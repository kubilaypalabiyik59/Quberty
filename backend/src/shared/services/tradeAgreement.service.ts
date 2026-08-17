import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { logger } from '../logger';
import { AppError } from '../errors/AppError';

/**
 * Trade agreement resolution — the negotiated price for a party ∩ product ∩
 * quantity ∩ date.
 *
 * Migration 021 created the table; this is what makes it mean something. Before it,
 * a purchase price was typed by hand into `unit_cost` on every line and a sales
 * price was the single `Product.selling_price` column.
 *
 * ── Precedence, and why it is not "best price wins" ────────────────────────
 * **[OFFICIAL]** D365 offers *Find next*: "When Find next is set to Yes, the
 * pricing engine continues to search for applicable trade agreements with a lower
 * sale price. When Find next is set to No, the price engine stops searching and
 * uses the trade agreement."
 * https://learn.microsoft.com/dynamics365/commerce/tasks/base-price-trade-agreements
 *
 * Our default is **most specific wins**, matching `postingProfile.service.ts`
 * exactly. A price negotiated with one supplier for one product must not be
 * silently undercut by a general row somebody added for everybody — that is a
 * pricing incident, not a saving. `find_next` opts an individual row into the
 * cheaper-wins search, so the D365 behaviour is available per row rather than
 * imposed globally.
 *
 * Specificity, most specific first — the same ladder as posting profiles:
 *
 *   party    PARTY  →  PARTY_GROUP  →  ALL
 *   product  VARIANT →  PRODUCT      →  ITEM_GROUP  →  ALL
 *
 * The product axis is ranked ahead of the party axis, because a shoe retailer
 * negotiates per style far more often than per customer, and a tie between "this
 * product for everyone" and "everything for this vendor" has to break one way.
 * Stated rather than emergent.
 */

export type AgreementSide = 'SALES' | 'PURCHASE';
export type AgreementType = 'PRICE' | 'LINE_DISCOUNT';

type Client = Prisma.TransactionClient | typeof db;

export interface TradeAgreementContext {
  customerId?: string | null;
  supplierId?: string | null;
  productId?: string | null;
  variantId?: string | null;
  itemGroupId?: string | null;
  quantity?: number;
  /** The date the agreement must be valid on. Defaults to today. */
  on?: Date;
  legalEntityId?: string | null;
  client?: Client;
}

export interface ResolvedPrice {
  /** Price per ONE unit, already divided by `price_unit`. */
  unitPrice: number;
  /** The row it came from, so a caller can show "why this price". */
  agreementId: string;
  /** How specific the winning row was, for logging and for the UI. */
  specificity: string;
  quantityFrom: number;
  quantityTo: number | null;
}

export interface ResolvedDiscount {
  percent: number;
  agreementId: string;
  specificity: string;
}

/**
 * Rank a row's specificity. Higher wins. Product axis is weighted above party, per
 * the note above.
 */
function rank(row: { party_scope: string; product_scope: string; variant_id: string | null }): number {
  const product = row.variant_id ? 40 : row.product_scope === 'PRODUCT' ? 30 : row.product_scope === 'ITEM_GROUP' ? 20 : 10;
  const party = row.party_scope === 'PARTY' ? 3 : row.party_scope === 'PARTY_GROUP' ? 2 : 1;
  return product * 10 + party;
}

function describe(row: { party_scope: string; product_scope: string; variant_id: string | null }): string {
  const product = row.variant_id ? 'VARIANT' : row.product_scope;
  return `${product} ∩ ${row.party_scope}`;
}

async function candidates(
  tenantId: string,
  side: AgreementSide,
  type: AgreementType,
  ctx: TradeAgreementContext,
) {
  const client = ctx.client ?? db;
  const on = ctx.on ?? new Date();
  const qty = ctx.quantity ?? 1;

  const rows = await client.tradeAgreement.findMany({
    where: {
      tenant_id: tenantId,
      legal_entity_id: ctx.legalEntityId ?? null,
      side,
      agreement_type: type,
      is_active: true,
      valid_from: { lte: on },
      OR: [{ valid_to: null }, { valid_to: { gte: on } }],
      // Quantity break: the row must cover this quantity.
      quantity_from: { lte: qty },
      AND: [{ OR: [{ quantity_to: null }, { quantity_to: { gte: qty } }] }],
    },
    select: {
      id: true, party_scope: true, product_scope: true,
      customer_id: true, supplier_id: true, party_group_id: true,
      product_id: true, variant_id: true, item_group_id: true,
      amount: true, discount_percent: true, price_unit: true,
      quantity_from: true, quantity_to: true, find_next: true,
    },
  });

  // Filter to rows that actually match this context. Done in code rather than in the
  // `where`, because "PARTY means it must equal mine, ALL means anything" is four
  // OR-branches per axis in SQL and one readable predicate here — and the row count
  // is a price list, not a transaction table.
  return rows.filter(r => {
    switch (r.party_scope) {
      case 'PARTY':
        if (side === 'SALES' && r.customer_id !== ctx.customerId) return false;
        if (side === 'PURCHASE' && r.supplier_id !== ctx.supplierId) return false;
        break;
      case 'PARTY_GROUP':
        // The master does not exist yet (S2P_O2C_STATUS §4). A row at this scope can
        // never match, so it is dropped LOUDLY rather than quietly ignored — a price
        // list somebody maintains and that never applies is worse than none.
        logger.warn(
          { tenantId, agreementId: r.id },
          'Trade agreement scoped to PARTY_GROUP was skipped: customer/vendor groups are not implemented. ' +
            'The row will never apply until they are.',
        );
        return false;
      case 'ALL':
        break;
      default:
        return false;
    }

    if (r.variant_id && r.variant_id !== ctx.variantId) return false;

    switch (r.product_scope) {
      case 'PRODUCT':
        return r.product_id === ctx.productId;
      case 'ITEM_GROUP':
        return !!ctx.itemGroupId && r.item_group_id === ctx.itemGroupId;
      case 'ALL':
        return true;
      default:
        return false;
    }
  });
}

/**
 * The negotiated unit price, or null when no agreement covers this combination —
 * which is the normal case for a tenant that has not entered any, and is why
 * applying migration 021 changed no behaviour.
 *
 * Never throws for "no agreement". A missing price is a legitimate answer; the
 * caller falls back to whatever it used before.
 */
export async function resolveTradeAgreementPrice(
  tenantId: string,
  side: AgreementSide,
  ctx: TradeAgreementContext,
): Promise<ResolvedPrice | null> {
  const matches = await candidates(tenantId, side, 'PRICE', ctx);
  if (matches.length === 0) return null;

  const priced = matches
    .filter(r => r.amount !== null)
    .map(r => ({
      row: r,
      unitPrice: Number(r.amount) / Number(r.price_unit),
      rank: rank(r),
    }));
  if (priced.length === 0) return null;

  // Most specific first; ties broken by the lower price, which is the only
  // defensible tie-break — two rows of equal specificity are equally entitled and
  // the customer/vendor gets the better of them.
  priced.sort((a, b) => (b.rank - a.rank) || (a.unitPrice - b.unitPrice));
  let winner = priced[0];

  // **[OFFICIAL]** *Find next*: a row can opt into "keep looking for a lower price".
  if (winner.row.find_next) {
    const cheapest = priced.reduce((best, c) => (c.unitPrice < best.unitPrice ? c : best), winner);
    if (cheapest !== winner) {
      logger.info(
        { tenantId, from: winner.row.id, to: cheapest.row.id },
        'find_next: a cheaper trade agreement superseded the most specific one',
      );
      winner = cheapest;
    }
  }

  return {
    unitPrice: Math.round(winner.unitPrice * 10000) / 10000,
    agreementId: winner.row.id,
    specificity: describe(winner.row),
    quantityFrom: Number(winner.row.quantity_from),
    quantityTo: winner.row.quantity_to === null ? null : Number(winner.row.quantity_to),
  };
}

/** The negotiated line discount percentage, or null. */
export async function resolveTradeAgreementDiscount(
  tenantId: string,
  side: AgreementSide,
  ctx: TradeAgreementContext,
): Promise<ResolvedDiscount | null> {
  const matches = (await candidates(tenantId, side, 'LINE_DISCOUNT', ctx))
    .filter(r => r.discount_percent !== null);
  if (matches.length === 0) return null;

  // Most specific first; ties broken by the LARGER discount, which is the same
  // principle as the lower price.
  matches.sort((a, b) => (rank(b) - rank(a)) || (Number(b.discount_percent) - Number(a.discount_percent)));
  const w = matches[0];

  return {
    percent: Number(w.discount_percent),
    agreementId: w.id,
    specificity: describe(w),
  };
}

/**
 * The purchase price for a line, with the fallback chain stated.
 *
 * Order: trade agreement → the caller's explicit cost → `Product.cost_price`.
 * The explicit cost sits ABOVE the product default and BELOW the agreement,
 * because a buyer typing a number is more informed than a stale master-data field
 * and less authoritative than a negotiated contract.
 */
export async function purchasePriceFor(
  tenantId: string,
  ctx: TradeAgreementContext & { explicitCost?: number | null },
): Promise<{ unitCost: number; source: 'AGREEMENT' | 'EXPLICIT' | 'PRODUCT'; agreementId?: string }> {
  const agreement = await resolveTradeAgreementPrice(tenantId, 'PURCHASE', ctx);
  if (agreement) {
    return { unitCost: agreement.unitPrice, source: 'AGREEMENT', agreementId: agreement.agreementId };
  }

  if (ctx.explicitCost !== null && ctx.explicitCost !== undefined) {
    return { unitCost: Number(ctx.explicitCost), source: 'EXPLICIT' };
  }

  const client = ctx.client ?? db;
  const product = ctx.productId
    ? await client.product.findFirst({
        where: { id: ctx.productId, tenant_id: tenantId },
        select: { cost_price: true },
      })
    : null;

  if (!product) {
    throw new AppError(
      'Cannot price this purchase line: no trade agreement, no cost given, and no product cost on file.',
      400,
      'PURCHASE_PRICE_UNRESOLVED',
    );
  }
  return { unitCost: Number(product.cost_price ?? 0), source: 'PRODUCT' };
}
