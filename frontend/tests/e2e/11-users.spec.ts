import { test, expect, Browser, Page } from '@playwright/test';
import { erpLogin, TEST_ADMIN } from './helpers';

/**
 * Users & roles, end to end: an admin creates a user and decides what they may
 * see by their role; financial setup follows the role; a deactivated user
 * cannot sign in. Each run leaves one deactivated test user behind.
 */

const PASSWORD = 'Quberty-e2e-2026';

async function signInAs(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
  return page;
}

test('admin creates a user, changes their role, and deactivates them', async ({ page, browser }) => {
  const email = `e2e-user-${Date.now().toString(36)}@quberty.test`;

  await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await page.goto('/settings/users');
  await expect(page.getByRole('heading', { name: 'Users & roles' })).toBeVisible();
  // An admin cannot change their own role here.
  await expect(page.locator('tr', { hasText: 'you' }).locator('select')).toBeDisabled();

  // Create a finance manager
  await page.getByRole('button', { name: 'New user' }).click();
  await page.getByLabel('First name').fill('E2E');
  await page.getByLabel('Last name').fill('Finance');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Role', { exact: true }).selectOption('finance_manager');
  await page.getByLabel('Initial password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create user' }).click();
  const row = page.locator('tr', { hasText: email });
  await expect(row).toBeVisible();

  // The finance manager sees financial setup, not user administration
  const fm = await signInAs(browser, email);
  await expect(fm.locator('nav a[href="/products/setup"]').first()).toBeAttached();
  await expect(fm.locator('nav a[href="/settings/users"]')).toHaveCount(0);
  await fm.context().close();

  // As a store manager they lose financial setup
  await row.locator('select').selectOption('store_manager');
  await expect(row.locator('select')).toHaveValue('store_manager');
  const sm = await signInAs(browser, email);
  await expect(sm.locator('nav a[href="/products/setup"]')).toHaveCount(0);
  await sm.goto('/products/setup');
  await expect(sm.getByText('limited to administrators and finance managers')).toBeVisible();
  await sm.context().close();

  // Deactivated, they cannot sign in
  page.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.locator('tr', { hasText: email })).toHaveCount(0); // inactive rows are hidden by default
  const gone = await (await browser.newContext()).newPage();
  await gone.goto('/login');
  await gone.fill('input[type="email"]', email);
  await gone.fill('input[type="password"]', PASSWORD);
  await gone.click('button[type="submit"]');
  await expect(gone.getByRole('alert')).toBeVisible({ timeout: 10_000 });
  await expect(gone).toHaveURL(/\/login/);
});
