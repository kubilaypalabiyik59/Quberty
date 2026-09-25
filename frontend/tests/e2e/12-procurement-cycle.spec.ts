import { test, expect } from '@playwright/test';
import { erpLogin, TEST_ADMIN } from './helpers';

/**
 * Requisition → RFQ → purchase order, clicked through the screens the way a
 * buyer does it. The API-level run with separate roles, confirmation and the
 * receipt is backend/scripts/verifyProcurementCycle.ts; confirming and
 * receiving an order on screen is 07-purchase-orders.
 */
test('a requisition goes to tender and the award raises a purchase order', async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = `E2E tender ${Date.now().toString(36)}`;
  await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);

  // ── Create the requisition ─────────────────────────────────────────────────
  await page.goto('/procurement/requisitions');
  await page.getByRole('button', { name: 'New requisition' }).click();
  const dialog = page.locator('div.fixed').filter({ hasText: 'New purchase requisition' });
  await dialog.locator('select').first().selectOption({ index: 1 });                  // warehouse
  await dialog.locator('input').first().fill(stamp);                                  // justification
  await dialog.getByLabel('Product for line 1').selectOption({ index: 1 });
  await dialog.getByRole('button', { name: 'Create requisition' }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  // ── Submit, approve, send to tender ────────────────────────────────────────
  await page.locator('tr', { hasText: stamp }).locator('a').first().click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByRole('button', { name: /Approve/ }).click();
  await expect(page.getByText('APPROVED').first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Send to tender' }).click();
  await page.waitForURL('**/procurement/rfq/**', { timeout: 10_000 });

  // ── Invite two vendors and send ────────────────────────────────────────────
  const invite = page.locator('select').filter({ hasText: 'Invite vendor…' });
  const bidRows = page.locator('table').filter({ hasText: 'VENDOR' }).locator('tbody tr');
  for (let i = 0; i < 2; i++) {
    await invite.selectOption({ index: 1 });
    await expect(bidRows).toHaveCount(i + 1, { timeout: 10_000 });   // wait for the invitation to land
  }
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('SENT').first()).toBeVisible({ timeout: 10_000 });

  // ── Enter both bids, award the first ───────────────────────────────────────
  const prices = ['9', '12'];
  for (const price of prices) {
    await page.getByRole('button', { name: 'Enter bid' }).first().click();
    await page.getByPlaceholder('unit price').first().fill(price);
    await page.getByRole('button', { name: 'Save bid' }).click();
    await expect(page.getByRole('button', { name: 'Save bid' })).toBeHidden({ timeout: 10_000 });
  }
  await expect(page.getByRole('button', { name: /Award/ })).toHaveCount(2);
  await page.getByRole('button', { name: /Award/ }).first().click();

  // The tender closes and links the purchase order it raised.
  await expect(page.getByText(/CLOSED|AWARDED/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('a[href^="/purchase/orders/"]').first()).toBeVisible({ timeout: 10_000 });
});
