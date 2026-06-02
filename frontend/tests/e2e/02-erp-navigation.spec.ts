import { test, expect } from '@playwright/test';
import { erpLogin, TEST_ADMIN } from './helpers';

// All ERP navigation tests share a single login
test.describe('ERP Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  });

  test('sidebar renders all main sections', async ({ page }) => {
    // Scope to the sidebar and target nav items by role — section labels also use the
    // same words (e.g. "Finance"), and the TopBar shows the page title as an <h1>.
    const aside = page.locator('aside');
    await expect(aside.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(aside.getByRole('link', { name: 'POS Terminal' })).toBeVisible();
    await expect(aside.getByRole('button', { name: 'Products' })).toBeVisible();
    await expect(aside.getByRole('button', { name: 'Sales' })).toBeVisible();
    await expect(aside.getByRole('button', { name: 'Finance' })).toBeVisible();
  });

  test('topbar Create dropdown works', async ({ page }) => {
    await page.click('button:has-text("Create")');
    await expect(page.locator('text=New Product')).toBeVisible();
    await expect(page.locator('text=New Sales Order')).toBeVisible();
    await expect(page.locator('text=New Purchase Order')).toBeVisible();
  });

  test('Ctrl+K focuses search', async ({ page }) => {
    await page.locator('body').click(); // make sure the document has focus
    await page.keyboard.press('Control+KeyK');
    await expect(page.getByPlaceholder('Search anything...')).toBeFocused();
  });

  test('dark mode toggle works', async ({ page }) => {
    const moonBtn = page.locator('button[title="Dark mode"]');
    await moonBtn.click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    const sunBtn = page.locator('button[title="Light mode"]');
    await sunBtn.click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('navigate to products page', async ({ page }) => {
    // "Products" in the sidebar is an expandable parent; click its "All Products" child link
    await page.locator('aside').getByRole('link', { name: 'All Products' }).click();
    await page.waitForURL('**/products', { timeout: 10_000 });
    await expect(page).toHaveURL(/\/products/);
  });

  test('navigate to finance accounts', async ({ page }) => {
    await page.locator('aside').getByRole('button', { name: 'Finance' }).click();
    await page.locator('aside').getByRole('link', { name: 'Chart of Accounts' }).click();
    await page.waitForURL('**/finance/accounts');
    await expect(page).toHaveURL(/finance\/accounts/);
  });

  test('keyboard shortcut G+D goes to dashboard', async ({ page }) => {
    await page.goto('http://localhost:3000/products');
    await page.locator('body').click(); // ensure focus is not in an input
    await page.keyboard.press('g');
    await page.keyboard.press('d');
    await page.waitForURL('**/dashboard', { timeout: 12_000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('bell notification panel opens', async ({ page }) => {
    await page.getByRole('button', { name: 'Notifications' }).click();
    // "Notifications" substring also matches "No notifications yet" — assert the unique empty-state text
    await expect(page.getByText('No notifications yet')).toBeVisible();
    await expect(page.getByText("You're all caught up!")).toBeVisible();
  });

  test('avatar dropdown shows user info', async ({ page }) => {
    await page.getByRole('button', { name: 'Account menu' }).click();
    // The dropdown's Settings/Logout are <button>s (sidebar Settings is a <link>)
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  });
});
