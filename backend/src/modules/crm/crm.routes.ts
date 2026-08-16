import { Hono } from 'hono';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { validate } from '../../shared/middleware/validate';
import { ok, created, paginated } from '../../shared/response';
import { CreateLeadSchema, QualifyLeadSchema, CreateOpportunitySchema } from '../../shared/schemas';
import type { AppEnv } from '../../shared/context';
import {
  createLead,
  qualifyLead,
  disqualifyLead,
  reopenLead,
  convertLeadToCustomer,
  createOpportunity,
  moveOpportunityStage,
  closeOpportunity,
  pipelineSummary,
} from './crm.service';

/**
 * Prospect to Quote (85), first half — mounted at /api/v1/crm.
 *
 * Quotations live under /api/v1/sales/quotations instead, next to the orders
 * they become, because that is where the money starts.
 */
const app = new Hono<AppEnv>();

/* ────────────────────────────── pipeline stages ──────────────────────────── */

app.get('/stages', async (c) => {
  const stages = await db.salesPipelineStage.findMany({
    where: { tenant_id: c.get('tenantId') },
    orderBy: { sort_order: 'asc' },
  });
  return ok(c, stages);
});

app.post('/stages', requireRole('admin'), async (c) => {
  const { code, name, sort_order, default_probability } = await c.req.json();
  if (!code || !name) throw new AppError('code and name are required', 400);
  const stage = await db.salesPipelineStage.create({
    data: {
      tenant_id: c.get('tenantId'),
      code,
      name,
      sort_order: Number(sort_order ?? 0),
      default_probability: Number(default_probability ?? 50),
    },
  });
  return created(c, stage);
});

app.put('/stages/:id', requireRole('admin'), async (c) => {
  const body = await c.req.json();
  const { count } = await db.salesPipelineStage.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.sort_order !== undefined && { sort_order: Number(body.sort_order) }),
      ...(body.default_probability !== undefined && { default_probability: Number(body.default_probability) }),
      ...(body.is_active !== undefined && { is_active: Boolean(body.is_active) }),
    },
  });
  if (count === 0) throw new AppError('Pipeline stage not found', 404);
  return ok(c, null);
});

/* ───────────────────────────────── leads ────────────────────────────────── */

app.get('/leads', async (c) => {
  const { status, search, source, page = '1', limit = '20' } = c.req.query();
  const where: any = { tenant_id: c.get('tenantId') };
  if (status) where.status = status;
  if (source) where.source = source;
  if (search) {
    where.OR = [
      { company_name: { contains: search, mode: 'insensitive' } },
      { first_name: { contains: search, mode: 'insensitive' } },
      { last_name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { lead_number: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [leads, total] = await Promise.all([
    db.lead.findMany({
      where,
      include: {
        converted_customer: { select: { id: true, code: true, first_name: true, last_name: true } },
        _count: { select: { opportunities: true, originated: true, quotations: true } },
      },
      orderBy: { created_at: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    db.lead.count({ where }),
  ]);
  return paginated(c, leads, total, Number(page), Number(limit));
});

app.post('/leads', validate(CreateLeadSchema), async (c) => {
  const lead = await createLead(c.get('tenantId'), c.get('body') as any, c.get('user').id);
  return created(c, lead);
});

app.get('/leads/:id', async (c) => {
  const lead = await db.lead.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: {
      converted_customer: true,
      // `opportunities` are those still addressed TO the lead; `originated` are
      // those that came FROM it and are now addressed to a customer. After
      // qualification the second list is the interesting one.
      opportunities: { orderBy: { created_at: 'desc' } },
      originated: {
        orderBy: { created_at: 'desc' },
        include: {
          customer: { select: { id: true, code: true, first_name: true, last_name: true } },
          // Quotations raised after qualification hang off the OPPORTUNITY and are
          // addressed to the customer, so they are not in `lead.quotations`. Without
          // them here the lead page would show "quotation: not used" for a deal that
          // demonstrably produced one.
          quotations: {
            orderBy: { created_at: 'desc' },
            select: {
              id: true, quotation_number: true, status: true, total_amount: true,
              valid_until: true, converted_order_id: true,
            },
          },
        },
      },
      quotations: {
        orderBy: { created_at: 'desc' },
        select: { id: true, quotation_number: true, status: true, total_amount: true, valid_until: true },
      },
    },
  });
  if (!lead) throw new AppError('Lead not found', 404);
  return ok(c, lead);
});

app.put('/leads/:id', async (c) => {
  const body = await c.req.json();
  // Status transitions go through their own endpoints, which enforce the
  // official rules (a lead with an opportunity cannot be disqualified). Letting
  // a plain PUT set `status` would route around them.
  delete body.status;
  delete body.converted_customer_id;
  delete body.tenant_id;
  delete body.lead_number;

  const { count } = await db.lead.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data: { ...body, updated_at: new Date() },
  });
  if (count === 0) throw new AppError('Lead not found', 404);
  return ok(c, null);
});

app.post('/leads/:id/qualify', validate(QualifyLeadSchema), async (c) => {
  const result = await qualifyLead(
    c.get('tenantId'),
    c.req.param('id'),
    c.get('body') as any,
    c.get('user').id,
  );
  return ok(c, result);
});

app.post('/leads/:id/disqualify', async (c) => {
  const { reason } = await c.req.json().catch(() => ({ reason: undefined }));
  const lead = await disqualifyLead(c.get('tenantId'), c.req.param('id'), reason);
  return ok(c, lead);
});

app.post('/leads/:id/reopen', async (c) => {
  const lead = await reopenLead(c.get('tenantId'), c.req.param('id'));
  return ok(c, lead);
});

/** The explicit "Convert to customer" step, without qualifying. */
app.post('/leads/:id/convert-to-customer', async (c) => {
  const customer = await convertLeadToCustomer(c.get('tenantId'), c.req.param('id'));
  return ok(c, customer);
});

/* ────────────────────────────── opportunities ───────────────────────────── */

app.get('/opportunities', async (c) => {
  const { status, stage_id, customer_id, page = '1', limit = '20' } = c.req.query();
  const where: any = { tenant_id: c.get('tenantId') };
  if (status) where.status = status;
  if (stage_id) where.stage_id = stage_id;
  if (customer_id) where.customer_id = customer_id;

  const [opportunities, total] = await Promise.all([
    db.opportunity.findMany({
      where,
      include: {
        customer: { select: { id: true, code: true, first_name: true, last_name: true } },
        lead: { select: { id: true, lead_number: true, company_name: true } },
        stage: { select: { id: true, code: true, name: true, sort_order: true } },
        _count: { select: { quotations: true } },
      },
      orderBy: { created_at: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    db.opportunity.count({ where }),
  ]);
  return paginated(c, opportunities, total, Number(page), Number(limit));
});

/** The weighted pipeline. Registered before /:id so "pipeline" is not an id. */
app.get('/opportunities/pipeline', async (c) => {
  return ok(c, await pipelineSummary(c.get('tenantId')));
});

app.post('/opportunities', validate(CreateOpportunitySchema), async (c) => {
  const opp = await createOpportunity(c.get('tenantId'), c.get('body') as any, c.get('user').id);
  return created(c, opp);
});

app.get('/opportunities/:id', async (c) => {
  const opp = await db.opportunity.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: {
      customer: true,
      lead: true,
      stage: true,
      quotations: {
        orderBy: { created_at: 'desc' },
        include: { lines: { orderBy: { sort_order: 'asc' } } },
      },
    },
  });
  if (!opp) throw new AppError('Opportunity not found', 404);
  return ok(c, opp);
});

app.put('/opportunities/:id', async (c) => {
  const body = await c.req.json();
  delete body.status;
  delete body.tenant_id;
  delete body.opportunity_number;

  const { count } = await db.opportunity.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data: {
      ...body,
      ...(body.expected_close_date !== undefined && {
        expected_close_date: body.expected_close_date ? new Date(body.expected_close_date) : null,
      }),
      updated_at: new Date(),
    },
  });
  if (count === 0) throw new AppError('Opportunity not found', 404);
  return ok(c, null);
});

app.post('/opportunities/:id/stage', async (c) => {
  const { stage_id, probability } = await c.req.json();
  if (!stage_id) throw new AppError('stage_id is required', 400);
  const opp = await moveOpportunityStage(
    c.get('tenantId'),
    c.req.param('id'),
    stage_id,
    probability === undefined ? undefined : Number(probability),
  );
  return ok(c, opp);
});

app.post('/opportunities/:id/close', async (c) => {
  const { outcome, reason } = await c.req.json();
  if (!['WON', 'LOST', 'CANCELLED'].includes(outcome)) {
    throw new AppError('outcome must be WON, LOST or CANCELLED', 400);
  }
  const opp = await closeOpportunity(c.get('tenantId'), c.req.param('id'), outcome, reason);
  return ok(c, opp);
});

export default app;
