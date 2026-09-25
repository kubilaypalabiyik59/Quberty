import { Hono }    from 'hono';
import type { z }   from 'zod';
import type { Prisma } from '@prisma/client';
import { db }       from '../../infrastructure/database/client';
import { validate } from '../../shared/middleware/validate';
import { AppError } from '../../shared/errors/AppError';
import { CreateCustomerSchema, UpdateCustomerSchema } from '../../shared/schemas';
import { assertTenantReferences } from '../../shared/services/tenantReference.service';
import { nextCustomerCode } from '../../shared/services/customerCode.service';
import { ok, created, paginated } from '../../shared/response';
import { routeGuard, type RouteGuards } from '../../shared/middleware/permissions';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

/**
 * The permission each route requires (WORK-030a). Exported so a test can pin the
 * map and prove every route in this file has exactly one entry; the guard is the
 * first middleware, so a denial happens before validation and before the database.
 */
export const CUSTOMER_ROUTE_PERMISSIONS = Object.freeze({
  'GET /': ['customer.read'],
  'POST /': ['customer.create'],
  'GET /segments': ['report.sales.read'],
  'GET /:id': ['customer.read'],
  'PUT /:id': ['customer.update'],
  'GET /:id/orders': ['customer.read', 'sales.order.read'],
  'GET /:id/statement': ['customer.read', 'sales.order.read'],
} satisfies RouteGuards);

/**
 * What a customer owes, derived from their sales orders.
 *
 * There is no customer subledger yet — the AR counterpart of
 * VendorOpenTransaction — so a receivable is read off the order: invoiced (it
 * has a factura that is not cancelled), not paid, not returned or cancelled.
 * Payments are whole-order today (`paid_at`). When partial payments and an AR
 * subledger arrive (WORK-048/049), this is the one function to re-point.
 */
type StatementOrder = {
  id: string; status: string; total_amount: unknown; invoice_id: string | null;
  paid_at: Date | null; returned_at: Date | null;
};
function receivableOf(o: StatementOrder, cancelledFacturas: Set<string>) {
  const invoiced = !!o.invoice_id && !cancelledFacturas.has(o.invoice_id);
  const live = o.status !== 'CANCELLED' && o.status !== 'RETURNED' && !o.returned_at;
  return { invoiced, open: invoiced && live && !o.paid_at };
}

const guard = routeGuard(CUSTOMER_ROUTE_PERMISSIONS);


const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

app.get('/', guard('GET /'), async (c) => {
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
  if (search) {
    where.OR.push({ code: { contains: search, mode: 'insensitive' } }, { tax_id: { contains: search, mode: 'insensitive' } });
  }
  const [customers, total] = await Promise.all([
    db.customer.findMany({ where, orderBy: { last_name: 'asc' }, skip: (Number(page) - 1) * Number(limit), take: Number(limit) }),
    db.customer.count({ where }),
  ]);

  // Open balance and last order for the customers on this page only.
  const ids = customers.map((cu) => cu.id);
  const orders = ids.length
    ? await db.salesOrder.findMany({
        where: { tenant_id: c.get('tenantId'), customer_id: { in: ids }, status: { not: 'DRAFT' } },
        select: { id: true, customer_id: true, status: true, total_amount: true, invoice_id: true, paid_at: true, returned_at: true, created_at: true },
      })
    : [];
  const cancelled = await cancelledFacturaIds(c.get('tenantId'), orders.map((o) => o.invoice_id));
  const byCustomer = new Map<string, { open_balance: number; last_order_at: Date | null }>();
  for (const o of orders) {
    const agg = byCustomer.get(o.customer_id!) ?? { open_balance: 0, last_order_at: null };
    if (receivableOf(o, cancelled).open) agg.open_balance += Number(o.total_amount);
    if (!agg.last_order_at || o.created_at > agg.last_order_at) agg.last_order_at = o.created_at;
    byCustomer.set(o.customer_id!, agg);
  }
  const rows = customers.map((cu) => ({
    ...cu,
    open_balance: Math.round((byCustomer.get(cu.id)?.open_balance ?? 0) * 100) / 100,
    last_order_at: byCustomer.get(cu.id)?.last_order_at ?? null,
  }));
  return paginated(c, rows, total, Number(page), Number(limit));
});

// Only the allow-listed fields are written. `tenant_id`, `id`, `user_id`,
// `lifetime_value` and `total_orders` used to be writable through `...body`.
app.post('/', guard('POST /'), validate(CreateCustomerSchema), async (c) => {
  const tenantId = c.get('tenantId');
  const body  = c.get('body') as z.infer<typeof CreateCustomerSchema>;
  await assertTenantReferences(tenantId, { taxGroupId: body.tax_group_id ?? null });
  // The schema requires first_name/last_name; the cast only bridges zod's
  // inference with strictNullChecks off.
  const data = {
    ...body,
    date_of_birth: toDate(body.date_of_birth),
    tenant_id: tenantId,
    code: body.code ?? await nextCustomerCode(tenantId, db),
  } as Prisma.CustomerUncheckedCreateInput;
  const customer = await db.customer.create({ data });
  return created(c, customer);
});

app.get('/segments', guard('GET /segments'), async (c) => {
  const segments = await db.customer.groupBy({
    by:    ['segment'],
    where: { tenant_id: c.get('tenantId') },
    _count: { id: true },
    _sum:   { lifetime_value: true },
  });
  return ok(c, segments);
});

app.get('/:id', guard('GET /:id'), async (c) => {
  const customer = await db.customer.findFirst({ where: { id: c.req.param('id'), tenant_id: c.get('tenantId') } });
  return ok(c, customer);
});

app.put('/:id', guard('PUT /:id'), validate(UpdateCustomerSchema), async (c) => {
  const tenantId = c.get('tenantId');
  const body = c.get('body') as z.infer<typeof UpdateCustomerSchema>;
  await assertTenantReferences(tenantId, { taxGroupId: body.tax_group_id ?? null });
  await db.customer.updateMany({
    where: { id: c.req.param('id'), tenant_id: tenantId },
    data:  { ...body, date_of_birth: toDate(body.date_of_birth), updated_at: new Date() },
  });
  return ok(c, null);
});

app.get('/:id/orders', guard('GET /:id/orders'), async (c) => {
  const orders = await db.salesOrder.findMany({
    where:   { customer_id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: { lines: { include: { product: { select: { name: true } } } } },
    orderBy: { created_at: 'desc' },
  });
  return ok(c, orders);
});

/**
 * The customer's statement: every non-draft order with its factura and payment
 * state, and the totals — ordered, invoiced, paid, open.
 */
app.get('/:id/statement', guard('GET /:id/statement'), async (c) => {
  const tenantId = c.get('tenantId');
  const customer = await db.customer.findFirst({ where: { id: c.req.param('id'), tenant_id: tenantId }, select: { id: true } });
  if (!customer) throw new AppError('Customer not found', 404);
  const orders = await db.salesOrder.findMany({
    where: { tenant_id: tenantId, customer_id: customer.id, status: { not: 'DRAFT' } },
    select: {
      id: true, order_number: true, source: true, status: true, currency: true, total_amount: true,
      invoice_id: true, paid_at: true, returned_at: true, created_at: true, shipped_at: true,
    },
    orderBy: { created_at: 'desc' },
    take: 500,
  });
  const facturaIds = orders.map((o) => o.invoice_id).filter((x): x is string => !!x);
  const facturas = facturaIds.length
    ? await db.factura.findMany({ where: { tenant_id: tenantId, id: { in: facturaIds } }, select: { id: true, factura_number: true, status: true } })
    : [];
  const facturaById = new Map(facturas.map((f) => [f.id, f]));
  const cancelled = new Set(facturas.filter((f) => f.status === 'CANCELLED').map((f) => f.id));

  const totals = { ordered: 0, invoiced: 0, paid: 0, open: 0 };
  const lines = orders.map((o) => {
    const r = receivableOf(o, cancelled);
    const amount = Number(o.total_amount);
    if (o.status !== 'CANCELLED') totals.ordered += amount;
    if (r.invoiced) totals.invoiced += amount;
    if (o.paid_at) totals.paid += amount;
    if (r.open) totals.open += amount;
    const f = o.invoice_id ? facturaById.get(o.invoice_id) : undefined;
    return {
      ...o,
      factura_number: f?.factura_number ?? null,
      factura_status: f?.status ?? null,
      payment_status: o.paid_at ? 'PAID' : r.open ? 'OPEN' : r.invoiced ? 'CLOSED' : 'NOT_INVOICED',
    };
  });
  const round = (n: number) => Math.round(n * 100) / 100;
  return ok(c, {
    orders: lines,
    totals: { ordered: round(totals.ordered), invoiced: round(totals.invoiced), paid: round(totals.paid), open: round(totals.open) },
  });
});

async function cancelledFacturaIds(tenantId: string, ids: Array<string | null>): Promise<Set<string>> {
  const wanted = ids.filter((x): x is string => !!x);
  if (wanted.length === 0) return new Set();
  const rows = await db.factura.findMany({
    where: { tenant_id: tenantId, id: { in: wanted }, status: 'CANCELLED' },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

export default app;
