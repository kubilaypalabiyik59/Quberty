import { Page } from '@playwright/test';

export const API_URL = 'http://localhost:3001/api/v1';

export const TEST_ADMIN = {
  email:    'admin@skarpine.com',
  password: 'Admin1234!',
  name:     'Admin User',
};

export const TEST_CASHIER = {
  email:    'cashier@test.com',
  password: 'Cashier123!',
  firstName: 'Caja',
  lastName:  'Principal',
};

export interface AuthCtx {
  token: string;
  tenantId: string;
}

/** Login via API and return token + tenantId */
export async function apiLogin(request: any): Promise<AuthCtx> {
  const res  = await request.post(`${API_URL}/auth/login`, {
    data: { email: TEST_ADMIN.email, password: TEST_ADMIN.password },
  });
  const body = await res.json();
  return { token: body.data.access_token, tenantId: body.data.tenant_id };
}

/** Headers for authenticated API calls */
export function authHeaders(ctx: AuthCtx) {
  return {
    Authorization: `Bearer ${ctx.token}`,
    'X-Tenant-ID': ctx.tenantId,
  };
}

/** GET helper */
export async function apiGet(request: any, path: string, ctx: AuthCtx) {
  return request.get(`${API_URL}${path}`, { headers: authHeaders(ctx) });
}

/** POST helper */
export async function apiPost(request: any, path: string, data: any, ctx: AuthCtx) {
  return request.post(`${API_URL}${path}`, { data, headers: authHeaders(ctx) });
}

/** Login to the ERP and wait for dashboard */
export async function erpLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 10_000 });
}

/** Login to the POS and wait for the main screen */
export async function posLogin(page: Page, email: string, password: string) {
  await page.goto('/pos/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.keyboard.press('Enter');
  // Lands on either open-register or main
  await page.waitForURL(/pos\/(open-register|main)/, { timeout: 10_000 });
}
