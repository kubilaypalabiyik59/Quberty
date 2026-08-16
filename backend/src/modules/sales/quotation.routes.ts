import { Hono } from 'hono';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { validate } from '../../shared/middleware/validate';
import { ok, created, paginated } from '../../shared/response';
import { CreateQuotationSchema, UpdateQuotationLinesSchema } from '../../shared/schemas';
import type { AppEnv } from '../../shared/context';
import {
  createQuotation,
  updateQuotationLines,
  sendQuotation,
  reviseQuotation,
  confirmQuotation,
  closeQuotation,
  expireOverdueQuotations,
} from './quotation.service';

/** Sales quotations — mounted at /api/v1/sales/quotations. */
const app = new Hono<AppEnv>();

app.get('/', async (c) => {
  const { status, customer_id, lead_id, opportunity_id, page = '1', limit = '20' } = c.req.query();

  // Expiry is observed on read rather than by a scheduler — see the note on
  // expireOverdueQuotations. Cheap, and it keeps the list honest.
  await expireOverdueQuotations(c.get('tenantId'));

  const where: any = { tenant_id: c.get('tenantId') };
  if (status) where.status = status;
  if (customer_id) where.customer_id = customer_id;
  if (lead_id) where.lead_id = lead_id;
  if (opportunity_id) where.opportunity_id = opportunity_id;

  const [quotations, total] = await Promise.all([
    db.salesQuotation.findMany({
      where,
      include: {
        customer: { select: { id: true, code: true, first_name: true, last_name: true } },
        lead: { select: { id: true, lead_number: true, company_name: true, first_name: true } },
        opportunity: { select: { id: true, opportunity_number: true, name: true } },
        converted_order: { select: { id: true, order_number: true, status: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { created_at: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    db.salesQuotation.count({ where }),
  ]);
  return paginated(c, quotations, total, Number(page), Number(limit));
});

app.post('/', validate(CreateQuotationSchema), async (c) => {
  const q = await createQuotation(c.get('tenantId'), c.get('body') as any, c.get('user').id);
  return created(c, q);
});

app.get('/:id', async (c) => {
  const q = await db.salesQuotation.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: {
      customer: true,
      lead: true,
      opportunity: { select: { id: true, opportunity_number: true, name: true, status: true } },
      site: { select: { id: true, code: true, name: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      converted_order: { select: { id: true, order_number: true, status: true, total_amount: true } },
      revised_from: { select: { id: true, quotation_number: true, revision: true } },
      revisions: { select: { id: true, quotation_number: true, revision: true, status: true } },
      lines: {
        orderBy: { sort_order: 'asc' },
        include: { product: { select: { id: true, sku: true, name: true, images: true } } },
      },
    },
  });
  if (!q) throw new AppError('Quotation not found', 404);
  return ok(c, q);
});

app.put('/:id/lines', requireRole('admin', 'store_manager'), validate(UpdateQuotationLinesSchema), async (c) => {
  const body = c.get('body') as any;
  const q = await updateQuotationLines(
    c.get('tenantId'),
    c.req.param('id'),
    body.lines,
    body.discount_amount,
  );
  return ok(c, q);
});

app.post('/:id/send', requireRole('admin', 'store_manager'), async (c) => {
  return ok(c, await sendQuotation(c.get('tenantId'), c.req.param('id')));
});

app.post('/:id/revise', requireRole('admin', 'store_manager'), async (c) => {
  return created(c, await reviseQuotation(c.get('tenantId'), c.req.param('id'), c.get('user').id));
});

/** The join to Order to Cash: creates the sales order. */
app.post('/:id/confirm', requireRole('admin', 'store_manager'), async (c) => {
  const result = await confirmQuotation(c.get('tenantId'), c.req.param('id'), c.get('user').id);
  return created(c, result);
});

app.post('/:id/lose', requireRole('admin', 'store_manager'), async (c) => {
  const { reason } = await c.req.json().catch(() => ({ reason: undefined }));
  return ok(c, await closeQuotation(c.get('tenantId'), c.req.param('id'), 'LOST', reason));
});

app.post('/:id/cancel', requireRole('admin', 'store_manager'), async (c) => {
  const { reason } = await c.req.json().catch(() => ({ reason: undefined }));
  return ok(c, await closeQuotation(c.get('tenantId'), c.req.param('id'), 'CANCELLED', reason));
});

export default app;
