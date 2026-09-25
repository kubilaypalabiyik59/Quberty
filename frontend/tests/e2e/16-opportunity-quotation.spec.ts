import { test, expect } from '@playwright/test';
import { erpLogin, apiLogin, apiGet, TEST_ADMIN } from './helpers';

/**
 * An opportunity says what is being sold through its quotation: New quotation
 * on the opportunity takes products and prices and opens the quotation.
 */
test('an open opportunity raises a quotation with product lines', async ({ page, request }) => {
  const auth = await apiLogin(request);
  const res = await apiGet(request, '/crm/opportunities?status=OPEN&limit=50', auth);
  const body = await res.json();
  const list: any[] = Array.isArray(body.data) ? body.data : body.data?.opportunities ?? [];
  const opp = list.find((o) => o.status === 'OPEN' && (o.customer_id || o.lead_id));
  test.skip(!opp, 'No open opportunity');

  await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await page.goto(`/crm/opportunities/${opp.id}`);
  await page.getByRole('button', { name: 'New quotation' }).click();

  await page.getByLabel('Product for line 1').selectOption({ index: 1 });
  await expect(page.getByLabel('Unit price for line 1')).not.toHaveValue('');   // taken from the product
  await page.getByLabel('Quantity for line 1').fill('2');
  await page.getByLabel('Discount for line 1').fill('10');
  await page.getByRole('button', { name: 'Create quotation' }).click();

  await page.waitForURL('**/sales/quotations/**', { timeout: 10_000 });
  await expect(page.getByText(opp.opportunity_number).first()).toBeVisible({ timeout: 10_000 });
});
