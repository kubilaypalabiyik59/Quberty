import { test, expect } from '@playwright/test';
import { erpLogin, TEST_ADMIN, TEST_CASHIER } from './helpers';

test.describe('HR — Employee & Cashier Creation', () => {
  test.beforeEach(async ({ page }) => {
    await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
    await page.goto('http://localhost:3000/hr');
  });

  test('HR page loads and shows employee table', async ({ page }) => {
    await expect(page.locator('h1').filter({ hasText: /Human Resources/i })).toBeVisible();
    await expect(page.locator('button:has-text("New Employee")')).toBeVisible();
  });

  test('open new employee modal', async ({ page }) => {
    await page.click('button:has-text("New Employee")');
    // Use the exact section heading — the page subtitle also contains "system accounts"
    await expect(page.getByText('System Account (ERP + POS)')).toBeVisible();
    // Role dropdown includes store_manager and cashier
    await expect(page.locator('option[value="store_manager"]')).toBeAttached();
    await expect(page.locator('option[value="cashier"]')).toBeAttached();
  });

  test('create cashier account', async ({ page }) => {
    await page.click('button:has-text("New Employee")');

    // The modal fields use <label>s (no placeholders); target by order within the form
    const textInputs = page.locator('form input[type="text"]');
    await textInputs.nth(0).fill(TEST_CASHIER.firstName); // First Name
    await textInputs.nth(1).fill(TEST_CASHIER.lastName);  // Last Name

    await page.locator('form select').selectOption('store_manager');

    // Unique email so the test stays green across repeated runs
    const uniqueEmail = `cashier+${Date.now()}@test.com`;
    await page.fill('form input[type="email"]', uniqueEmail);
    await page.fill('form input[type="password"]', TEST_CASHIER.password);

    await page.click('button:has-text("Create Employee")');

    // Modal closes on success
    await expect(page.getByRole('heading', { name: 'New Employee' })).not.toBeVisible({ timeout: 8000 });
  });

  test('new cashier appears in employee list', async ({ page }) => {
    await expect(
      page.locator(`text=${TEST_CASHIER.firstName}`).first()
    ).toBeVisible({ timeout: 8000 });
  });
});
