import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { logger } from '../../shared/logger';
import { allocateNumber } from '../../shared/services/numberSequence.service';
import { computePurchaseMoney } from '../../shared/services/documentTax.service';
import { nextPurchaseOrderNumber } from '../../shared/utils/orderCounter';
import {
  REQUISITION_STATUS,
  REQUISITION_PURPOSE,
  PURCHASE_SOURCE_DOCUMENT,
  deriveRequisitionStatus,
} from '../../shared/services/documentChain';

/**
 * Purchase requisitions — the INTERNAL request that comes before the purchase
 * order.
 *
 * **[OFFICIAL]** "A purchase requisition is an internal document that authorizes
 * the Purchasing department to buy items or services… After a purchase
 * requisition is approved, you can use it to generate a purchase order. Purchase
 * orders are the external documents that the Purchasing department submits to
 * vendors."
 * learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-requisitions-overview
 *
 * ── Line status is the load-bearing part ───────────────────────────────────
 * Microsoft's model gives a status to the header AND to every line, and derives
 * the header from the lines. That is not ceremony. "Approve four of the five
 * things the store asked for" is the ordinary case in a retail business, and a
 * header-only status cannot express it — which would force the requester to
 * raise a second requisition for the rejected item and lose the link between the
 * two.
 *
 * ── What is deliberately NOT built ─────────────────────────────────────────
 * There is no workflow engine. At ≤50 employees the approver is one person, and
 * a configurable multi-step routing engine would be the single heaviest thing in
 * this codebase for the least use. Approval is instead a PARAMETER: on or off,
 * with an optional value threshold. If a customer ever needs real routing, it
 * attaches to `submitted_at`/`approved_by` without touching these rows.
 *
 * Nothing here posts to the general ledger. A requisition is a request; the
 * first accounting event on the purchase side is still the product receipt.
 */

export interface RequisitionLineInput {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  estimated_unit_cost?: number;
  required_date?: string | null;
  preferred_supplier_id?: string | null;
  notes?: string | null;
}

export interface CreateRequisitionInput {
  site_id?: string | null;
  warehouse_id?: string | null;
  purpose?: string;
  required_date?: string | null;
  justification?: string | null;
  currency?: string;
  notes?: string | null;
  lines: RequisitionLineInput[];
}

function reqLineTotal(l: RequisitionLineInput): number {
  return Number((Number(l.quantity) * Number(l.estimated_unit_cost ?? 0)).toFixed(2));
}

export async function createRequisition(
  tenantId: string,
  input: CreateRequisitionInput,
  userId: string,
) {
  if (!input.lines?.length) throw new AppError('A requisition must have at least one line', 400);

  const purpose = input.purpose ?? REQUISITION_PURPOSE.CONSUMPTION;
  if (!Object.values(REQUISITION_PURPOSE).includes(purpose as any)) {
    throw new AppError(
      `Unknown requisition purpose "${purpose}". Expected CONSUMPTION or REPLENISHMENT.`,
      400,
    );
  }
  if (purpose === REQUISITION_PURPOSE.REPLENISHMENT) {
    // The enum value exists so transfer orders can attach later without a
    // migration; the behaviour behind it does not exist yet. Saying so beats
    // accepting the document and quietly producing a purchase order anyway.
    throw new AppError(
      'REPLENISHMENT requisitions are not implemented yet — they generate transfer orders, ' +
        'which this system does not have. Use CONSUMPTION.',
      400,
    );
  }

  const estimated_total = Number(input.lines.reduce((s, l) => s + reqLineTotal(l), 0).toFixed(2));
  const requisition_number = await allocateNumber({ tenantId, reference: 'PURCHASE_REQUISITION' });

  return db.purchaseRequisition.create({
    data: {
      tenant_id: tenantId,
      requisition_number,
      requester_user_id: userId,
      site_id: input.site_id ?? null,
      warehouse_id: input.warehouse_id ?? null,
      purpose,
      required_date: input.required_date ? new Date(input.required_date) : null,
      justification: input.justification ?? null,
      currency: input.currency ?? 'BOB',
      notes: input.notes ?? null,
      estimated_total,
      created_by: userId,
      lines: {
        create: input.lines.map((l, i) => ({
          product_id: l.product_id,
          variant_id: l.variant_id ?? null,
          quantity: l.quantity,
          estimated_unit_cost: l.estimated_unit_cost ?? 0,
          line_total: reqLineTotal(l),
          required_date: l.required_date ? new Date(l.required_date) : null,
          preferred_supplier_id: l.preferred_supplier_id ?? null,
          sort_order: i,
          notes: l.notes ?? null,
        })),
      },
    },
    include: { lines: true },
  });
}

/** Recompute and persist the header status from the lines. */
async function syncHeaderStatus(tx: Prisma.TransactionClient, requisitionId: string) {
  const lines = await tx.purchaseRequisitionLine.findMany({
    where: { requisition_id: requisitionId },
    select: { status: true },
  });
  const status = deriveRequisitionStatus(lines.map((l) => l.status));
  await tx.purchaseRequisition.update({
    where: { id: requisitionId },
    data: {
      status,
      ...(status === REQUISITION_STATUS.CLOSED ? { closed_at: new Date() } : {}),
    },
  });
  return status;
}

/**
 * Submit for review — or approve outright when the tenant has no approval step,
 * or when the value is below the threshold.
 *
 * **[OFFICIAL]** D365 supports exactly this: "The workflow process can also be
 * configured to skip the review tasks and automatically approve the purchase
 * requisition."
 */
export async function submitRequisition(tenantId: string, requisitionId: string, userId: string) {
  const req = await db.purchaseRequisition.findFirst({
    where: { id: requisitionId, tenant_id: tenantId },
    include: { lines: true },
  });
  if (!req) throw new AppError('Requisition not found', 404);
  if (req.status !== REQUISITION_STATUS.DRAFT) {
    throw new AppError(`Only a DRAFT requisition can be submitted; ${req.requisition_number} is ${req.status}.`, 409);
  }
  if (!req.lines.length) throw new AppError('Requisition has no lines', 400);

  const params = await db.purchaseParameters.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: null },
    select: { requisition_approval_enabled: true, requisition_approval_threshold: true },
  });

  const approvalOn = params?.requisition_approval_enabled ?? true;
  const threshold = params?.requisition_approval_threshold ?? null;
  const belowThreshold = threshold !== null && Number(req.estimated_total) <= Number(threshold);
  const autoApprove = !approvalOn || belowThreshold;

  const target = autoApprove ? REQUISITION_STATUS.APPROVED : REQUISITION_STATUS.IN_REVIEW;

  return db.$transaction(async (tx) => {
    await tx.purchaseRequisitionLine.updateMany({
      where: { requisition_id: req.id, status: REQUISITION_STATUS.DRAFT },
      data: { status: target },
    });
    await tx.purchaseRequisition.update({
      where: { id: req.id },
      data: {
        submitted_at: new Date(),
        ...(autoApprove ? { approved_at: new Date(), approved_by: userId } : {}),
      },
    });
    const status = await syncHeaderStatus(tx, req.id);

    logger.info(
      {
        tenantId,
        requisition: req.requisition_number,
        status,
        autoApprove,
        reason: !approvalOn ? 'approval disabled' : belowThreshold ? 'below threshold' : null,
      },
      'Requisition submitted',
    );

    return tx.purchaseRequisition.findUnique({
      where: { id: req.id },
      include: { lines: { orderBy: { sort_order: 'asc' } } },
    });
  });
}

/**
 * Approve or reject, whole document or specific lines.
 *
 * `line_ids` omitted means every line still in review.
 */
export async function decideRequisition(
  tenantId: string,
  requisitionId: string,
  decision: 'APPROVED' | 'REJECTED',
  userId: string,
  opts: { line_ids?: string[]; reason?: string } = {},
) {
  const req = await db.purchaseRequisition.findFirst({
    where: { id: requisitionId, tenant_id: tenantId },
    include: { lines: true },
  });
  if (!req) throw new AppError('Requisition not found', 404);

  const inReview = req.lines.filter((l) => l.status === REQUISITION_STATUS.IN_REVIEW);
  if (!inReview.length) {
    throw new AppError(
      `Requisition ${req.requisition_number} has no lines in review (header is ${req.status}).`,
      409,
    );
  }

  const targets = opts.line_ids?.length
    ? inReview.filter((l) => opts.line_ids!.includes(l.id))
    : inReview;

  if (!targets.length) {
    throw new AppError('None of the supplied line_ids are in review on this requisition.', 400);
  }

  return db.$transaction(async (tx) => {
    await tx.purchaseRequisitionLine.updateMany({
      where: { id: { in: targets.map((l) => l.id) } },
      data: { status: decision },
    });

    await tx.purchaseRequisition.update({
      where: { id: req.id },
      data:
        decision === REQUISITION_STATUS.APPROVED
          ? { approved_at: new Date(), approved_by: userId }
          : { rejected_at: new Date(), rejected_by: userId, rejection_reason: opts.reason ?? null },
    });

    const status = await syncHeaderStatus(tx, req.id);
    logger.info(
      { tenantId, requisition: req.requisition_number, decision, lines: targets.length, status },
      'Requisition decision recorded',
    );

    return tx.purchaseRequisition.findUnique({
      where: { id: req.id },
      include: { lines: { orderBy: { sort_order: 'asc' } } },
    });
  });
}

export async function cancelRequisitionLines(
  tenantId: string,
  requisitionId: string,
  lineIds?: string[],
) {
  const req = await db.purchaseRequisition.findFirst({
    where: { id: requisitionId, tenant_id: tenantId },
    include: { lines: true },
  });
  if (!req) throw new AppError('Requisition not found', 404);

  // **[OFFICIAL]** "Only purchase requisition lines that are approved can be
  // canceled" — a line still in review is RECALLED and deleted instead. We allow
  // cancelling DRAFT and APPROVED, and refuse CLOSED, because a closed line has
  // a purchase order behind it and cancelling here would leave the PO orphaned.
  const cancellable = req.lines.filter(
    (l) =>
      l.status !== REQUISITION_STATUS.CLOSED &&
      l.status !== REQUISITION_STATUS.CANCELLED &&
      (!lineIds?.length || lineIds.includes(l.id)),
  );
  const closed = req.lines.filter(
    (l) => l.status === REQUISITION_STATUS.CLOSED && lineIds?.includes(l.id),
  );
  if (closed.length) {
    throw new AppError(
      `${closed.length} line(s) already have a purchase order and cannot be cancelled here. ` +
        `Cancel the purchase order instead.`,
      409,
    );
  }
  if (!cancellable.length) throw new AppError('No cancellable lines', 400);

  return db.$transaction(async (tx) => {
    await tx.purchaseRequisitionLine.updateMany({
      where: { id: { in: cancellable.map((l) => l.id) } },
      data: { status: REQUISITION_STATUS.CANCELLED },
    });
    await syncHeaderStatus(tx, req.id);
    return tx.purchaseRequisition.findUnique({
      where: { id: req.id },
      include: { lines: { orderBy: { sort_order: 'asc' } } },
    });
  });
}

/**
 * Generate a purchase order from approved requisition lines.
 *
 * **[OFFICIAL]** for a CONSUMPTION requisition, "a purchase order is generated
 * for the purchase requisition line", and the line then becomes *Closed*.
 *
 * A purchase order carries exactly one supplier, so this takes one. Lines with a
 * different `preferred_supplier_id` are not silently reassigned — the caller
 * either names the lines or accepts the ones that match. Guessing which vendor a
 * requester meant is precisely the sort of quiet decision that produced the
 * account-selection defects in this codebase.
 */
export async function createPurchaseOrderFromRequisition(
  tenantId: string,
  requisitionId: string,
  input: { supplier_id: string; warehouse_id?: string; line_ids?: string[]; expected_date?: string },
  userId: string,
) {
  const req = await db.purchaseRequisition.findFirst({
    where: { id: requisitionId, tenant_id: tenantId },
    include: { lines: { orderBy: { sort_order: 'asc' } } },
  });
  if (!req) throw new AppError('Requisition not found', 404);

  const supplier = await db.supplier.findFirst({
    where: { id: input.supplier_id, tenant_id: tenantId },
    select: { id: true, name: true, currency: true },
  });
  if (!supplier) throw new AppError('Supplier not found', 404);

  const approved = req.lines.filter((l) => l.status === REQUISITION_STATUS.APPROVED);
  if (!approved.length) {
    throw new AppError(
      `Requisition ${req.requisition_number} has no APPROVED lines. ` +
        `Its status is ${req.status}; approve it before ordering.`,
      409,
    );
  }

  const selected = input.line_ids?.length
    ? approved.filter((l) => input.line_ids!.includes(l.id))
    : approved;
  if (!selected.length) throw new AppError('None of the supplied line_ids are approved lines.', 400);

  const warehouseId = input.warehouse_id ?? req.warehouse_id;
  if (!warehouseId) {
    throw new AppError(
      'A purchase order needs a warehouse. The requisition has none — pass warehouse_id.',
      400,
    );
  }

  // The estimated costs are what we expect the supplier to invoice, i.e. gross.
  // `computePurchaseMoney` splits that into AP, recoverable tax and the amount
  // that capitalises — the same helper the direct purchase path uses.
  const agreed = Number(
    selected.reduce((s, l) => s + Number(l.quantity) * Number(l.estimated_unit_cost), 0).toFixed(2),
  );
  const money = await computePurchaseMoney(tenantId, agreed, { partyId: supplier.id });

  const po_number = await nextPurchaseOrderNumber(tenantId);

  return db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.create({
      data: {
        tenant_id: tenantId,
        po_number,
        supplier_id: supplier.id,
        warehouse_id: warehouseId,
        expected_date: input.expected_date
          ? new Date(input.expected_date)
          : req.required_date ?? null,
        currency: req.currency,
        subtotal: agreed,
        tax_amount: money.recoverable_tax,
        total_amount: money.total,
        notes: `From requisition ${req.requisition_number}`,
        created_by: userId,
        source_document_type: PURCHASE_SOURCE_DOCUMENT.REQUISITION,
        source_document_id: req.id,
        lines: {
          create: selected.map((l, i) => ({
            product_id: l.product_id,
            variant_id: l.variant_id,
            quantity: l.quantity,
            unit_cost: l.estimated_unit_cost,
            line_total: Number((Number(l.quantity) * Number(l.estimated_unit_cost)).toFixed(2)),
            sort_order: i,
            source_line_id: l.id,
          })),
        },
      },
      include: { lines: true },
    });

    // Closing the requisition lines is what stops the same demand being ordered
    // twice. It is per line, not per document, because half a requisition may
    // still be waiting on a different vendor.
    await tx.purchaseRequisitionLine.updateMany({
      where: { id: { in: selected.map((l) => l.id) } },
      data: {
        status: REQUISITION_STATUS.CLOSED,
        fulfilled_by_type: 'PURCHASE_ORDER',
      },
    });
    // `fulfilled_by_line_id` is set per row, so it cannot go in the updateMany.
    for (const l of selected) {
      const poLine = po.lines.find((p) => p.source_line_id === l.id);
      if (poLine) {
        await tx.purchaseRequisitionLine.update({
          where: { id: l.id },
          data: { fulfilled_by_line_id: poLine.id },
        });
      }
    }

    const status = await syncHeaderStatus(tx, req.id);
    logger.info(
      {
        tenantId,
        requisition: req.requisition_number,
        po: po.po_number,
        lines: selected.length,
        requisitionStatus: status,
      },
      'Purchase order generated from requisition',
    );

    return { purchase_order: po, requisition_status: status };
  });
}
