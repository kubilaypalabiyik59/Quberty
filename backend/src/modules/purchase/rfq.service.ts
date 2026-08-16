import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { logger } from '../../shared/logger';
import { allocateNumber } from '../../shared/services/numberSequence.service';
import { computeDocumentTax } from '../../shared/services/documentTax.service';
import { nextPurchaseOrderNumber } from '../../shared/utils/orderCounter';
import {
  RFQ_CASE_STATUS,
  REQUISITION_STATUS,
  PURCHASE_SOURCE_DOCUMENT,
  aggregateRfqStatus,
  deriveRequisitionStatus,
} from '../../shared/services/documentChain';

/**
 * Requests for quotation — the sourcing step between "we need this" and "we are
 * buying it from them".
 *
 * ── The two-level shape, and why it is not over-engineering ────────────────
 * **[OFFICIAL]** D365 splits an RFQ into a *case* (the demand and its lines) and
 * one *RFQ per invited vendor* (that vendor's bid, with a reply line for each
 * case line).
 * learn.microsoft.com/dynamics365/supply-chain/procurement/request-quotations
 *
 * A single flat table cannot do the one job an RFQ exists for. Comparing three
 * vendors on price and lead time requires every vendor to have answered the SAME
 * demand line — so the demand line has to be a row that each vendor's reply
 * points at. Collapse the two levels and "compare replies" degenerates into
 * matching on product id and hoping the quantities agree.
 *
 * ── Awarding is per line, across vendors ───────────────────────────────────
 * **[OFFICIAL]** "You can accept some lines in a bid and reject others. You can
 * also accept lines from different vendors."
 *
 * Since a purchase order carries exactly one supplier, awarding lines from two
 * vendors produces TWO purchase orders from one case. That is why provenance is
 * recorded on the purchase order LINE as well as the header — see
 * `PurchaseOrderLine.source_line_id`.
 *
 * Nothing here posts to the general ledger.
 */

/* ─────────────────────────────── the case ────────────────────────────────── */

export interface RfqCaseLineInput {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  required_date?: string | null;
  notes?: string | null;
}

export interface CreateRfqCaseInput {
  title: string;
  warehouse_id?: string | null;
  bid_deadline?: string | null;
  currency?: string;
  notes?: string | null;
  lines: RfqCaseLineInput[];
}

async function responseDays(tenantId: string): Promise<number> {
  const p = await db.purchaseParameters.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: null },
    select: { rfq_response_days: true },
  });
  return p?.rfq_response_days ?? 7;
}

export async function createRfqCase(tenantId: string, input: CreateRfqCaseInput, userId: string) {
  if (!input.lines?.length) throw new AppError('An RFQ needs at least one line', 400);

  const rfq_number = await allocateNumber({ tenantId, reference: 'RFQ' });
  const deadline = input.bid_deadline
    ? new Date(input.bid_deadline)
    : new Date(Date.now() + (await responseDays(tenantId)) * 86_400_000);

  return db.rfqCase.create({
    data: {
      tenant_id: tenantId,
      rfq_number,
      title: input.title,
      purchase_type: 'PURCHASE_ORDER',
      warehouse_id: input.warehouse_id ?? null,
      bid_deadline: deadline,
      currency: input.currency ?? 'BOB',
      notes: input.notes ?? null,
      created_by: userId,
      lines: {
        create: input.lines.map((l, i) => ({
          product_id: l.product_id,
          variant_id: l.variant_id ?? null,
          quantity: l.quantity,
          required_date: l.required_date ? new Date(l.required_date) : null,
          sort_order: i,
          notes: l.notes ?? null,
        })),
      },
    },
    include: { lines: true },
  });
}

/**
 * Build an RFQ case from an existing requisition.
 *
 * **[OFFICIAL]** "If the RFQ case is generated from a purchase requisition, the
 * *Purchase requisition* type is automatically assigned. You can't manually
 * create an RFQ case of the *Purchase requisition* type." — hence the type is
 * set here and is not an argument.
 *
 * D365 requires the requisition to be *In review* for this. We accept IN_REVIEW
 * and APPROVED: for a business with one approver, sourcing a price before
 * approving the spend is the normal order of events, and forbidding it would
 * force the approver to sign off on a number nobody has checked.
 */
export async function createRfqCaseFromRequisition(
  tenantId: string,
  requisitionId: string,
  input: { title?: string; line_ids?: string[]; bid_deadline?: string; warehouse_id?: string },
  userId: string,
) {
  const req = await db.purchaseRequisition.findFirst({
    where: { id: requisitionId, tenant_id: tenantId },
    include: { lines: { orderBy: { sort_order: 'asc' } } },
  });
  if (!req) throw new AppError('Requisition not found', 404);

  const eligible = req.lines.filter(
    (l) =>
      (l.status === REQUISITION_STATUS.IN_REVIEW || l.status === REQUISITION_STATUS.APPROVED) &&
      (!input.line_ids?.length || input.line_ids.includes(l.id)),
  );
  if (!eligible.length) {
    throw new AppError(
      `Requisition ${req.requisition_number} has no lines in review or approved to source. ` +
        `Its status is ${req.status}.`,
      409,
    );
  }

  const rfq_number = await allocateNumber({ tenantId, reference: 'RFQ' });
  const deadline = input.bid_deadline
    ? new Date(input.bid_deadline)
    : new Date(Date.now() + (await responseDays(tenantId)) * 86_400_000);

  return db.rfqCase.create({
    data: {
      tenant_id: tenantId,
      rfq_number,
      title: input.title ?? `Sourcing for ${req.requisition_number}`,
      purchase_type: 'PURCHASE_REQUISITION',
      requisition_id: req.id,
      warehouse_id: input.warehouse_id ?? req.warehouse_id,
      bid_deadline: deadline,
      currency: req.currency,
      created_by: userId,
      lines: {
        create: eligible.map((l, i) => ({
          product_id: l.product_id,
          variant_id: l.variant_id,
          quantity: l.quantity,
          required_date: l.required_date,
          requisition_line_id: l.id,
          sort_order: i,
          notes: l.notes,
        })),
      },
    },
    include: { lines: true, requisition: { select: { requisition_number: true } } },
  });
}

/* ────────────────────────────── invitations ──────────────────────────────── */

/**
 * Invite vendors. Each invitation clones the case lines into reply lines so the
 * vendor has something to price, line for line.
 *
 * Re-inviting an existing vendor is a no-op rather than an error: the unique
 * constraint is (tenant, case, supplier) precisely so a case cannot accumulate
 * rival bids from the same vendor.
 */
export async function inviteVendors(tenantId: string, caseId: string, supplierIds: string[]) {
  const rfq = await db.rfqCase.findFirst({
    where: { id: caseId, tenant_id: tenantId },
    include: { lines: { orderBy: { sort_order: 'asc' } }, requests: { select: { supplier_id: true } } },
  });
  if (!rfq) throw new AppError('RFQ case not found', 404);
  if (rfq.status === RFQ_CASE_STATUS.CANCELLED || rfq.status === RFQ_CASE_STATUS.CLOSED) {
    throw new AppError(`RFQ ${rfq.rfq_number} is ${rfq.status}.`, 409);
  }
  if (!rfq.lines.length) throw new AppError('RFQ case has no lines to bid on', 400);

  const already = new Set(rfq.requests.map((r) => r.supplier_id));
  const toInvite = supplierIds.filter((id) => !already.has(id));

  const suppliers = await db.supplier.findMany({
    where: { id: { in: toInvite }, tenant_id: tenantId },
    select: { id: true, name: true, currency: true },
  });
  const missing = toInvite.filter((id) => !suppliers.some((s) => s.id === id));
  if (missing.length) throw new AppError(`Supplier(s) not found: ${missing.join(', ')}`, 404);

  await db.$transaction(async (tx) => {
    for (const s of suppliers) {
      await tx.rfqRequest.create({
        data: {
          tenant_id: tenantId,
          case_id: rfq.id,
          supplier_id: s.id,
          currency: rfq.currency,
          // A vendor invited after the case was already sent starts at CREATED,
          // which is exactly why D365 shows a LOWEST status: it drops back to
          // Created and tells the buyer somebody has not been asked yet.
          status: 'CREATED',
          lines: {
            create: rfq.lines.map((l) => ({
              case_line_id: l.id,
              product_id: l.product_id,
              variant_id: l.variant_id,
              quantity: l.quantity,
              sort_order: l.sort_order,
            })),
          },
        },
      });
    }
  });

  return getRfqCase(tenantId, rfq.id);
}

/** DRAFT → SENT, and every not-yet-sent invitation with it. */
export async function sendRfq(tenantId: string, caseId: string) {
  const rfq = await db.rfqCase.findFirst({
    where: { id: caseId, tenant_id: tenantId },
    include: { requests: true },
  });
  if (!rfq) throw new AppError('RFQ case not found', 404);
  if (!rfq.requests.length) {
    throw new AppError(`RFQ ${rfq.rfq_number} has no vendors invited yet.`, 400);
  }

  await db.$transaction(async (tx) => {
    const pending = rfq.requests.filter((r) => r.status === 'CREATED').map((r) => r.id);
    if (pending.length) {
      await tx.rfqRequest.updateMany({
        where: { id: { in: pending } },
        data: { status: 'SENT', sent_at: new Date() },
      });
      await tx.rfqRequestLine.updateMany({
        where: { request_id: { in: pending }, status: 'CREATED' },
        data: { status: 'SENT' },
      });
    }
    if (rfq.status === RFQ_CASE_STATUS.DRAFT) {
      await tx.rfqCase.update({
        where: { id: rfq.id },
        data: { status: RFQ_CASE_STATUS.SENT, sent_at: new Date() },
      });
    }
  });

  return getRfqCase(tenantId, caseId);
}

/* ──────────────────────────────── the bid ───────────────────────────────── */

export interface ReplyLineInput {
  /** Either the reply line id, or the case line it answers. */
  line_id?: string;
  case_line_id?: string;
  unit_price: number;
  quantity?: number;
  delivery_date?: string | null;
  lead_time_days?: number | null;
}

/**
 * Register a vendor's bid.
 *
 * **[OFFICIAL]** "The reply (bid) has to be submitted in order to be registered
 * as received, and only then it can be further processed as accepted or
 * rejected." So recording a reply moves the request to RECEIVED, and awarding
 * refuses anything that is not.
 *
 * Re-submitting overwrites the previous figures, which is D365's behaviour too
 * ("If you need to update the bid, you should go through the same process").
 */
export async function recordReply(
  tenantId: string,
  requestId: string,
  input: { lines: ReplyLineInput[]; score?: number; notes?: string; lead_time_days?: number },
) {
  const request = await db.rfqRequest.findFirst({
    where: { id: requestId, tenant_id: tenantId },
    include: { lines: true, rfq_case: { select: { id: true, rfq_number: true, status: true } } },
  });
  if (!request) throw new AppError('RFQ reply not found', 404);
  if (['ACCEPTED', 'REJECTED', 'CANCELLED'].includes(request.status)) {
    throw new AppError(
      `This bid is already ${request.status} and cannot be re-submitted.`,
      409,
    );
  }
  if (!input.lines?.length) throw new AppError('A bid needs at least one priced line', 400);

  const byId = new Map(request.lines.map((l) => [l.id, l]));
  const byCaseLine = new Map(request.lines.map((l) => [l.case_line_id, l]));

  const updates = input.lines.map((l) => {
    const target = l.line_id ? byId.get(l.line_id) : l.case_line_id ? byCaseLine.get(l.case_line_id) : undefined;
    if (!target) {
      throw new AppError(
        `Bid line does not belong to this request (line_id=${l.line_id ?? '—'}, case_line_id=${l.case_line_id ?? '—'}).`,
        400,
      );
    }
    const qty = l.quantity ?? Number(target.quantity);
    return {
      id: target.id,
      quantity: qty,
      unit_price: l.unit_price,
      line_total: Number((qty * Number(l.unit_price)).toFixed(2)),
      delivery_date: l.delivery_date ? new Date(l.delivery_date) : null,
      lead_time_days: l.lead_time_days ?? null,
    };
  });

  if (input.score !== undefined && (input.score < 0 || input.score > 100)) {
    throw new AppError('Bid score must be between 0 and 100.', 400);
  }

  return db.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.rfqRequestLine.update({
        where: { id: u.id },
        data: {
          quantity: u.quantity,
          unit_price: u.unit_price,
          line_total: u.line_total,
          delivery_date: u.delivery_date,
          lead_time_days: u.lead_time_days,
          status: 'RECEIVED',
        },
      });
    }

    const total = await tx.rfqRequestLine.aggregate({
      where: { request_id: request.id },
      _sum: { line_total: true },
    });

    return tx.rfqRequest.update({
      where: { id: request.id },
      data: {
        status: 'RECEIVED',
        received_at: new Date(),
        total_amount: total._sum.line_total ?? 0,
        score: input.score ?? request.score,
        lead_time_days: input.lead_time_days ?? request.lead_time_days,
        notes: input.notes ?? request.notes,
      },
      include: { lines: { orderBy: { sort_order: 'asc' } }, supplier: { select: { code: true, name: true } } },
    });
  });
}

/** A vendor who declines to bid. Distinct from us rejecting them. */
export async function declineReply(tenantId: string, requestId: string, reason?: string) {
  const request = await db.rfqRequest.findFirst({ where: { id: requestId, tenant_id: tenantId } });
  if (!request) throw new AppError('RFQ reply not found', 404);

  return db.rfqRequest.update({
    where: { id: request.id },
    data: { status: 'DECLINED', decided_at: new Date(), reason_code: reason ?? null },
  });
}

export async function rejectReply(tenantId: string, requestId: string, reason?: string) {
  const request = await db.rfqRequest.findFirst({ where: { id: requestId, tenant_id: tenantId } });
  if (!request) throw new AppError('RFQ reply not found', 404);
  if (request.status === 'ACCEPTED') {
    throw new AppError('This bid was accepted and cannot be rejected.', 409);
  }

  return db.$transaction(async (tx) => {
    await tx.rfqRequestLine.updateMany({
      where: { request_id: request.id, status: { notIn: ['ACCEPTED'] } },
      data: { status: 'REJECTED' },
    });
    return tx.rfqRequest.update({
      where: { id: request.id },
      data: { status: 'REJECTED', decided_at: new Date(), reason_code: reason ?? null },
    });
  });
}

/* ──────────────────────────── compare and award ──────────────────────────── */

/**
 * The comparison matrix: one row per case line, one cell per vendor.
 *
 * `best` marks the cheapest received bid per line. It is a hint, not a decision
 * — lead time and score are shown next to it because the cheapest bid is
 * routinely not the one a buyer takes.
 */
export async function compareReplies(tenantId: string, caseId: string) {
  const rfq = await db.rfqCase.findFirst({
    where: { id: caseId, tenant_id: tenantId },
    include: {
      lines: {
        orderBy: { sort_order: 'asc' },
        include: { product: { select: { sku: true, name: true } } },
      },
      requests: {
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          lines: true,
        },
      },
    },
  });
  if (!rfq) throw new AppError('RFQ case not found', 404);

  const vendors = rfq.requests.map((r) => ({
    request_id: r.id,
    supplier_id: r.supplier_id,
    supplier_code: r.supplier.code,
    supplier_name: r.supplier.name,
    status: r.status,
    score: r.score,
    lead_time_days: r.lead_time_days,
    total_amount: Number(r.total_amount),
  }));

  const lines = rfq.lines.map((cl) => {
    const bids = rfq.requests.map((r) => {
      const rl = r.lines.find((x) => x.case_line_id === cl.id);
      return {
        request_id: r.id,
        supplier_id: r.supplier_id,
        supplier_name: r.supplier.name,
        line_id: rl?.id ?? null,
        status: rl?.status ?? null,
        unit_price: rl ? Number(rl.unit_price) : null,
        line_total: rl ? Number(rl.line_total) : null,
        delivery_date: rl?.delivery_date ?? null,
        lead_time_days: rl?.lead_time_days ?? null,
      };
    });

    // "Cheapest" is computed over every bid that was actually SUBMITTED, which
    // includes the ones later rejected. Filtering to RECEIVED only looks right
    // until the moment of award: awarding flips the losers to REJECTED, and the
    // cheapest marker would then silently jump onto the winner — rewriting the
    // comparison that justified the decision. The matrix has to stay readable as
    // a record of why a vendor was chosen, especially when the winner was NOT
    // the cheapest.
    const priced = bids.filter(
      (b) => ['RECEIVED', 'ACCEPTED', 'REJECTED'].includes(b.status ?? '') && (b.unit_price ?? 0) > 0,
    );
    const cheapest = priced.length
      ? priced.reduce((a, b) => ((b.unit_price ?? 0) < (a.unit_price ?? 0) ? b : a))
      : null;

    return {
      case_line_id: cl.id,
      product_id: cl.product_id,
      sku: cl.product.sku,
      name: cl.product.name,
      quantity: Number(cl.quantity),
      required_date: cl.required_date,
      best_request_id: cheapest?.request_id ?? null,
      bids,
    };
  });

  const agg = aggregateRfqStatus(rfq.requests.map((r) => r.status));

  return {
    rfq_number: rfq.rfq_number,
    title: rfq.title,
    status: rfq.status,
    purchase_type: rfq.purchase_type,
    lowest_status: agg.lowest,
    highest_status: agg.highest,
    bid_deadline: rfq.bid_deadline,
    vendors,
    lines,
  };
}

/**
 * Award a bid and generate the purchase order.
 *
 * **[OFFICIAL]** "When you accept a bid or one or more lines in a bid, a
 * purchase order or a purchase agreement is automatically generated. You can
 * then reject the bids from all the other vendors."
 *
 * And when the case came from a requisition: "the purchase requisition lines
 * will be updated with… Unit price… Vendor" — so the winning price is written
 * back onto the requisition, which is what makes the requester's estimate and
 * the real market price comparable after the fact.
 */
export async function awardRfq(
  tenantId: string,
  caseId: string,
  requestId: string,
  input: { line_ids?: string[]; reason_code?: string; reject_others?: boolean; expected_date?: string },
  userId: string,
) {
  const rfq = await db.rfqCase.findFirst({
    where: { id: caseId, tenant_id: tenantId },
    include: {
      lines: true,
      requisition: { select: { id: true, requisition_number: true, currency: true } },
    },
  });
  if (!rfq) throw new AppError('RFQ case not found', 404);
  if (rfq.status === RFQ_CASE_STATUS.CANCELLED) throw new AppError(`RFQ ${rfq.rfq_number} is cancelled.`, 409);

  const request = await db.rfqRequest.findFirst({
    where: { id: requestId, tenant_id: tenantId, case_id: rfq.id },
    include: { lines: { orderBy: { sort_order: 'asc' } }, supplier: true },
  });
  if (!request) throw new AppError('That bid does not belong to this RFQ case', 404);
  if (request.status !== 'RECEIVED') {
    throw new AppError(
      `Only a RECEIVED bid can be awarded; this one is ${request.status}. Record the reply first.`,
      409,
    );
  }

  const candidates = request.lines.filter((l) => l.status === 'RECEIVED');
  const selected = input.line_ids?.length
    ? candidates.filter((l) => input.line_ids!.includes(l.id))
    : candidates;
  if (!selected.length) throw new AppError('No received bid lines to award.', 400);

  const unpriced = selected.filter((l) => Number(l.unit_price) <= 0);
  if (unpriced.length) {
    throw new AppError(
      `${unpriced.length} of the selected lines have no price. A purchase order cannot be raised from an unpriced bid.`,
      400,
    );
  }

  const warehouseId = rfq.warehouse_id;
  if (!warehouseId) {
    throw new AppError('This RFQ case has no warehouse; a purchase order needs one.', 400);
  }

  // Purchase-side arithmetic, unchanged: subtotal is NET and tax is added on top.
  const subtotal = Number(selected.reduce((s, l) => s + Number(l.line_total), 0).toFixed(2));
  const poTax = await computeDocumentTax(tenantId, subtotal, {
    partyId: request.supplier_id,
    side: 'PURCHASE',
  });
  const po_number = await nextPurchaseOrderNumber(tenantId);

  return db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.create({
      data: {
        tenant_id: tenantId,
        po_number,
        supplier_id: request.supplier_id,
        warehouse_id: warehouseId,
        expected_date: input.expected_date ? new Date(input.expected_date) : null,
        currency: request.currency,
        subtotal,
        tax_amount: poTax.vat,
        total_amount: Number((subtotal + poTax.vat).toFixed(2)),
        notes: `Awarded from RFQ ${rfq.rfq_number} — ${request.supplier.name}`,
        created_by: userId,
        source_document_type: PURCHASE_SOURCE_DOCUMENT.RFQ,
        source_document_id: rfq.id,
        lines: {
          create: selected.map((l, i) => ({
            product_id: l.product_id,
            variant_id: l.variant_id,
            quantity: l.quantity,
            unit_cost: l.unit_price,
            line_total: l.line_total,
            sort_order: i,
            // Points at the winning BID line, not the case line — that is the
            // record of what was actually agreed and with whom.
            source_line_id: l.id,
          })),
        },
      },
      include: { lines: true },
    });

    await tx.rfqRequestLine.updateMany({
      where: { id: { in: selected.map((l) => l.id) } },
      data: { status: 'ACCEPTED' },
    });

    // A partly-awarded bid keeps the unselected lines rejected rather than
    // dangling in RECEIVED, so the case cannot look like it is still open on
    // lines nobody will ever buy.
    const notSelected = candidates.filter((l) => !selected.some((s) => s.id === l.id));
    if (notSelected.length) {
      await tx.rfqRequestLine.updateMany({
        where: { id: { in: notSelected.map((l) => l.id) } },
        data: { status: 'REJECTED' },
      });
    }

    await tx.rfqRequest.update({
      where: { id: request.id },
      data: {
        status: 'ACCEPTED',
        decided_at: new Date(),
        reason_code: input.reason_code ?? null,
        generated_po_id: po.id,
      },
    });

    // **[OFFICIAL]** rejecting the losing bids is the prompted next step. Made
    // explicit rather than automatic: a buyer may want to keep a second vendor
    // open while the winner confirms stock.
    if (input.reject_others) {
      const others = await tx.rfqRequest.findMany({
        where: { case_id: rfq.id, id: { not: request.id }, status: { in: ['SENT', 'RECEIVED', 'CREATED'] } },
        select: { id: true },
      });
      if (others.length) {
        await tx.rfqRequest.updateMany({
          where: { id: { in: others.map((o) => o.id) } },
          data: { status: 'REJECTED', decided_at: new Date(), reason_code: 'Not selected' },
        });
        await tx.rfqRequestLine.updateMany({
          where: { request_id: { in: others.map((o) => o.id) }, status: { notIn: ['ACCEPTED'] } },
          data: { status: 'REJECTED' },
        });
      }
    }

    // Write the agreed price back onto the requisition, per the official
    // behaviour, and close the sourced lines.
    let requisitionStatus: string | null = null;
    if (rfq.requisition_id) {
      for (const l of selected) {
        const caseLine = rfq.lines.find((cl) => cl.id === l.case_line_id);
        if (!caseLine?.requisition_line_id) continue;
        const poLine = po.lines.find((p) => p.source_line_id === l.id);
        await tx.purchaseRequisitionLine.update({
          where: { id: caseLine.requisition_line_id },
          data: {
            estimated_unit_cost: l.unit_price,
            line_total: l.line_total,
            preferred_supplier_id: request.supplier_id,
            status: REQUISITION_STATUS.CLOSED,
            fulfilled_by_type: 'RFQ',
            fulfilled_by_line_id: poLine?.id ?? l.id,
          },
        });
      }
      const reqLines = await tx.purchaseRequisitionLine.findMany({
        where: { requisition_id: rfq.requisition_id },
        select: { status: true },
      });
      requisitionStatus = deriveRequisitionStatus(reqLines.map((x) => x.status));
      await tx.purchaseRequisition.update({
        where: { id: rfq.requisition_id },
        data: {
          status: requisitionStatus,
          ...(requisitionStatus === REQUISITION_STATUS.CLOSED ? { closed_at: new Date() } : {}),
        },
      });
    }

    // The case closes only when nothing is left open on it.
    const remaining = await tx.rfqRequest.count({
      where: { case_id: rfq.id, status: { in: ['CREATED', 'SENT', 'RECEIVED'] } },
    });
    await tx.rfqCase.update({
      where: { id: rfq.id },
      data: {
        status: remaining === 0 ? RFQ_CASE_STATUS.CLOSED : RFQ_CASE_STATUS.AWARDED,
        awarded_at: new Date(),
        ...(remaining === 0 ? { closed_at: new Date() } : {}),
      },
    });

    logger.info(
      {
        tenantId,
        rfq: rfq.rfq_number,
        supplier: request.supplier.code,
        po: po.po_number,
        lines: selected.length,
        requisition: rfq.requisition?.requisition_number ?? null,
        requisitionStatus,
      },
      'RFQ awarded and purchase order generated',
    );

    return { purchase_order: po, requisition_status: requisitionStatus };
  });
}

export async function cancelRfqCase(tenantId: string, caseId: string, reason?: string) {
  const rfq = await db.rfqCase.findFirst({ where: { id: caseId, tenant_id: tenantId } });
  if (!rfq) throw new AppError('RFQ case not found', 404);
  if (rfq.status === RFQ_CASE_STATUS.AWARDED || rfq.status === RFQ_CASE_STATUS.CLOSED) {
    throw new AppError(
      `RFQ ${rfq.rfq_number} is ${rfq.status} — a purchase order has already been raised from it.`,
      409,
    );
  }

  return db.$transaction(async (tx) => {
    await tx.rfqRequest.updateMany({
      where: { case_id: rfq.id, status: { notIn: ['ACCEPTED', 'REJECTED'] } },
      data: { status: 'CANCELLED', decided_at: new Date(), reason_code: reason ?? null },
    });
    return tx.rfqCase.update({
      where: { id: rfq.id },
      data: { status: RFQ_CASE_STATUS.CANCELLED, closed_at: new Date(), notes: reason ?? rfq.notes },
    });
  });
}

/** One case with its lines, its bids, and the two official aggregate statuses. */
export async function getRfqCase(tenantId: string, caseId: string) {
  const rfq = await db.rfqCase.findFirst({
    where: { id: caseId, tenant_id: tenantId },
    include: {
      lines: {
        orderBy: { sort_order: 'asc' },
        include: { product: { select: { sku: true, name: true } } },
      },
      requests: {
        include: {
          supplier: { select: { code: true, name: true } },
          lines: { orderBy: { sort_order: 'asc' } },
        },
      },
      requisition: { select: { id: true, requisition_number: true, status: true } },
      warehouse: { select: { code: true, name: true } },
    },
  });
  if (!rfq) throw new AppError('RFQ case not found', 404);

  const agg = aggregateRfqStatus(rfq.requests.map((r) => r.status));
  return { ...rfq, lowest_status: agg.lowest, highest_status: agg.highest };
}
