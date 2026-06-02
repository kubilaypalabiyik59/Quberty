import { test } from '@playwright/test';
import { erpLogin, posLogin, TEST_ADMIN, TEST_CASHIER } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Documentation screenshot capture.
 * Logs in once, visits every module page, and saves a full-page PNG per screen
 * into docs/manual/img/. Special interactions (open create forms / modals) are
 * wrapped in try/catch so one failing screen never aborts the whole run.
 *
 * Run with:  npx playwright test 99-screenshots --workers=1
 */

const OUT = path.resolve(__dirname, '../../../docs/manual/img');
fs.mkdirSync(OUT, { recursive: true });

async function shoot(page: any, slug: string) {
  // settle: let queries resolve + animations finish
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, `${slug}.png`), fullPage: true });
  console.log(`  ✓ ${slug}.png`);
}

// [slug, route, optional interaction]
const ERP_ROUTES: Array<[string, string, ((page: any) => Promise<void>)?]> = [
  ['dashboard', '/dashboard'],
  // Products
  ['products-list', '/products'],
  ['products-new', '/products/new'],
  ['products-variants', '/products/variants'],
  ['products-categories', '/products/categories'],
  ['products-uom', '/products/uom'],
  // Sales
  ['sales-orders-list', '/sales/orders'],
  ['sales-customers', '/sales/customers'],
  // Purchase
  ['purchase-orders', '/purchase/orders'],
  ['purchase-suppliers', '/purchase/suppliers'],
  // Inventory
  ['inventory-stock', '/inventory/stock'],
  ['inventory-low-stock', '/inventory/low-stock'],
  ['inventory-transactions', '/inventory/transactions'],
  ['inventory-counting', '/inventory/counting'],
  ['inventory-transfers', '/inventory/transfers'],
  // Warehouse
  ['warehouse-work', '/warehouse/work'],
  ['warehouse-waves', '/warehouse/waves'],
  ['warehouse-arrival', '/warehouse/arrival'],
  ['warehouse-locations', '/warehouse/locations'],
  // Finance
  ['finance-accounts', '/finance/accounts'],
  ['finance-journal', '/finance/journal'],
  ['finance-facturas', '/finance/facturas'],
  ['finance-iva-report', '/finance/iva-report'],
  ['finance-p-and-l', '/finance/p-and-l'],
  ['finance-balance-sheet', '/finance/balance-sheet'],
  ['finance-aging', '/finance/aging'],
  ['finance-periods', '/finance/periods'],
  ['finance-bank-reconciliation', '/finance/bank-reconciliation'],
  ['finance-coa-templates', '/finance/coa-templates'],
  // Management
  ['reports', '/reports'],
  ['import', '/import'],
  ['hr-employees', '/hr'],
  ['hr-payroll', '/hr/payroll'],
  ['audit', '/audit'],
  ['settings', '/settings'],
  ['setup', '/setup'],
];

test('capture all ERP module screenshots', async ({ page }) => {
  test.setTimeout(300_000);
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);

  for (const [slug, route] of ERP_ROUTES) {
    try {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await shoot(page, slug);
    } catch (e) {
      console.log(`  ✗ ${slug} (${route}) failed: ${(e as Error).message}`);
    }
  }
});

test('capture Sales Order create form (customer + price)', async ({ page }) => {
  test.setTimeout(120_000);
  await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await page.goto('/sales/orders', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  // Open the inline "New Sales Order" form
  await page.getByRole('button', { name: 'New Order' }).click();
  await page.waitForTimeout(1200);
  await shoot(page, 'sales-order-form-empty');

  // Pick the first real customer (skip the "Walk-in" placeholder option)
  try {
    const custSelect = page.locator('select').first();
    const opts = await custSelect.locator('option').all();
    if (opts.length > 1) {
      const val = await opts[1].getAttribute('value');
      if (val) await custSelect.selectOption(val);
    }
  } catch (e) { console.log('customer select skipped:', (e as Error).message); }

  // Pick the first real product in line 1 → unit price auto-fills
  try {
    const productSelect = page.locator('table select').first();
    const popts = await productSelect.locator('option').all();
    if (popts.length > 1) {
      const val = await popts[1].getAttribute('value');
      if (val) await productSelect.selectOption(val);
    }
    await page.waitForTimeout(600);
  } catch (e) { console.log('product select skipped:', (e as Error).message); }

  await shoot(page, 'sales-order-form-filled');
});

test('capture New Customer form', async ({ page }) => {
  test.setTimeout(90_000);
  await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await page.goto('/sales/customers', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  try {
    await page.getByRole('button', { name: 'New Customer' }).click();
    await page.waitForTimeout(1000);
    await shoot(page, 'customer-form');
  } catch (e) { console.log('customer form failed:', (e as Error).message); }
});

test('capture New Purchase Order form', async ({ page }) => {
  test.setTimeout(90_000);
  await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await page.goto('/purchase/orders', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  try {
    await page.getByRole('button', { name: /New PO|New Purchase Order/ }).first().click();
    await page.waitForTimeout(1200);
    await shoot(page, 'purchase-order-form');
  } catch (e) { console.log('PO form failed:', (e as Error).message); }
});

test('capture POS flow', async ({ page }) => {
  test.setTimeout(120_000);
  // POS login page itself
  await page.goto('/pos/login', { waitUntil: 'domcontentloaded' });
  await shoot(page, 'pos-login');

  // Try cashier first, fall back to admin (cashier may not be seeded)
  let loggedIn = false;
  for (const cred of [
    { email: TEST_CASHIER.email, password: TEST_CASHIER.password },
    { email: TEST_ADMIN.email, password: TEST_ADMIN.password },
  ]) {
    try {
      await posLogin(page, cred.email, cred.password);
      loggedIn = true;
      break;
    } catch { /* try next */ }
  }
  if (!loggedIn) { console.log('POS login failed for all creds'); return; }

  await page.waitForTimeout(1200);
  if (page.url().includes('open-register')) {
    await shoot(page, 'pos-open-register');
    try {
      // Enter an opening float then open the register
      const float = page.getByPlaceholder(/Opening Float|Float/i).first();
      if (await float.count()) await float.fill('500');
      await page.getByRole('button', { name: /Open Register/i }).first().click();
      await page.waitForURL(/pos\/main/, { timeout: 10000 });
      await page.waitForTimeout(1000);
    } catch (e) { console.log('open-register step skipped:', (e as Error).message); }
  }
  if (page.url().includes('main')) {
    await shoot(page, 'pos-main');
  }
});

test('capture storefront', async ({ page }) => {
  test.setTimeout(120_000);
  for (const [slug, route] of [
    ['store-shop', '/shop'],
    ['store-login', '/store/login'],
    ['store-register', '/store/register'],
    ['store-cart', '/cart'],
  ] as Array<[string, string]>) {
    try {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await shoot(page, slug);
    } catch (e) { console.log(`  ✗ ${slug} failed: ${(e as Error).message}`); }
  }
});
