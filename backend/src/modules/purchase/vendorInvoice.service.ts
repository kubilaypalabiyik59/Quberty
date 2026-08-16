import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { logger } from '../../shared/logger';
import { allocateNumber, nextJournalVoucher } from '../../shared/services/numberSequence.service';
import { resolveItemPolicies, groupByItemGroup, ItemPolicy } from '../../shared/services/itemPolicy.service';
import { resolvePostingAccounts_orExplain } from '../../shared/services/posting.service';
import { computePurchaseMoney } from '../../shared/services/documentTax.service';
import {
  resolveMatchingPolicy,
  resolvePriceTolerance,
  evaluateLineMatch,
  evaluatePriceTotalMatch,
  evaluateInvoiceTotalsMatch,
  rollUpHeaderStatus,
  MatchStatus,
} from '../../shared/services/invoiceMatching.service';

/**
 * Vendor invoice — the FINANCIAL half of a purchase.
 *
 * The supplier's document, not ours: their number, their date, and in Bolivia
 * their NIT and factura authorisation, because those are what the IVA purchase
 * ledger is built from. **[OFFICIAL]** an invoice may also carry lines that were
 * never on the purchase order, and may reference no order at all.
 * learn.microsoft.com/dynamics365/finance/accounts-payable/vendor-invoices-overview
 *
 * ── WHAT POSTS HERE ────────────────────────────────────────────────────────
 *     DR  PURCHASE_ACCRUAL     what the receipts accrued  ← reverses the accrual
 *     DR  VAT_INPUT            recoverable tax per the factura
 *     DR/CR PRICE_VARIANCE     invoice price − receipt price, when they differ
 *         CR  AP               what the supplier is owed
 *
 * This is the first point at which recoverable tax exists, which is the whole
 * reason the split was worth building: **[OFFICIAL]** D365 carries an *Accrued
 * sales tax on receipt* posting type whose only job is to reverse receipt-time
 * tax at invoice, confirming that recoverable tax is a financial-update concept.
 * For Bolivia it also means crédito fiscal is recognised against a document that
 * actually carries the factura number.
 *
 * ── MATCHING ───────────────────────────────────────────────────────────────
 * Three-way matching is not a comparison of two numbers. **[OFFICIAL]** it asks
 * whether an invoice line is tied to specific product receipt lines and whether
 * the tied quantities add up — "if there are multiple product receipts for a
 * single invoice line, you need to run the process multiple times". That is why
 * matches are rows in `vendor_invoice_matches`, not a computed comparison.
 */

type Tx = Prisma.TransactionClient;

export interface InvoiceLineInput {
  po_line_id?: string | null;
  product_id?: string | null;
  variant_id?: string | null;
  description?: string | null;
  quantity: number;
  unit_price: number;
  charges_amount?: number;
  discount_amount?: number;
}

export interface CreateInvoiceInput {
  supplier_id?: string | null;
  purchase_order_id?: string | null;
  /** The supplier's own invoice / factura number. */
  invoice_number: string;
  invoice_date: string;
  posting_date?: string | null;
  due_date?: string | null;
  supplier_tax_id?: string | null;
  fiscal_authorization_code?: string | null;
  fiscal_control_code?: string | null;
  notes?: string | null;
  /**
   * Omitted → defaulted from the order using
   * `PurchaseParameters.default_invoice_quantity`. **[OFFICIAL]** the default is
   * the product receipt quantity, with ordered / receive-now / registered as the
   * documented alternatives.
   */
  lines?: InvoiceLineInput[];
  /** Tie each line to product receipts automatically, oldest receipt first. */
  auto_match?: boolean;
}

/* ────────────────────────────── creation ─────────────────────────────────── */

export async function createInvoice(
  tenantId: string,
  userId: string,
  input: CreateInvoiceInput,
  legalEntityId: string | null = null,
): Promise<{ id: string; internal_number: string }> {
  return db.$transaction(async (tx) => {
    const params = await tx.purchaseParameters.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
      select: { default_invoice_quantity: true },
    });
    const defaultQty = params?.default_invoice_quantity ?? 'PRODUCT_RECEIPT';

    let po = null;
    if (input.purchase_order_id) {
      po = await tx.purchaseOrder.findFirst({
        where: { id: input.purchase_order_id, tenant_id: tenantId },
        include: { lines: true },
      });
      if (!po) throw new AppError('Purchase order not found', 404);
    }

    const supplierId = input.supplier_id ?? po?.supplier_id;
    if (!supplierId) {
      throw new AppError('A vendor invoice needs a supplier, either directly or through an order.', 400);
    }
    if (!input.invoice_number?.trim()) {
      throw new AppError("The supplier's invoice number is required.", 400);
    }

    // **[OFFICIAL]** duplicate invoice numbers are a parameterised concern
    // ("Check the invoice number used → Reject duplicate"). The uniqueness is per
    // supplier, because two suppliers both numbering "0001" is entirely normal.
    const duplicate = await tx.vendorInvoice.findFirst({
      where: { tenant_id: tenantId, supplier_id: supplierId, invoice_number: input.invoice_number.trim() },
      select: { internal_number: true },
    });
    if (duplicate) {
      throw new AppError(
        `Invoice ${input.invoice_number} from this supplier already exists (${duplicate.internal_number}).`,
        409,
        'DUPLICATE_INVOICE_NUMBER',
      );
    }

    // ── Default the lines from the order ─────────────────────────────────────
    let lines: InvoiceLineInput[] = input.lines ?? [];
    if (lines.length === 0 && po) {
      const receiptTotals = await receiptQuantitiesByPoLine(tx, po.id);
      lines = po.lines
        .map(l => {
          const ordered = Number(l.quantity);
          const received = Number(receiptTotals.get(l.id) ?? 0);
          const invoiced = Number(l.invoiced_qty);
          const qty =
            defaultQty === 'ORDERED'
              ? ordered - invoiced
              : Math.max(0, received - invoiced);
          return {
            po_line_id: l.id,
            product_id: l.product_id,
            variant_id: l.variant_id,
            quantity: Number(qty.toFixed(2)),
            unit_price: Number(l.unit_cost),
          };
        })
        .filter(l => l.quantity > 0);
    }

    if (lines.length === 0) {
      throw new AppError(
        po
          ? `Nothing to invoice on ${po.po_number}. With default_invoice_quantity = ${defaultQty}, ` +
            `every line is either uninvoiced-and-unreceived or already fully invoiced.`
          : 'A vendor invoice needs at least one line.',
        409,
        'NOTHING_TO_INVOICE',
      );
    }

    const internalNumber = await allocateNumber({
      tenantId, reference: 'VENDOR_INVOICE', legalEntityId, tx,
    });

    const invoice = await tx.vendorInvoice.create({
      data: {
        tenant_id:                 tenantId,
        legal_entity_id:           legalEntityId,
        invoice_number:            input.invoice_number.trim(),
        internal_number:           internalNumber,
        supplier_id:               supplierId,
        purchase_order_id:         po?.id ?? null,
        invoice_date:              new Date(input.invoice_date),
        posting_date:              new Date(input.posting_date ?? input.invoice_date),
        due_date:                  input.due_date ? new Date(input.due_date) : null,
        supplier_tax_id:           input.supplier_tax_id ?? null,
        fiscal_authorization_code: input.fiscal_authorization_code ?? null,
        fiscal_control_code:       input.fiscal_control_code ?? null,
        currency:                  po?.currency ?? 'BOB',
        notes:                     input.notes ?? null,
        created_by:                userId,
      },
    });

    for (const [i, l] of lines.entries()) {
      const qty = Number(l.quantity);
      const price = Number(l.unit_price);
      if (!(qty > 0)) throw new AppError('Every invoice line needs a quantity greater than zero.', 400);

      // **[OFFICIAL]** net amount = (unit price x qty) + line charges - line discounts.
      const net = Number((qty * price + Number(l.charges_amount ?? 0) - Number(l.discount_amount ?? 0)).toFixed(2));

      await tx.vendorInvoiceLine.create({
        data: {
          invoice_id:      invoice.id,
          po_line_id:      l.po_line_id ?? null,
          product_id:      l.product_id ?? null,
          variant_id:      l.variant_id ?? null,
          description:     l.description ?? null,
          quantity:        qty,
          unit_price:      price,
          charges_amount:  Number(l.charges_amount ?? 0),
          discount_amount: Number(l.discount_amount ?? 0),
          line_net_amount: net,
          sort_order:      i,
        },
      });
    }

    await recalcInvoiceMoney(tx, tenantId, invoice.id, supplierId);
    if (input.auto_match !== false) await autoMatch(tx, tenantId, invoice.id, userId);
    await runMatching(tx, tenantId, invoice.id, legalEntityId);

    return { id: invoice.id, internal_number: internalNumber };
  }, { timeout: 60_000, maxWait: 20_000 });
}

/** Received-but-not-yet-consumed quantities, per purchase order line. */
async function receiptQuantitiesByPoLine(tx: Tx, poId: string): Promise<Map<string, number>> {
  const rows = await tx.productReceiptLine.findMany({
    where: { receipt: { purchase_order_id: poId, status: 'POSTED' } },
    select: { po_line_id: true, quantity: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.po_line_id) continue;
    out.set(r.po_line_id, (out.get(r.po_line_id) ?? 0) + Number(r.quantity));
  }
  return out;
}

/**
 * The document total, split by the same engine the order uses, so an invoice and
 * the order it came from cannot disagree about what the tax is.
 */
async function recalcInvoiceMoney(tx: Tx, tenantId: string, invoiceId: string, supplierId: string): Promise<void> {
  const lines = await tx.vendorInvoiceLine.findMany({
    where: { invoice_id: invoiceId }, select: { line_net_amount: true },
  });
  const gross = Number(lines.reduce((s, l) => s + Number(l.line_net_amount), 0).toFixed(2));
  const money = await computePurchaseMoney(tenantId, gross, { partyId: supplierId, client: tx });

  await tx.vendorInvoice.update({
    where: { id: invoiceId },
    data: {
      subtotal:            money.net,
      tax_amount:          money.recoverable_tax,
      non_recoverable_tax: money.non_recoverable_tax,
      total_amount:        money.total,
    },
  });
}

/* ────────────────────────────── matching ─────────────────────────────────── */

/**
 * Tie invoice lines to product receipt lines, oldest receipt first.
 *
 * **[OFFICIAL]** "you can automatically match posted product receipts to invoice
 * lines… The matching process runs until the matched product receipt quantity
 * equals the invoice quantity." Consuming the oldest open receipt first is the
 * only ordering that keeps a partially-invoiced order's remainder meaningful.
 */
export async function autoMatch(tx: Tx, tenantId: string, invoiceId: string, userId: string): Promise<number> {
  const lines = await tx.vendorInvoiceLine.findMany({
    where: { invoice_id: invoiceId },
    select: { id: true, po_line_id: true, quantity: true, matched_receipt_qty: true },
  });

  let created = 0;
  for (const line of lines) {
    if (!line.po_line_id) continue;
    let outstanding = Number(line.quantity) - Number(line.matched_receipt_qty);
    if (outstanding <= 0) continue;

    const receiptLines = await tx.productReceiptLine.findMany({
      where: { po_line_id: line.po_line_id, receipt: { status: 'POSTED', tenant_id: tenantId } },
      select: { id: true, quantity: true, matched_qty: true, receipt: { select: { receipt_date: true } } },
      orderBy: { receipt: { receipt_date: 'asc' } },
    });

    for (const rl of receiptLines) {
      if (outstanding <= 0) break;
      const available = Number(rl.quantity) - Number(rl.matched_qty);
      if (available <= 0) continue;

      const take = Number(Math.min(available, outstanding).toFixed(2));
      await tx.vendorInvoiceMatch.create({
        data: {
          tenant_id: tenantId,
          invoice_line_id: line.id,
          receipt_line_id: rl.id,
          quantity: take,
          created_by: userId,
        },
      });
      await tx.productReceiptLine.update({
        where: { id: rl.id }, data: { matched_qty: { increment: take } },
      });
      await tx.vendorInvoiceLine.update({
        where: { id: line.id }, data: { matched_receipt_qty: { increment: take } },
      });
      outstanding = Number((outstanding - take).toFixed(2));
      created++;
    }
  }
  return created;
}

export interface MatchingOutcome {
  header_match_status: MatchStatus;
  totals_match_status: MatchStatus;
  lines: {
    id: string;
    matching_policy: string;
    price_match: MatchStatus;
    price_total_match: MatchStatus;
    receipt_qty_match: MatchStatus;
    variance_pct: number | null;
    reasons: string[];
  }[];
  reasons: string[];
}

/**
 * Run every applicable matching type and STORE the verdict.
 *
 * **[OFFICIAL]** the match status is a stored, refreshable value ("Last match"
 * status, "Automatically update invoice header match status"), not something
 * recomputed on read — history cannot be re-derived once tolerances or policies
 * change.
 */
export async function runMatching(
  tx: Tx,
  tenantId: string,
  invoiceId: string,
  legalEntityId: string | null = null,
): Promise<MatchingOutcome> {
  const invoice = await tx.vendorInvoice.findFirst({
    where: { id: invoiceId, tenant_id: tenantId },
    include: {
      lines: { include: { po_line: { include: { product: { select: { id: true } } } } }, orderBy: { sort_order: 'asc' } },
    },
  });
  if (!invoice) throw new AppError('Vendor invoice not found', 404);

  const params = await tx.purchaseParameters.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
    select: {
      match_invoice_totals: true, invoice_totals_tolerance_pct: true,
      match_price_totals: true, price_total_tolerance_pct: true, price_total_tolerance_amount: true,
      flag_negative_price_variance: true,
    },
  });

  const productIds = invoice.lines.map(l => l.product_id).filter((v): v is string => !!v);
  const policies = await resolveItemPolicies(tenantId, productIds, tx);

  const out: MatchingOutcome = {
    header_match_status: 'NOT_APPLICABLE',
    totals_match_status: 'NOT_APPLICABLE',
    lines: [],
    reasons: [],
  };
  const statuses: MatchStatus[][] = [];

  for (const line of invoice.lines) {
    const ctx = {
      tenantId,
      legalEntityId,
      itemId: line.product_id,
      itemGroupId: line.product_id ? policies.get(line.product_id)?.itemGroupId ?? null : null,
      partyId: invoice.supplier_id,
      partyGroupId: null,
    };

    const { policy } = await resolveMatchingPolicy(
      ctx, { lineOverride: line.po_line?.matching_policy ?? null }, tx,
    );
    const { tolerance } = await resolvePriceTolerance(ctx, tx);

    const orderNetUnitPrice = line.po_line ? Number(line.po_line.unit_cost) : null;

    const verdict = evaluateLineMatch({
      invoiceNetAmount: Number(line.line_net_amount),
      invoiceQuantity: Number(line.quantity),
      orderNetUnitPrice,
      matchedReceiptQty: Number(line.matched_receipt_qty),
      policy,
      tolerancePct: tolerance,
      flagNegative: params?.flag_negative_price_variance ?? false,
    });

    // **[OFFICIAL]** price totals matching compares the accumulated invoiced net
    // for an order line — this invoice plus everything already posted — against
    // the order line's net amount.
    let priceTotal: { status: MatchStatus; reason: string | null } = { status: 'NOT_APPLICABLE', reason: null };
    if (line.po_line && policy !== 'NONE') {
      const posted = await tx.vendorInvoiceLine.aggregate({
        where: {
          po_line_id: line.po_line_id,
          invoice: { status: 'POSTED', tenant_id: tenantId },
        },
        _sum: { line_net_amount: true },
      });
      priceTotal = evaluatePriceTotalMatch({
        mode: params?.match_price_totals ?? 'NONE',
        accumulatedInvoiceNet: Number(
          (Number(posted._sum.line_net_amount ?? 0) + Number(line.line_net_amount)).toFixed(2),
        ),
        expectedOrderNet: Number(line.po_line.line_total),
        tolerancePct: Number(params?.price_total_tolerance_pct ?? 0),
        toleranceAmount: params?.price_total_tolerance_amount != null
          ? Number(params.price_total_tolerance_amount) : null,
      });
    }

    await tx.vendorInvoiceLine.update({
      where: { id: line.id },
      data: {
        matching_policy:          policy,
        price_tolerance_pct:      tolerance,
        price_match_status:       verdict.priceMatch,
        price_total_match_status: priceTotal.status,
        receipt_qty_match_status: verdict.receiptQtyMatch,
        price_variance_pct:       verdict.variancePct,
      },
    });

    const reasons = [...verdict.reasons, ...(priceTotal.reason ? [priceTotal.reason] : [])];
    statuses.push([verdict.priceMatch, verdict.receiptQtyMatch, priceTotal.status]);
    out.lines.push({
      id: line.id,
      matching_policy: policy,
      price_match: verdict.priceMatch,
      price_total_match: priceTotal.status,
      receipt_qty_match: verdict.receiptQtyMatch,
      variance_pct: verdict.variancePct,
      reasons,
    });
    out.reasons.push(...reasons);
  }

  // ── Invoice totals matching ──────────────────────────────────────────────
  // **[OFFICIAL]** the expectation is built from the ORDER's prices at the
  // INVOICE's quantities, which is what keeps a partial invoice from failing.
  let totals: { status: MatchStatus; reasons: string[] } = { status: 'NOT_APPLICABLE', reasons: [] };
  if (params?.match_invoice_totals && invoice.purchase_order_id) {
    const expectedGross = Number(
      invoice.lines
        .reduce((s, l) => s + (l.po_line ? Number(l.quantity) * Number(l.po_line.unit_cost) : Number(l.line_net_amount)), 0)
        .toFixed(2),
    );
    const expectedMoney = await computePurchaseMoney(tenantId, expectedGross, {
      partyId: invoice.supplier_id, client: tx,
    });
    totals = evaluateInvoiceTotalsMatch({
      enabled: true,
      tolerancePct: Number(params.invoice_totals_tolerance_pct ?? 0),
      actual: {
        subtotal: Number(invoice.subtotal),
        tax: Number(invoice.tax_amount),
        total: Number(invoice.total_amount),
      },
      expected: {
        subtotal: expectedMoney.net,
        tax: expectedMoney.recoverable_tax,
        total: expectedMoney.total,
      },
    });
    out.reasons.push(...totals.reasons);
  }

  const header = rollUpHeaderStatus([...statuses, [totals.status]]);
  await tx.vendorInvoice.update({
    where: { id: invoiceId },
    data: {
      header_match_status: header,
      totals_match_status: totals.status,
      last_matched_at: new Date(),
    },
  });

  out.header_match_status = header;
  out.totals_match_status = totals.status;
  return out;
}

/* ────────────────────────────── posting ──────────────────────────────────── */

export interface PostedInvoice {
  id: string;
  internal_number: string;
  journal_entry_id: string | null;
  accrual_reversed: number;
  price_variance: number;
  posting_note: string;
}

export async function postInvoice(
  tenantId: string,
  userId: string,
  invoiceId: string,
  legalEntityId: string | null = null,
): Promise<PostedInvoice> {
  return db.$transaction(async (tx) => {
    const invoice = await tx.vendorInvoice.findFirst({
      where: { id: invoiceId, tenant_id: tenantId },
      include: {
        lines: { include: { po_line: true, matches: { include: { receipt_line: true } } } },
        purchase_order: { select: { id: true, po_number: true } },
      },
    });
    if (!invoice) throw new AppError('Vendor invoice not found', 404);
    if (invoice.status === 'POSTED') throw new AppError('This invoice is already posted.', 409);
    if (invoice.status === 'CANCELLED') throw new AppError('A cancelled invoice cannot be posted.', 409);

    const params = await tx.purchaseParameters.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
      select: { post_invoice_with_discrepancies: true, post_product_receipt_in_ledger: true },
    });

    // ── The discrepancy gate ─────────────────────────────────────────────────
    // **[OFFICIAL]** with "Require approval", the "Approve posting with matching
    // discrepancies" toggle must be set before an invoice with price or quantity
    // errors can post.
    const matching = await runMatching(tx, tenantId, invoiceId, legalEntityId);
    if (
      matching.header_match_status === 'FAILED' &&
      (params?.post_invoice_with_discrepancies ?? 'ALLOW_WITH_WARNING') === 'REQUIRE_APPROVAL' &&
      !invoice.discrepancy_approved
    ) {
      throw new AppError(
        `Invoice ${invoice.invoice_number} has matching discrepancies and this tenant requires ` +
          `approval before posting them:\n  - ${matching.reasons.join('\n  - ')}`,
        409,
        'MATCHING_DISCREPANCY_UNAPPROVED',
      );
    }

    // ── Receiving requirements ───────────────────────────────────────────────
    // **[OFFICIAL]** the item model group's "Receiving requirements" blocks a
    // vendor invoice until the goods have been received. It was declared in
    // migration 009 and unenforceable until the two documents existed.
    const productIds = invoice.lines.map(l => l.product_id).filter((v): v is string => !!v);
    const policies = await resolveItemPolicies(tenantId, productIds, tx);
    const unreceived = invoice.lines.filter(
      l => l.product_id &&
        policies.get(l.product_id)?.receivingRequirements &&
        Number(l.matched_receipt_qty) < Number(l.quantity) - 1e-9,
    );
    if (unreceived.length > 0) {
      throw new AppError(
        `${unreceived.length} line(s) belong to an item model group with receiving requirements, ` +
          `so the goods must be received before the invoice can post.`,
        409,
        'RECEIVING_REQUIRED',
      );
    }

    const journal = await postInvoiceVoucher(tx, {
      tenantId, legalEntityId, userId, invoice, policies,
      receiptPostingOn: params?.post_product_receipt_in_ledger ?? false,
    });

    await tx.vendorInvoice.update({
      where: { id: invoice.id },
      data: {
        status: 'POSTED',
        posted_at: new Date(),
        posted_by: userId,
        journal_entry_id: journal.journalId,
      },
    });

    // ── Order accumulators ───────────────────────────────────────────────────
    // **[OFFICIAL]** the order becomes *Invoiced* only when both the invoice
    // remainder and the deliver remainder reach zero.
    for (const line of invoice.lines) {
      if (!line.po_line_id) continue;
      await tx.purchaseOrderLine.update({
        where: { id: line.po_line_id },
        data: { invoiced_qty: { increment: Number(line.quantity) } },
      });
    }
    if (invoice.purchase_order) {
      const lines = await tx.purchaseOrderLine.findMany({
        where: { po_id: invoice.purchase_order.id },
        select: { quantity: true, received_qty: true, invoiced_qty: true },
      });
      const done = lines.every(
        l => Number(l.invoiced_qty) >= Number(l.quantity) - 1e-9 &&
             Number(l.received_qty) >= Number(l.quantity) - 1e-9,
      );
      if (done) {
        await tx.purchaseOrder.update({
          where: { id: invoice.purchase_order.id }, data: { status: 'INVOICED' },
        });
      }
    }

    logger.info(
      { tenantId, invoice: invoice.internal_number, voucher: journal.journalId, total: Number(invoice.total_amount) },
      'Vendor invoice posted (financial update)',
    );

    return {
      id: invoice.id,
      internal_number: invoice.internal_number,
      journal_entry_id: journal.journalId,
      accrual_reversed: journal.accrualReversed,
      price_variance: journal.priceVariance,
      posting_note: journal.note,
    };
  }, { timeout: 60_000, maxWait: 20_000 });
}

async function postInvoiceVoucher(
  tx: Tx,
  ctx: {
    tenantId: string;
    legalEntityId: string | null;
    userId: string;
    invoice: Prisma.VendorInvoiceGetPayload<{
      include: {
        lines: { include: { po_line: true; matches: { include: { receipt_line: true } } } };
        purchase_order: { select: { id: true; po_number: true } };
      };
    }>;
    policies: Map<string, ItemPolicy>;
    receiptPostingOn: boolean;
  },
): Promise<{ journalId: string | null; accrualReversed: number; priceVariance: number; note: string }> {
  const { invoice } = ctx;
  const document = `Vendor invoice ${invoice.internal_number} (${invoice.invoice_number})`;
  const total = Number(invoice.total_amount);
  const recoverableTax = Number(invoice.tax_amount);

  // What the receipts actually accrued for these lines, at the cost they were
  // received at — NOT at the invoice price. The difference between the two is
  // exactly the price variance.
  let accrued = 0;
  for (const line of invoice.lines) {
    for (const m of line.matches) {
      accrued += Number(m.quantity) * Number(m.receipt_line.net_unit_cost);
    }
  }
  accrued = Number(accrued.toFixed(2));

  const invoiceNet = Number((total - recoverableTax).toFixed(2));

  if (!ctx.receiptPostingOn) {
    // The tenant is still on the single-voucher behaviour: the receipt already
    // debited inventory and credited AP. Posting again here would double both.
    // Say so rather than silently skipping — a null voucher must never be quiet.
    return {
      journalId: null,
      accrualReversed: 0,
      priceVariance: 0,
      note:
        'No invoice voucher: post_product_receipt_in_ledger is off, so the receipt already posted ' +
        'inventory, recoverable tax and accounts payable in one voucher. This invoice is recorded ' +
        'and matched, but posting it again would double the entry. Switch the parameter on to move ' +
        'this tenant to the separate physical/financial postings.',
    };
  }

  const acc = await resolvePostingAccounts_orExplain(
    ctx.tenantId, ['AP', 'VAT_INPUT', 'PURCHASE_ACCRUAL'] as const,
    { document, partyId: invoice.supplier_id, legalEntityId: ctx.legalEntityId, client: tx },
  );
  if (!acc) {
    return {
      journalId: null, accrualReversed: 0, priceVariance: 0,
      note: 'Invoice voucher skipped — posting profiles unresolved and require_balanced_posting is off.',
    };
  }

  const debits: { account_id: string; debit_amount: number; credit_amount: number; description: string }[] = [];

  if (accrued > 0) {
    debits.push({
      account_id: acc.PURCHASE_ACCRUAL,
      debit_amount: accrued,
      credit_amount: 0,
      description: `Reverse goods received not invoiced — ${invoice.purchase_order?.po_number ?? invoice.internal_number}`,
    });
  }

  // Lines never received — a service, a utility bill, or an invoice line that was
  // not on the order — have no accrual to reverse, so they capitalise or expense
  // here instead.
  const unaccruedLines = invoice.lines.filter(l => l.matches.length === 0);
  if (unaccruedLines.length > 0) {
    const unaccruedGross = Number(unaccruedLines.reduce((s, l) => s + Number(l.line_net_amount), 0).toFixed(2));
    const share = invoiceNet > 0 && total > 0 ? invoiceNet / total : 1;
    const unaccruedNet = Number((unaccruedGross * share).toFixed(2));

    const stocked = unaccruedLines.filter(l => l.product_id && ctx.policies.get(l.product_id)?.stocked !== false);
    const expensed = unaccruedLines.filter(l => !l.product_id || ctx.policies.get(l.product_id)?.stocked === false);

    const stockedGross = stocked.reduce((s, l) => s + Number(l.line_net_amount), 0);
    const expensedGross = expensed.reduce((s, l) => s + Number(l.line_net_amount), 0);
    const scale = unaccruedGross > 0 ? unaccruedNet / unaccruedGross : 0;

    if (stockedGross > 0) {
      const policyMap = new Map(
        stocked
          .filter(l => l.product_id && ctx.policies.get(l.product_id))
          .map(l => [l.product_id!, ctx.policies.get(l.product_id!)!]),
      );
      for (const bucket of groupByItemGroup(
        stocked.filter(l => l.product_id),
        policyMap,
        l => l.product_id!,
        l => Number(l.line_net_amount) * scale,
      )) {
        if (bucket.amount <= 0) continue;
        const inv = await resolvePostingAccounts_orExplain(ctx.tenantId, ['INVENTORY'] as const, {
          document: `${document}${bucket.itemGroupCode ? ` (${bucket.itemGroupCode})` : ''}`,
          partyId: invoice.supplier_id, itemGroupId: bucket.itemGroupId ?? undefined,
          legalEntityId: ctx.legalEntityId, client: tx,
        });
        if (!inv) return { journalId: null, accrualReversed: 0, priceVariance: 0, note: 'Invoice voucher skipped — inventory account unresolved.' };
        debits.push({
          account_id: inv.INVENTORY,
          debit_amount: Number(bucket.amount.toFixed(2)),
          credit_amount: 0,
          description: `Inventory invoiced${bucket.itemGroupCode ? ` [${bucket.itemGroupCode}]` : ''} — ${invoice.invoice_number}`,
        });
      }
    }

    if (expensedGross > 0) {
      const exp = await resolvePostingAccounts_orExplain(ctx.tenantId, ['PURCHASE_EXPENSE'] as const, {
        document: `${document} (not stocked)`, partyId: invoice.supplier_id,
        legalEntityId: ctx.legalEntityId, client: tx,
      });
      if (!exp) return { journalId: null, accrualReversed: 0, priceVariance: 0, note: 'Invoice voucher skipped — expense account unresolved.' };
      debits.push({
        account_id: exp.PURCHASE_EXPENSE,
        debit_amount: Number((expensedGross * scale).toFixed(2)),
        credit_amount: 0,
        description: `Expensed (not stocked) — ${invoice.invoice_number}`,
      });
    }
  }

  if (recoverableTax > 0) {
    debits.push({
      account_id: acc.VAT_INPUT,
      debit_amount: recoverableTax,
      credit_amount: 0,
      description: `Recoverable input tax — factura ${invoice.invoice_number}`,
    });
  }

  // ── Price variance ───────────────────────────────────────────────────────
  // **[OFFICIAL]** the stock variation account is "used when there's a difference
  // in the unit price between product receipt and invoice". Without it the
  // voucher simply would not balance when the supplier bills a different price
  // than the goods were received at.
  const debited = Number(debits.reduce((s, d) => s + d.debit_amount, 0).toFixed(2));
  const variance = Number((total - debited).toFixed(2));

  if (Math.abs(variance) >= 0.01) {
    const pv = await resolvePostingAccounts_orExplain(ctx.tenantId, ['PRICE_VARIANCE'] as const, {
      document, partyId: invoice.supplier_id, legalEntityId: ctx.legalEntityId, client: tx,
    });
    if (!pv) return { journalId: null, accrualReversed: 0, priceVariance: 0, note: 'Invoice voucher skipped — price variance account unresolved.' };
    debits.push({
      account_id: pv.PRICE_VARIANCE,
      debit_amount: variance > 0 ? variance : 0,
      credit_amount: variance < 0 ? -variance : 0,
      description:
        variance > 0
          ? `Invoiced above the received cost — ${invoice.invoice_number}`
          : `Invoiced below the received cost — ${invoice.invoice_number}`,
    });
  }

  const entryNumber = await nextJournalVoucher(ctx.tenantId, tx, ctx.legalEntityId);
  const entry = await tx.journalEntry.create({
    data: {
      tenant_id:     ctx.tenantId,
      entry_number:  entryNumber,
      entry_date:    invoice.posting_date,
      description:   `Vendor invoice: ${invoice.invoice_number} (${invoice.internal_number})`,
      source_module: 'VENDOR_INVOICE',
      source_id:     invoice.id,
      status:        'POSTED',
      posted_at:     new Date(),
      created_by:    ctx.userId,
      lines: {
        create: [
          ...debits.filter(d => d.debit_amount > 0 || d.credit_amount > 0),
          {
            account_id: acc.AP,
            debit_amount: 0,
            credit_amount: total,
            description: `AP — ${invoice.invoice_number}`,
          },
        ],
      },
    },
  });

  return {
    journalId: entry.id,
    accrualReversed: accrued,
    priceVariance: Math.abs(variance) >= 0.01 ? variance : 0,
    note:
      'Financial update posted: accrual reversed, recoverable tax recognised against the factura, ' +
      'payable created.',
  };
}
