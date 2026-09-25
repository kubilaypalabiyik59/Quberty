/**
 * ORDER-TO-CASH ROUTE PERMISSIONS (WORK-030a)
 *
 * Pins, for the sales order, quotation, CRM, customer and POS routers and the three
 * product reads the storefront shares:
 *   - the exact permission manifest of each router;
 *   - that every route the router registers has exactly one manifest entry, so a
 *     new route without a guard fails here;
 *   - that for EVERY route a role lacking the permission is refused 403 before the
 *     database is touched and before a FACTURA number is drawn;
 *   - that a role holding the permission gets past the guard.
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

jest.mock('../shared/services/numberSequence.service', () => ({
  ...jest.requireActual('../shared/services/numberSequence.service'),
  nextFacturaNumber: jest.fn(),
}));

import salesRoutes, { SALES_ORDER_ROUTE_PERMISSIONS } from '../modules/sales/sales.routes';
import quotationRoutes, { SALES_QUOTATION_ROUTE_PERMISSIONS } from '../modules/sales/quotation.routes';
import crmRoutes, { CRM_ROUTE_PERMISSIONS } from '../modules/crm/crm.routes';
import customerRoutes, { CUSTOMER_ROUTE_PERMISSIONS } from '../modules/customers/customer.routes';
import posRoutes, { POS_ROUTE_PERMISSIONS } from '../modules/pos/pos.routes';
import paymentMethodRoutes, { SALES_PAYMENT_METHOD_ROUTE_PERMISSIONS } from '../modules/sales/salesPaymentMethod.routes';
import productRoutes, { PRODUCT_READ_ROUTE_PERMISSIONS } from '../modules/inventory/product.routes';
import { db } from '../infrastructure/database/client';
import { nextFacturaNumber } from '../shared/services/numberSequence.service';
import { errorHandler } from '../shared/middleware/errorHandler';
import { hasPermission, type Permission, type RouteGuard, type RouteGuards } from '../shared/middleware/permissions';
import type { AppEnv } from '../shared/context';

const touched = (db as any).__touched as { count: number };

/** Resolve with `fallback` after `ms` unless cleared — and always cleared. */
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

const ROUTERS: Array<[string, Hono<AppEnv>, RouteGuards, number, boolean]> = [
  // name, router, manifest, expected route count, manifest covers the whole router
  ['sales orders', salesRoutes, SALES_ORDER_ROUTE_PERMISSIONS, 12, true],
  ['quotations', quotationRoutes, SALES_QUOTATION_ROUTE_PERMISSIONS, 9, true],
  ['crm', crmRoutes, CRM_ROUTE_PERMISSIONS, 18, true],
  ['customers', customerRoutes, CUSTOMER_ROUTE_PERMISSIONS, 7, true],
  ['pos', posRoutes, POS_ROUTE_PERMISSIONS, 7, true],
  ['sales payment methods', paymentMethodRoutes, SALES_PAYMENT_METHOD_ROUTE_PERMISSIONS, 3, true],
  // Only the three storefront-shared reads are converted in 030a.
  ['product reads', productRoutes, PRODUCT_READ_ROUTE_PERMISSIONS, 3, false],
];

describe('manifests', () => {
  it('pins the sales order manifest', () => {
    expect(SALES_ORDER_ROUTE_PERMISSIONS).toEqual({
      'GET /': ['sales.order.read'],
      'POST /': ['sales.order.create'],
      'POST /storefront': ['storefront.order.place'],
      'GET /:id': ['sales.order.read'],
      'POST /:id/invoice': ['sales.invoice.post'],
      'POST /:id/pay': ['sales.customer_payment.post'],
      'PUT /:id': ['sales.order.update'],
      'POST /:id/confirm': ['sales.order.confirm'],
      'POST /:id/ship': ['sales.order.ship'],
      'POST /:id/complete': ['sales.order.complete'],
      'POST /:id/cancel': ['sales.order.cancel'],
      'POST /:id/return': ['sales.return.post'],
    });
  });

  it('pins the quotation manifest (confirm can create the customer too)', () => {
    expect(SALES_QUOTATION_ROUTE_PERMISSIONS).toEqual({
      'GET /': ['sales.quotation.read'],
      'POST /': ['sales.quotation.create'],
      'GET /:id': ['sales.quotation.read'],
      'PUT /:id/lines': ['sales.quotation.update'],
      'POST /:id/send': ['sales.quotation.send'],
      'POST /:id/revise': ['sales.quotation.update'],
      'POST /:id/confirm': ['sales.quotation.confirm', 'sales.order.create', 'customer.create'],
      'POST /:id/lose': ['sales.quotation.close'],
      'POST /:id/cancel': ['sales.quotation.close'],
    });
  });

  it('pins the CRM manifest', () => {
    expect(CRM_ROUTE_PERMISSIONS).toEqual({
      'GET /stages': ['crm.opportunity.read'],
      'POST /stages': ['crm.setup.maintain'],
      'PUT /stages/:id': ['crm.setup.maintain'],
      'GET /leads': ['crm.lead.read'],
      'POST /leads': ['crm.lead.maintain'],
      'GET /leads/:id': ['crm.lead.read'],
      'PUT /leads/:id': ['crm.lead.maintain'],
      'POST /leads/:id/qualify': ['crm.lead.maintain', 'crm.opportunity.maintain', 'customer.create'],
      'POST /leads/:id/disqualify': ['crm.lead.maintain'],
      'POST /leads/:id/reopen': ['crm.lead.maintain'],
      'POST /leads/:id/convert-to-customer': ['crm.lead.maintain', 'customer.create'],
      'GET /opportunities': ['crm.opportunity.read'],
      'GET /opportunities/pipeline': ['crm.opportunity.read'],
      'POST /opportunities': ['crm.opportunity.maintain'],
      'GET /opportunities/:id': ['crm.opportunity.read'],
      'PUT /opportunities/:id': ['crm.opportunity.maintain'],
      'POST /opportunities/:id/stage': ['crm.opportunity.maintain'],
      'POST /opportunities/:id/close': ['crm.opportunity.close'],
    });
  });

  it('pins the customer manifest', () => {
    expect(CUSTOMER_ROUTE_PERMISSIONS).toEqual({
      'GET /': ['customer.read'],
      'POST /': ['customer.create'],
      'GET /segments': ['report.sales.read'],
      'GET /:id': ['customer.read'],
      'PUT /:id': ['customer.update'],
      'GET /:id/orders': ['customer.read', 'sales.order.read'],
      'GET /:id/statement': ['customer.read', 'sales.order.read'],
    });
  });

  it('pins the POS manifest', () => {
    expect(POS_ROUTE_PERMISSIONS).toEqual({
      'POST /sessions/open': ['pos.session.operate'],
      'GET /sessions/current': ['pos.session.operate'],
      'GET /sessions': ['pos.session.read'],
      'GET /sessions/:id': ['pos.session.read'],
      'POST /sessions/:id/close': ['pos.session.operate'],
      'POST /sale': ['pos.sale.post'],
      'POST /sales/:orderId/void': ['pos.sale.void'],
    });
  });

  it('pins the storefront-shared product reads', () => {
    const either = { anyOf: ['product.read', 'storefront.catalog.read'] };
    expect(PRODUCT_READ_ROUTE_PERMISSIONS).toEqual({
      'GET /': either, 'GET /categories': either, 'GET /:id': either,
    });
  });
});

describe('the recording database', () => {
  // Without this, "zero database access on denial" could be vacuously true.
  it('does record access when a permitted request reaches its handler', async () => {
    touched.count = 0;
    await raceWithTimeout(Promise.resolve(mount('store_manager', customerRoutes).request('/')), 1500, null);
    expect(touched.count).toBeGreaterThan(0);
  });
});

describe.each(ROUTERS)('%s router', (_name, router, manifest, count, whole) => {
  beforeEach(() => {
    touched.count = 0;
    (nextFacturaNumber as jest.Mock).mockClear();
  });

  it('has the expected number of guarded routes', () => {
    expect(Object.keys(manifest)).toHaveLength(count);
  });

  if (whole) {
    it('registers exactly the routes its manifest names — no route without a guard', () => {
      const registered = new Set(
        router.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`),
      );
      expect([...registered].sort()).toEqual(Object.keys(manifest).sort());
    });
  }

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
    expect(nextFacturaNumber).not.toHaveBeenCalled();
  });

  it.each(Object.keys(manifest))('lets a holder of %s past the guard', async (key) => {
    const guard = manifest[key];
    const holder = ['store_manager', ...ROLES].find((role) => holds(role, guard)) ?? 'admin';
    const { url, init } = request(key);
    touched.count = 0;
    const outcome = await raceWithTimeout(
      Promise.resolve(mount(holder, router).request(url, init)).then((r) => r.status),
      1500,
      'running' as const,
    );
    // Past the guard means the handler ran: it answered something other than 403,
    // or it was still working against the (fake) database.
    expect(outcome === 'running' || outcome !== 403).toBe(true);
  });
});
