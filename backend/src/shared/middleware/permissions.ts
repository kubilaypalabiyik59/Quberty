import { AppError } from '../errors/AppError';
import type { AppContext, AppNext } from '../context';

export type Permission =
  | 'products:read'    | 'products:create'    | 'products:update'   | 'products:delete'
  | 'inventory:read'   | 'inventory:adjust'   | 'inventory:count'   | 'inventory:transfer'
  | 'warehouse:read'   | 'warehouse:manage'
  | 'sales:read'       | 'sales:create'       | 'sales:confirm'     | 'sales:ship'
  | 'sales:cancel'     | 'sales:invoice'      | 'sales:return'
  | 'purchase:read'    | 'purchase:create'    | 'purchase:confirm'  | 'purchase:receive'
  | 'purchase:pay'     | 'purchase:cancel'
  | 'customers:read'   | 'customers:create'   | 'customers:update'
  | 'hr:read'          | 'hr:create'          | 'hr:update'         | 'hr:delete'
  | 'finance:read'     | 'finance:journal'    | 'finance:close_period'
  | 'reports:read'
  | 'pos:session'      | 'pos:sale'           | 'pos:void'
  | 'import:run'
  | 'admin:all';

export type Role = 'admin' | 'store_manager' | 'cashier' | 'employee';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    'admin:all',
    'products:read', 'products:create', 'products:update', 'products:delete',
    'inventory:read', 'inventory:adjust', 'inventory:count', 'inventory:transfer',
    'warehouse:read', 'warehouse:manage',
    'sales:read', 'sales:create', 'sales:confirm', 'sales:ship', 'sales:cancel', 'sales:invoice', 'sales:return',
    'purchase:read', 'purchase:create', 'purchase:confirm', 'purchase:receive', 'purchase:pay', 'purchase:cancel',
    'customers:read', 'customers:create', 'customers:update',
    'hr:read', 'hr:create', 'hr:update', 'hr:delete',
    'finance:read', 'finance:journal', 'finance:close_period',
    'reports:read',
    'pos:session', 'pos:sale', 'pos:void',
    'import:run',
  ],
  store_manager: [
    'products:read', 'products:create', 'products:update',
    'inventory:read', 'inventory:adjust', 'inventory:count', 'inventory:transfer',
    'warehouse:read', 'warehouse:manage',
    'sales:read', 'sales:create', 'sales:confirm', 'sales:ship', 'sales:cancel', 'sales:invoice', 'sales:return',
    'purchase:read', 'purchase:create', 'purchase:confirm', 'purchase:receive', 'purchase:pay', 'purchase:cancel',
    'customers:read', 'customers:create', 'customers:update',
    'hr:read',
    'finance:read', 'finance:journal',
    'reports:read',
    'pos:session', 'pos:sale', 'pos:void',
    'import:run',
  ],
  cashier: [
    'products:read',
    'inventory:read',
    'sales:read', 'sales:create',
    'customers:read', 'customers:create',
    'pos:session', 'pos:sale',
    'reports:read',
  ],
  employee: [
    'products:read',
    'inventory:read',
    'sales:read',
    'purchase:read',
    'customers:read',
    'reports:read',
  ],
};

export function hasPermission(role: string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role as Role];
  if (!perms) return false;
  return perms.includes('admin:all') || perms.includes(permission);
}

export function requirePermission(permission: Permission) {
  return async (c: AppContext, next: AppNext) => {
    const user = c.get('user');
    if (!user) throw new AppError('Authentication required', 401);
    if (!hasPermission(user.role, permission)) {
      throw new AppError(`Permission denied: ${permission}`, 403);
    }
    await next();
  };
}
