import { test, expect, Page } from '@playwright/test';
import { erpLogin, TEST_ADMIN } from './helpers';

/**
 * Workforce session: kept while in use, ended when idle.
 *
 * Idle time is simulated by back-dating the shared last-activity timestamp,
 * so the suite does not wait out the real limit (10 minutes by default).
 */

const ACTIVITY_KEY = 'quberty.session.last_activity';

async function backdate(page: Page, msAgo: number) {
  await page.evaluate(
    ([key, ago]) => localStorage.setItem(key as string, String(Date.now() - (ago as number))),
    [ACTIVITY_KEY, msAgo],
  );
}

test.describe('Session', () => {
  test('a live session survives opening the site again', async ({ page, context }) => {
    await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
    const again = await context.newPage();
    await again.goto('/');
    await again.waitForURL('**/dashboard', { timeout: 10_000 });
    await again.goto('/login');
    await again.waitForURL('**/dashboard', { timeout: 10_000 });
  });

  test('a browser idle past the limit asks to sign in, and the refresh cookie is gone', async ({ page, context }) => {
    await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
    await backdate(page, 11 * 60_000);
    const later = await context.newPage();
    await later.goto('/dashboard');
    await later.waitForURL('**/login', { timeout: 10_000 });
    await expect(later.getByRole('status').filter({ hasText: 'inactivity' })).toBeVisible();
    const status = await later.evaluate(() =>
      fetch('http://localhost:3001/api/v1/auth/refresh', { method: 'POST', credentials: 'include' }).then((r) => r.status),
    );
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('an open tab warns in the last minute, and "Stay signed in" keeps the session', async ({ page }) => {
    await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
    await backdate(page, 9 * 60_000 + 30_000);
    const warning = page.getByRole('alertdialog');
    await expect(warning).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: 'Stay signed in' }).click();
    await expect(warning).toBeHidden();
    await page.waitForTimeout(6_000);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('an open tab left idle is signed out and told why', async ({ page }) => {
    await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
    await backdate(page, 11 * 60_000);
    await page.waitForURL('**/login', { timeout: 12_000 });
    await expect(page.getByRole('status').filter({ hasText: 'inactivity' })).toBeVisible();
  });
});
