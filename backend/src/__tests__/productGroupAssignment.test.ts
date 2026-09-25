/**
 * ITEM GROUP ASSIGNMENT ON PRODUCTS
 *
 *   - a product can be created with its item group and item model group;
 *   - a group id from another tenant is refused (422) on create, update and bulk;
 *   - bulk assignment fills only the empty field when only_unassigned is set;
 *   - bulk assignment skips and reports products with posted transactions unless forced.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import productRoutes from '../modules/inventory/product.routes';
import { db } from '../infrastructure/database/client';
import { errorHandler } from '../shared/middleware/errorHandler';
import type { AppEnv } from '../shared/context';

jest.mock('../infrastructure/database/client', () => ({
  db: {
    itemGroup: { findFirst: jest.fn() },
    itemModelGroup: { findFirst: jest.fn() },
    product: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
    inventoryTransaction: { groupBy: jest.fn(), count: jest.fn() },
  },
}));

const mdb = db as any;
const TENANT = 'tenant-1';
const IG = 'ig-1';
const IMG = 'img-1';

function mount() {
  const app = new Hono<AppEnv>();
  const identity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'user-1', email: 'a@t.com', role: 'admin', tenantId: TENANT });
    c.set('tenantId', TENANT);
    await next();
  };
  app.use('*', identity);
  app.route('/', productRoutes);
  app.onError(errorHandler);
  return app;
}
const send = (method: string, body: unknown) => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  jest.clearAllMocks();
  // Groups exist only in this tenant.
  mdb.itemGroup.findFirst.mockImplementation(({ where }: any) =>
    Promise.resolve(where.id === IG && where.tenant_id === TENANT ? { id: IG } : null));
  mdb.itemModelGroup.findFirst.mockImplementation(({ where }: any) =>
    Promise.resolve(where.id === IMG && where.tenant_id === TENANT ? { id: IMG } : null));
  mdb.product.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'p-new', ...data }));
  mdb.product.updateMany.mockImplementation(({ where }: any) => Promise.resolve({ count: where.id?.in?.length ?? 1 }));
  mdb.inventoryTransaction.groupBy.mockResolvedValue([]);
});

describe('create', () => {
  it('stores the item group and item model group given at creation', async () => {
    const res = await mount().request('/', send('POST', {
      name: 'Boot', sku: 'B-1', selling_price: 100, item_group_id: IG, item_model_group_id: IMG,
    }));
    expect(res.status).toBe(201);
    const data = mdb.product.create.mock.calls[0][0].data;
    expect(data.item_group_id).toBe(IG);
    expect(data.item_model_group_id).toBe(IMG);
    expect(data.tenant_id).toBe(TENANT);
  });

  it("refuses another tenant's item group before creating anything", async () => {
    const res = await mount().request('/', send('POST', {
      name: 'Boot', sku: 'B-1', selling_price: 100, item_group_id: 'someone-elses',
    }));
    expect(res.status).toBe(422);
    expect(mdb.product.create).not.toHaveBeenCalled();
  });
});

describe('update', () => {
  it("refuses another tenant's item model group", async () => {
    const res = await mount().request('/p-1', send('PUT', { item_model_group_id: 'someone-elses' }));
    expect(res.status).toBe(422);
    expect(mdb.product.updateMany).not.toHaveBeenCalled();
  });
});

describe('bulk assignment', () => {
  it('fills only products whose field is empty when only_unassigned is set', async () => {
    mdb.product.findMany.mockResolvedValue([{ id: 'p-1', sku: 'A' }, { id: 'p-2', sku: 'B' }]);
    const res = await mount().request('/setup/assign-groups', send('POST', { item_group_id: IG, only_unassigned: true }));
    expect(res.status).toBe(200);
    const where = mdb.product.findMany.mock.calls[0][0].where;
    expect(where.tenant_id).toBe(TENANT);
    expect(where.item_group_id).toBeNull();
    // An empty field must count as "would change": NOT (field = value) is NULL
    // in SQL for an empty field and would silently drop it.
    expect(where.OR).toEqual([{ item_group_id: null }, { item_group_id: { not: IG } }]);
    expect(where.NOT).toBeUndefined();
    const body: any = await res.json();
    expect(body.data.item_group_id).toEqual({ updated: 2, skipped_with_transactions: [] });
    expect(mdb.product.updateMany.mock.calls[0][0].where.tenant_id).toBe(TENANT);
  });

  it('skips and reports products with posted transactions', async () => {
    mdb.product.findMany.mockResolvedValue([{ id: 'p-1', sku: 'CLEAN' }, { id: 'p-2', sku: 'POSTED' }]);
    mdb.inventoryTransaction.groupBy.mockResolvedValue([{ product_id: 'p-2' }]);
    const res = await mount().request('/setup/assign-groups', send('POST', { item_model_group_id: IMG, product_ids: ['p-1', 'p-2'] }));
    const body: any = await res.json();
    expect(body.data.item_model_group_id).toEqual({ updated: 1, skipped_with_transactions: ['POSTED'] });
    expect(mdb.product.updateMany.mock.calls[0][0].where.id.in).toEqual(['p-1']);
  });

  it('includes products with transactions when forced', async () => {
    mdb.product.findMany.mockResolvedValue([{ id: 'p-1', sku: 'CLEAN' }, { id: 'p-2', sku: 'POSTED' }]);
    mdb.inventoryTransaction.groupBy.mockResolvedValue([{ product_id: 'p-2' }]);
    const res = await mount().request('/setup/assign-groups', send('POST', { item_group_id: IG, product_ids: ['p-1', 'p-2'], force: true }));
    const body: any = await res.json();
    expect(body.data.item_group_id.updated).toBe(2);
  });

  it("refuses another tenant's group", async () => {
    const res = await mount().request('/setup/assign-groups', send('POST', { item_group_id: 'someone-elses', only_unassigned: true }));
    expect(res.status).toBe(422);
    expect(mdb.product.updateMany).not.toHaveBeenCalled();
  });

  it('needs a target: product_ids or only_unassigned', async () => {
    const res = await mount().request('/setup/assign-groups', send('POST', { item_group_id: IG }));
    expect(res.status).toBe(400);
  });
});
