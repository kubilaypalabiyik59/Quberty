import { test, expect } from '@playwright/test';
import { erpLogin, apiLogin, apiGet, apiPost, TEST_ADMIN } from './helpers';

// ── UI-only tests (no data dependency) ───────────────────────────────────────

test.describe('Purchase Orders — UI', () => {
  test.beforeEach(async ({ page }) => {
    await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  });

  test('list page loads with table and New PO button', async ({ page }) => {
    await page.goto('/purchase/orders');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Purchase Orders' })).toBeVisible();
    await expect(main.locator('table')).toBeVisible({ timeout: 8_000 });
    await expect(main.getByRole('button', { name: 'New PO' })).toBeVisible();
  });

  test('table columns are visible', async ({ page }) => {
    await page.goto('/purchase/orders');
    await expect(page.locator('th:has-text("PO #")')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('th:has-text("Supplier")')).toBeVisible();
    await expect(page.locator('th:has-text("Status")')).toBeVisible();
    await expect(page.locator('th:has-text("Total")')).toBeVisible();
  });

  test('New PO button shows the create form', async ({ page }) => {
    await page.goto('/purchase/orders');
    await page.getByRole('main').getByRole('button', { name: 'New PO' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'New Purchase Order' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Order Lines')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Purchase Order' })).toBeVisible();
  });

  test('Create PO button is disabled until supplier + warehouse + product are set', async ({ page }) => {
    await page.goto('/purchase/orders');
    await page.getByRole('main').getByRole('button', { name: 'New PO' }).click();
    await expect(page.getByRole('button', { name: 'Create Purchase Order' })).toBeDisabled({ timeout: 5_000 });
  });

  test('Cancel on PO form returns to list', async ({ page }) => {
    await page.goto('/purchase/orders');
    await page.getByRole('main').getByRole('button', { name: 'New PO' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('main').getByRole('heading', { name: 'Purchase Orders' })).toBeVisible({ timeout: 5_000 });
  });

  test('PO form has Supplier, Warehouse and Expected Date fields', async ({ page }) => {
    await page.goto('/purchase/orders');
    await page.getByRole('main').getByRole('button', { name: 'New PO' }).click();
    await expect(page.getByText('Supplier', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Warehouse', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Expected', { exact: false }).first()).toBeVisible();
  });
});

// ── Full lifecycle test ───────────────────────────────────────────────────────

test('Purchase Order full lifecycle: DRAFT → CONFIRMED → RECEIVED → Paid', async ({ page, request }) => {
  // ── 1. API setup ────────────────────────────────────────────────────────────
  const auth = await apiLogin(request);

  // Get or create a supplier
  const suppRes  = await apiGet(request, '/purchase/suppliers', auth);
  const suppBody = await suppRes.json();
  let suppliers: any[] = suppBody.data ?? [];

  if (!suppliers.length) {
    const newSupp = await apiPost(request, '/purchase/suppliers', {
      code: 'TEST-SUPP-01',
      name: 'Test Supplier (Playwright)',
      country: 'BO',
      currency: 'BOB',
    }, auth);
    const ns = await newSupp.json();
    suppliers = [ns.data];
  }

  // Get a warehouse
  const whRes  = await apiGet(request, '/warehouse/warehouses', auth);
  const whBody = await whRes.json();
  const warehouses: any[] = whBody.data ?? [];

  // Get a receive location
  const locRes  = await apiGet(request, '/warehouse/locations', auth);
  const locBody = await locRes.json();
  const locations: any[] = locBody.data ?? [];

  // Get a product
  const prodRes  = await apiGet(request, '/products?limit=5', auth);
  const prodBody = await prodRes.json();
  const products = Array.isArray(prodBody.data)
    ? prodBody.data
    : (prodBody.data?.products ?? prodBody.data?.data ?? []);

  if (!suppliers.length || !warehouses.length || !locations.length || !products.length) {
    test.skip(true, 'Missing suppliers/warehouses/locations/products — skipping PO lifecycle');
    return;
  }

  // Create PO via API
  const poRes  = await apiPost(request, '/purchase/orders', {
    supplier_id:         suppliers[0].id,
    warehouse_id:        warehouses[0].id,
    receive_location_id: locations[0].id,
    currency:            'BOB',
    lines: [{ product_id: products[0].id, quantity: 5, unit_cost: 50 }],
  }, auth);
  const poBody = await poRes.json();
  const poNumber: string = poBody.data?.po_number;
  expect(poNumber).toBeTruthy();

  // ── 2. PO appears in list as DRAFT ──────────────────────────────────────────
  await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await page.goto('/purchase/orders');
  await expect(page.locator(`text=${poNumber}`).first()).toBeVisible({ timeout: 8_000 });

  const row = page.locator('tr').filter({ hasText: poNumber }).first();
  await expect(row.locator('text=DRAFT')).toBeVisible();

  // ── 3. Confirm → CONFIRMED ──────────────────────────────────────────────────
  await row.locator('button:has-text("Confirm")').click();
  await expect(row.locator('text=CONFIRMED')).toBeVisible({ timeout: 8_000 });

  // ── 4. Receive PO ────────────────────────────────────────────────────────────
  const receiveBtn = row.locator('button:has-text("Receive")');
  await expect(receiveBtn).toBeVisible({ timeout: 5_000 });
  await receiveBtn.click();

  // Receive modal
  await expect(page.getByRole('heading', { name: 'Receive Purchase Order' })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Receive Into Location')).toBeVisible();

  // Select location (first real option in the modal's location dropdown)
  const locSelect = page.locator('select').filter({ has: page.locator('option[value=""]') }).last();
  await locSelect.selectOption({ index: 1 });

  // Choose "No, just receive" to skip packing slip
  await page.getByRole('button', { name: 'No, just receive' }).click();

  await page.getByRole('button', { name: 'Confirm & Receive' }).click();
  await expect(page.getByRole('heading', { name: 'Receive Purchase Order' })).not.toBeVisible({ timeout: 8_000 });

  // RECEIVED badge
  await expect(row.locator('text=RECEIVED')).toBeVisible({ timeout: 8_000 });

  // ── 5. Pay Supplier ──────────────────────────────────────────────────────────
  const payBtn = row.locator('button:has-text("Pay Supplier")');
  await expect(payBtn).toBeVisible({ timeout: 5_000 });
  await payBtn.click();

  // Pay modal
  await expect(page.getByRole('heading', { name: 'Pay Supplier' })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Cuentas por Pagar')).toBeVisible();
  await expect(page.locator('input[type="date"]').first()).toBeVisible();

  await page.getByRole('button', { name: 'Record Payment' }).click();
  await expect(page.getByRole('heading', { name: 'Pay Supplier' })).not.toBeVisible({ timeout: 8_000 });

  // Paid badge
  await expect(row.locator('text=Paid').first()).toBeVisible({ timeout: 8_000 });
});

// ── Suppliers sub-section ─────────────────────────────────────────────────────

test.describe('Suppliers — UI', () => {
  test.beforeEach(async ({ page }) => {
    await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  });

  test('suppliers page loads', async ({ page }) => {
    await page.goto('/purchase/suppliers');
    await expect(
      page.locator('h1, h2').filter({ hasText: /supplier/i }).first()
    ).toBeVisible({ timeout: 8_000 });
  });
});
