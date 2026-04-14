import { Hono }    from 'hono';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { ok, created } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

app.get('/', async (c) => {
  const types = await db.variantType.findMany({ where: { tenant_id: c.get('tenantId') }, orderBy: { name: 'asc' } });
  return ok(c, types);
});

app.post('/', requireRole('admin', 'store_manager'), async (c) => {
  const { name, values } = await c.req.json();
  if (!name) throw new AppError('name is required');
  const type = await db.variantType.create({ data: { name, values: values ?? [], tenant_id: c.get('tenantId') } });
  return created(c, type);
});

app.put('/:id', requireRole('admin', 'store_manager'), async (c) => {
  const { name, values } = await c.req.json();
  await db.variantType.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data:  { name, values, updated_at: new Date() },
  });
  return ok(c, null);
});

app.delete('/:id', requireRole('admin', 'store_manager'), async (c) => {
  await db.variantType.deleteMany({ where: { id: c.req.param('id'), tenant_id: c.get('tenantId') } });
  return ok(c, null);
});

export default app;
