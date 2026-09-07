/**
 * RBAC PERMISSION TESTS
 * Verifies role-to-permission mapping without any HTTP or DB calls.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { hasPermission, requirePermission, type Permission } from '../shared/middleware/permissions';
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
        'hr:delete', 'pos:void', 'import:run',
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
    it('can run imports', () => {
      expect(hasPermission('store_manager', 'import:run')).toBe(true);
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
      expect(hasPermission('cashier', 'pos:session')).toBe(true);
    });
    it('can complete a sale', () => {
      expect(hasPermission('cashier', 'pos:sale')).toBe(true);
    });
    it('can create customers', () => {
      expect(hasPermission('cashier', 'customers:create')).toBe(true);
    });
    it('cannot void sales', () => {
      expect(hasPermission('cashier', 'pos:void')).toBe(false);
    });
    it('cannot access finance journals', () => {
      expect(hasPermission('cashier', 'finance:journal')).toBe(false);
    });
    it('cannot manage warehouse', () => {
      expect(hasPermission('cashier', 'warehouse:manage')).toBe(false);
    });
    it('cannot create purchase orders', () => {
      expect(hasPermission('cashier', 'purchase:create')).toBe(false);
    });
  });

  describe('employee role', () => {
    it('can read products', () => {
      expect(hasPermission('employee', 'products:read')).toBe(true);
    });
    it('can read sales', () => {
      expect(hasPermission('employee', 'sales:read')).toBe(true);
    });
    it('cannot create sales orders', () => {
      expect(hasPermission('employee', 'sales:create')).toBe(false);
    });
    it('cannot adjust inventory', () => {
      expect(hasPermission('employee', 'inventory:adjust')).toBe(false);
    });
    it('cannot access POS', () => {
      expect(hasPermission('employee', 'pos:sale')).toBe(false);
    });
  });

  describe('unknown role', () => {
    it('is denied all permissions', () => {
      expect(hasPermission('unknown_role', 'products:read')).toBe(false);
      expect(hasPermission('',             'sales:read'   )).toBe(false);
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
function buildPermissionApp(role: string | undefined, permission: Permission) {
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

  app.get('/guarded', setUser, requirePermission(permission), (c) => {
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
    const { app, captured } = buildPermissionApp(undefined, 'products:read');

    await app.request('/guarded');

    expect(captured.error).toBeInstanceOf(AppError);
    // 401 not 403: missing authentication is a different failure from a denied
    // permission, and the middleware distinguishes them.
    expect(captured.error).toMatchObject({ statusCode: 401 });
    expect(captured.handlerRan).toBe(false);
  });
});
