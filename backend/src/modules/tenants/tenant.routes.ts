import { Hono }    from 'hono';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { ok, created } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

app.post('/', async (c) => {
  const { name, slug, plan = 'starter', language = 'en', timezone = 'UTC' } = await c.req.json();
  if (!name || !slug) throw new AppError('name and slug are required');

  const existing = await db.tenant.findUnique({ where: { slug } });
  if (existing) throw new AppError('Slug already taken', 409);

  const tenant = await db.tenant.create({
    data: { name, slug, plan, language, timezone,
      modules: { sales: true, purchase: true, inventory: true, warehouse: true, hr: true, reporting: true, import: true } },
  });
  return created(c, tenant);
});

app.get('/:id/config', async (c) => {
  const tenant = await db.tenant.findUnique({
    where:  { id: c.req.param('id') },
    select: { id: true, name: true, slug: true, plan: true, modules: true, branding: true, language: true, timezone: true },
  });
  if (!tenant) throw new AppError('Tenant not found', 404);
  return ok(c, tenant);
});

app.put('/:id/config', async (c) => {
  const body = await c.req.json();
  const tenant = await db.tenant.update({
    where: { id: c.req.param('id') },
    data:  { modules: body.modules, branding: body.branding, language: body.language, timezone: body.timezone },
  });
  return ok(c, tenant);
});

app.put('/:id/setup', async (c) => {
  const tenantId = c.req.param('id');
  const { currency_code, tax_config } = await c.req.json();

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new AppError('Tenant not found', 404);

  const updated = await db.tenant.update({
    where: { id: tenantId },
    data: {
      ...(currency_code ? { currency_code } : {}),
      ...(tax_config    ? { tax_config }    : {}),
    },
  });

  return ok(c, updated);
});

export default app;
