/**
 * PUBLIC STOREFRONT CATALOGUE
 *
 *   - reachable without a token, the store named by its tenant slug;
 *   - published, active products of that tenant only;
 *   - an allow-list: in stock yes/no, never quantities; no cost or internal ids;
 *   - an unknown or inactive store is 404.
 */

import catalogRoutes from '../modules/storefront/publicCatalog.routes';
import { Hono } from 'hono';
import { db } from '../infrastructure/database/client';
import { errorHandler } from '../shared/middleware/errorHandler';
import type { AppEnv } from '../shared/context';

jest.mock('../infrastructure/database/client', () => ({
  db: {
    tenant: { findFirst: jest.fn() },
    product: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
    productCategory: { findMany: jest.fn() },
    inventoryStock: { groupBy: jest.fn() },
  },
}));

const mdb = db as any;
const app = new Hono<AppEnv>().route('/', catalogRoutes).onError(errorHandler);

beforeEach(() => {
  jest.clearAllMocks();
  mdb.tenant.findFirst.mockImplementation(({ where }: any) =>
    Promise.resolve(where.slug === 'shop' && where.is_active ? { id: 't-1' } : null));
  mdb.product.findMany.mockResolvedValue([
    { id: 'p-1', sku: 'A', name: 'Boot', selling_price: 10, variants: [{ id: 'v-1' }, { id: 'v-2' }] },
    { id: 'p-2', sku: 'B', name: 'Sandal', selling_price: 5, variants: [] },
  ]);
  mdb.product.count.mockResolvedValue(2);
  mdb.inventoryStock.groupBy.mockResolvedValue([
    { product_id: 'p-1', variant_id: 'v-1', _sum: { quantity: 7, reserved_qty: 2 } },
    { product_id: 'p-1', variant_id: 'v-2', _sum: { quantity: 1, reserved_qty: 1 } },
  ]);
});

it('lists published, active products of the named store without a token', async () => {
  const res = await app.request('/shop/products');
  expect(res.status).toBe(200);
  const where = mdb.product.findMany.mock.calls[0][0].where;
  expect(where).toMatchObject({ tenant_id: 't-1', is_active: true, is_published: true });
});

it('reports availability as yes/no, never a quantity', async () => {
  const body: any = await (await app.request('/shop/products')).json();
  const [boot, sandal] = body.data;
  expect(boot.in_stock).toBe(true);
  expect(boot.variants).toEqual([{ id: 'v-1', available: true }, { id: 'v-2', available: false }]);
  expect(sandal.in_stock).toBe(false);
  expect(JSON.stringify(body)).not.toMatch(/quantity|reserved|available_stock|total_stock/);
});

it('selects an allow-list: no cost, no internal grouping', async () => {
  await app.request('/shop/products');
  const select = mdb.product.findMany.mock.calls[0][0].select;
  expect(Object.keys(select).sort()).toEqual(
    ['brand', 'category', 'description', 'id', 'images', 'name', 'sale_price', 'selling_price', 'sku', 'variants'].sort(),
  );
});

it('caps the page size', async () => {
  await app.request('/shop/products?limit=5000');
  expect(mdb.product.findMany.mock.calls[0][0].take).toBe(48);
});

it('answers 404 for an unknown store', async () => {
  expect((await app.request('/nowhere/products')).status).toBe(404);
  expect((await app.request('/nowhere/categories')).status).toBe(404);
});

it('does not show an unpublished product page', async () => {
  mdb.product.findFirst.mockResolvedValue(null);
  const res = await app.request('/shop/products/p-9');
  expect(res.status).toBe(404);
  expect(mdb.product.findFirst.mock.calls[0][0].where).toMatchObject({ is_published: true, is_active: true, tenant_id: 't-1' });
});
