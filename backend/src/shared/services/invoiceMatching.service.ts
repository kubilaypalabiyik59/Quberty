import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';

/**
 * Invoice matching — policy resolution, tolerance resolution, and the verdicts.
 *
 * ── WHY THIS IS TWO-AXIS AND `postingProfile.service` IS NOT ────────────────
 * **[OFFICIAL]** the matching policy hierarchy is
 *
 *     Item and vendor  →  Item  →  Vendor  →  Legal entity
 *
 * and the price tolerance search order is spelled out as nine cells, item axis
 * crossed with vendor axis:
 *
 *     Table/Table · Table/Group · Table/All ·
 *     Group/Table · Group/Group · Group/All ·
 *     All/Table   · All/Group   · All/All
 *
 * learn.microsoft.com/dynamics365/finance/accounts-payable/tasks/set-up-accounts-payable-invoice-matching-validation
 *
 * The MOST SPECIFIC level is an intersection of both axes. `PostingProfile` is a
 * single axis with flat precedence (ITEM → ITEM_GROUP → PARTY → PARTY_GROUP →
 * ALL), which cannot express "this item from that vendor" at all — it would pick
 * the item rule and never look at the vendor. Copying that shape here would have
 * quietly dropped the official first level of the hierarchy.
 *
 * Widening `PostingProfile` to match was considered and rejected for now: a
 * three-store retailer does not yet need per-vendor inventory accounts, and the
 * fully general matrix is exactly the D365 reporting pain CLAUDE.md §3 warns
 * against importing wholesale. The asymmetry is deliberate and recorded in
 * docs/process/VENDOR_INVOICE.md §5.
 */

type Client = Prisma.TransactionClient | typeof db;

export type MatchPolicy = 'NONE' | 'TWO_WAY' | 'THREE_WAY';
export type MatchStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'NOT_APPLICABLE';

/** Least specific last. The order IS the official search order. */
const ITEM_AXIS = ['ITEM', 'ITEM_GROUP', 'ALL'] as const;
const PARTY_AXIS = ['PARTY', 'PARTY_GROUP', 'ALL'] as const;

type ItemScope = (typeof ITEM_AXIS)[number];
type PartyScope = (typeof PARTY_AXIS)[number];

export interface MatchContext {
  tenantId: string;
  legalEntityId?: string | null;
  itemId?: string | null;
  itemGroupId?: string | null;
  partyId?: string | null;
  partyGroupId?: string | null;
}

interface ScopedRow {
  item_scope: string;
  item_scope_id: string | null;
  party_scope: string;
  party_scope_id: string | null;
  legal_entity_id: string | null;
}

const idFor = (ctx: MatchContext, s: ItemScope | PartyScope): string | null | undefined => {
  switch (s) {
    case 'ITEM':        return ctx.itemId;
    case 'ITEM_GROUP':  return ctx.itemGroupId;
    case 'PARTY':       return ctx.partyId;
    case 'PARTY_GROUP': return ctx.partyGroupId;
    case 'ALL':         return null;
  }
};

/**
 * Walk the nine cells in the documented order and return the first row that
 * matches. Item axis is the outer loop, exactly as the official list reads:
 * Table/Table, Table/Group, Table/All, then Group/*, then All/*.
 */
function pickMostSpecific<T extends ScopedRow>(rows: T[], ctx: MatchContext): T | null {
  for (const itemScope of ITEM_AXIS) {
    const itemId = idFor(ctx, itemScope);
    if (itemScope !== 'ALL' && !itemId) continue;

    for (const partyScope of PARTY_AXIS) {
      const partyId = idFor(ctx, partyScope);
      if (partyScope !== 'ALL' && !partyId) continue;

      const hits = rows.filter(
        r =>
          r.item_scope === itemScope &&
          (itemScope === 'ALL' ? r.item_scope_id === null : r.item_scope_id === itemId) &&
          r.party_scope === partyScope &&
          (partyScope === 'ALL' ? r.party_scope_id === null : r.party_scope_id === partyId),
      );
      if (hits.length === 0) continue;

      // A legal-entity-specific row beats the tenant default at equal specificity,
      // the same tie-break posting profiles use.
      return hits.find(h => h.legal_entity_id !== null) ?? hits[0];
    }
  }
  return null;
}

const scopeWhere = (ctx: MatchContext) => ({
  tenant_id: ctx.tenantId,
  legal_entity_id: ctx.legalEntityId ? { in: [ctx.legalEntityId, null] } : null,
});

/**
 * The line matching policy for one invoice line.
 *
 * **[OFFICIAL]** the legal-entity default applies "to all items and vendors
 * except those for which a different line matching policy is specified", and may
 * be overridden per purchase order line — but only when the parameters page
 * allows it, which is why `lineOverride` is ignored unless
 * `allow_matching_policy_override` is on.
 */
export async function resolveMatchingPolicy(
  ctx: MatchContext,
  opts: { lineOverride?: string | null } = {},
  client: Client = db,
): Promise<{ policy: MatchPolicy; source: string }> {
  const params = await client.purchaseParameters.findFirst({
    where: { tenant_id: ctx.tenantId, legal_entity_id: ctx.legalEntityId ?? null },
    select: { line_matching_policy: true, allow_matching_policy_override: true },
  });
  const legalEntityDefault = (params?.line_matching_policy ?? 'NONE') as MatchPolicy;
  const overridable = params?.allow_matching_policy_override ?? true;

  if (opts.lineOverride && overridable) {
    return { policy: opts.lineOverride as MatchPolicy, source: 'purchase order line' };
  }

  if (!overridable) return { policy: legalEntityDefault, source: 'legal entity (override disabled)' };

  const rows = await client.matchingPolicy.findMany({
    where: scopeWhere(ctx),
    select: {
      item_scope: true, item_scope_id: true,
      party_scope: true, party_scope_id: true,
      legal_entity_id: true, policy: true,
    },
  });

  const hit = pickMostSpecific(rows, ctx);
  if (!hit) return { policy: legalEntityDefault, source: 'legal entity' };
  return {
    policy: hit.policy as MatchPolicy,
    source: `${hit.item_scope.toLowerCase()} / ${hit.party_scope.toLowerCase()}`,
  };
}

/**
 * The allowed unit-price variance, as a fraction (0.02 = 2%).
 *
 * **[OFFICIAL]** "The default legal entity price tolerance is 0 percent, and this
 * price tolerance is applied to all items and all accounts (All, All). You can't
 * delete the record for the default legal entity price tolerance." We hold that
 * default on `PurchaseParameters.price_tolerance_pct` rather than forcing an
 * All/All row to exist, so a tenant provisioned before this feature still
 * resolves — but the effect is identical and the row, when present, wins.
 */
export async function resolvePriceTolerance(
  ctx: MatchContext,
  client: Client = db,
): Promise<{ tolerance: number; source: string }> {
  const rows = await client.priceTolerance.findMany({
    where: scopeWhere(ctx),
    select: {
      item_scope: true, item_scope_id: true,
      party_scope: true, party_scope_id: true,
      legal_entity_id: true, tolerance_pct: true,
    },
  });

  const hit = pickMostSpecific(rows, ctx);
  if (hit) {
    return {
      tolerance: Number(hit.tolerance_pct),
      source: `${hit.item_scope.toLowerCase()} / ${hit.party_scope.toLowerCase()}`,
    };
  }

  const params = await client.purchaseParameters.findFirst({
    where: { tenant_id: ctx.tenantId, legal_entity_id: ctx.legalEntityId ?? null },
    select: { price_tolerance_pct: true },
  });
  return { tolerance: Number(params?.price_tolerance_pct ?? 0), source: 'legal entity default' };
}

/* ────────────────────────────── the verdicts ────────────────────────────── */

export interface LineMatchInput {
  /** **[OFFICIAL]** net amount = (unit price x qty) + line charges - line discounts. */
  invoiceNetAmount: number;
  invoiceQuantity: number;
  /** The order line's net unit price, or null when the line is not on an order. */
  orderNetUnitPrice: number | null;
  /** Sum of matched product receipt quantities for this invoice line. */
  matchedReceiptQty: number;
  policy: MatchPolicy;
  tolerancePct: number;
  /** Whether an undercharge is flagged too. **[OFFICIAL]** it is not, by default. */
  flagNegative: boolean;
}

export interface LineMatchResult {
  priceMatch: MatchStatus;
  receiptQtyMatch: MatchStatus;
  /** Signed: negative means the vendor charged LESS than the order. */
  variancePct: number | null;
  netUnitPrice: number | null;
  reasons: string[];
}

/**
 * **[OFFICIAL]** "Two-way matching and three-way matching always match price
 * information by the unit price", where net unit price = net amount / quantity.
 * Three-way adds: "the quantity on the invoice is matched to product receipt
 * quantities that have been received. If the invoice quantity differs from the
 * matched product receipt quantity, a quantity matching error exists."
 *
 * Pure on purpose — no database, so the arithmetic can be tested against the
 * official worked examples directly.
 */
export function evaluateLineMatch(input: LineMatchInput): LineMatchResult {
  const reasons: string[] = [];

  if (input.policy === 'NONE') {
    return {
      priceMatch: 'NOT_APPLICABLE',
      receiptQtyMatch: 'NOT_APPLICABLE',
      variancePct: null,
      netUnitPrice: null,
      reasons,
    };
  }

  const netUnitPrice =
    input.invoiceQuantity !== 0
      ? Number((input.invoiceNetAmount / input.invoiceQuantity).toFixed(4))
      : null;

  let priceMatch: MatchStatus = 'NOT_APPLICABLE';
  let variancePct: number | null = null;

  if (input.orderNetUnitPrice !== null && input.orderNetUnitPrice !== 0 && netUnitPrice !== null) {
    variancePct = Number(
      (((netUnitPrice - input.orderNetUnitPrice) / input.orderNetUnitPrice) * 100).toFixed(4),
    );
    const overTolerance = variancePct > input.tolerancePct * 100 + 1e-9;
    // **[OFFICIAL]** "By default, negative price discrepancies are allowed."
    const underTolerance = input.flagNegative && variancePct < -(input.tolerancePct * 100) - 1e-9;

    priceMatch = overTolerance || underTolerance ? 'FAILED' : 'PASSED';
    if (priceMatch === 'FAILED') {
      reasons.push(
        `unit price ${netUnitPrice} vs ordered ${input.orderNetUnitPrice} — ` +
          `${variancePct > 0 ? '+' : ''}${variancePct}% exceeds the ${(input.tolerancePct * 100).toFixed(2)}% tolerance`,
      );
    }
  } else if (input.orderNetUnitPrice === null) {
    // **[OFFICIAL]** a line that was not on the purchase order "is included only
    // in matching policies for invoice totals" — there is no price to match to.
    reasons.push('not on the purchase order — price matching does not apply to this line');
  }

  let receiptQtyMatch: MatchStatus = 'NOT_APPLICABLE';
  if (input.policy === 'THREE_WAY') {
    const diff = Number((input.invoiceQuantity - input.matchedReceiptQty).toFixed(2));
    receiptQtyMatch = diff === 0 ? 'PASSED' : 'FAILED';
    if (diff !== 0) {
      reasons.push(
        input.matchedReceiptQty === 0
          ? `invoiced ${input.invoiceQuantity} but matched to no product receipt`
          : `invoiced ${input.invoiceQuantity} but matched receipts total ${input.matchedReceiptQty}`,
      );
    }
  }

  return { priceMatch, receiptQtyMatch, variancePct, netUnitPrice, reasons };
}

/**
 * **[OFFICIAL]** price totals matching compares "the net amount of each line on
 * the invoice, and all pending and previously posted invoice lines, with the net
 * amount of the corresponding purchase order line" — a not-to-exceed control for
 * an order line invoiced more than once, by percentage, amount, or both, where
 * "if either the percentage or the amount exceeds the tolerance… the line has a
 * matching discrepancy".
 */
export function evaluatePriceTotalMatch(input: {
  mode: string;
  accumulatedInvoiceNet: number;
  expectedOrderNet: number;
  tolerancePct: number;
  toleranceAmount: number | null;
}): { status: MatchStatus; reason: string | null } {
  if (input.mode === 'NONE' || input.expectedOrderNet === 0) {
    return { status: 'NOT_APPLICABLE', reason: null };
  }

  const varianceAmount = Number((input.accumulatedInvoiceNet - input.expectedOrderNet).toFixed(2));
  const variancePct = Number(((varianceAmount / input.expectedOrderNet) * 100).toFixed(4));

  const byPct =
    (input.mode === 'PERCENTAGE' || input.mode === 'PERCENTAGE_AND_AMOUNT') &&
    variancePct > input.tolerancePct * 100 + 1e-9;
  const byAmount =
    (input.mode === 'AMOUNT' || input.mode === 'PERCENTAGE_AND_AMOUNT') &&
    input.toleranceAmount !== null &&
    varianceAmount > input.toleranceAmount + 1e-9;

  if (byPct || byAmount) {
    return {
      status: 'FAILED',
      reason:
        `invoiced ${input.accumulatedInvoiceNet} against an expected ${input.expectedOrderNet} ` +
        `(+${varianceAmount}, +${variancePct}%)`,
    };
  }
  return { status: 'PASSED', reason: null };
}

/**
 * **[OFFICIAL]** invoice totals matching compares six totals against expected
 * totals, where "the expected invoice totals are calculated based on the prices,
 * charges, and sales tax information from the purchase order and the quantities
 * from the invoice".
 *
 * That last clause is the subtle part and the reason this is not simply
 * "invoice total vs order total": a half-delivered order must not fail totals
 * matching. The expectation is rebuilt at the invoice's own quantities.
 */
export function evaluateInvoiceTotalsMatch(input: {
  enabled: boolean;
  tolerancePct: number;
  actual: { subtotal: number; tax: number; total: number };
  expected: { subtotal: number; tax: number; total: number };
}): { status: MatchStatus; reasons: string[] } {
  if (!input.enabled) return { status: 'NOT_APPLICABLE', reasons: [] };

  const reasons: string[] = [];
  const check = (label: string, actual: number, expected: number) => {
    if (expected === 0 && actual === 0) return;
    const variance = expected === 0 ? 100 : ((actual - expected) / expected) * 100;
    if (Math.abs(variance) > input.tolerancePct * 100 + 1e-9) {
      reasons.push(
        `${label}: invoiced ${actual.toFixed(2)}, expected ${expected.toFixed(2)} ` +
          `(${variance > 0 ? '+' : ''}${variance.toFixed(2)}%)`,
      );
    }
  };

  check('subtotal', input.actual.subtotal, input.expected.subtotal);
  check('tax', input.actual.tax, input.expected.tax);
  check('invoice amount', input.actual.total, input.expected.total);

  return { status: reasons.length === 0 ? 'PASSED' : 'FAILED', reasons };
}

/**
 * The header roll-up. **[OFFICIAL]** the header carries a *Last match* status
 * that summarises the lines; a single failing line fails the invoice.
 */
export function rollUpHeaderStatus(lineStatuses: MatchStatus[][]): MatchStatus {
  const flat = lineStatuses.flat();
  if (flat.some(s => s === 'FAILED')) return 'FAILED';
  if (flat.some(s => s === 'PASSED')) return 'PASSED';
  return 'NOT_APPLICABLE';
}
