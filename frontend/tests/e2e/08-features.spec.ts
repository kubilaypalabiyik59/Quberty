import { test, expect } from '@playwright/test';
import { erpLogin, apiLogin, apiGet, apiPost, TEST_ADMIN, authHeaders, API_URL } from './helpers';

// ════════════════════════════════════════════════════════════════════════════
// Audit Log Viewer
// ════════════════════════════════════════════════════════════════════════════
test.describe('Audit Log Viewer', () => {
  test.beforeEach(async ({ page }) => {
    await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  });

  test('audit page loads with table and method filter', async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByRole('main').getByRole('heading', { name: 'Audit Log' })).toBeVisible();
    await expect(page.getByRole('main').locator('table')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('th:has-text("Method")')).toBeVisible();
    await expect(page.locator('th:has-text("Path")')).toBeVisible();
    await expect(page.locator('select').filter({ hasText: 'All methods' })).toBeVisible();
  });

  test('audit log shows entries (writes are recorded)', async ({ page }) => {
    await page.goto('/audit');
    // There should be at least one row (the suite has done many writes)
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 8_000 });
    // A method badge should be visible
    await expect(page.locator('tbody').getByText(/POST|PUT|DELETE/).first()).toBeVisible();
  });

  test('method filter narrows results to POST', async ({ page }) => {
    await page.goto('/audit');
    await page.locator('select').selectOption('POST');
    await page.waitForTimeout(800);
    // Every visible method badge in the body should read POST
    const badges = page.locator('tbody tr td:nth-child(3)');
    const count = await badges.count();
    if (count > 0) {
      for (let i = 0; i < Math.min(count, 5); i++) {
        await expect(badges.nth(i)).toHaveText(/POST/);
      }
    }
  });

  test('GET /audit requires admin (returns data for admin)', async ({ request }) => {
    const auth = await apiLogin(request);
    const res = await apiGet(request, '/audit?limit=5', auth);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Low Stock Alerts + Reorder Points
// ════════════════════════════════════════════════════════════════════════════
test.describe('Low Stock + Reorder Points', () => {
  test('low-stock page loads', async ({ page }) => {
    await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
    await page.goto('/inventory/low-stock');
    await expect(page.getByRole('main').getByRole('heading', { name: 'Low Stock' })).toBeVisible();
    await expect(page.getByRole('main').locator('table')).toBeVisible({ timeout: 8_000 });
  });

  test('setting a high reorder point makes the product appear in low-stock', async ({ page, request }) => {
    const auth = await apiLogin(request);

    // Pick a product
    const prodRes = await apiGet(request, '/products?limit=1', auth);
    const prodBody = await prodRes.json();
    const products = Array.isArray(prodBody.data) ? prodBody.data : (prodBody.data?.products ?? []);
    if (!products.length) { test.skip(true, 'No products'); return; }
    const product = products[0];

    // Set an impossibly high reorder point so it's guaranteed low
    await request.put(`${API_URL}/products/${product.id}`, {
      data: { reorder_point: 99999 }, headers: authHeaders(auth),
    });

    try {
      // API: low-stock endpoint should now include it
      const lowRes = await apiGet(request, '/inventory/low-stock', auth);
      const lowBody = await lowRes.json();
      const found = (lowBody.data ?? []).find((x: any) => x.id === product.id);
      expect(found).toBeTruthy();
      expect(found.reorder_point).toBe(99999);
      expect(found.shortfall).toBeGreaterThan(0);

      // UI: it should be listed on the low-stock page
      await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
      await page.goto('/inventory/low-stock');
      await expect(page.locator(`text=${product.name}`).first()).toBeVisible({ timeout: 8_000 });
      await expect(page.locator('text=need attention')).toBeVisible();
    } finally {
      // Cleanup: turn monitoring back off
      await request.put(`${API_URL}/products/${product.id}`, {
        data: { reorder_point: 0 }, headers: authHeaders(auth),
      });
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Bulk Actions on Products
// ════════════════════════════════════════════════════════════════════════════
test.describe('Bulk Actions (Products)', () => {
  test.beforeEach(async ({ page }) => {
    await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
    await page.goto('/products');
    await expect(page.getByRole('main').locator('table')).toBeVisible({ timeout: 8_000 });
    // Wait until real product rows (with checkboxes) have loaded, not skeleton rows
    await expect(page.locator('tbody input[type="checkbox"]').first()).toBeVisible({ timeout: 8_000 });
  });

  test('selecting a row reveals the bulk action bar', async ({ page }) => {
    // First data row checkbox (skip header checkbox)
    const firstRowCheckbox = page.locator('tbody tr').first().locator('input[type="checkbox"]');
    await firstRowCheckbox.check();
    const bar = page.getByTestId('bulk-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('selected');
    await expect(bar.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Unpublish' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Delete' })).toBeVisible();
  });

  test('select-all header checkbox selects every row', async ({ page }) => {
    const totalCheckboxes = await page.locator('tbody input[type="checkbox"]').count();
    await page.locator('thead input[type="checkbox"]').check();
    await expect(page.locator('tbody input[type="checkbox"]:checked')).toHaveCount(totalCheckboxes);
    await expect(page.getByTestId('bulk-bar')).toContainText(`${totalCheckboxes} selected`);
  });

  test('Clear button deselects all', async ({ page }) => {
    await page.locator('thead input[type="checkbox"]').check();
    await expect(page.getByTestId('bulk-bar')).toBeVisible();
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByTestId('bulk-bar')).not.toBeVisible();
  });

  test('bulk publish updates products', async ({ page }) => {
    const firstRowCheckbox = page.locator('tbody tr').first().locator('input[type="checkbox"]');
    await firstRowCheckbox.check();
    await page.getByTestId('bulk-bar').getByRole('button', { name: 'Publish', exact: true }).click();
    // Bulk bar clears on success
    await expect(page.getByTestId('bulk-bar')).not.toBeVisible({ timeout: 8_000 });
  });
});
