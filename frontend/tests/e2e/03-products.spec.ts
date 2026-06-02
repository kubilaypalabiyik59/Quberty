import { test, expect } from '@playwright/test';
import { erpLogin, TEST_ADMIN } from './helpers';

test.describe('Products Module', () => {
  test.beforeEach(async ({ page }) => {
    await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
    await page.goto('http://localhost:3000/products');
  });

  test('products page loads and shows table', async ({ page }) => {
    // Scope to main — the TopBar also shows "Products" as its page title
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Products' })).toBeVisible();
    await expect(
      main.locator('table').or(main.getByText('No products'))
    ).toBeVisible({ timeout: 8000 });
  });

  test('new product button navigates to create form', async ({ page }) => {
    await page.click('a[href*="/products/new"], button:has-text("New Product")');
    await page.waitForURL('**/products/new');
    await expect(page).toHaveURL(/products\/new/);
  });

  test('product create form renders required fields', async ({ page }) => {
    await page.goto('http://localhost:3000/products/new');
    // Product name field (identified by its placeholder) should render
    await expect(page.getByPlaceholder('e.g. Nike Air Max 270')).toBeVisible({ timeout: 8000 });
  });
});
