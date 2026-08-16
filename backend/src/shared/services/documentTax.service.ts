import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { logger } from '../logger';
import { resolveTax } from '../../config/tax';
import {
  calculateTax,
  resolveApplicableTaxCodes,
  TaxLineResult,
} from './tax.service';

/**
 * The single place a document works out its tax.
 *
 * Replaces two older paths that both had problems:
 *
 *   `resolveTax(c.get('taxConfig'))` — read an untyped JSON blob on the tenant row.
 *   `TAX.iva(subtotal)`             — worse: the hardcoded Bolivian constant, so
 *                                     EVERY tenant got 13% regardless of their own
 *                                     configuration. Purchase orders and sales
 *                                     order creation both did this.
 *
 * Now the tax comes from the configured engine: tax group (party) ∩ item tax group
 * (product) → tax codes → calculation. See tax.service.ts.
 *
 * ── Legacy fallback, and why it exists ─────────────────────────────────────
 * A tenant that has not been provisioned yet has no tax codes, and the
 * intersection legitimately returns nothing. Rather than charge zero tax on a
 * live system, this falls back to the old per-tenant JSON config and says so in
 * the return value. The fallback is a migration aid — once every tenant is
 * provisioned it should be deleted, along with `Tenant.tax_config` and
 * `config/tax.ts`.
 *
 * ── KNOWN LIMITATION: tax is computed on the document TOTAL ────────────────
 * This is correct for Bolivia, where one rate (IVA 13%) applies to everything the
 * anchor customer sells. It is NOT correct for a jurisdiction with several
 * concurrent rates — Turkey (KDV 20/10/1) or Germany (USt 19/7) — where an order
 * holding one standard-rated and one reduced-rate product cannot be represented by
 * a single header figure at all.
 *
 * The hook for fixing this is on the LINE, not here: `SalesOrderLine` and
 * `PurchaseOrderLine` carry a nullable `item_tax_group_id` and per-line tax
 * amounts, so line-level calculation is a service change rather than a migration.
 * **That refactor must happen before selling into any multi-rate market.**
 */

export interface DocumentTaxResult {
  /** Net of all taxes. */
  subtotal: number;
  /** Recoverable VAT — IVA, KDV, USt. */
  vat: number;
  /** Non-recoverable turnover tax — Bolivia's IT. Zero where none applies. */
  turnover: number;
  /** What the customer pays. */
  total: number;
  lines: TaxLineResult[];
  source: 'ENGINE' | 'LEGACY';
}

type Client = Prisma.TransactionClient | typeof db;

export interface DocumentTaxContext {
  /** Customer or supplier — the party side of the intersection. */
  partyId?: string | null;
  /** Product — the item side. Omit for header-level calculation. */
  productId?: string | null;
  /** `Tenant.tax_config`, used only if the engine is not configured. */
  legacyConfig?: unknown;
  client?: Client;
  /** PURCHASE flips the party lookup from customers to suppliers. */
  side?: 'SALES' | 'PURCHASE';
}

/**
 * Money for a PURCHASE document, from one place.
 *
 * ── The incoherence this replaces ──────────────────────────────────────────
 * Purchase used to do `computeDocumentTax(subtotal)` and then
 * `total = subtotal + vat`. With a price-inclusive code that DECOMPOSES the tax
 * out of the amount and then adds it straight back on, which produced an
 * effective 11,5% and a total that was neither the net nor the gross:
 *
 *   Bs 2 500 → tax 287,61 → total 2 787,61
 *
 * ── What is correct in Bolivia ─────────────────────────────────────────────
 * A supplier's factura carries ONE amount with the IVA inside it (Ley 843
 * art. 5), and the buyer's crédito fiscal is the alícuota applied to that
 * invoiced amount. So the figure a buyer agrees with a vendor IS the gross:
 *
 *   gross          what we owe the supplier      → AP
 *   gross − IVA    the recoverable tax removed   → Inventory / expense
 *   IVA            13% of the gross              → VAT_INPUT
 *
 * Inventory must be debited NET of a recoverable tax — capitalising IVA that
 * will be reclaimed overstates stock value and therefore COGS.
 *
 * Where the tax is NOT recoverable, or the jurisdiction adds it on top (Turkey,
 * Germany, Bolivia after Ley 1733), the same engine yields `total > net` and the
 * arithmetic still holds. That is the point of asking the engine instead of
 * hardcoding a sign.
 */
export interface PurchaseDocumentMoney {
  /** Goes to Inventory / expense. Net of recoverable tax. */
  net: number;
  /** Recoverable input tax → VAT_INPUT. */
  recoverable_tax: number;
  /** Non-recoverable tax, already inside `net` because it is a cost. */
  non_recoverable_tax: number;
  /** What the supplier is owed → AP, and the document's total_amount. */
  total: number;
  source: 'ENGINE' | 'LEGACY';
}

/**
 * The pure half — split a tax result into the three figures a purchase document
 * posts. Extracted from `computePurchaseMoney` so it can be tested against
 * several jurisdictions without a database.
 *
 * There is **no jurisdiction branch here, and there must never be one.** The
 * three figures fall out of what the engine already returned:
 *
 *   Bolivia, IVA por dentro (inclusive, GROSS)
 *     agreed 2 500 → total 2 500 · recoverable 325 · net 2 175
 *     the tax was already inside the agreed price, so AP owes exactly it
 *
 *   Turkey / Germany / Bolivia post-Ley-1733 (exclusive, NET)
 *     agreed 2 500 → total 2 825 · recoverable 325 · net 2 500
 *     the tax is added, so AP owes more than the agreed price
 *
 * Same code, opposite arithmetic, decided entirely by TaxCode rows.
 */
export function splitPurchaseMoney(tax: DocumentTaxResult): PurchaseDocumentMoney {
  const recoverable = tax.lines
    .filter((l) => l.is_recoverable)
    .reduce((s, l) => s + l.amount, 0);
  const nonRecoverable = tax.lines
    .filter((l) => !l.is_recoverable)
    .reduce((s, l) => s + l.amount, 0);

  // The legacy fallback has no line detail; treat its VAT as recoverable, which
  // is what the old code assumed anyway.
  const recoverableTax = tax.source === 'LEGACY' ? tax.vat : recoverable;

  return {
    net: Number((tax.total - recoverableTax).toFixed(2)),
    recoverable_tax: Number(recoverableTax.toFixed(2)),
    non_recoverable_tax: Number(nonRecoverable.toFixed(2)),
    total: Number(tax.total.toFixed(2)),
    source: tax.source,
  };
}

export async function computePurchaseMoney(
  tenantId: string,
  /** The amount agreed with the supplier, as it appears on their invoice. */
  amount: number,
  ctx: Omit<DocumentTaxContext, 'side'> = {},
): Promise<PurchaseDocumentMoney> {
  return splitPurchaseMoney(
    await computeDocumentTax(tenantId, amount, { ...ctx, side: 'PURCHASE' }),
  );
}

export async function computeDocumentTax(
  tenantId: string,
  amount: number,
  ctx: DocumentTaxContext = {},
): Promise<DocumentTaxResult> {
  const client = ctx.client ?? db;
  const side = ctx.side ?? 'SALES';

  const [params, party, product] = await Promise.all([
    client.salesParameters.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: null },
      select: { default_tax_group_id: true, default_item_tax_group_id: true },
    }),
    ctx.partyId
      ? side === 'PURCHASE'
        ? client.supplier.findFirst({ where: { id: ctx.partyId, tenant_id: tenantId }, select: { tax_group_id: true } })
        : client.customer.findFirst({ where: { id: ctx.partyId, tenant_id: tenantId }, select: { tax_group_id: true } })
      : Promise.resolve(null),
    ctx.productId
      ? client.product.findFirst({ where: { id: ctx.productId, tenant_id: tenantId }, select: { item_tax_group_id: true } })
      : Promise.resolve(null),
  ]);

  const taxGroupId = party?.tax_group_id ?? params?.default_tax_group_id ?? null;
  const itemTaxGroupId = product?.item_tax_group_id ?? params?.default_item_tax_group_id ?? null;

  const codes = await resolveApplicableTaxCodes(tenantId, taxGroupId, itemTaxGroupId, new Date(), client);

  if (codes.length === 0) {
    const legacy = resolveTax(ctx.legacyConfig ?? undefined);
    const b = legacy.breakdown(amount);
    logger.warn(
      { tenantId, side },
      'Tax engine not configured for this tenant — falling back to Tenant.tax_config. ' +
        'Run provisionConfiguration to migrate.',
    );
    return { subtotal: b.subtotal, vat: b.iva, turnover: b.it, total: amount, lines: [], source: 'LEGACY' };
  }

  const calc = calculateTax(amount, codes);
  return {
    subtotal: calc.subtotal,
    vat: calc.lines.filter(l => l.tax_type === 'VAT').reduce((s, l) => s + l.amount, 0),
    turnover: calc.lines.filter(l => l.tax_type === 'TURNOVER').reduce((s, l) => s + l.amount, 0),
    total: calc.total,
    lines: calc.lines,
    source: 'ENGINE',
  };
}
