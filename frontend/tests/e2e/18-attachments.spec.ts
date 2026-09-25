import { test, expect } from '@playwright/test';
import { erpLogin, apiLogin, apiGet, authHeaders, API_URL, TEST_ADMIN } from './helpers';

/**
 * Attach a file to an opportunity, open it through its signed link, remove it —
 * against the real private storage bucket.
 */
test('a file is attached to an opportunity, opened and removed', async ({ page, request }) => {
  const auth = await apiLogin(request);
  const body = await (await apiGet(request, '/crm/opportunities?limit=20', auth)).json();
  const opp = (Array.isArray(body.data) ? body.data : body.data?.opportunities ?? [])[0];
  test.skip(!opp, 'No opportunity');

  const name = `oferta-${Date.now().toString(36)}.txt`;
  const content = `Quotation as sent — ${name}`;

  await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await page.goto(`/crm/opportunities/${opp.id}`);
  await page.getByLabel('Attach a file').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) });
  const row = page.getByRole('button', { name, exact: true });
  await expect(row).toBeVisible({ timeout: 15_000 });

  // The file is served only through a short-lived signed link, and it is the file we sent.
  const list = await (await apiGet(request, `/attachments?entity_type=OPPORTUNITY&entity_id=${opp.id}`, auth)).json();
  const att = list.data.find((a: any) => a.file_name === name);
  const dl = await (await request.get(`${API_URL}/attachments/${att.id}/download`, { headers: authHeaders(auth) })).json();
  expect(dl.data.expires_in).toBe(60);
  const file = await request.get(dl.data.url);
  expect(file.status()).toBe(200);
  expect(await file.text()).toBe(content);

  // Remove it.
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: `Remove ${name}` }).click();
  await expect(row).toHaveCount(0, { timeout: 10_000 });
});
