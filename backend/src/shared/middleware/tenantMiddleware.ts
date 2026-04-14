import { db } from '../../infrastructure/database/client';
import { AppError } from '../errors/AppError';
import type { AppContext, AppNext } from '../context';

/**
 * Hono tenant middleware — resolves tenant from X-Tenant-ID header and
 * populates c.get('tenantId') + c.get('tenantSlug').
 */
export async function tenantMiddleware(c: AppContext, next: AppNext) {
  const tenantId = c.req.header('x-tenant-id');

  if (!tenantId) {
    throw new AppError('X-Tenant-ID header is required', 400);
  }

  const tenant = await db.tenant.findUnique({
    where:  { id: tenantId, is_active: true },
    select: { id: true, slug: true },
  });

  if (!tenant) {
    throw new AppError('Tenant not found', 404);
  }

  c.set('tenantId',   tenant.id);
  c.set('tenantSlug', tenant.slug);
  await next();
}
