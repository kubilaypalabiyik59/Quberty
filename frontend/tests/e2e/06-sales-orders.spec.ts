import { test, expect } from '@playwright/test';
import { erpLogin, apiLogin, apiGet, apiPost, TEST_ADMIN } from './helpers';

// ── UI-only tests (no data dependency) ───────────────────────────────────────

test.describe('Sales Orders — UI', () => {
  test.beforeEach(async ({ page }) => {
    await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  });

  test('list page loads with table and New Order button', async ({ page }) => {
    await page.goto('/sales/orders');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Sales Orders' })).toBeVisible();
    await expect(main.locator('table')).toBeVisible({ timeout: 8_000 });
    await expect(main.getByRole('button', { name: 'New Order' })).toBeVisible();
  });

  test('status filter dropdown is visible', async ({ page }) => {
    await page.goto('/sales/orders');
    await expect(
      page.getByRole('main').locator('select').filter({ hasText: 'All Statuses' })
    ).toBeVisible({ timeout: 8_000 });
  });

  test('New Order shows the SO create form', async ({ page }) => {
    await page.goto('/sales/orders');
    await page.getByRole('main').getByRole('button', { name: 'New Order' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'New Sales Order' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Order Lines')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Sales Order' })).toBeVisible();
  });

  test('Create Sales Order button is disabled until a product is selected', async ({ page }) => {
    await page.goto('/sales/orders');
    await page.getByRole('main').getByRole('button', { name: 'New Order' }).click();
    await expect(page.getByRole('button', { name: 'Create Sales Order' })).toBeDisabled({ timeout: 5_000 });
  });

  test('Cancel on SO form returns to list', async ({ page }) => {
    await page.goto('/sales/orders');
    await page.getByRole('main').getByRole('button', { name: 'New Order' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('main').getByRole('heading', { name: 'Sales Orders' })).toBeVisible({ timeout: 5_000 });
  });

  test('SO form has Customer, Warehouse, Discount and Notes fields', async ({ page }) => {
    await page.goto('/sales/orders');
    await page.getByRole('main').getByRole('button', { name: 'New Order' }).click();
    await expect(page.getByText('Customer', { exact: true })).toBeVisible();
    await expect(page.getByText('Warehouse (for stock picking)')).toBeVisible();
    await expect(page.getByText('Discount Amount (Bs.)')).toBeVisible();
    await expect(page.getByText('Notes', { exact: true })).toBeVisible();
  });

  test('Add line button adds a new product row', async ({ page }) => {
    await page.goto('/sales/orders');
    await page.getByRole('main').getByRole('button', { name: 'New Order' }).click();
    const productSelects = page.locator('tbody select').first();
    await expect(productSelects).toBeVisible({ timeout: 5_000 });
    const initial = await page.locator('tbody tr').count();
    await page.getByText('Add line').click();
    await expect(page.locator('tbody tr')).toHaveCount(initial + 1);
  });
});

// ── Full lifecycle test ───────────────────────────────────────────────────────

test('Sales Order full lifecycle: DRAFT → CONFIRMED → Invoiced → Paid', async ({ page, request }) => {
  // ── 1. API setup ────────────────────────────────────────────────────────────
  const auth = await apiLogin(request);

  const prodRes  = await apiGet(request, '/products?limit=5', auth);
  const prodBody = await prodRes.json();
  const products = Array.isArray(prodBody.data)
    ? prodBody.data
    : (prodBody.data?.products ?? prodBody.data?.data ?? []);

  if (!products.length) {
    test.skip(true, 'No products in DB — skipping SO lifecycle test');
    return;
  }

  const soRes  = await apiPost(request, '/sales/orders', {
    currency: 'BOB',
    lines: [{ product_id: products[0].id, quantity: 1, unit_price: 115 }],
  }, auth);
  const soBody = await soRes.json();
  const orderNumber: string = soBody.data?.order_number;
  expect(orderNumber).toBeTruthy();

  // ── 2. SO appears in list as DRAFT ──────────────────────────────────────────
  await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await page.goto('/sales/orders');
  await expect(page.locator(`text=${orderNumber}`).first()).toBeVisible({ timeout: 8_000 });

  const row = page.locator('tr').filter({ hasText: orderNumber }).first();
  await expect(row.locator('text=DRAFT')).toBeVisible();

  // ── 3. Confirm → CONFIRMED ──────────────────────────────────────────────────
  await row.locator('button:has-text("Confirm")').click();
  await expect(row.locator('text=CONFIRMED')).toBeVisible({ timeout: 8_000 });

  // ── 4. Issue Factura ─────────────────────────────────────────────────────────
  // "Issue" button appears in the Invoice column for CONFIRMED orders
  const issueBtn = row.locator('button:has-text("Issue")');
  await expect(issueBtn).toBeVisible({ timeout: 5_000 });
  await issueBtn.click();

  // Invoice modal — Bolivia tax breakdown shown (modal is the only thing on screen now)
  await expect(page.getByRole('heading', { name: 'Fatura Oluştur' })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('IVA 13%', { exact: false })).toBeVisible();
  await expect(page.getByText('IT 3%', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Issue Factura' }).click();
  await expect(page.getByRole('heading', { name: 'Fatura Oluştur' })).not.toBeVisible({ timeout: 8_000 });

  // Invoiced badge
  await expect(row.locator('text=Invoiced')).toBeVisible({ timeout: 8_000 });

  // ── 5. Collect AR Payment ────────────────────────────────────────────────────
  const collectBtn = row.locator('button:has-text("Collect")');
  await expect(collectBtn).toBeVisible({ timeout: 5_000 });
  await collectBtn.click();

  // AR Pay modal
  await expect(page.getByRole('heading', { name: 'Collect Payment' })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Cuentas por Cobrar')).toBeVisible();
  await expect(page.locator('input[type="date"]').first()).toBeVisible();

  await page.getByRole('button', { name: 'Record Payment' }).click();
  await expect(page.getByRole('heading', { name: 'Collect Payment' })).not.toBeVisible({ timeout: 8_000 });

  // Paid badge
  await expect(row.locator('text=Paid').first()).toBeVisible({ timeout: 8_000 });
});

// ── SO detail page ────────────────────────────────────────────────────────────

test('SO detail page loads for an existing order', async ({ page, request }) => {
  const auth = await apiLogin(request);

  const soRes  = await apiGet(request, '/sales/orders?limit=1', auth);
  const soBody = await soRes.json();
  const orders = soBody.data?.orders ?? [];

  if (!orders.length) {
    test.skip(true, 'No sales orders — skipping detail page test');
    return;
  }

  await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await page.goto(`/sales/orders/${orders[0].id}`);
  await expect(page).toHaveURL(/sales\/orders\/.+/);
  await expect(
    page.locator(`text=${orders[0].order_number}`).first()
  ).toBeVisible({ timeout: 8_000 });
});
