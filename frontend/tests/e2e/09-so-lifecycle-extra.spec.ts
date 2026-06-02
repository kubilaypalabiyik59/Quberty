import { test, expect } from '@playwright/test';
import { erpLogin, apiLogin, apiGet, apiPost, authHeaders, API_URL, TEST_ADMIN } from './helpers';

/**
 * Covers the Sales Order lifecycle branches NOT exercised by 06-sales-orders:
 * Ship, Complete, Cancel, Return. Stock transitions are driven through the API
 * (reliable), with a UI smoke check that the row action buttons work.
 */

async function createConfirmedSO(request: any, auth: any, product: any) {
  const soRes = await apiPost(request, '/sales/orders', {
    currency: 'BOB',
    warehouse_id: undefined,
    lines: [{ product_id: product.id, quantity: 1, unit_price: 115 }],
  }, auth);
  const so = (await soRes.json()).data;
  await apiPost(request, `/sales/orders/${so.id}/confirm`, {}, auth);
  return so;
}

async function firstProductWithStock(request: any, auth: any) {
  const res = await apiGet(request, '/products?limit=5&inStock=true', auth);
  const body = await res.json();
  const products = Array.isArray(body.data) ? body.data : (body.data?.products ?? body.data?.data ?? []);
  return products[0];
}

test('SO: confirm → ship → complete → return (full chain via API)', async ({ request }) => {
  const auth = await apiLogin(request);
  const product = await firstProductWithStock(request, auth);
  if (!product) { test.skip(true, 'No product in stock'); return; }

  const so = await createConfirmedSO(request, auth, product);

  // Ship
  const shipRes = await apiPost(request, `/sales/orders/${so.id}/ship`, {}, auth);
  expect(shipRes.ok()).toBeTruthy();
  expect((await shipRes.json()).data.status).toBe('SHIPPED');

  // Complete
  const compRes = await apiPost(request, `/sales/orders/${so.id}/complete`, {}, auth);
  expect(compRes.ok()).toBeTruthy();
  expect((await compRes.json()).data.status).toBe('COMPLETED');

  // Return — restores stock + credit note
  const retRes = await apiPost(request, `/sales/orders/${so.id}/return`, {}, auth);
  expect(retRes.ok()).toBeTruthy();
  const retBody = await retRes.json();
  expect(retBody.success).toBe(true);

  // Verify it's marked RETURNED
  const detail = await apiGet(request, `/sales/orders/${so.id}`, auth);
  expect((await detail.json()).data.status).toBe('RETURNED');
});

test('SO: cancel a DRAFT order via API', async ({ request }) => {
  const auth = await apiLogin(request);
  const product = await firstProductWithStock(request, auth);
  if (!product) { test.skip(true, 'No product'); return; }

  const soRes = await apiPost(request, '/sales/orders', {
    currency: 'BOB',
    lines: [{ product_id: product.id, quantity: 1, unit_price: 115 }],
  }, auth);
  const so = (await soRes.json()).data;
  expect(so.status).toBe('DRAFT');

  const cancelRes = await apiPost(request, `/sales/orders/${so.id}/cancel`, {}, auth);
  expect(cancelRes.ok()).toBeTruthy();
  expect((await cancelRes.json()).data.status).toBe('CANCELLED');
});

test('SO: Ship button works from the UI', async ({ page, request }) => {
  const auth = await apiLogin(request);
  const product = await firstProductWithStock(request, auth);
  if (!product) { test.skip(true, 'No product in stock'); return; }

  const so = await createConfirmedSO(request, auth, product);

  await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await page.goto('/sales/orders');
  const row = page.locator('tr').filter({ hasText: so.order_number }).first();
  await expect(row).toBeVisible({ timeout: 8_000 });
  await expect(row.locator('text=CONFIRMED')).toBeVisible();

  await row.getByRole('button', { name: 'Ship' }).click();
  await expect(row.locator('text=SHIPPED')).toBeVisible({ timeout: 8_000 });
});

test('SO: Cancel button works from the UI (with confirm dialog)', async ({ page, request }) => {
  const auth = await apiLogin(request);
  const product = await firstProductWithStock(request, auth);
  if (!product) { test.skip(true, 'No product'); return; }

  // DRAFT order
  const soRes = await apiPost(request, '/sales/orders', {
    currency: 'BOB',
    lines: [{ product_id: product.id, quantity: 1, unit_price: 115 }],
  }, auth);
  const so = (await soRes.json()).data;

  await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await page.goto('/sales/orders');
  const row = page.locator('tr').filter({ hasText: so.order_number }).first();
  await expect(row).toBeVisible({ timeout: 8_000 });

  page.on('dialog', d => d.accept()); // accept the "Cancel ...?" confirm()
  await row.getByRole('button', { name: 'Cancel' }).click();
  await expect(row.locator('text=CANCELLED')).toBeVisible({ timeout: 8_000 });
});
