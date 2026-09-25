/**
 * FOREIGN STOCK REFERENCES (WORK-030b, D-18)
 *
 * A stock adjustment or transfer that names another tenant's product, variant or
 * location is refused with 422 FOREIGN_REFERENCE before any stock row, cost layer
 * or transaction is written.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';

jest.mock('../infrastructure/database/client', () => ({
  db: {
    product:              { findMany: jest.fn() },
    productVariant:       { findMany: jest.fn() },
    warehouseLocation:    { findMany: jest.fn(), findFirst: jest.fn() },
    warehouse:            { findFirst: jest.fn() },
    inventoryJournal:     { create: jest.fn() },
    inventoryStock:       { upsert: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    inventoryTransaction: { create: jest.fn() },
    $transaction:         jest.fn(),
  },
}));

import inventoryRoutes from '../modules/inventory/inventory.routes';
import { db } from '../infrastructure/database/client';
import { errorHandler } from '../shared/middleware/errorHandler';
import type { AppEnv } from '../shared/context';

const mocked = db as any;
const P = '11111111-1111-4111-8111-111111111111';
const MINE = '22222222-2222-4222-8222-222222222222';
const THEIRS = '33333333-3333-4333-8333-333333333333';

function app() {
  const a = new Hono<AppEnv>();
  const identity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'u1', email: 'm@m.com', role: 'store_manager', tenantId: 't1' });
    c.set('tenantId', 't1');
    await next();
  };
  a.use('*', identity);
  a.route('/', inventoryRoutes);
  a.onError(errorHandler);
  return a;
}

const post = (body: unknown) => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked.product.findMany.mockResolvedValue([{ id: P }]);
  mocked.productVariant.findMany.mockResolvedValue([]);
  mocked.warehouseLocation.findMany.mockResolvedValue([{ id: MINE }]);
  mocked.warehouseLocation.findFirst.mockResolvedValue({ zone: { warehouse_id: 'wh-1' } });
  mocked.warehouse.findFirst.mockResolvedValue({ id: 'wh-1' });
  mocked.$transaction.mockImplementation((fn: any) => fn(mocked));
});

describe('POST /adjust', () => {
  // Since WORK-045 an adjustment is a one-line inventory journal; the references
  // are still refused before any journal, stock row or movement is written.
  it("refuses another tenant's location before writing", async () => {
    mocked.warehouseLocation.findFirst.mockResolvedValue(null);
    const res = await app().request('/adjust', post({ product_id: P, location_id: THEIRS, quantity: 5 }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('FOREIGN_REFERENCE');
    expect(body.error.message).toContain('location_id');
    expect(mocked.inventoryJournal.create).not.toHaveBeenCalled();
    expect(mocked.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('looks the location up within the tenant', async () => {
    mocked.warehouseLocation.findFirst.mockResolvedValue(null);
    await app().request('/adjust', post({ product_id: P, location_id: THEIRS, quantity: 5 }));
    expect(mocked.warehouseLocation.findFirst.mock.calls[0][0].where).toEqual({ id: THEIRS, tenant_id: 't1' });
  });

  it("refuses another tenant's product before a journal is created", async () => {
    mocked.product.findMany.mockResolvedValue([]);
    const res = await app().request('/adjust', post({ product_id: P, location_id: MINE, quantity: 5 }));
    expect(res.status).toBe(422);
    expect(mocked.inventoryJournal.create).not.toHaveBeenCalled();
    expect(mocked.inventoryStock.upsert).not.toHaveBeenCalled();
  });
});

describe('POST /transfers', () => {
  it("refuses a transfer into another tenant's location before reading stock", async () => {
    const res = await app().request('/transfers', post({
      product_id: P, from_location_id: MINE, to_location_id: THEIRS, quantity: 1,
    }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.message).toContain('to_location_id');
    expect(mocked.inventoryStock.findFirst).not.toHaveBeenCalled();
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });
});
