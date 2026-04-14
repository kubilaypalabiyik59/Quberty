/**
 * RBAC PERMISSION TESTS
 * Verifies role-to-permission mapping without any HTTP or DB calls.
 */

import { hasPermission, requirePermission, type Permission } from '../shared/middleware/permissions';
import { Request, Response, NextFunction } from 'express';

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

function makeReq(role: string): Partial<Request> {
  return { user: { id: 'user-1', email: 'test@test.com', role, tenantId: 'tenant-1' } };
}

describe('requirePermission() middleware', () => {
  it('calls next() when user has the permission', () => {
    const req  = makeReq('admin') as Request;
    const res  = {} as Response;
    const next = jest.fn() as NextFunction;

    requirePermission('sales:create')(req, res, next);

    expect(next).toHaveBeenCalledWith(); // called with no args = success
  });

  it('calls next(AppError) when user lacks permission', () => {
    const req  = makeReq('cashier') as Request;
    const res  = {} as Response;
    const next = jest.fn() as NextFunction;

    requirePermission('finance:journal')(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('calls next(AppError 401) when req.user is missing', () => {
    const req  = { user: undefined } as unknown as Request;
    const res  = {} as Response;
    const next = jest.fn() as NextFunction;

    requirePermission('products:read')(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});
