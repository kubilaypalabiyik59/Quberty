/**
 * O2C CONTAINMENT (WORK-029)
 *
 * Pins the closed paths: cross-tenant writes on sales orders and customers,
 * unguarded POS and customer routes, POS stock taken from the wrong store, and
 * count lines edited after finalization. Every denial must happen before the
 * database is touched, and a refused POS sale must not allocate a FACTURA number.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import salesRoutes from '../modules/sales/sales.routes';
import customerRoutes from '../modules/customers/customer.routes';
import posRoutes from '../modules/pos/pos.routes';
import countRoutes from '../modules/inventory/inventory-count.routes';
import { nextFacturaNumber } from '../shared/services/numberSequence.service';
import { db } from '../infrastructure/database/client';
import { errorHandler } from '../shared/middleware/errorHandler';
import type { AppEnv } from '../shared/context';

jest.mock('../infrastructure/database/client', () => {
  const m: any = {
    salesOrder:         { findFirst: jest.fn(), updateMany: jest.fn() },
    customer:           { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    taxGroup:           { count: jest.fn() },
    registerSession:    { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    warehouse:          { findFirst: jest.fn(), findMany: jest.fn() },
    inventoryCountLine: { updateMany: jest.fn(), findFirst: jest.fn() },
    inventoryStock:     { findMany: jest.fn(), updateMany: jest.fn() },
    inventoryTransaction: { create: jest.fn() },
    // The POS resolves the ledger's accounting currency before it opens its
    // transaction (WORK-025): the register sells in the ledger currency and the
    // till sends none.
    financeParameters:  {
      findFirst: jest.fn().mockResolvedValue({
        legal_entity_id: null,
        accounting_currency_code: 'BOB',
        reporting_currency_code: 'BOB',
        accounting_rate_type_id: 'rt-1',
        reporting_rate_type_id: null,
        exchange_rate_date_basis: 'POSTING_DATE',
      }),
    },
  };
  // The register session row lock taken by POS sale, void and close (WORK-047).
  m.$queryRaw = jest.fn().mockResolvedValue([{ id: 'sess', status: 'OPEN' }]);
  m.$transaction = jest.fn((fn: any) => fn(m));
  return { db: m };
});

jest.mock('../shared/services/numberSequence.service', () => ({
  nextFacturaNumber: jest.fn(),
  allocateNumber: jest.fn(),
}));

jest.mock('../shared/utils/orderCounter', () => ({
  nextSalesOrderNumber: jest.fn().mockResolvedValue('SO-2026-00001'),
}));

const mdb = db as any;
const TENANT = 'tenant-1';
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function mount(role: string, router: Hono<AppEnv>) {
  const app = new Hono<AppEnv>();
  const setIdentity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'user-1', email: 't@t.com', role, tenantId: TENANT });
    c.set('tenantId', TENANT);
    await next();
  };
  app.use('*', setIdentity);
  app.route('/', router);
  app.onError(errorHandler);
  return app;
}

const json = (method: string, body: unknown) => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

const dbCalls = (): number => {
  let n = 0;
  for (const model of Object.values(mdb) as any[]) {
    if (model && typeof model === 'object') {
      for (const fn of Object.values(model) as any[]) n += fn?.mock?.calls.length ?? 0;
    }
  }
  return n;
};

beforeEach(() => jest.clearAllMocks());

describe('sales order completion', () => {
  it('returns 404 for an order outside the tenant and writes nothing', async () => {
    mdb.salesOrder.findFirst.mockResolvedValue(null);
    const res = await mount('admin', salesRoutes).request(`/${UUID_A}/complete`, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(mdb.salesOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: UUID_A, tenant_id: TENANT } }));
    expect(mdb.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to complete an order that is not SHIPPED', async () => {
    mdb.salesOrder.findFirst.mockResolvedValue({ id: UUID_A, status: 'DRAFT' });
    const res = await mount('admin', salesRoutes).request(`/${UUID_A}/complete`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(mdb.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('completes a SHIPPED order with a tenant- and status-scoped write', async () => {
    mdb.salesOrder.findFirst.mockResolvedValueOnce({ id: UUID_A, status: 'SHIPPED' }).mockResolvedValueOnce({ id: UUID_A, status: 'COMPLETED' });
    mdb.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    const res = await mount('store_manager', salesRoutes).request(`/${UUID_A}/complete`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(mdb.salesOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: UUID_A, tenant_id: TENANT, status: 'SHIPPED' },
    }));
  });

  it('denies a cashier before any database call', async () => {
    const res = await mount('cashier', salesRoutes).request(`/${UUID_A}/complete`, { method: 'POST' });
    expect(res.status).toBe(403);
    expect(dbCalls()).toBe(0);
  });
});

describe('customers', () => {
  it.each(['customer', 'unregistered-role'])('denies %s on every route before any database call', async (role) => {
    const app = mount(role, customerRoutes);
    expect((await app.request('/')).status).toBe(403);
    expect((await app.request(`/${UUID_A}`)).status).toBe(403);
    expect((await app.request('/', json('POST', { first_name: 'A', last_name: 'B' }))).status).toBe(403);
    expect((await app.request(`/${UUID_A}`, json('PUT', { first_name: 'A' }))).status).toBe(403);
    expect((await app.request(`/${UUID_A}/orders`)).status).toBe(403);
    expect(dbCalls()).toBe(0);
  });

  it.each([
    ['tenant_id', { tenant_id: 'tenant-2' }],
    ['lifetime_value', { lifetime_value: 1_000_000 }],
    ['user_id', { user_id: UUID_B }],
  ])('refuses %s in an update body', async (_k, body) => {
    const res = await mount('store_manager', customerRoutes).request(`/${UUID_A}`, json('PUT', body));
    expect(res.status).toBe(400);
    expect(mdb.customer.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a tax group from another tenant', async () => {
    mdb.taxGroup.count.mockResolvedValue(0);
    const res = await mount('store_manager', customerRoutes).request(`/${UUID_A}`, json('PUT', { tax_group_id: UUID_B }));
    expect(res.status).toBe(422);
    expect(mdb.customer.updateMany).not.toHaveBeenCalled();
  });

  it('writes an allowed update scoped to the tenant', async () => {
    mdb.customer.updateMany.mockResolvedValue({ count: 1 });
    const res = await mount('store_manager', customerRoutes).request(`/${UUID_A}`, json('PUT', { phone: '777' }));
    expect(res.status).toBe(200);
    const arg = mdb.customer.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: UUID_A, tenant_id: TENANT });
    expect(arg.data).not.toHaveProperty('tenant_id');
  });
});

describe('POS', () => {
  const sale = { session_id: UUID_A, payment_method: 'CASH', lines: [{ product_id: UUID_B, quantity: 1, unit_price: 10 }] };

  it.each(['customer', 'unregistered-role'])('denies %s on every POS route before any database call', async (role) => {
    const app = mount(role, posRoutes);
    expect((await app.request('/sessions/open', json('POST', { terminal_name: 'T1', opening_float: 0 }))).status).toBe(403);
    expect((await app.request('/sessions/current?terminal_name=T1')).status).toBe(403);
    expect((await app.request('/sessions')).status).toBe(403);
    expect((await app.request(`/sessions/${UUID_A}/close`, json('POST', { closing_float: 0 }))).status).toBe(403);
    expect((await app.request('/sale', json('POST', sale))).status).toBe(403);
    expect((await app.request(`/sales/${UUID_A}/void`, { method: 'POST' })).status).toBe(403);
    expect(dbCalls()).toBe(0);
  });

  it('refuses to open a register without a warehouse when the tenant has several', async () => {
    mdb.registerSession.findFirst.mockResolvedValue(null);
    mdb.warehouse.findMany.mockResolvedValue([{ id: 'wh-1', site_id: 's1' }, { id: 'wh-2', site_id: 's2' }]);
    const res = await mount('cashier', posRoutes).request('/sessions/open', json('POST', { terminal_name: 'T1', opening_float: 0 }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.code).toBe('POS_SESSION_WAREHOUSE_REQUIRED');
    expect(mdb.registerSession.create).not.toHaveBeenCalled();
  });

  it('persists the sole warehouse and derives its site', async () => {
    mdb.registerSession.findFirst.mockResolvedValue(null);
    mdb.warehouse.findMany.mockResolvedValue([{ id: 'wh-1', site_id: 'site-1' }]);
    mdb.registerSession.create.mockResolvedValue({ id: 'sess-1' });
    const res = await mount('cashier', posRoutes).request('/sessions/open', json('POST', { terminal_name: 'T1', opening_float: 0 }));
    expect(res.status).toBe(201);
    expect(mdb.registerSession.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ warehouse_id: 'wh-1', site_id: 'site-1' }));
  });

  it('refuses a warehouse from another tenant', async () => {
    mdb.registerSession.findFirst.mockResolvedValue(null);
    mdb.warehouse.findFirst.mockResolvedValue(null);
    const res = await mount('cashier', posRoutes).request('/sessions/open', json('POST', { terminal_name: 'T1', opening_float: 0, warehouse_id: UUID_B }));
    expect(res.status).toBe(422);
    expect(mdb.warehouse.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: UUID_B, tenant_id: TENANT, is_active: true } }));
    expect(mdb.registerSession.create).not.toHaveBeenCalled();
  });

  it('refuses a sale on a session without a warehouse before allocating a FACTURA number', async () => {
    mdb.registerSession.findFirst.mockResolvedValue({ id: UUID_A, warehouse_id: null, terminal_name: 'T1' });
    const res = await mount('cashier', posRoutes).request('/sale', json('POST', sale));
    expect(res.status).toBe(422);
    expect(nextFacturaNumber).not.toHaveBeenCalled();
  });

  // Register-warehouse scoping of the stock issue is pinned in stockLedger.test.ts
  // (issueAvailable), which replaced deductPosStock in WORK-043.
});

describe('inventory count lines', () => {
  it.each(['cashier', 'customer'])('denies %s before any database call', async (role) => {
    const res = await mount(role, countRoutes).request(`/${UUID_A}/lines/${UUID_B}`, json('PUT', { counted_qty: 3 }));
    expect(res.status).toBe(403);
    expect(dbCalls()).toBe(0);
  });

  it.each([[-1], [1.5], ['x']])('rejects counted_qty %p', async (v) => {
    const res = await mount('store_manager', countRoutes).request(`/${UUID_A}/lines/${UUID_B}`, json('PUT', { counted_qty: v }));
    expect(res.status).toBe(400);
    expect(mdb.inventoryCountLine.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to edit a finalized count', async () => {
    mdb.inventoryCountLine.updateMany.mockResolvedValue({ count: 0 });
    mdb.inventoryCountLine.findFirst.mockResolvedValue({ id: UUID_B });
    const res = await mount('store_manager', countRoutes).request(`/${UUID_A}/lines/${UUID_B}`, json('PUT', { counted_qty: 3 }));
    expect(res.status).toBe(409);
    expect(mdb.inventoryCountLine.updateMany.mock.calls[0][0].where).toEqual({
      id: UUID_B, count_id: UUID_A, count: { tenant_id: TENANT, status: 'IN_PROGRESS' },
    });
  });

  it('returns 404 for a line of another count', async () => {
    mdb.inventoryCountLine.updateMany.mockResolvedValue({ count: 0 });
    mdb.inventoryCountLine.findFirst.mockResolvedValue(null);
    const res = await mount('store_manager', countRoutes).request(`/${UUID_A}/lines/${UUID_B}`, json('PUT', { counted_qty: 3 }));
    expect(res.status).toBe(404);
  });

  it('updates an open count line', async () => {
    mdb.inventoryCountLine.updateMany.mockResolvedValue({ count: 1 });
    const res = await mount('store_manager', countRoutes).request(`/${UUID_A}/lines/${UUID_B}`, json('PUT', { counted_qty: 3 }));
    expect(res.status).toBe(200);
  });
});
