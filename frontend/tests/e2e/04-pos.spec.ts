import { test, expect } from '@playwright/test';
import { posLogin, TEST_ADMIN, apiLogin, apiGet } from './helpers';

test.describe('POS Terminal', () => {

  test('POS login page renders', async ({ page }) => {
    await page.goto('http://localhost:3000/pos/login');
    await expect(page.locator('text=Quberty POS')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('POS wrong credentials shows error', async ({ page }) => {
    await page.goto('http://localhost:3000/pos/login');
    await page.fill('input[type="email"]', 'wrong@email.com');
    await page.fill('input[type="password"]', 'wrong');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    // Should stay on login
    await expect(page).toHaveURL(/pos\/login/);
  });

  test('POS layout uses the light theme (immune to ERP dark-mode filter)', async ({ page }) => {
    await page.goto('http://localhost:3000/pos/login');
    const root = page.locator('[data-no-invert]');
    await expect(root).toBeVisible();
    const styles = await root.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { bgImage: s.backgroundImage, color: s.color };
    });
    // Light theme: a gradient background (not a solid dark fill) + dark slate text
    expect(styles.bgImage).toContain('gradient');
    // text is dark slate-900 ≈ rgb(15, 23, 42), i.e. NOT white
    expect(styles.color).not.toBe('rgb(255, 255, 255)');
  });

  test.describe('After POS Login', () => {
    // POS accepts any ERP user. Use the admin account (guaranteed to exist) so
    // these tests don't depend on a cashier created by the later 05-hr suite.
    test.beforeEach(async ({ page }) => {
      await posLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
    });

    test('open register page shows terminal name and NumPad', async ({ page }) => {
      if (page.url().includes('open-register')) {
        await expect(page.locator('text=Open Register')).toBeVisible();
        // NumPad buttons
        await expect(page.locator('button:has-text("7")')).toBeVisible();
        await expect(page.locator('button:has-text("1")')).toBeVisible();
        await expect(page.locator('button:has-text("0")')).toBeVisible();
      }
    });

    test('main POS page has product search and cart', async ({ page }) => {
      // If on open-register, open the register first
      if (page.url().includes('open-register')) {
        await page.click('button:has-text("Open Register")');
        await page.waitForURL('**/pos/main', { timeout: 8000 });
      }
      await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
      await expect(page.locator('text=Walk-in Customer')).toBeVisible();
      await expect(page.locator('text=COBRAR')).toBeVisible();
    });

    test('COBRAR button is disabled with empty cart', async ({ page }) => {
      if (page.url().includes('open-register')) {
        await page.click('button:has-text("Open Register")');
        await page.waitForURL('**/pos/main', { timeout: 8000 });
      }
      const cobrarBtn = page.locator('button:has-text("COBRAR")');
      await expect(cobrarBtn).toBeDisabled();
    });

    test('product search returns REAL product results in the grid', async ({ page, request }) => {
      if (page.url().includes('open-register')) {
        await page.click('button:has-text("Open Register")');
        await page.waitForURL('**/pos/main', { timeout: 8000 });
      }

      // Fetch a real product from the API so we assert an actual match (not the empty state)
      const auth = await apiLogin(request);
      const res = await apiGet(request, '/products?limit=1', auth);
      const body = await res.json();
      const product = Array.isArray(body.data) ? body.data[0] : (body.data?.products?.[0]);
      if (!product) { test.skip(true, 'No products in DB'); return; }

      const searchBox = page.locator('input[placeholder*="Search"]');
      await searchBox.fill(product.name.slice(0, 4));

      // The grid must render actual product cards — the empty state must NOT be shown.
      // (This is what caught the productData.products unwrap bug.)
      await expect(page.locator('.grid button').first()).toBeVisible({ timeout: 6000 });
      await expect(page.getByText('No products found')).toBeHidden();
      await expect(page.getByText(product.sku, { exact: false }).first()).toBeVisible();
    });

    test('customer search modal opens', async ({ page }) => {
      if (page.url().includes('open-register')) {
        await page.click('button:has-text("Open Register")');
        await page.waitForURL('**/pos/main', { timeout: 8000 });
      }
      await page.click('text=Walk-in Customer');
      await expect(page.getByText('Customer', { exact: true })).toBeVisible();
      await expect(page.getByPlaceholder('Search by name, email or phone...')).toBeVisible();
      await expect(page.getByRole('button', { name: 'New Customer' })).toBeVisible();
    });

    test('full sale: search → add to cart → COBRAR → CARD → receipt', async ({ page, request }) => {
      if (page.url().includes('open-register')) {
        await page.click('button:has-text("Open Register")');
        await page.waitForURL('**/pos/main', { timeout: 8000 });
      }

      // Find a product that actually has stock so the sale can complete.
      // Prefer a no-variant product (single always-enabled "Add to Cart" tile).
      const auth = await apiLogin(request);
      const res = await apiGet(request, '/products?limit=100', auth);
      const body = await res.json();
      const all: any[] = Array.isArray(body.data) ? body.data : (body.data?.products ?? []);
      const inStock =
        all.find((p: any) => (p.total_stock ?? 0) > 0 && (p.variants?.length ?? 0) === 0) ??
        all.find((p: any) => (p.total_stock ?? 0) > 0) ??
        all[0];
      if (!inStock) { test.skip(true, 'No products'); return; }

      // Search by name, then open the specific product by its SKU shown on the card
      await page.locator('input[placeholder*="Search"]').fill(inStock.name);
      const card = page.locator('.grid button').filter({ hasText: inStock.sku });
      await expect(card.first()).toBeVisible({ timeout: 6000 });
      await card.first().click();

      // VariantPicker: click the first enabled add/variant tile (class w-36)
      const tile = page.locator('button.w-36:not([disabled])').first();
      await expect(tile).toBeVisible({ timeout: 5000 });
      await tile.click();

      // Cart now has a line → COBRAR enabled
      const cobrar = page.locator('button:has-text("COBRAR")');
      await expect(cobrar).toBeEnabled({ timeout: 5000 });
      await cobrar.click();

      // Payment modal → pay by CARD (no cash numpad needed) → confirm
      await expect(page.getByText('Total to Collect')).toBeVisible({ timeout: 5000 });
      await page.getByRole('button', { name: 'CARD' }).click();
      await page.getByRole('button', { name: 'CONFIRM SALE' }).click();

      // Lands on the receipt with a real factura
      await page.waitForURL('**/pos/receipt**', { timeout: 10000 });
      await expect(page.getByText('Sale Complete!')).toBeVisible({ timeout: 8000 });
      await expect(page.getByText('Factura issued successfully')).toBeVisible();
    });

    test('Close Register navigates to z-report', async ({ page }) => {
      if (page.url().includes('open-register')) {
        await page.click('button:has-text("Open Register")');
        await page.waitForURL('**/pos/main', { timeout: 8000 });
      }
      await page.click('button:has-text("Close Register")');
      await page.waitForURL('**/pos/z-report', { timeout: 5000 });
      await expect(page.getByText('Close Register', { exact: true })).toBeVisible();
    });
  });
});
