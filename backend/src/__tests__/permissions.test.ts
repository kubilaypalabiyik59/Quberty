/**
 * RBAC PERMISSION TESTS
 * Verifies role-to-permission mapping without any HTTP or DB calls.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import {
  hasPermission,
  PURCHASE_PERMISSIONS,
  O2C_PERMISSIONS,
  STOCK_PERMISSIONS,
  requirePermission,
  type Permission,
} from '../shared/middleware/permissions';
import { AppError } from '../shared/errors/AppError';
import type { AppEnv } from '../shared/context';

// ── hasPermission() ────────────────────────────────────────────────────────────

describe('hasPermission()', () => {

  describe('admin role', () => {
    it('has admin:all', () => {
      expect(hasPermission('admin', 'admin:all')).toBe(true);
    });
    it('has every permission via admin:all', () => {
      const permissions: Permission[] = [
        'sales:create', 'purchase:pay', 'finance:close_period',
        'hr:delete', 'pos.sale.void', 'import.job.execute',
      ];
      permissions.forEach((p) => {
        expect(hasPermission('admin', p)).toBe(true);
      });
    });
  });

  describe('store_manager role', () => {
    it('can create sales orders', () => {
      expect(hasPermission('store_manager', 'sales:create')).toBe(true);
    });
    it('can receive purchase orders', () => {
      expect(hasPermission('store_manager', 'purchase:receive')).toBe(true);
    });
    it('can prepare an import but not run it', () => {
      expect(hasPermission('store_manager', 'import.job.prepare')).toBe(true);
      expect(hasPermission('store_manager', 'import.job.execute')).toBe(false);
    });
    it('cannot close accounting periods', () => {
      expect(hasPermission('store_manager', 'finance:close_period')).toBe(false);
    });
    it('cannot delete HR records', () => {
      expect(hasPermission('store_manager', 'hr:delete')).toBe(false);
    });
    it('does NOT have admin:all', () => {
      expect(hasPermission('store_manager', 'admin:all')).toBe(false);
    });
  });

  describe('cashier role', () => {
    it('can open a POS session', () => {
      expect(hasPermission('cashier', 'pos.session.operate')).toBe(true);
    });
    it('can complete a sale', () => {
      expect(hasPermission('cashier', 'pos.sale.post')).toBe(true);
    });
    it('can create customers', () => {
      expect(hasPermission('cashier', 'customer.create')).toBe(true);
    });
    it('cannot void sales', () => {
      expect(hasPermission('cashier', 'pos.sale.void')).toBe(false);
    });
    it('cannot access finance journals', () => {
      expect(hasPermission('cashier', 'finance:journal')).toBe(false);
    });
    it('cannot manage warehouse', () => {
      expect(hasPermission('cashier', 'warehouse.structure.maintain')).toBe(false);
    });
    it('cannot create purchase orders', () => {
      expect(hasPermission('cashier', 'purchase:create')).toBe(false);
    });
  });

  describe('employee role', () => {
    it('can read products', () => {
      expect(hasPermission('employee', 'product.read')).toBe(true);
    });
    it('can read sales', () => {
      expect(hasPermission('employee', 'sales:read')).toBe(true);
    });
    it('cannot create sales orders', () => {
      expect(hasPermission('employee', 'sales:create')).toBe(false);
    });
    it('cannot adjust inventory', () => {
      expect(hasPermission('employee', 'inventory.adjustment.post')).toBe(false);
    });
    it('cannot access POS', () => {
      expect(hasPermission('employee', 'pos.sale.post')).toBe(false);
    });
  });

  describe('order to cash registry (WORK-030a)', () => {
    it('gives a customer exactly the two storefront permissions', () => {
      O2C_PERMISSIONS.forEach((permission) => {
        expect({ permission, held: hasPermission('customer', permission) })
          .toEqual({ permission, held: permission.startsWith('storefront.') });
      });
    });

    it('gives the auditor every O2C read and nothing else from the registry', () => {
      O2C_PERMISSIONS.forEach((permission) => {
        const expected = permission.endsWith('.read') && !permission.startsWith('storefront.');
        expect({ permission, held: hasPermission('auditor', permission) }).toEqual({ permission, held: expected });
      });
    });

    it('confines the cashier to the till', () => {
      const cashier = O2C_PERMISSIONS.filter((p) => hasPermission('cashier', p)).sort();
      expect(cashier).toEqual(['customer.create', 'customer.read', 'pos.sale.post', 'pos.session.operate', 'product.read', 'sales.payment_method.read']);
    });

    it('gives the employee reads only', () => {
      const employee = O2C_PERMISSIONS.filter((p) => hasPermission('employee', p)).sort();
      expect(employee).toEqual(['crm.lead.read', 'crm.opportunity.read', 'customer.read', 'product.read', 'sales.order.read', 'sales.quotation.read']);
    });

    it.each<[string, string[]]>([
      ['admin', [...O2C_PERMISSIONS]],
      ['store_manager', O2C_PERMISSIONS.filter((p) =>
        p !== 'sales.order.cancel' && p !== 'crm.setup.maintain' && !p.startsWith('storefront.')
        && p !== 'sales.payment_method.maintain')],
      ['warehouse_worker', ['product.read']],
      ['purchasing_requester', ['product.read']],
      ['buyer', ['product.read']],
      ['receiver', ['product.read']],
      ['ap_clerk', ['product.read']],
      ['finance_approver', []],
    ])('pins the exact O2C grants of %s', (role, expected) => {
      // The route tests derive holders from hasPermission itself, so a grant lost
      // here would pass them; this list is the independent record.
      expect(O2C_PERMISSIONS.filter((p) => hasPermission(role, p)).sort()).toEqual([...expected].sort());
    });

    it('keeps sales-order cancel and CRM stage setup with the admin, not the store manager', () => {
      expect(hasPermission('store_manager', 'sales.order.cancel')).toBe(false);
      expect(hasPermission('store_manager', 'crm.setup.maintain')).toBe(false);
      expect(hasPermission('store_manager', 'pos.sale.void')).toBe(true);
      expect(hasPermission('admin', 'sales.order.cancel')).toBe(true);
    });
  });

  describe('unknown role', () => {
    it('refuses a role name that exists on the object prototype', () => {
      expect(hasPermission('constructor', 'product.read')).toBe(false);
      expect(hasPermission('toString', 'admin:all')).toBe(false);
    });
    it('is denied all permissions', () => {
      expect(hasPermission('unknown_role', 'product.read')).toBe(false);
      expect(hasPermission('',             'sales:read'   )).toBe(false);
    });
  });

  describe('purchasing compatibility policy', () => {
    it.each(['customer', 'cashier', 'unknown_role'])(
      '%s has no purchasing business permission',
      (role) => {
        PURCHASE_PERMISSIONS.forEach((permission) => {
          expect(hasPermission(role, permission)).toBe(false);
        });
      },
    );

    it('keeps the owner override and fails closed for sensitive store-manager actions', () => {
      PURCHASE_PERMISSIONS.forEach((permission) => {
        expect(hasPermission('admin', permission)).toBe(true);
      });
      expect(hasPermission('store_manager', 'purchase.vendor_payment.post')).toBe(false);
      expect(hasPermission('store_manager', 'purchase.order.cancel')).toBe(false);
      expect(hasPermission('store_manager', 'purchase.vendor_invoice.approve_discrepancy')).toBe(false);
      expect(hasPermission('store_manager', 'purchase.vendor_invoice.cancel')).toBe(false);
      expect(hasPermission('store_manager', 'purchase.vendor_invoice.post')).toBe(true);
    });

    it('does not give warehouse workers unrelated legacy permissions', () => {
      expect(hasPermission('warehouse_worker', 'purchase.order.read')).toBe(true);
      expect(hasPermission('warehouse_worker', 'purchase.receipt.post')).toBe(true);
      expect(hasPermission('warehouse_worker', 'inventory.adjustment.post')).toBe(false);
      expect(hasPermission('warehouse_worker', 'warehouse.structure.maintain')).toBe(false);
    });
  });

  describe('product, stock, warehouse and import registry (WORK-030b)', () => {
    const managerStock = STOCK_PERMISSIONS.filter((p) =>
      !['product.delete', 'product.setup.read', 'product.setup.maintain', 'warehouse.site.maintain', 'import.job.execute', 'inventory.journal.opening', 'inventory.journal.cost_override'].includes(p));
    const structure = ['warehouse.structure.read'];

    // The route tests derive holders from hasPermission itself; this list is the
    // independent record of who may do what.
    it.each<[string, string[]]>([
      ['admin', [...STOCK_PERMISSIONS]],
      ['store_manager', managerStock],
      ['cashier', ['inventory.stock.read', ...structure]],
      ['employee', ['inventory.stock.read', ...structure]],
      ['warehouse_worker', [
        'inventory.stock.read', ...structure, 'warehouse.work.read', 'warehouse.work.execute',
        'warehouse.wave.read', 'warehouse.arrival.read', 'inventory.count.read', 'inventory.count.record',
      ]],
      ['customer', []],
      ['purchasing_requester', structure],
      ['buyer', ['inventory.stock.read', ...structure]],
      ['receiver', [
        'inventory.stock.read', ...structure, 'warehouse.work.read', 'warehouse.work.execute', 'warehouse.arrival.read',
      ]],
      ['ap_clerk', structure],
      ['finance_approver', []],
      ['auditor', STOCK_PERMISSIONS.filter((p) => p.endsWith('.read'))],
      ['finance_manager', ['product.setup.read', 'product.setup.maintain', 'inventory.stock.read', ...structure]],
    ])('pins the exact stock grants of %s', (role, expected) => {
      expect(STOCK_PERMISSIONS.filter((p) => hasPermission(role, p)).sort()).toEqual([...expected].sort());
    });

    // Product financial setup decides which GL accounts a product posts to and
    // how it is costed: finance's, not the store's (Kubi, 2026-09-18).
    it('gives product financial setup to admin and finance_manager only; the auditor may read it', () => {
      const holders = (p: Permission) =>
        ['admin', 'store_manager', 'cashier', 'employee', 'warehouse_worker', 'customer', 'purchasing_requester',
          'buyer', 'receiver', 'ap_clerk', 'finance_approver', 'auditor', 'finance_manager']
          .filter((r) => hasPermission(r, p)).sort();
      expect(holders('product.setup.maintain')).toEqual(['admin', 'finance_manager']);
      expect(holders('product.setup.read')).toEqual(['admin', 'auditor', 'finance_manager']);
    });

    it('keeps recording a count and posting it with different roles (S-2)', () => {
      expect(hasPermission('warehouse_worker', 'inventory.count.record')).toBe(true);
      expect(hasPermission('warehouse_worker', 'inventory.count.post')).toBe(false);
      expect(hasPermission('store_manager', 'inventory.count.post')).toBe(true);
    });
  });
});

// ── requirePermission() middleware ────────────────────────────────────────────

/**
 * `requirePermission` is Hono middleware: it reads `c.get('user')` and THROWS an
 * AppError. It does not take an Express `(req, res, next)` triple and never calls
 * `next(error)` — which is why the previous version of this section stopped
 * compiling. The error is captured through `app.onError`, where a real request's
 * error would land.
 *
 * `role: undefined` reproduces requirePermission running with no authMiddleware
 * in front of it, which must be a 401 rather than a 403.
 */
function buildPermissionApp(role: string | undefined, ...permissions: [Permission, ...Permission[]]) {
  const captured: { error: unknown; handlerRan: boolean } = {
    error: undefined,
    handlerRan: false,
  };
  const app = new Hono<AppEnv>();

  const setUser: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (role !== undefined) {
      c.set('user', { id: 'user-1', email: 'test@test.com', role, tenantId: 'tenant-1' });
    }
    await next();
  };

  app.get('/guarded', setUser, requirePermission(...permissions), (c) => {
    captured.handlerRan = true;
    return c.json({ ok: true });
  });

  app.onError((err, c) => {
    captured.error = err;
    return c.json({ ok: false }, 500);
  });

  return { app, captured };
}

describe('requirePermission() middleware', () => {
  it('continues when the user has the permission', async () => {
    const { app, captured } = buildPermissionApp('admin', 'sales:create');

    const res = await app.request('/guarded');

    expect(captured.error).toBeUndefined();
    expect(res.status).toBe(200);
    expect(captured.handlerRan).toBe(true);
  });

  it('throws AppError 403 when the user lacks the permission', async () => {
    const { app, captured } = buildPermissionApp('cashier', 'finance:journal');

    await app.request('/guarded');

    expect(captured.error).toBeInstanceOf(AppError);
    expect(captured.error).toMatchObject({ statusCode: 403 });
    expect(captured.handlerRan).toBe(false);
  });

  it('throws AppError 401 when there is no user on the context', async () => {
    const { app, captured } = buildPermissionApp(undefined, 'product.read');

    await app.request('/guarded');

    expect(captured.error).toBeInstanceOf(AppError);
    // 401 not 403: missing authentication is a different failure from a denied
    // permission, and the middleware distinguishes them.
    expect(captured.error).toMatchObject({ statusCode: 401 });
    expect(captured.handlerRan).toBe(false);
  });

  it.each<[string, Permission]>([
    ['purchasing_requester', 'purchase.requisition.create'],
    ['buyer', 'purchase.order.create'],
    ['receiver', 'purchase.receipt.post'],
    ['ap_clerk', 'purchase.vendor_invoice.match'],
    ['finance_approver', 'purchase.vendor_payment.post'],
    ['auditor', 'purchase.vendor_invoice.read'],
    ['admin', 'purchase.vendor_payment.reverse'],
    ['store_manager', 'purchase.setup.maintain'],
  ])('allows %s through its representative purchasing guard', async (role, permission) => {
    const { app, captured } = buildPermissionApp(role, permission);
    const res = await app.request('/guarded');
    expect(res.status).toBe(200);
    expect(captured.handlerRan).toBe(true);
  });

  it('requires every permission in an all-of guard', async () => {
    const denied = buildPermissionApp(
      'receiver',
      'purchase.receipt.post',
      'purchase.vendor_invoice.create',
      'purchase.vendor_invoice.match',
      'purchase.vendor_invoice.post',
    );
    await denied.app.request('/guarded');
    expect(denied.captured.error).toMatchObject({ statusCode: 403 });
    expect(denied.captured.handlerRan).toBe(false);

    const allowed = buildPermissionApp(
      'store_manager',
      'purchase.receipt.post',
      'purchase.vendor_invoice.create',
      'purchase.vendor_invoice.match',
      'purchase.vendor_invoice.post',
    );
    const res = await allowed.app.request('/guarded');
    expect(res.status).toBe(200);
    expect(allowed.captured.handlerRan).toBe(true);
  });
});
