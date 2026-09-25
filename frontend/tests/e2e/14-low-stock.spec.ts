import { test, expect } from '@playwright/test';
import { erpLogin, apiLogin, apiGet, TEST_ADMIN } from './helpers';

/**
 * Low-stock rules end to end: add a rule, see the product flagged on the page
 * and in the notification bell, edit it, remove it. The rule goes on a product
 * that was not monitored, so removing it restores the data.
 */
test('add, see in the bell, edit and remove a low-stock rule', async ({ page, request }) => {
  const auth = await apiLogin(request);
  const monitored = new Set(((await (await apiGet(request, '/inventory/low-stock?scope=all', auth)).json()).data ?? []).map((r: any) => r.id));
  const products: any[] = (await (await apiGet(request, '/products?limit=100', auth)).json()).data ?? [];
  const target = products.find((p) => (p.product_type ?? 'physical') === 'physical' && !monitored.has(p.id) && !/^Verify/.test(p.name));
  test.skip(!target, 'No unmonitored physical product');

  await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await page.goto('/inventory/low-stock');

  // Add: a reorder point far above any stock, so the product is flagged.
  await page.getByRole('button', { name: 'New rule' }).click();
  await page.getByLabel('Find a product').fill(target.name);
  await page.getByLabel('Product', { exact: true }).selectOption(target.id);
  await page.getByLabel('Reorder point (units)').fill('99999');
  await page.getByRole('button', { name: 'Add rule' }).click();
  const row = page.locator('tr', { hasText: target.sku });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row).toContainText('99999');

  // The bell counts it and lists it.
  await page.reload();
  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.getByText('Low stock ·')).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(target.name) }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { level: 1 }).first().click();

  // Edit
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Reorder point (units)').fill('88888');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('88888');

  // Remove — the product is no longer monitored.
  page.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('tr', { hasText: target.sku })).toHaveCount(0, { timeout: 10_000 });
});
