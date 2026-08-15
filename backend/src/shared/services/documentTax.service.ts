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
