import { test, expect } from '@playwright/test';
import { erpLogin, TEST_ADMIN } from './helpers';

test.describe('Customers and suppliers', () => {
  test.beforeEach(async ({ page }) => {
    await erpLogin(page, TEST_ADMIN.email, TEST_ADMIN.password);
  });

  test('create and edit a customer, then read a statement', async ({ page }) => {
    const stamp = Date.now().toString(36);
    await page.goto('/sales/customers');
    await page.getByRole('button', { name: 'New customer' }).click();
    await page.getByLabel('First name').fill('E2E');
    await page.getByLabel('Last name / company').fill(`Cliente ${stamp}`);
    await page.getByLabel('NIT / CI').fill(`9${Date.now() % 10_000_000}`);
    await page.getByLabel('Email').fill(`cliente-${stamp}@quberty.test`);
    await page.getByLabel('City').fill('La Paz');
    await page.getByRole('button', { name: 'Create customer' }).click();

    await page.getByLabel('Search customers').fill(`Cliente ${stamp}`);
    const row = page.locator('tr', { hasText: `Cliente ${stamp}` });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText('La Paz');

    await row.getByRole('button', { name: /^Edit / }).click();
    await page.getByLabel('Phone').fill('+591 70000000');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(row).toContainText('+591 70000000');

    // The statement opens; a new customer has no orders yet. The amounts and
    // payment states are pinned by backend/src/__tests__/customerStatement.test.ts.
    await row.getByRole('button', { name: 'Statement' }).click();
    await expect(page.getByText(`Statement — E2E Cliente ${stamp}`)).toBeVisible();
    await expect(page.getByText('No orders yet.')).toBeVisible({ timeout: 10_000 });
  });

  test('a supplier statement shows payables and purchase orders', async ({ page }) => {
    await page.goto('/purchase/suppliers');
    await expect(page.getByText('Open payable').first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Statement' }).first().click();
    await expect(page.getByText('Recent purchase orders')).toBeVisible();
    await expect(page.getByText('Payables', { exact: true })).toBeVisible();
  });
});
