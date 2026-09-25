/**
 * PRODUCT, STOCK, WAREHOUSE AND IMPORT ROUTE PERMISSIONS (WORK-030b)
 *
 * For the product, unit-of-measure, variant-type, inventory, count, warehouse and
 * import routers:
 *   - the exact permission manifest of each router;
 *   - every registered route has exactly one manifest entry, so a new route
 *     without a guard fails here;
 *   - for EVERY route, each role lacking the permission is refused 403 before the
 *     database is touched;
 *   - a role holding the permission gets past the guard.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';

// A database that records any access and never resolves to real data. `then` is
// hidden so an awaited proxy settles instead of hanging.
jest.mock('../infrastructure/database/client', () => {
  const touched = { count: 0 };
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === '__touched') return touched;
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      touched.count++;
      return new Proxy(function () {}, handler);
    },
    apply() {
      touched.count++;
      return new Proxy(function () {}, handler);
    },
  };
  return { db: new Proxy(function () {}, handler) };
});

import productRoutes, { PRODUCT_READ_ROUTE_PERMISSIONS, PRODUCT_ROUTE_PERMISSIONS } from '../modules/inventory/product.routes';
import uomRoutes, { UOM_ROUTE_PERMISSIONS } from '../modules/inventory/uom.routes';
import variantTypeRoutes, { VARIANT_TYPE_ROUTE_PERMISSIONS } from '../modules/inventory/variant-types.routes';
import inventoryRoutes, { INVENTORY_ROUTE_PERMISSIONS } from '../modules/inventory/inventory.routes';
import countRoutes, { INVENTORY_COUNT_ROUTE_PERMISSIONS } from '../modules/inventory/inventory-count.routes';
import warehouseRoutes, { WAREHOUSE_ROUTE_PERMISSIONS } from '../modules/warehouse/warehouse.routes';
import importRoutes, { IMPORT_ROUTE_PERMISSIONS } from '../modules/import/import.routes';
import journalRoutes, { INVENTORY_JOURNAL_ROUTE_PERMISSIONS } from '../modules/inventory/inventory-journal.routes';
import { db } from '../infrastructure/database/client';
import { errorHandler } from '../shared/middleware/errorHandler';
import { hasPermission, type Permission, type RouteGuard, type RouteGuards } from '../shared/middleware/permissions';
import type { AppEnv } from '../shared/context';

const touched = (db as any).__touched as { count: number };

async function raceWithTimeout<T, F>(work: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<F>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

const ROLES = [
  'store_manager', 'cashier', 'employee', 'warehouse_worker', 'customer',
  'purchasing_requester', 'buyer', 'receiver', 'ap_clerk', 'finance_approver', 'auditor',
];

function holds(role: string, guard: RouteGuard): boolean {
  if ('anyOf' in guard) return guard.anyOf.some((p) => hasPermission(role, p));
  return (guard as readonly Permission[]).every((p) => hasPermission(role, p));
}

function mount(role: string, router: Hono<AppEnv>) {
  const app = new Hono<AppEnv>();
  const identity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'user-1', email: 't@t.com', role, tenantId: 'tenant-1' });
    c.set('tenantId', 'tenant-1');
    await next();
  };
  app.use('*', identity);
  app.route('/', router);
  app.onError(errorHandler);
  return app;
}

function request(key: string) {
  const [method, path] = key.split(' ');
  const url = path.replace(/:[A-Za-z]+/g, UUID);
  return {
    url,
    init: method === 'GET'
      ? { method }
      : { method, headers: { 'content-type': 'application/json' }, body: '{}' },
  };
}

const PRODUCT_ALL: RouteGuards = { ...PRODUCT_READ_ROUTE_PERMISSIONS, ...PRODUCT_ROUTE_PERMISSIONS };

const ROUTERS: Array<[string, Hono<AppEnv>, RouteGuards, number]> = [
  ['products', productRoutes, PRODUCT_ALL, 27],
  ['units of measure', uomRoutes, UOM_ROUTE_PERMISSIONS, 4],
  ['variant types', variantTypeRoutes, VARIANT_TYPE_ROUTE_PERMISSIONS, 4],
  ['inventory', inventoryRoutes, INVENTORY_ROUTE_PERMISSIONS, 5],
  ['inventory counts', countRoutes, INVENTORY_COUNT_ROUTE_PERMISSIONS, 5],
  ['warehouse', warehouseRoutes, WAREHOUSE_ROUTE_PERMISSIONS, 25],
  ['import', importRoutes, IMPORT_ROUTE_PERMISSIONS, 6],
  ['inventory journals', journalRoutes, INVENTORY_JOURNAL_ROUTE_PERMISSIONS, 9],
];

describe('manifests', () => {
  it('pins the inventory and count manifests', () => {
    expect(INVENTORY_ROUTE_PERMISSIONS).toEqual({
      'GET /stock': ['inventory.stock.read'],
      'GET /transactions': ['inventory.transaction.read'],
      'GET /low-stock': ['inventory.stock.read'],
      'POST /transfers': ['inventory.transfer.post'],
      'POST /adjust': ['inventory.adjustment.post'],
    });
    expect(INVENTORY_COUNT_ROUTE_PERMISSIONS).toEqual({
      'GET /': ['inventory.count.read'],
      'GET /:id': ['inventory.count.read'],
      'POST /': ['inventory.count.create'],
      'PUT /:id/lines/:lineId': ['inventory.count.record'],
      'POST /:id/finalize': ['inventory.count.post'],
    });
  });

  it('pins the import manifest: preparing and running are separate', () => {
    expect(IMPORT_ROUTE_PERMISSIONS).toEqual({
      'POST /upload': ['import.job.prepare'],
      'POST /jobs/:id/mapping': ['import.job.prepare'],
      'POST /jobs/:id/validate': ['import.job.prepare'],
      'POST /jobs/:id/execute': ['import.job.execute'],
      'GET /jobs': ['import.job.read'],
      'GET /jobs/:id': ['import.job.read'],
    });
  });

  it('keeps site creation and product deletion out of the store manager duties', () => {
    expect(WAREHOUSE_ROUTE_PERMISSIONS['POST /sites']).toEqual(['warehouse.site.maintain']);
    expect(PRODUCT_ROUTE_PERMISSIONS['DELETE /:id']).toEqual(['product.delete']);
    expect(hasPermission('store_manager', 'warehouse.site.maintain')).toBe(false);
    expect(hasPermission('store_manager', 'product.delete')).toBe(false);
  });

  it('puts every warehouse work action behind warehouse.work.execute', () => {
    expect(WAREHOUSE_ROUTE_PERMISSIONS['POST /work/:id/start']).toEqual(['warehouse.work.execute']);
    expect(WAREHOUSE_ROUTE_PERMISSIONS['POST /work/:id/lines/:lineId/complete']).toEqual(['warehouse.work.execute']);
    // The whole-work "complete" shortcut is gone: it marked work done without moving stock.
    expect(WAREHOUSE_ROUTE_PERMISSIONS).not.toHaveProperty(['POST /work/:id/complete']);
  });
});

describe('the recording database', () => {
  it('does record access when a permitted request reaches its handler', async () => {
    touched.count = 0;
    await raceWithTimeout(Promise.resolve(mount('store_manager', inventoryRoutes).request('/stock')), 1500, null);
    expect(touched.count).toBeGreaterThan(0);
  });
});

describe.each(ROUTERS)('%s router', (_name, router, manifest, count) => {
  beforeEach(() => { touched.count = 0; });

  it('has the expected number of guarded routes', () => {
    expect(Object.keys(manifest)).toHaveLength(count);
  });

  it('registers exactly the routes its manifest names — no route without a guard', () => {
    const registered = new Set(
      router.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`),
    );
    expect([...registered].sort()).toEqual(Object.keys(manifest).sort());
  });

  it.each(Object.keys(manifest))('refuses %s to a role without the permission, before the database', async (key) => {
    const guard = manifest[key];
    const denied = ROLES.filter((role) => !holds(role, guard));
    expect(denied.length).toBeGreaterThan(0);
    for (const role of denied) {
      touched.count = 0;
      const { url, init } = request(key);
      const res = await mount(role, router).request(url, init);
      expect({ role, status: res.status }).toEqual({ role, status: 403 });
      expect({ role, dbTouched: touched.count }).toEqual({ role, dbTouched: 0 });
    }
  });

  it.each(Object.keys(manifest))('lets a holder of %s past the guard', async (key) => {
    const guard = manifest[key];
    const holder = ['store_manager', ...ROLES].find((role) => holds(role, guard)) ?? 'admin';
    const { url, init } = request(key);
    const outcome = await raceWithTimeout(
      Promise.resolve(mount(holder, router).request(url, init)).then((r) => r.status),
      1500,
      'running' as const,
    );
    // Past the guard means the handler ran: anything but 403, or still working.
    expect(outcome === 'running' || outcome !== 403).toBe(true);
  });
});
