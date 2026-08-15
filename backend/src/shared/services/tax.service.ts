import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../errors/AppError';

/**
 * Tax resolution and calculation.
 *
 * Applicable taxes are the INTERSECTION of the codes in the party's tax group and
 * the codes in the product's item tax group — the D365 model:
 *
 *   "Both groups contain a list of sales tax codes, and the intersection of the two
 *    lists of sales tax codes determines the list of applicable sales tax codes for
 *    the transaction."
 *   — learn.microsoft.com/dynamics365/finance/general-ledger/indirect-taxes-overview
 *
 * That single mechanism carries all three target jurisdictions:
 *
 *   Bolivia  IVA 13% inclusive + IT 3% turnover on the net.
 *   Turkey   KDV 20/10/1 by product, and tevkifat as a share of the calculated
 *            tax that the buyer remits, above a threshold.
 *   Germany  USt 19/7 by product, reverse charge and intra-community exemption by
 *            customer — i.e. by which codes intersect, not by an if-branch.
 *
 * ── Bolivia must not regress ────────────────────────────────────────────────
 * Configured with IVA13 (inclusive) + IT3 (turnover), `calculateTax` returns
 * exactly what `config/tax.ts resolveTax()` returns today:
 *   subtotal = gross / 1.13 · iva = gross - subtotal · it = subtotal * 0.03
 * There is a test asserting this equivalence. If it fails, the generalisation is
 * wrong — not the test.
 */

export interface TaxCodeSpec {
  id: string;
  code: string;
  name: string;
  tax_type: string;
  rate: number;
  is_inclusive: boolean;
  is_recoverable: boolean;
  reverse_charge: boolean;
  is_exempt: boolean;
  exempt_reason: string | null;
  withholding_share: number | null;
  withholding_threshold: number | null;
  posting_type_payable: string;
  posting_type_receivable: string | null;
}

export interface TaxLineResult {
  tax_code_id: string;
  code: string;
  tax_type: string;
  /** Amount the tax is computed on. */
  base: number;
  rate: number;
  /** Total tax computed, before any withholding split. */
  amount: number;
  /** Portion the SUPPLIER declares and posts. */
  amount_payable: number;
  /**
   * Portion the BUYER remits directly — Turkish tevkifat. Zero elsewhere.
   * Under reverse charge the whole amount lands here and `amount_payable` is 0.
   */
  amount_withheld: number;
  is_recoverable: boolean;
  exempt_reason: string | null;
  posting_type_payable: string;
  posting_type_receivable: string | null;
}

export interface TaxCalculation {
  /** Net of all taxes — the revenue figure. */
  subtotal: number;
  /** Gross including inclusive taxes. */
  total: number;
  lines: TaxLineResult[];
}

type Client = Prisma.TransactionClient | typeof db;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Codes that apply to a party × product combination.
 * Returns [] when the two groups share nothing — which is correct and is how D365
 * behaves: "If there's no intersection of sales tax codes in the groups on a line,
 * a sales tax transaction isn't created."
 */
export async function resolveApplicableTaxCodes(
  tenantId: string,
  taxGroupId: string | null,
  itemTaxGroupId: string | null,
  on: Date = new Date(),
  client: Client = db,
): Promise<TaxCodeSpec[]> {
  if (!taxGroupId || !itemTaxGroupId) return [];

  const rows = await client.taxCode.findMany({
    where: {
      tenant_id: tenantId,
      is_active: true,
      valid_from: { lte: on },
      OR: [{ valid_to: null }, { valid_to: { gte: on } }],
      tax_group_codes: { some: { tax_group_id: taxGroupId } },
      item_tax_group_codes: { some: { item_tax_group_id: itemTaxGroupId } },
    },
    select: {
      id: true, code: true, name: true, tax_type: true, rate: true,
      is_inclusive: true, is_recoverable: true, reverse_charge: true,
      is_exempt: true, exempt_reason: true,
      withholding_share: true, withholding_threshold: true,
      posting_type_payable: true, posting_type_receivable: true,
    },
    orderBy: { code: 'asc' },
  });

  return rows.map(r => ({
    ...r,
    rate: Number(r.rate),
    withholding_share: r.withholding_share === null ? null : Number(r.withholding_share),
    withholding_threshold: r.withholding_threshold === null ? null : Number(r.withholding_threshold),
  }));
}

/**
 * Calculate tax for one amount against a set of codes.
 *
 * `amount` is the gross when any applicable code is inclusive, and the net
 * otherwise. Mixing inclusive and exclusive codes on one line is rejected rather
 * than guessed — the two interpret the same input differently, and silently
 * picking one is how a tax engine starts producing quietly wrong numbers.
 *
 * Ordering matters and is deliberate:
 *   1. Inclusive VAT is extracted first to establish the net.
 *   2. Exclusive VAT is applied to that net.
 *   3. Turnover tax (Bolivia's IT) is applied to the net, never to the gross.
 */
export function calculateTax(amount: number, codes: TaxCodeSpec[]): TaxCalculation {
  if (codes.length === 0) {
    return { subtotal: round2(amount), total: round2(amount), lines: [] };
  }

  const vatCodes      = codes.filter(c => c.tax_type === 'VAT' && !c.is_exempt);
  const inclusive     = vatCodes.filter(c => c.is_inclusive);
  const exclusive     = vatCodes.filter(c => !c.is_inclusive);
  const turnoverCodes = codes.filter(c => c.tax_type === 'TURNOVER' && !c.is_exempt);
  const exemptCodes   = codes.filter(c => c.is_exempt);

  if (inclusive.length > 0 && exclusive.length > 0) {
    throw new AppError(
      `Tax codes ${inclusive.map(c => c.code).join(',')} are price-inclusive but ` +
        `${exclusive.map(c => c.code).join(',')} are exclusive. A single amount cannot be both.`,
      500,
      'TAX_INCLUSIVE_MIXED',
    );
  }

  // 1. Establish the net.
  const inclusiveRateSum = inclusive.reduce((s, c) => s + c.rate, 0);
  const subtotal = inclusive.length > 0 ? amount / (1 + inclusiveRateSum) : amount;

  const lines: TaxLineResult[] = [];

  const emit = (c: TaxCodeSpec, base: number, taxAmount: number) => {
    // Reverse charge: the customer accounts for the whole amount, so the supplier
    // posts no liability.
    //
    // Tevkifat (Turkey): the buyer remits `withholding_share` of the calculated
    // tax. Two details come straight from the primary legislation — KDV Genel
    // Uygulama Tebliği I/C-2.1.3.4.1 (Resmî Gazete 26.04.2014, No. 28983):
    //
    //   "Kısmi tevkifat uygulaması kapsamına giren her bir işlemin KDV DAHİL
    //    bedeli […] fatura düzenleme sınırını aşmadığı takdirde, hesaplanan KDV
    //    tevkifata tabi tutulmaz. Sınırın aşılması halinde ise TUTARIN TAMAMI
    //    üzerinden tevkifat yapılır."
    //
    //   1. The threshold is tested against the VAT-INCLUSIVE amount, not the net.
    //      Turkish KDV is exclusive, so the net alone understates the comparison
    //      and would wrongly exempt transactions near the boundary.
    //   2. Once exceeded, withholding applies to the WHOLE tax, not the excess.
    let withheld = 0;
    if (c.reverse_charge) {
      withheld = taxAmount;
    } else if (c.withholding_share) {
      const vatInclusiveValue = subtotal + taxAmount;
      const overThreshold = c.withholding_threshold === null || vatInclusiveValue >= c.withholding_threshold;
      if (overThreshold) withheld = taxAmount * c.withholding_share;
    }

    lines.push({
      tax_code_id: c.id,
      code: c.code,
      tax_type: c.tax_type,
      base: round2(base),
      rate: c.rate,
      amount: round2(taxAmount),
      amount_payable: round2(taxAmount - withheld),
      amount_withheld: round2(withheld),
      is_recoverable: c.is_recoverable,
      exempt_reason: c.exempt_reason,
      posting_type_payable: c.posting_type_payable,
      posting_type_receivable: c.posting_type_receivable,
    });
  };

  for (const c of inclusive) emit(c, subtotal, subtotal * c.rate);
  for (const c of exclusive) emit(c, subtotal, subtotal * c.rate);
  // 3. Turnover tax is on the net, never the gross — Bolivia's IT is 3% of the
  //    subtotal after IVA has been taken out.
  for (const c of turnoverCodes) emit(c, subtotal, subtotal * c.rate);

  // Exempt codes produce a zero line so the reason still reaches the invoice —
  // a German intra-community supply is invalid without its §6a reference.
  for (const c of exemptCodes) {
    lines.push({
      tax_code_id: c.id, code: c.code, tax_type: c.tax_type,
      base: round2(subtotal), rate: 0, amount: 0, amount_payable: 0, amount_withheld: 0,
      is_recoverable: c.is_recoverable, exempt_reason: c.exempt_reason,
      posting_type_payable: c.posting_type_payable,
      posting_type_receivable: c.posting_type_receivable,
    });
  }

  // Turnover tax is a cost to the seller, not a surcharge on the customer, so it
  // does not raise the amount the customer pays.
  const addedByExclusiveVat = lines
    .filter(l => l.tax_type === 'VAT' && exclusive.some(e => e.id === l.tax_code_id))
    .reduce((s, l) => s + l.amount, 0);

  return {
    subtotal: round2(subtotal),
    total: round2(subtotal + addedByExclusiveVat + (inclusive.length > 0 ? amount - subtotal : 0)),
    lines,
  };
}

/**
 * Resolve the groups that apply to a sale line, honouring the parameter defaults.
 * Party and product each fall back to the SalesParameters default when unclassified,
 * which is what lets the tax engine be switched on without reclassifying every
 * existing customer and product first.
 */
export async function resolveGroupsForSale(
  tenantId: string,
  customerId: string | null,
  productId: string | null,
  client: Client = db,
): Promise<{ taxGroupId: string | null; itemTaxGroupId: string | null }> {
  const [params, customer, product] = await Promise.all([
    client.salesParameters.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: null },
      select: { default_tax_group_id: true, default_item_tax_group_id: true },
    }),
    customerId
      ? client.customer.findFirst({ where: { id: customerId, tenant_id: tenantId }, select: { tax_group_id: true } })
      : Promise.resolve(null),
    productId
      ? client.product.findFirst({ where: { id: productId, tenant_id: tenantId }, select: { item_tax_group_id: true } })
      : Promise.resolve(null),
  ]);

  return {
    taxGroupId:     customer?.tax_group_id ?? params?.default_tax_group_id ?? null,
    itemTaxGroupId: product?.item_tax_group_id ?? params?.default_item_tax_group_id ?? null,
  };
}
