import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { logger } from '../logger';
import { AppError } from '../errors/AppError';
import { computeDocumentTax } from './documentTax.service';

/**
 * Factura lines — building them, and keeping them honest against the header.
 *
 * Migration 022 created the table. This is the only place that writes it.
 *
 * ── The rule that shapes everything here ───────────────────────────────────
 * A factura is a legal document that STATES a total. The lines explain that total;
 * they do not redefine it. So `facturas.subtotal / iva_amount / it_amount /
 * total_amount` are never recomputed from lines — instead the lines are built to
 * sum to what the header says, and a mismatch is refused rather than reconciled.
 *
 * The alternative — deriving the header — would let a future schema or rounding
 * change silently restate an already-issued document, which is the one thing a
 * fiscal document must never do.
 *
 * ── [OPEN — NOT VERIFIED] ──────────────────────────────────────────────────
 * Whether Bolivian law REQUIRES line detail on the printed factura is a blocking
 * open question (HANDOVER §7) and is not answered here. It needs the SIN's own
 * normativa, outside this workstream's research scope (CLAUDE.md §5). Lines are
 * built because partial invoicing, per-line tax and credit notes require them
 * regardless. **Nothing in this file is a compliance claim.**
 *
 * ── [OFFICIAL — Ley 843 art. 5] ────────────────────────────────────────────
 * "El impuesto … forma parte integrante del precio neto de la venta … no se
 * mostrará por separado." Under the current Bolivian regime a line's `line_total`
 * is the invoiced amount with the IVA already inside it, and the tax is computed
 * FROM it rather than added TO it. Under a NET regime (Turkey, Germany, Bolivia
 * after Ley 1733) the same code produces the opposite arithmetic, because the
 * decision lives in `TaxCode.base_kind` and not here.
 */

type Client = Prisma.TransactionClient | typeof db;

export interface FacturaLineInput {
  salesOrderLineId?: string | null;
  productId?: string | null;
  variantId?: string | null;
  description: string;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  /** The invoiced amount for the line. Omit and it is quantity × price − discount. */
  lineTotal?: number;
  itemTaxGroupId?: string | null;
  sortOrder?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compute each line's tax and write the lines.
 *
 * Tax is computed PER LINE through the same engine the header uses. For Bolivia the
 * result is identical to computing on the total — one rate applies to everything —
 * and any residual cent from rounding five lines separately is absorbed into the
 * largest line, so the lines still sum to the header exactly.
 *
 * For Turkey or Germany the per-line result is the only correct one, and this is
 * the refactor that S2P_O2C_STATUS listed as "required before Turkey or Germany".
 * The header remains a single-rate summary there, which is a real limitation and is
 * stated in the return value rather than hidden.
 */
export async function writeFacturaLines(
  tenantId: string,
  facturaId: string,
  lines: FacturaLineInput[],
  header: { subtotal: number; ivaAmount: number; itAmount: number; totalAmount: number },
  opts: { customerId?: string | null; client?: Client } = {},
): Promise<{ written: number; multiRate: boolean }> {
  const client = opts.client ?? db;

  if (lines.length === 0) {
    throw new AppError('A factura must have at least one line.', 400, 'FACTURA_NO_LINES');
  }

  // ── 1. Each line's own gross ────────────────────────────────────────────
  const priced = lines.map((l, i) => {
    const gross =
      l.lineTotal !== undefined
        ? round2(l.lineTotal)
        : round2(l.quantity * l.unitPrice * (1 - (l.discountPct ?? 0) / 100));
    return { input: l, gross, index: i };
  });

  const linesGross = round2(priced.reduce((s, p) => s + p.gross, 0));

  // ── 2. The lines must explain the document ──────────────────────────────
  // Refused, not reconciled. A factura whose lines disagree with its total is not a
  // rounding problem to smooth over; it is a caller that built the wrong lines.
  if (Math.abs(linesGross - round2(header.totalAmount)) > 0.02) {
    throw new AppError(
      `Factura lines total ${linesGross.toFixed(2)} but the document states ` +
        `${round2(header.totalAmount).toFixed(2)}. The lines must explain the document, not restate it.`,
      500,
      'FACTURA_LINES_DISAGREE',
    );
  }

  // ── 3. Tax, per line ────────────────────────────────────────────────────
  const computed: Array<{
    p: (typeof priced)[number];
    vat: number;
    turnover: number;
    base: number;
  }> = [];

  for (const p of priced) {
    const tax = await computeDocumentTax(tenantId, p.gross, {
      side: 'SALES',
      partyId: opts.customerId ?? undefined,
      productId: p.input.productId ?? undefined,
      client,
    });
    computed.push({
      p,
      vat: round2(tax.vat),
      turnover: round2(tax.turnover),
      base: round2(tax.subtotal),
    });
  }

  // Did the lines actually resolve to more than one rate? Worth knowing, because a
  // multi-rate factura means the header's single `iva_amount` is a sum and not a
  // rate — which is exactly the condition that makes the header inadequate.
  const rates = new Set(
    computed.filter(c => c.p.gross !== 0).map(c => (c.vat / c.p.gross).toFixed(4)),
  );
  const multiRate = rates.size > 1;

  // ── 4. Absorb the rounding residue ──────────────────────────────────────
  // Five lines taxed separately can differ from one total taxed once by a cent. The
  // header is the document, so the difference goes onto the largest line rather
  // than being left to make the two disagree.
  const adjust = (key: 'vat' | 'turnover', target: number) => {
    const sum = round2(computed.reduce((s, c) => s + c[key], 0));
    const diff = round2(target - sum);
    if (diff === 0) return;
    if (Math.abs(diff) > 0.05 * Math.max(1, Math.abs(target))) {
      logger.warn(
        { tenantId, facturaId, key, sum, target, diff },
        'Per-line tax differs materially from the header — not a rounding residue',
      );
    }
    const biggest = computed.reduce((a, b) => (Math.abs(b.p.gross) > Math.abs(a.p.gross) ? b : a));
    biggest[key] = round2(biggest[key] + diff);
  };
  adjust('vat', round2(header.ivaAmount));
  adjust('turnover', round2(header.itAmount));

  // ── 5. Write ────────────────────────────────────────────────────────────
  await client.facturaLine.createMany({
    data: computed.map(c => ({
      tenant_id: tenantId,
      factura_id: facturaId,
      sales_order_line_id: c.p.input.salesOrderLineId ?? null,
      product_id: c.p.input.productId ?? null,
      variant_id: c.p.input.variantId ?? null,
      description: c.p.input.description,
      sku: c.p.input.sku ?? null,
      quantity: c.p.input.quantity,
      unit_price: c.p.input.unitPrice,
      discount_pct: c.p.input.discountPct ?? 0,
      line_total: c.p.gross,
      item_tax_group_id: c.p.input.itemTaxGroupId ?? null,
      tax_base: c.base,
      tax_amount: round2(c.vat + c.turnover),
      vat_amount: c.vat,
      turnover_amount: c.turnover,
      sort_order: c.p.input.sortOrder ?? c.p.index,
    })),
  });

  if (multiRate) {
    logger.info(
      { tenantId, facturaId, rates: [...rates] },
      'Factura carries more than one tax rate — the header totals are a sum, not a rate. ' +
        'Correct in the lines; the printed header cannot express it.',
    );
  }

  return { written: computed.length, multiRate };
}

/**
 * Build factura lines from a sales order, invoicing only what is not yet invoiced.
 *
 * This is what makes partial invoicing possible: `invoiced_qty` on the order line
 * is the accumulator, the same one `PurchaseOrderLine` has carried since migration
 * 010. An order half delivered can now be half invoiced, and the second invoice
 * knows what the first one took.
 */
export async function linesFromSalesOrder(
  tenantId: string,
  orderId: string,
  opts: { client?: Client; onlyUninvoiced?: boolean } = {},
): Promise<FacturaLineInput[]> {
  const client = opts.client ?? db;
  const onlyUninvoiced = opts.onlyUninvoiced ?? true;

  const order = await client.salesOrder.findFirst({
    where: { id: orderId, tenant_id: tenantId },
    include: {
      lines: {
        include: {
          product: { select: { name: true, sku: true, item_tax_group_id: true } },
          variant: { select: { sku_variant: true } },
        },
        orderBy: { sort_order: 'asc' },
      },
    },
  });
  if (!order) throw new AppError(`Sales order ${orderId} not found.`, 404, 'ORDER_NOT_FOUND');

  const out: FacturaLineInput[] = [];
  for (const [i, l] of order.lines.entries()) {
    const remaining = onlyUninvoiced ? Number(l.quantity) - Number(l.invoiced_qty) : Number(l.quantity);
    if (remaining <= 0) continue;

    out.push({
      salesOrderLineId: l.id,
      productId: l.product_id,
      variantId: l.variant_id,
      // Snapshot. The variant's SKU is included because for a shoe retailer the
      // size IS the identity of what was sold, and a line reading only "Sneaker"
      // does not describe the goods.
      description: l.variant?.sku_variant ? `${l.product.name} (${l.variant.sku_variant})` : l.product.name,
      sku: l.variant?.sku_variant ?? l.product.sku,
      quantity: remaining,
      unitPrice: Number(l.unit_price),
      discountPct: Number(l.discount_pct),
      lineTotal: round2(remaining * Number(l.unit_price) * (1 - Number(l.discount_pct) / 100)),
      itemTaxGroupId: l.item_tax_group_id ?? l.product.item_tax_group_id ?? null,
      sortOrder: i,
    });
  }

  return out;
}

/** Advance `invoiced_qty` for the lines an issued factura covered. */
export async function markInvoiced(
  facturaId: string,
  client: Client = db,
): Promise<void> {
  const lines = await client.facturaLine.findMany({
    where: { factura_id: facturaId, sales_order_line_id: { not: null } },
    select: { sales_order_line_id: true, quantity: true },
  });

  for (const l of lines) {
    await client.salesOrderLine.update({
      where: { id: l.sales_order_line_id! },
      data: { invoiced_qty: { increment: l.quantity } },
    });
  }
}
