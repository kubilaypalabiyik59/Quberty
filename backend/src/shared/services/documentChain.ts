/**
 * The vocabulary of the document chain, in one place.
 *
 * Two end-to-end processes now start before the order:
 *
 *   Prospect to Quote (85)  Lead → Opportunity → Quotation → Sales Order
 *   Source to Pay (75)      Requisition → RFQ → Purchase Order
 *
 * Everything downstream of the order — shipment, factura, payment, receipt — is
 * unchanged and untouched.
 *
 * ── Why this file exists ───────────────────────────────────────────────────
 * `SalesOrder.source_document_type` and `PurchaseOrder.source_document_type` are
 * plain strings in the database. That is deliberate (a new upstream document is
 * a new value, not a migration), but a plain string with no single definition is
 * how the same concept ends up spelled three ways across three modules — which
 * is precisely how the two rival charts of accounts came about (D-1). So the
 * values live here, are typed, and nothing else may invent one.
 */

/* ────────────────────────── provenance vocabulary ────────────────────────── */

/** What a sales order can have come from. */
export const SALES_SOURCE_DOCUMENT = {
  /** Raised directly — a counter sale, a storefront order, an import. */
  DIRECT: 'DIRECT',
  QUOTATION: 'QUOTATION',
  OPPORTUNITY: 'OPPORTUNITY',
  /** Hooks: neither exists yet, and neither needs anything beyond this value. */
  SALES_AGREEMENT: 'SALES_AGREEMENT',
  SUBSCRIPTION: 'SUBSCRIPTION',
} as const;
export type SalesSourceDocument = (typeof SALES_SOURCE_DOCUMENT)[keyof typeof SALES_SOURCE_DOCUMENT];

/** What a purchase order can have come from. */
export const PURCHASE_SOURCE_DOCUMENT = {
  DIRECT: 'DIRECT',
  REQUISITION: 'REQUISITION',
  RFQ: 'RFQ',
  PURCHASE_AGREEMENT: 'PURCHASE_AGREEMENT',
  PLANNED_ORDER: 'PLANNED_ORDER',
} as const;
export type PurchaseSourceDocument =
  (typeof PURCHASE_SOURCE_DOCUMENT)[keyof typeof PURCHASE_SOURCE_DOCUMENT];

/* ──────────────────────────── document statuses ──────────────────────────── */

/**
 * **[OFFICIAL]** the three lead states, and only these three.
 * learn.microsoft.com/dynamics365/sales/developer/lead-entity
 */
export const LEAD_STATUS = {
  OPEN: 'OPEN',
  QUALIFIED: 'QUALIFIED',
  DISQUALIFIED: 'DISQUALIFIED',
} as const;
export type LeadStatus = (typeof LEAD_STATUS)[keyof typeof LEAD_STATUS];

export const OPPORTUNITY_STATUS = {
  OPEN: 'OPEN',
  WON: 'WON',
  LOST: 'LOST',
  CANCELLED: 'CANCELLED',
} as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUS)[keyof typeof OPPORTUNITY_STATUS];

/**
 * **[OFFICIAL]** the D365 Supply Chain sales quotation lifecycle.
 * learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/data-entities/add-efficiency-in-quote-to-cash-concept
 */
export const QUOTATION_STATUS = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  /** Superseded by a newer revision; kept for history, never edited again. */
  REVISED: 'REVISED',
  CONFIRMED: 'CONFIRMED',
  LOST: 'LOST',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type QuotationStatus = (typeof QUOTATION_STATUS)[keyof typeof QUOTATION_STATUS];

/** Statuses from which a quotation may still be edited or acted on. */
export const QUOTATION_OPEN_STATUSES: QuotationStatus[] = [
  QUOTATION_STATUS.DRAFT,
  QUOTATION_STATUS.SENT,
];

/**
 * **[OFFICIAL]** purchase requisition statuses, shared by header and line.
 * learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-requisitions-overview
 */
export const REQUISITION_STATUS = {
  DRAFT: 'DRAFT',
  IN_REVIEW: 'IN_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  /** Approved AND a downstream document has been generated for it. */
  CLOSED: 'CLOSED',
} as const;
export type RequisitionStatus = (typeof REQUISITION_STATUS)[keyof typeof REQUISITION_STATUS];

/** **[OFFICIAL]** the requisition purpose decides what an approved line produces. */
export const REQUISITION_PURPOSE = {
  /** Produces a purchase order. The only one implemented. */
  CONSUMPTION: 'CONSUMPTION',
  /** Produces one or more fulfilment documents — transfer order, and in a
   *  manufacturing tenant a production order. Not implemented; the value exists
   *  so those attach later without a migration. */
  REPLENISHMENT: 'REPLENISHMENT',
} as const;

export const RFQ_CASE_STATUS = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  AWARDED: 'AWARDED',
  CANCELLED: 'CANCELLED',
  CLOSED: 'CLOSED',
} as const;

/**
 * **[OFFICIAL]** RFQ reply statuses, *in rank order*:
 *
 *   "The statuses are ranked in the following way from lowest to highest:
 *    Created, Sent, Received, Rejected, Accepted, Declined, Canceled."
 *   — learn.microsoft.com/dynamics365/supply-chain/procurement/request-quotations
 *
 * The rank is the whole point. D365 shows an RFQ case's *lowest* and *highest*
 * status so a buyer can see at a glance whether anyone has replied yet and
 * whether anything has been awarded, across many vendors and many lines. We
 * compute those two aggregates on read rather than storing them — see
 * `RfqCase.status` in schema.prisma for why.
 */
export const RFQ_STATUS_RANK = [
  'CREATED',
  'SENT',
  'RECEIVED',
  'REJECTED',
  'ACCEPTED',
  'DECLINED',
  'CANCELLED',
] as const;
export type RfqStatus = (typeof RFQ_STATUS_RANK)[number];

export function rfqStatusRank(status: string): number {
  const i = RFQ_STATUS_RANK.indexOf(status as RfqStatus);
  // An unknown status ranks lowest rather than throwing: an aggregate display
  // must never be the thing that takes a page down.
  return i === -1 ? 0 : i;
}

/**
 * Lowest and highest status across a set of RFQ statuses, per the official
 * ranking. Returns nulls for an empty set — a case with no vendors invited yet
 * genuinely has no aggregate, and inventing 'CREATED' would claim otherwise.
 */
export function aggregateRfqStatus(statuses: string[]): {
  lowest: RfqStatus | null;
  highest: RfqStatus | null;
} {
  if (statuses.length === 0) return { lowest: null, highest: null };
  const ranked = statuses.map(rfqStatusRank);
  return {
    lowest: RFQ_STATUS_RANK[Math.min(...ranked)],
    highest: RFQ_STATUS_RANK[Math.max(...ranked)],
  };
}

/* ─────────────────────── requisition status aggregation ──────────────────── */

/**
 * Derive a requisition header status from its line statuses.
 *
 * **[OFFICIAL]** "The overall status of a purchase requisition depends on the
 * status of the purchase requisition lines. Therefore, you must complete the
 * review process for all purchase requisition lines before you can complete the
 * review process for the whole purchase requisition."
 *
 * The rules, in precedence order:
 *   - no lines at all           → DRAFT (nothing has been requested yet)
 *   - every line CANCELLED      → CANCELLED
 *   - every line REJECTED       → REJECTED
 *   - every line CLOSED/CANCELLED, at least one CLOSED → CLOSED
 *   - any line still IN_REVIEW  → IN_REVIEW  (review is not finished)
 *   - any line still DRAFT      → DRAFT
 *   - otherwise                 → APPROVED   (review finished, nothing pending)
 *
 * Lines that are CANCELLED are ignored when judging whether the rest is
 * finished, which is what allows "approve four of five, cancel the fifth".
 */
export function deriveRequisitionStatus(lineStatuses: string[]): RequisitionStatus {
  if (lineStatuses.length === 0) return REQUISITION_STATUS.DRAFT;

  const has = (s: string) => lineStatuses.includes(s);
  const all = (s: string) => lineStatuses.every((x) => x === s);

  if (all(REQUISITION_STATUS.CANCELLED)) return REQUISITION_STATUS.CANCELLED;
  if (all(REQUISITION_STATUS.REJECTED)) return REQUISITION_STATUS.REJECTED;

  const live = lineStatuses.filter((s) => s !== REQUISITION_STATUS.CANCELLED);

  if (live.length > 0 && live.every((s) => s === REQUISITION_STATUS.CLOSED)) {
    return REQUISITION_STATUS.CLOSED;
  }
  if (has(REQUISITION_STATUS.IN_REVIEW)) return REQUISITION_STATUS.IN_REVIEW;
  if (has(REQUISITION_STATUS.DRAFT)) return REQUISITION_STATUS.DRAFT;

  return REQUISITION_STATUS.APPROVED;
}
