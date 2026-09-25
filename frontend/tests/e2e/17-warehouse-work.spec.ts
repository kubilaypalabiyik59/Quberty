import { test, expect } from '@playwright/test';
import { erpLogin, apiLogin, apiGet, TEST_ADMIN } from './helpers';

/**
 * Warehouse management, on screen: an open put-away task (created by a receipt
 * into a warehouse whose parameters require putaway) is started and completed
 * by the worker. That the completion moves the stock and its FIFO cost layer is
 * proven by backend scripts/verifyPutaway.ts.
 */
test('a warehouse worker starts and completes a put-away task', async ({ page, request }) => {
  const auth = await apiLogin(request);
  const res = await apiGet(request, '/warehouse/work?status=OPEN', auth);
  const body = await res.json();
  const works: any[] = Array.isArray(body.data) ? body.data : body.data?.work ?? [];
  const work = works.find((w) => w.status === 'OPEN' && (w.lines ?? []).length > 0);
  test.skip(!work, 'No open warehouse work — receive into a warehouse that requires putaway first');

  await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await page.goto('/warehouse/work');
  const card = page.locator('div.rounded-xl, div').filter({ hasText: work.work_id_code }).filter({ has: page.getByRole('button', { name: 'Start' }) }).last();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.getByRole('button', { name: 'Start' }).click();

  // Each line: confirm the full quantity.
  for (let i = 0; i < work.lines.length; i++) {
    const done = page.getByRole('button', { name: 'Done' }).first();
    await expect(done).toBeVisible({ timeout: 10_000 });
    await done.click();
    await expect(done).toBeEnabled({ timeout: 10_000 }).catch(() => {});
  }
  // Completing posts the stock move; wait for the server rather than a fixed delay.
  const statusOf = async () => {
    const after = await (await apiGet(request, '/warehouse/work', auth)).json();
    const w = (Array.isArray(after.data) ? after.data : after.data?.work ?? []).find((x: any) => x.id === work.id);
    return w ? `${w.status}:${w.lines.every((l: any) => l.status === 'DONE')}` : 'missing';
  };
  await expect.poll(statusOf, { timeout: 15_000 }).toBe('COMPLETED:true');
});
