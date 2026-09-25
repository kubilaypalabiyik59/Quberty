/**
 * TENANT ADMINISTRATION ROUTE TESTS (WORK-022)
 *
 * Tenant administration used to be mounted outside auth: anyone could create a
 * tenant, read any tenant's config, and change any tenant's currency and tax
 * basis. These tests pin the contained contract:
 *   - every route is permission-guarded and denies before touching the database;
 *   - accounting setup is admin-only (segregation of duties);
 *   - the accounting currency is not set here any more (WORK-024 moved it to the ledger);
 *   - a token for tenant A cannot act on tenant B;
 *   - a store manager cannot mint an admin;
 *   - chart-of-accounts seeding is accounting setup.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import * as jwt from 'jsonwebtoken';
import tenantRoutes, { TENANT_ROUTE_PERMISSIONS, formattingLocale } from '../modules/tenants/tenant.routes';
import hrRoutes from '../modules/hr/hr.routes';
import financeRoutes from '../modules/finance/finance.routes';
import { tenantMiddleware } from '../shared/middleware/tenantMiddleware';
import { authMiddleware } from '../shared/middleware/authMiddleware';
import { errorHandler } from '../shared/middleware/errorHandler';
import { hasPermission } from '../shared/middleware/permissions';
import { db } from '../infrastructure/database/client';
import type { AppEnv } from '../shared/context';

jest.mock('../infrastructure/database/client', () => ({
  db: {
    tenant:            { findUnique: jest.fn(), update: jest.fn() },
    journalEntry:      { count: jest.fn() },
    // findFirst: POST /employees checks the email is not already a user.
    user:              { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    employee:          { count: jest.fn(), create: jest.fn() },
    account:           { count: jest.fn(), findMany: jest.fn() },
    // GET /config projects the ledger's currency for the screens that render money.
    financeParameters: { findFirst: jest.fn() },
    tenantCurrency:    { findFirst: jest.fn() },
  },
}));

const mocked = db as unknown as {
  tenant:            { findUnique: jest.Mock; update: jest.Mock };
  journalEntry:      { count: jest.Mock };
  user:              { create: jest.Mock; findFirst: jest.Mock };
  employee:          { count: jest.Mock; create: jest.Mock };
  account:           { count: jest.Mock; findMany: jest.Mock };
  financeParameters: { findFirst: jest.Mock };
  tenantCurrency:    { findFirst: jest.Mock };
};

function buildMountedRouter(role: string, router: Hono<AppEnv>) {
  const app = new Hono<AppEnv>();
  const setIdentity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'user-1', email: 'test@test.com', role, tenantId: 'tenant-1' });
    c.set('tenantId', 'tenant-1');
    await next();
  };
  app.use('*', setIdentity);
  app.route('/', router);
  app.onError(errorHandler);
  return app;
}

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const dbTouched = () =>
  mocked.tenant.findUnique.mock.calls.length +
  mocked.tenant.update.mock.calls.length +
  mocked.journalEntry.count.mock.calls.length;

describe('tenant administration routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('publishes and consumes the exact permission map', () => {
    expect(TENANT_ROUTE_PERMISSIONS).toEqual({
      'GET /config': ['setup.tenant.read'],
      'PUT /config': ['setup.tenant.maintain'],
      'PUT /setup':  ['finance.setup.maintain'],
    });
  });

  it('grants organisation setup to store managers but accounting setup to admin only', () => {
    expect(hasPermission('admin', 'finance.setup.maintain')).toBe(true);
    expect(hasPermission('store_manager', 'setup.tenant.maintain')).toBe(true);
    expect(hasPermission('store_manager', 'finance.setup.maintain')).toBe(false);
    expect(hasPermission('finance_approver', 'finance.setup.maintain')).toBe(false);
    expect(hasPermission('auditor', 'setup.tenant.read')).toBe(true);
    expect(hasPermission('auditor', 'setup.tenant.maintain')).toBe(false);
    // Taken back in WORK-025b: these roles get the currency from its own
    // unpermissioned route, not from the tenant config.
    expect(hasPermission('cashier', 'setup.tenant.read')).toBe(false);
    expect(hasPermission('employee', 'setup.tenant.read')).toBe(false);
  });

  it.each(['customer', 'unregistered-role'])(
    'denies %s on every route before any database call',
    async (role) => {
      const app = buildMountedRouter(role, tenantRoutes);
      expect((await app.request('/config')).status).toBe(403);
      expect((await app.request('/config', json('PUT', { language: 'es' }))).status).toBe(403);
      expect((await app.request('/setup', json('PUT', { currency_code: 'USD' }))).status).toBe(403);
      expect(dbTouched()).toBe(0);
    },
  );

  // Every screen that renders an amount needs the currency, and the roles that
  // render the most of them — a cashier at the till, a customer in the shop —
  // have no business reading the tenant's plan, modules or branding. So the
  // currency has its own route, which needs authentication and no permission,
  // and `setup.tenant.read` was taken back off those roles (WORK-025b).
  it.each(['cashier', 'employee', 'customer'])(
    'lets %s read the display currency without reading the tenant config',
    async (role) => {
      mocked.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', name: 'T', slug: 't', language: 'es' });
      mocked.financeParameters.findFirst.mockResolvedValue({ accounting_currency_code: 'BOB' });
      mocked.tenantCurrency.findFirst.mockResolvedValue({ currency_code: 'BOB', symbol: 'Bs.', rounding_precision: '0.01', rounding_method: 'NEAREST' });
      const app = buildMountedRouter(role, tenantRoutes);

      const res = await app.request('/currency');
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).data).toMatchObject({ code: 'BOB', locale: 'es' });

      // …and nothing else about the tenant.
      expect((await app.request('/config')).status).toBe(403);
      expect(mocked.tenant.update).not.toHaveBeenCalled();
    },
  );

  // Intl formats BOB as `1299,50 BOB` under bare `es` and `Bs 1.299,50` under
  // `es-BO`, so the country qualifies the language when it is set — never guessed.
  it('qualifies the formatting locale with the tenant country', async () => {
    mocked.tenant.findUnique.mockResolvedValue({ language: 'es', country: 'BO' });
    mocked.financeParameters.findFirst.mockResolvedValue({ accounting_currency_code: 'BOB' });
    mocked.tenantCurrency.findFirst.mockResolvedValue({ currency_code: 'BOB', symbol: 'Bs.', rounding_precision: '0.01', rounding_method: 'NEAREST' });
    const res = await buildMountedRouter('cashier', tenantRoutes).request('/currency');
    expect(((await res.json()) as any).data).toMatchObject({ code: 'BOB', symbol: 'Bs.', locale: 'es-BO' });
  });

  it.each([
    ['es', 'BO', 'es-BO'],
    ['es', null, 'es'],
    ['tr', 'TR', 'tr-TR'],
    ['es-AR', 'BO', 'es-BO'],
    ['es_BO', null, 'es-BO'],
    [null, 'BO', 'en'],
    ['!!', null, 'en'],
  ])('formattingLocale(%s, %s) is %s', (language, country, expected) => {
    expect(formattingLocale(language as any, country as any)).toBe(expected);
  });

  it('refuses a language Intl cannot format with', async () => {
    const app = buildMountedRouter('admin', tenantRoutes);
    expect((await app.request('/config', json('PUT', { language: 'es_BO' }))).status).toBe(400);
    expect(mocked.tenant.update).not.toHaveBeenCalled();
  });

  it('serves no currency, rather than a guess, before the ledger exists', async () => {
    mocked.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', name: 'T', slug: 't', language: 'es' });
    mocked.financeParameters.findFirst.mockResolvedValue(null);
    const res = await buildMountedRouter('cashier', tenantRoutes).request('/currency');
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toBeNull();
  });

  it('lets an auditor read the tenant config but change nothing', async () => {
    mocked.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', name: 'T', slug: 't', language: 'es' });
    mocked.financeParameters.findFirst.mockResolvedValue({ accounting_currency_code: 'BOB' });
    mocked.tenantCurrency.findFirst.mockResolvedValue({ currency_code: 'BOB', symbol: 'Bs.', rounding_precision: '0.01', rounding_method: 'NEAREST' });
    const app = buildMountedRouter('auditor', tenantRoutes);

    const res = await app.request('/config');
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.currency).toMatchObject({ code: 'BOB', locale: 'es' });

    expect((await app.request('/config', json('PUT', { language: 'en' }))).status).toBe(403);
    expect((await app.request('/setup', json('PUT', { tax_config: { vat_rate: 0.13, vat_inclusive: true } }))).status).toBe(403);
    expect(mocked.tenant.update).not.toHaveBeenCalled();
  });

  it('refuses accounting setup to a store manager', async () => {
    const app = buildMountedRouter('store_manager', tenantRoutes);
    const res = await app.request('/setup', json('PUT', { currency_code: 'USD' }));
    expect(res.status).toBe(403);
    expect(dbTouched()).toBe(0);
  });

  it('lets a store manager update branding, keyed only by the token tenant', async () => {
    mocked.tenant.update.mockResolvedValue({ id: 'tenant-1' });
    const app = buildMountedRouter('store_manager', tenantRoutes);
    const res = await app.request('/config', json('PUT', { language: 'es', timezone: 'America/La_Paz' }));
    expect(res.status).toBe(200);
    expect(mocked.tenant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tenant-1' },
      data:  { language: 'es', timezone: 'America/La_Paz' },
    }));
  });

  it.each([
    ['modules',          { modules: { hr: false } }],
    ['a tenant id',      { id: 'tenant-2', language: 'es' }],
    ['an unknown key',   { plan: 'enterprise' }],
  ])('rejects %s in the config body', async (_label, body) => {
    const app = buildMountedRouter('admin', tenantRoutes);
    const res = await app.request('/config', json('PUT', body));
    expect(res.status).toBe(400);
    expect(mocked.tenant.update).not.toHaveBeenCalled();
  });

  it('rejects a malformed currency code or tax rate', async () => {
    const app = buildMountedRouter('admin', tenantRoutes);
    expect((await app.request('/setup', json('PUT', { currency_code: 'usd' }))).status).toBe(400);
    expect((await app.request('/setup', json('PUT', { tax_config: { vat_rate: 13, vat_inclusive: true } }))).status).toBe(400);
    expect(dbTouched()).toBe(0);
  });

  // WORK-024: the accounting currency belongs to the ledger and is set through
  // PUT /finance/ledger-currencies (its lock is tested in currencyServices.test).
  it('refuses a currency on the tenant setup route', async () => {
    const app = buildMountedRouter('admin', tenantRoutes);
    const res = await app.request('/setup', json('PUT', {
      currency_code: 'TRY', tax_config: { vat_rate: 0.13, vat_inclusive: true },
    }));
    expect(res.status).toBe(400);
    expect(mocked.tenant.update).not.toHaveBeenCalled();
  });

  it('updates the tax fallback only, keyed by the token tenant', async () => {
    mocked.tenant.update.mockResolvedValue({ id: 'tenant-1', currency_code: 'BOB', tax_config: {} });
    const app = buildMountedRouter('admin', tenantRoutes);
    const res = await app.request('/setup', json('PUT', { tax_config: { vat_rate: 0.13, vat_inclusive: true } }));
    expect(res.status).toBe(200);
    expect(mocked.tenant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tenant-1' }, data: { tax_config: { vat_rate: 0.13, vat_inclusive: true } },
    }));
    expect(mocked.journalEntry.count).not.toHaveBeenCalled();
  });
});

describe('cross-tenant isolation through the real middleware chain', () => {
  beforeEach(() => jest.clearAllMocks());

  function buildTenantScopedApp() {
    const app = new Hono<AppEnv>();
    const v1 = new Hono<AppEnv>();
    v1.use('*', tenantMiddleware);
    v1.use('*', authMiddleware);
    v1.route('/tenant', tenantRoutes);
    app.route('/api/v1', v1);
    app.onError(errorHandler);
    return app;
  }

  it('refuses a tenant-A token presented with tenant B in the header', async () => {
    mocked.tenant.findUnique.mockResolvedValue({ id: 'tenant-B', slug: 'b', tax_config: null, currency_code: 'EUR' });
    const token = jwt.sign({ sub: 'u1', email: 'a@a.com', role: 'admin', tenantId: 'tenant-A' }, process.env.JWT_SECRET!);
    const res = await buildTenantScopedApp().request('/api/v1/tenant/setup', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-tenant-id': 'tenant-B' },
      body: JSON.stringify({ currency_code: 'USD' }),
    });
    expect(res.status).toBe(401);
    expect(mocked.tenant.findUnique).toHaveBeenCalledTimes(1); // the middleware's lookup only
    expect(mocked.tenant.update).not.toHaveBeenCalled();
    expect(mocked.journalEntry.count).not.toHaveBeenCalled();
  });

  it('refuses a request with no token', async () => {
    mocked.tenant.findUnique.mockResolvedValue({ id: 'tenant-A', slug: 'a', tax_config: null, currency_code: 'BOB' });
    const res = await buildTenantScopedApp().request('/api/v1/tenant/config', { headers: { 'x-tenant-id': 'tenant-A' } });
    expect(res.status).toBe(401);
  });

  // The currency route has no permission guard, so authentication is its whole
  // check — pin that it still refuses an unauthenticated caller.
  it('refuses the currency route without a token', async () => {
    mocked.tenant.findUnique.mockResolvedValue({ id: 'tenant-A', slug: 'a', tax_config: null });
    const res = await buildTenantScopedApp().request('/api/v1/tenant/currency', { headers: { 'x-tenant-id': 'tenant-A' } });
    expect(res.status).toBe(401);
    expect(mocked.financeParameters.findFirst).not.toHaveBeenCalled();
  });

  it('refuses a request with no tenant header', async () => {
    const res = await buildTenantScopedApp().request('/api/v1/tenant/config');
    expect(res.status).toBe(400);
    expect(mocked.tenant.findUnique).not.toHaveBeenCalled();
  });
});

describe('related privilege controls', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses a store manager creating an admin user before any write', async () => {
    const app = buildMountedRouter('store_manager', hrRoutes);
    const res = await app.request('/employees', json('POST', {
      email: 'x@x.com', password: 'longenough1', first_name: 'X', last_name: 'Y', role: 'admin',
    }));
    expect(res.status).toBe(403);
    expect(mocked.user.create).not.toHaveBeenCalled();
    expect(mocked.employee.create).not.toHaveBeenCalled();
  });

  it('still lets a store manager create a non-admin employee', async () => {
    mocked.user.create.mockResolvedValue({ id: 'user-2' });
    mocked.employee.count.mockResolvedValue(0);
    mocked.employee.create.mockResolvedValue({ id: 'emp-1', pos_pin_hash: null });
    const app = buildMountedRouter('store_manager', hrRoutes);
    const res = await app.request('/employees', json('POST', {
      email: 'c@c.com', password: 'longenough1', first_name: 'C', last_name: 'D', role: 'cashier',
    }));
    expect(res.status).toBe(201);
  });

  it('refuses chart-of-accounts seeding to a store manager', async () => {
    const app = buildMountedRouter('store_manager', financeRoutes);
    const res = await app.request('/seed-coa', json('POST', { template_id: 'bolivia-pcg' }));
    expect(res.status).toBe(403);
    expect(mocked.account.count).not.toHaveBeenCalled();
    expect(mocked.account.findMany).not.toHaveBeenCalled();
  });
});
