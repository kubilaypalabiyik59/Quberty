import { Hono }    from 'hono';
import { routeGuard, type RouteGuards } from '../../shared/middleware/permissions';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { ok, created } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

/** Variant dimensions (size, colour) are product master data (WORK-030b). */
export const VARIANT_TYPE_ROUTE_PERMISSIONS = Object.freeze({
  'GET /': ['product.read'],
  'POST /': ['product.maintain'],
  'PUT /:id': ['product.maintain'],
  'DELETE /:id': ['product.maintain'],
} satisfies RouteGuards);

const guard = routeGuard(VARIANT_TYPE_ROUTE_PERMISSIONS);

app.get('/', guard('GET /'), async (c) => {
  const types = await db.variantType.findMany({ where: { tenant_id: c.get('tenantId') }, orderBy: { name: 'asc' } });
  return ok(c, types);
});

app.post('/', guard('POST /'), async (c) => {
  const { name, values } = await c.req.json();
  if (!name) throw new AppError('name is required');
  const type = await db.variantType.create({ data: { name, values: values ?? [], tenant_id: c.get('tenantId') } });
  return created(c, type);
});

app.put('/:id', guard('PUT /:id'), async (c) => {
  const { name, values } = await c.req.json();
  await db.variantType.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data:  { name, values, updated_at: new Date() },
  });
  return ok(c, null);
});

app.delete('/:id', guard('DELETE /:id'), async (c) => {
  await db.variantType.deleteMany({ where: { id: c.req.param('id'), tenant_id: c.get('tenantId') } });
  return ok(c, null);
});

export default app;
