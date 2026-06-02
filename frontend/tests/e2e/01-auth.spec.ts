import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';

test.describe('Authentication', () => {

  test('login page renders correctly', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('wrong credentials shows error', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[type="email"]', 'wrong@email.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    // Should stay on login and show error
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/login/);
  });

  test('unauthenticated access to dashboard redirects to login', async ({ page }) => {
    // Clear storage to ensure no session
    await page.goto(`${BASE}/dashboard`);
    await page.waitForURL(/login/, { timeout: 8000 });
    await expect(page).toHaveURL(/login/);
  });

});
