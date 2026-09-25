/**
 * STOREFRONT CONTAINMENT (WORK-030a)
 *
 *   - the workforce gate: a customer or an unknown role reaches only the storefront
 *     surface, and a workforce role passes through to its own guards;
 *   - registration: an explicit tenant, always a customer, never an admin, and no
 *     self-promotion route;
 *   - the product projection: a shopper sees published products and no cost.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';

jest.mock('../infrastructure/database/client', () => ({
  db: {
    tenant:         { findUnique: jest.fn(), findFirst: jest.fn() },
    user:           { findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
    customer:       { count: jest.fn(), create: jest.fn() },
    refreshToken:   { create: jest.fn() },
    product:        { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
    inventoryStock: { groupBy: jest.fn(), findMany: jest.fn() },
    $transaction:   jest.fn(),
    $queryRaw:      jest.fn(),
  },
}));

import authRoutes from '../modules/auth/auth.routes';
import productRoutes from '../modules/inventory/product.routes';
import { STOREFRONT_SURFACE, isStorefrontSurface, workforceGate } from '../shared/middleware/workforceGate';
import { errorHandler } from '../shared/middleware/errorHandler';
import { db } from '../infrastructure/database/client';
import type { AppEnv } from '../shared/context';

const mocked = db as any;
const UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

beforeEach(() => jest.clearAllMocks());

// ── The gate ──────────────────────────────────────────────────────────────────

function gatedApp(role: string) {
  const app = new Hono<AppEnv>();
  const v1 = new Hono<AppEnv>();
  const identity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'u1', email: 'u@u.com', role, tenantId: 't1' });
    c.set('tenantId', 't1');
    await next();
  };
  v1.use('*', identity);
  v1.use('*', workforceGate);
  v1.all('*', (c) => c.text('reached'));
  app.route('/api/v1', v1);
  app.onError(errorHandler);
  return app;
}

describe('workforce gate', () => {
  it('pins the storefront surface', () => {
    expect(STOREFRONT_SURFACE).toEqual([
      'GET /products',
      'GET /products/categories',
      'GET /products/:uuid',
      'POST /sales/orders/storefront',
      'GET /tenant/currency',
    ]);
  });

  it.each([
    ['GET', '/api/v1/products'],
    ['GET', '/api/v1/products/categories'],
    ['GET', `/api/v1/products/${UUID}`],
    ['POST', '/api/v1/sales/orders/storefront'],
    ['GET', '/api/v1/tenant/currency'],
  ])('lets a customer reach %s %s', async (method, path) => {
    const res = await gatedApp('customer').request(path, { method });
    expect(res.status).toBe(200);
  });

  it.each([
    ['GET', '/api/v1/finance/journal-entries'],
    ['GET', '/api/v1/finance/trial-balance'],
    ['GET', '/api/v1/finance/facturas'],
    ['GET', '/api/v1/crm/leads'],
    ['POST', `/api/v1/warehouse/work/${UUID}/complete`],
    ['POST', '/api/v1/uom/seed-defaults'],
    ['POST', `/api/v1/products/${UUID}/generate-video`],
    ['GET', '/api/v1/sales/orders'],
    ['GET', '/api/v1/customers'],
    ['POST', '/api/v1/pos/sale'],
    ['GET', '/api/v1/products/barcode/123'],
    ['GET', '/api/v1/products/not-a-uuid'],
    ['PUT', `/api/v1/products/${UUID}`],
    ['GET', '/api/v1/tenant/config'],
  ])('refuses a customer %s %s', async (method, path) => {
    const res = await gatedApp('customer').request(path, { method });
    expect(res.status).toBe(403);
  });

  it('refuses a role the registry does not know, even on a surface route', async () => {
    expect((await gatedApp('superuser').request('/api/v1/finance/journal-entries')).status).toBe(403);
    expect((await gatedApp('superuser').request('/api/v1/products')).status).toBe(200);
  });

  it.each(['admin', 'store_manager', 'cashier', 'employee', 'auditor'])(
    'lets the workforce role %s through to its own guards',
    async (role) => {
      expect((await gatedApp(role).request('/api/v1/finance/journal-entries')).status).toBe(200);
    },
  );

  it('matches paths exactly, not by prefix', () => {
    expect(isStorefrontSurface('GET', '/api/v1/products')).toBe(true);
    expect(isStorefrontSurface('GET', '/api/v1/products/')).toBe(true);
    expect(isStorefrontSurface('POST', '/api/v1/products')).toBe(false);
    expect(isStorefrontSurface('GET', '/api/v1/productsX')).toBe(false);
    expect(isStorefrontSurface('GET', `/api/v1/products/${UUID}/stock`)).toBe(false);
  });
});

// ── Registration ──────────────────────────────────────────────────────────────

const shopper = { email: 'shopper@test.com', password: 'Password1!', first_name: 'Ana', last_name: 'Q' };

describe('registration', () => {
  function withAuthApp() {
    const app = new Hono<AppEnv>();
    app.route('/', authRoutes);
    app.onError(errorHandler);
    return app;
  }

  it('refuses a registration that names no tenant, and writes nothing', async () => {
    const res = await withAuthApp().request('/register', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(shopper),
    });
    expect(res.status).toBe(400);
    expect(mocked.tenant.findFirst).not.toHaveBeenCalled();
    expect(mocked.tenant.findUnique).not.toHaveBeenCalled();
    expect(mocked.user.create).not.toHaveBeenCalled();
  });

  it('refuses an unknown store', async () => {
    mocked.tenant.findUnique.mockResolvedValue(null);
    const res = await withAuthApp().request('/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...shopper, tenant_slug: 'nowhere' }),
    });
    expect(res.status).toBe(404);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it('creates a customer — never an admin, even as the first user of a tenant', async () => {
    mocked.tenant.findUnique.mockResolvedValue({ id: 't1', is_active: true });
    mocked.user.findFirst.mockResolvedValue(null);
    mocked.user.count.mockResolvedValue(0);
    const tx = {
      user: { create: jest.fn().mockResolvedValue({ id: 'u1', email: shopper.email, first_name: 'Ana', last_name: 'Q', role: 'customer' }) },
      customer: { create: jest.fn().mockResolvedValue({ id: 'c1' }) },
      $queryRaw: jest.fn().mockResolvedValue([{ max: 41n }]),
    };
    mocked.$transaction.mockImplementation((fn: any) => fn(tx));
    mocked.refreshToken.create.mockResolvedValue({});

    const res = await withAuthApp().request('/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...shopper, tenant_slug: 'scarpe' }),
    });
    expect(res.status).toBe(201);
    expect(mocked.tenant.findUnique).toHaveBeenCalledWith({ where: { slug: 'scarpe', is_active: true } });
    expect(tx.user.create.mock.calls[0][0].data.role).toBe('customer');
    // The customer code continues from the highest existing one, not a count.
    expect(tx.customer.create.mock.calls[0][0].data.code).toBe('CUST-00042');
    expect(mocked.customer.count).not.toHaveBeenCalled();
  }, 20_000);

  it('refuses a role smuggled into the body', async () => {
    const res = await withAuthApp().request('/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...shopper, tenant_slug: 'scarpe', role: 'admin' }),
    });
    expect(res.status).toBe(400);
    expect(mocked.user.create).not.toHaveBeenCalled();
  });

  it('has no self-promotion route', async () => {
    const res = await withAuthApp().request('/make-admin', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(mocked.user.update).not.toHaveBeenCalled();
  });
});

// ── Product projection ────────────────────────────────────────────────────────

function productApp(role: string) {
  const app = new Hono<AppEnv>();
  const identity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'u1', email: 'u@u.com', role, tenantId: 't1' });
    c.set('tenantId', 't1');
    await next();
  };
  app.use('*', identity);
  app.route('/', productRoutes);
  app.onError(errorHandler);
  return app;
}

describe('storefront product projection', () => {
  const product = {
    id: UUID, name: 'Boot', selling_price: 300, cost_price: 120, is_published: true,
    variants: [{ id: 'v1', additional_cost: 20 }],
  };

  beforeEach(() => {
    mocked.product.findMany.mockResolvedValue([product]);
    mocked.product.count.mockResolvedValue(1);
    mocked.product.findFirst.mockResolvedValue(product);
    mocked.inventoryStock.groupBy.mockResolvedValue([]);
    mocked.inventoryStock.findMany.mockResolvedValue([]);
  });

  it('shows a shopper published products only, whatever the query asks, and no cost', async () => {
    const res = await productApp('customer').request('/?published=false');
    expect(res.status).toBe(200);
    expect(mocked.product.findMany.mock.calls[0][0].where.is_published).toBe(true);
    const body = (await res.json()) as any;
    expect(body.data[0]).not.toHaveProperty('cost_price');
    // additional_cost is a price surcharge, not a cost, and stays visible.
    expect(body.data[0].variants[0].additional_cost).toBe(20);
  });

  it('hides an unpublished product and its cost from a shopper reading by id', async () => {
    const res = await productApp('customer').request(`/${UUID}`);
    expect(mocked.product.findFirst.mock.calls[0][0].where.is_published).toBe(true);
    expect(((await res.json()) as any).data).not.toHaveProperty('cost_price');
  });

  it('gives the back office the full product', async () => {
    const res = await productApp('store_manager').request('/');
    expect(mocked.product.findMany.mock.calls[0][0].where).not.toHaveProperty('is_published');
    expect(((await res.json()) as any).data[0].cost_price).toBe(120);
  });

  it('refuses a role with neither catalogue permission', async () => {
    const res = await productApp('finance_approver').request('/');
    expect(res.status).toBe(403);
    expect(mocked.product.findMany).not.toHaveBeenCalled();
  });
});
