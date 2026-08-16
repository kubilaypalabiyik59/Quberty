import { Hono } from 'hono';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { validate } from '../../shared/middleware/validate';
import { ok, created, paginated } from '../../shared/response';
import {
  CreateRequisitionSchema,
  RequisitionDecisionSchema,
  RequisitionToPoSchema,
  CreateRfqCaseSchema,
  InviteVendorsSchema,
  RecordBidSchema,
  AwardRfqSchema,
} from '../../shared/schemas';
import type { AppEnv } from '../../shared/context';
import {
  createRequisition,
  submitRequisition,
  decideRequisition,
  cancelRequisitionLines,
  createPurchaseOrderFromRequisition,
} from './requisition.service';
import {
  createRfqCase,
  createRfqCaseFromRequisition,
  inviteVendors,
  sendRfq,
  recordReply,
  declineReply,
  rejectReply,
  compareReplies,
  awardRfq,
  cancelRfqCase,
  getRfqCase,
} from './rfq.service';

/**
 * Source to Pay upstream — mounted at /api/v1/procurement.
 *
 * Deliberately NOT nested inside the existing /purchase routes. Those own the
 * purchase ORDER and everything after it (receipt, payment). Requisition and RFQ
 * come before it and have a different audience: a requisition is raised by a
 * store, an RFQ is run by a buyer, and neither is a vendor-facing order.
 */
const app = new Hono<AppEnv>();

/* ═════════════════════════════ REQUISITIONS ═══════════════════════════════ */

app.get('/requisitions', async (c) => {
  const { status, warehouse_id, page = '1', limit = '20' } = c.req.query();
  const where: any = { tenant_id: c.get('tenantId') };
  if (status) where.status = status;
  if (warehouse_id) where.warehouse_id = warehouse_id;

  const [requisitions, total] = await Promise.all([
    db.purchaseRequisition.findMany({
      where,
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        site: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true, rfq_cases: true } },
      },
      orderBy: { created_at: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    db.purchaseRequisition.count({ where }),
  ]);
  return paginated(c, requisitions, total, Number(page), Number(limit));
});

app.post('/requisitions', validate(CreateRequisitionSchema), async (c) => {
  const req = await createRequisition(c.get('tenantId'), c.get('body') as any, c.get('user').id);
  return created(c, req);
});

app.get('/requisitions/:id', async (c) => {
  const req = await db.purchaseRequisition.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: {
      warehouse: { select: { id: true, code: true, name: true } },
      site: { select: { id: true, code: true, name: true } },
      lines: {
        orderBy: { sort_order: 'asc' },
        include: {
          product: { select: { id: true, sku: true, name: true } },
          preferred_supplier: { select: { id: true, code: true, name: true } },
        },
      },
      rfq_cases: { select: { id: true, rfq_number: true, title: true, status: true } },
    },
  });
  if (!req) throw new AppError('Requisition not found', 404);

  // The purchase orders this requisition produced. Read through the provenance
  // pair rather than a stored list, so the link cannot drift.
  //
  // There are TWO routes from a requisition to an order and both have to be
  // followed, or the requisition appears to have produced nothing:
  //
  //   direct  requisition → PO           source_document_type = REQUISITION
  //   sourced requisition → RFQ → PO     source_document_type = RFQ
  //
  // The second is the interesting one, and it is the one a naive query misses:
  // the awarded order points at the RFQ CASE, not at the requisition behind it.
  const rfqIds = req.rfq_cases.map((r) => r.id);
  const orders = await db.purchaseOrder.findMany({
    where: {
      tenant_id: c.get('tenantId'),
      OR: [
        { source_document_type: 'REQUISITION', source_document_id: req.id },
        ...(rfqIds.length ? [{ source_document_type: 'RFQ', source_document_id: { in: rfqIds } }] : []),
      ],
    },
    select: {
      id: true, po_number: true, status: true, total_amount: true,
      source_document_type: true, source_document_id: true,
      supplier: { select: { name: true } },
    },
    orderBy: { created_at: 'desc' },
  });

  return ok(c, { ...req, purchase_orders: orders });
});

app.post('/requisitions/:id/submit', async (c) => {
  return ok(c, await submitRequisition(c.get('tenantId'), c.req.param('id'), c.get('user').id));
});

app.post(
  '/requisitions/:id/approve',
  requireRole('admin', 'store_manager'),
  validate(RequisitionDecisionSchema),
  async (c) => {
    const body = c.get('body') as any;
    return ok(
      c,
      await decideRequisition(c.get('tenantId'), c.req.param('id'), 'APPROVED', c.get('user').id, body),
    );
  },
);

app.post(
  '/requisitions/:id/reject',
  requireRole('admin', 'store_manager'),
  validate(RequisitionDecisionSchema),
  async (c) => {
    const body = c.get('body') as any;
    return ok(
      c,
      await decideRequisition(c.get('tenantId'), c.req.param('id'), 'REJECTED', c.get('user').id, body),
    );
  },
);

app.post('/requisitions/:id/cancel', async (c) => {
  const { line_ids } = await c.req.json().catch(() => ({ line_ids: undefined }));
  return ok(c, await cancelRequisitionLines(c.get('tenantId'), c.req.param('id'), line_ids));
});

/** Approved requisition → purchase order. */
app.post(
  '/requisitions/:id/purchase-order',
  requireRole('admin', 'store_manager'),
  validate(RequisitionToPoSchema),
  async (c) => {
    const result = await createPurchaseOrderFromRequisition(
      c.get('tenantId'),
      c.req.param('id'),
      c.get('body') as any,
      c.get('user').id,
    );
    return created(c, result);
  },
);

/** Requisition → RFQ case, for when the price needs testing before ordering. */
app.post('/requisitions/:id/rfq', requireRole('admin', 'store_manager'), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rfq = await createRfqCaseFromRequisition(
    c.get('tenantId'),
    c.req.param('id'),
    body,
    c.get('user').id,
  );
  return created(c, rfq);
});

/* ════════════════════════════════ RFQ ═════════════════════════════════════ */

app.get('/rfq', async (c) => {
  const { status, page = '1', limit = '20' } = c.req.query();
  const where: any = { tenant_id: c.get('tenantId') };
  if (status) where.status = status;

  const [cases, total] = await Promise.all([
    db.rfqCase.findMany({
      where,
      include: {
        requisition: { select: { id: true, requisition_number: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        requests: { select: { id: true, status: true, total_amount: true, supplier: { select: { name: true } } } },
        _count: { select: { lines: true, requests: true } },
      },
      orderBy: { created_at: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    db.rfqCase.count({ where }),
  ]);
  return paginated(c, cases, total, Number(page), Number(limit));
});

app.post('/rfq', requireRole('admin', 'store_manager'), validate(CreateRfqCaseSchema), async (c) => {
  const rfq = await createRfqCase(c.get('tenantId'), c.get('body') as any, c.get('user').id);
  return created(c, rfq);
});

app.get('/rfq/:id', async (c) => {
  return ok(c, await getRfqCase(c.get('tenantId'), c.req.param('id')));
});

/** The comparison matrix — one row per demand line, one cell per vendor. */
app.get('/rfq/:id/compare', async (c) => {
  return ok(c, await compareReplies(c.get('tenantId'), c.req.param('id')));
});

app.post('/rfq/:id/vendors', requireRole('admin', 'store_manager'), validate(InviteVendorsSchema), async (c) => {
  const { supplier_ids } = c.get('body') as any;
  return ok(c, await inviteVendors(c.get('tenantId'), c.req.param('id'), supplier_ids));
});

app.post('/rfq/:id/send', requireRole('admin', 'store_manager'), async (c) => {
  return ok(c, await sendRfq(c.get('tenantId'), c.req.param('id')));
});

app.post('/rfq/:id/award', requireRole('admin', 'store_manager'), validate(AwardRfqSchema), async (c) => {
  const body = c.get('body') as any;
  const result = await awardRfq(
    c.get('tenantId'),
    c.req.param('id'),
    body.request_id,
    body,
    c.get('user').id,
  );
  return created(c, result);
});

app.post('/rfq/:id/cancel', requireRole('admin', 'store_manager'), async (c) => {
  const { reason } = await c.req.json().catch(() => ({ reason: undefined }));
  return ok(c, await cancelRfqCase(c.get('tenantId'), c.req.param('id'), reason));
});

/* ── individual bids ──────────────────────────────────────────────────────── */

app.post('/rfq/bids/:requestId', requireRole('admin', 'store_manager'), validate(RecordBidSchema), async (c) => {
  const bid = await recordReply(c.get('tenantId'), c.req.param('requestId'), c.get('body') as any);
  return ok(c, bid);
});

app.post('/rfq/bids/:requestId/decline', requireRole('admin', 'store_manager'), async (c) => {
  const { reason } = await c.req.json().catch(() => ({ reason: undefined }));
  return ok(c, await declineReply(c.get('tenantId'), c.req.param('requestId'), reason));
});

app.post('/rfq/bids/:requestId/reject', requireRole('admin', 'store_manager'), async (c) => {
  const { reason } = await c.req.json().catch(() => ({ reason: undefined }));
  return ok(c, await rejectReply(c.get('tenantId'), c.req.param('requestId'), reason));
});

export default app;
