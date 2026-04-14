import { Hono }    from 'hono';
import { db }       from '../../infrastructure/database/client';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { ok, created, paginated } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

app.get('/', async (c) => {
  const { search, segment, page = '1', limit = '20' } = c.req.query();
  const where: any = { tenant_id: c.get('tenantId') };
  if (segment) where.segment = segment;
  if (search) {
    where.OR = [
      { first_name: { contains: search, mode: 'insensitive' } },
      { last_name:  { contains: search, mode: 'insensitive' } },
      { email:      { contains: search, mode: 'insensitive' } },
    ];
  }
  const [customers, total] = await Promise.all([
    db.customer.findMany({ where, orderBy: { last_name: 'asc' }, skip: (Number(page) - 1) * Number(limit), take: Number(limit) }),
    db.customer.count({ where }),
  ]);
  return paginated(c, customers, total, Number(page), Number(limit));
});

app.post('/', async (c) => {
  const body  = await c.req.json();
  const count = await db.customer.count({ where: { tenant_id: c.get('tenantId') } });
  const customer = await db.customer.create({
    data: { ...body, tenant_id: c.get('tenantId'), code: body.code ?? `CUST-${String(count + 1).padStart(5, '0')}` },
  });
  return created(c, customer);
});

app.get('/segments', requireRole('admin', 'store_manager'), async (c) => {
  const segments = await db.customer.groupBy({
    by:    ['segment'],
    where: { tenant_id: c.get('tenantId') },
    _count: { id: true },
    _sum:   { lifetime_value: true },
  });
  return ok(c, segments);
});

app.get('/:id', async (c) => {
  const customer = await db.customer.findFirst({ where: { id: c.req.param('id'), tenant_id: c.get('tenantId') } });
  return ok(c, customer);
});

app.put('/:id', async (c) => {
  const body = await c.req.json();
  await db.customer.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data:  { ...body, updated_at: new Date() },
  });
  return ok(c, null);
});

app.get('/:id/orders', async (c) => {
  const orders = await db.salesOrder.findMany({
    where:   { customer_id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: { lines: { include: { product: { select: { name: true } } } } },
    orderBy: { created_at: 'desc' },
  });
  return ok(c, orders);
});

export default app;
