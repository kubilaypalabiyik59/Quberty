import { AppError } from '../errors/AppError';
import { isKnownRole } from './permissions';
import type { AppContext, AppNext } from '../context';

/**
 * The line between the storefront and the back office (WORK-030a, design D-2).
 *
 * Microsoft keeps e-commerce customers on a separate identity and API surface from
 * back-office users (Commerce B2C tenants and identity record linking), and a user
 * with no role holds no privileges (role-based security). This gate is that line
 * in one place: a `customer`, or any role the registry does not know, reaches only
 * the routes below. Every other v1 route answers 403 before its own guard, its
 * validation or the database — so a route that forgets its guard is still closed
 * to shoppers.
 *
 * Paths are exact after the `/api/v1` prefix; `:uuid` matches a UUID only, so
 * `/products/categories` is its own entry and cannot be reached as an id.
 */
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

export const STOREFRONT_SURFACE = Object.freeze([
  'GET /products',
  'GET /products/categories',
  'GET /products/:uuid',
  'POST /sales/orders/storefront',
  'GET /tenant/currency',
] as const);

const SURFACE_PATTERNS = STOREFRONT_SURFACE.map((entry) => {
  const [method, path] = entry.split(' ');
  const pattern = path.replace(':uuid', UUID);
  return { method, regex: new RegExp(`^/api/v1${pattern}/?$`) };
});

export function isStorefrontSurface(method: string, path: string): boolean {
  return SURFACE_PATTERNS.some((s) => s.method === method.toUpperCase() && s.regex.test(path));
}

export async function workforceGate(c: AppContext, next: AppNext) {
  const role = c.get('user')?.role;
  const workforce = isKnownRole(role) && role !== 'customer';
  if (!workforce && !isStorefrontSurface(c.req.method, c.req.path)) {
    throw new AppError('This area is not available to storefront accounts', 403);
  }
  await next();
}
