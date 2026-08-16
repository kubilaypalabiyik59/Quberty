import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { logger } from '../../shared/logger';
import { allocateNumber } from '../../shared/services/numberSequence.service';
import { computeDocumentTax } from '../../shared/services/documentTax.service';
import { nextSalesOrderNumber } from '../../shared/utils/orderCounter';
import { convertLeadToCustomer } from '../crm/crm.service';
import {
  QUOTATION_STATUS,
  QUOTATION_OPEN_STATUSES,
  OPPORTUNITY_STATUS,
  SALES_SOURCE_DOCUMENT,
  type QuotationStatus,
} from '../../shared/services/documentChain';

/**
 * Sales quotations — the last document before the order, and the join between
 * Prospect to Quote (85) and Order to Cash (65).
 *
 * ── The money convention, inherited deliberately ───────────────────────────
 * `SalesOrder` stores GROSS line totals in its `subtotal` column and derives
 * `tax_amount` by DECOMPOSING that figure, because Bolivian IVA is quoted inside
 * the price. The column name says "subtotal" and holds a gross amount; that is
 * confusing and it is not fixed here.
 *
 * It is not fixed here because a quotation whose totals are computed differently
 * from the order it becomes would produce a price change at confirmation —
 * a customer accepting Bs 1 299,00 and being invoiced something else. Matching
 * the order exactly is worth more than better naming in one new table. Renaming
 * both, together, is a separate change.
 *
 * ── No general ledger ──────────────────────────────────────────────────────
 * Nothing in this file posts. A quotation is an offer; offers do not hit the
 * books. The first accounting event is still the factura.
 */

export interface QuotationLineInput {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  unit_price: number;
  discount_pct?: number;
  notes?: string | null;
}

export interface CreateQuotationInput {
  customer_id?: string | null;
  lead_id?: string | null;
  opportunity_id?: string | null;
  site_id?: string | null;
  warehouse_id?: string | null;
  currency?: string;
  discount_amount?: number;
  valid_until?: string | null;
  notes?: string | null;
  lines: QuotationLineInput[];
}

/** Gross line total, with the same rounding the order path uses. */
function lineTotal(l: QuotationLineInput): number {
  return Number(
    (Number(l.quantity) * Number(l.unit_price) * (1 - (l.discount_pct ?? 0) / 100)).toFixed(2),
  );
}

/**
 * Compute the header money for a set of lines, exactly as `SalesService.createOrder`
 * does, so a quotation and the order it becomes agree to the cent.
 */
async function computeTotals(
  tenantId: string,
  lines: QuotationLineInput[],
  partyId: string | null,
  discountAmount: number,
  client: Prisma.TransactionClient | typeof db = db,
) {
  const subtotal = Number(lines.reduce((s, l) => s + lineTotal(l), 0).toFixed(2));
  const tax = await computeDocumentTax(tenantId, subtotal, { partyId, client });
  return {
    subtotal,
    tax_amount: tax.vat,
    total_amount: Number((subtotal - discountAmount).toFixed(2)),
  };
}

async function validityDays(tenantId: string): Promise<number> {
  const params = await db.salesParameters.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: null },
    select: { quotation_validity_days: true },
  });
  return params?.quotation_validity_days ?? 30;
}

export async function createQuotation(
  tenantId: string,
  input: CreateQuotationInput,
  createdBy: string,
) {
  if (!input.lines?.length) throw new AppError('A quotation must have at least one line', 400);

  const parties = [input.customer_id, input.lead_id].filter(Boolean).length;
  if (parties !== 1) {
    throw new AppError(
      'A quotation needs exactly one party: either customer_id or lead_id, not both and not neither.',
      400,
    );
  }

  const params = await db.salesParameters.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: null },
    select: { require_opportunity_for_quotation: true, quotation_validity_days: true },
  });
  if (params?.require_opportunity_for_quotation && !input.opportunity_id) {
    throw new AppError(
      'This tenant requires every quotation to belong to an opportunity ' +
        '(SalesParameters.require_opportunity_for_quotation).',
      400,
    );
  }

  // Referential checks before the number is burned, so a bad request does not
  // leave a gap in the series.
  if (input.customer_id) {
    const c = await db.customer.findFirst({ where: { id: input.customer_id, tenant_id: tenantId }, select: { id: true } });
    if (!c) throw new AppError('Customer not found', 404);
  }
  if (input.lead_id) {
    const l = await db.lead.findFirst({ where: { id: input.lead_id, tenant_id: tenantId }, select: { id: true } });
    if (!l) throw new AppError('Lead not found', 404);
  }
  if (input.opportunity_id) {
    const o = await db.opportunity.findFirst({
      where: { id: input.opportunity_id, tenant_id: tenantId },
      select: { id: true, status: true, opportunity_number: true },
    });
    if (!o) throw new AppError('Opportunity not found', 404);
    if (o.status !== OPPORTUNITY_STATUS.OPEN) {
      throw new AppError(`Opportunity ${o.opportunity_number} is ${o.status}; cannot quote against it.`, 409);
    }
  }

  const discount = Number(input.discount_amount ?? 0);
  const totals = await computeTotals(tenantId, input.lines, input.customer_id ?? null, discount);
  const quotation_number = await allocateNumber({ tenantId, reference: 'SALES_QUOTATION' });

  const validUntil = input.valid_until
    ? new Date(input.valid_until)
    : new Date(Date.now() + (params?.quotation_validity_days ?? 30) * 86_400_000);

  return db.salesQuotation.create({
    data: {
      tenant_id: tenantId,
      quotation_number,
      customer_id: input.customer_id ?? null,
      lead_id: input.lead_id ?? null,
      opportunity_id: input.opportunity_id ?? null,
      site_id: input.site_id ?? null,
      warehouse_id: input.warehouse_id ?? null,
      currency: input.currency ?? 'BOB',
      discount_amount: discount,
      valid_until: validUntil,
      notes: input.notes ?? null,
      created_by: createdBy,
      ...totals,
      lines: {
        create: input.lines.map((l, i) => ({
          product_id: l.product_id,
          variant_id: l.variant_id ?? null,
          quantity: l.quantity,
          unit_price: l.unit_price,
          discount_pct: l.discount_pct ?? 0,
          line_total: lineTotal(l),
          sort_order: i,
          notes: l.notes ?? null,
        })),
      },
    },
    include: { lines: true, customer: true, lead: true, opportunity: true },
  });
}

/** Replace the lines of an editable quotation and recompute the header. */
export async function updateQuotationLines(
  tenantId: string,
  quotationId: string,
  lines: QuotationLineInput[],
  discountAmount?: number,
) {
  const q = await getEditable(tenantId, quotationId);
  if (!lines.length) throw new AppError('A quotation must have at least one line', 400);

  const discount = discountAmount ?? Number(q.discount_amount);
  const totals = await computeTotals(tenantId, lines, q.customer_id, discount);

  return db.$transaction(async (tx) => {
    await tx.salesQuotationLine.deleteMany({ where: { quotation_id: q.id } });
    await tx.salesQuotationLine.createMany({
      data: lines.map((l, i) => ({
        quotation_id: q.id,
        product_id: l.product_id,
        variant_id: l.variant_id ?? null,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount_pct: l.discount_pct ?? 0,
        line_total: lineTotal(l),
        sort_order: i,
        notes: l.notes ?? null,
      })),
    });
    return tx.salesQuotation.update({
      where: { id: q.id },
      data: { ...totals, discount_amount: discount },
      include: { lines: true },
    });
  });
}

async function getEditable(tenantId: string, quotationId: string) {
  const q = await db.salesQuotation.findFirst({ where: { id: quotationId, tenant_id: tenantId } });
  if (!q) throw new AppError('Quotation not found', 404);
  if (!QUOTATION_OPEN_STATUSES.includes(q.status as QuotationStatus)) {
    throw new AppError(
      `Quotation ${q.quotation_number} is ${q.status} and is read-only. ` +
        `Create a revision instead.`,
      409,
    );
  }
  return q;
}

/** DRAFT → SENT. */
export async function sendQuotation(tenantId: string, quotationId: string) {
  const q = await db.salesQuotation.findFirst({ where: { id: quotationId, tenant_id: tenantId } });
  if (!q) throw new AppError('Quotation not found', 404);
  if (q.status !== QUOTATION_STATUS.DRAFT) {
    throw new AppError(`Only a DRAFT quotation can be sent; ${q.quotation_number} is ${q.status}.`, 409);
  }

  const validUntil = q.valid_until ?? new Date(Date.now() + (await validityDays(tenantId)) * 86_400_000);

  return db.salesQuotation.update({
    where: { id: q.id },
    data: { status: QUOTATION_STATUS.SENT, sent_at: new Date(), valid_until: validUntil },
  });
}

/**
 * Revise: copy the quotation into a new row and retire the old one.
 *
 * D365 has a `Revised` status for the same reason posting profiles are date
 * effective — what was offered on a given day has to stay recoverable after the
 * offer changes. Editing in place would destroy it.
 */
export async function reviseQuotation(tenantId: string, quotationId: string, createdBy: string) {
  const q = await db.salesQuotation.findFirst({
    where: { id: quotationId, tenant_id: tenantId },
    include: { lines: { orderBy: { sort_order: 'asc' } } },
  });
  if (!q) throw new AppError('Quotation not found', 404);
  if (q.status === QUOTATION_STATUS.CONFIRMED) {
    throw new AppError(
      `Quotation ${q.quotation_number} is already confirmed as order — revise the order instead.`,
      409,
    );
  }
  if (q.status === QUOTATION_STATUS.REVISED) {
    throw new AppError(`Quotation ${q.quotation_number} has already been revised.`, 409);
  }

  const quotation_number = await allocateNumber({ tenantId, reference: 'SALES_QUOTATION' });

  return db.$transaction(async (tx) => {
    const copy = await tx.salesQuotation.create({
      data: {
        tenant_id: tenantId,
        quotation_number,
        customer_id: q.customer_id,
        lead_id: q.lead_id,
        opportunity_id: q.opportunity_id,
        site_id: q.site_id,
        warehouse_id: q.warehouse_id,
        currency: q.currency,
        subtotal: q.subtotal,
        discount_amount: q.discount_amount,
        tax_amount: q.tax_amount,
        total_amount: q.total_amount,
        notes: q.notes,
        valid_until: q.valid_until,
        revision: q.revision + 1,
        revised_from_id: q.id,
        created_by: createdBy,
        lines: {
          create: q.lines.map((l) => ({
            product_id: l.product_id,
            variant_id: l.variant_id,
            quantity: l.quantity,
            unit_price: l.unit_price,
            discount_pct: l.discount_pct,
            line_total: l.line_total,
            item_tax_group_id: l.item_tax_group_id,
            sort_order: l.sort_order,
            notes: l.notes,
          })),
        },
      },
      include: { lines: true },
    });

    await tx.salesQuotation.update({
      where: { id: q.id },
      data: { status: QUOTATION_STATUS.REVISED, closed_at: new Date() },
    });

    return copy;
  });
}

/**
 * Confirm a quotation and create the sales order.
 *
 * **[OFFICIAL]** "A sales order is created in Supply Chain Management from the
 * quotation confirmation… Supply Chain Management links the new sales order to
 * the related sales quotation, so that users can navigate between them" and the
 * quotation becomes read-only.
 * learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/data-entities/add-efficiency-in-quote-to-cash-concept
 *
 * The order is created in DRAFT, exactly as `POST /sales/orders` creates one, so
 * every existing downstream step — confirm, reserve, wave, ship, invoice, pay —
 * behaves identically whether the order came from a quotation or not. That is
 * the point: this adds a way IN to the order, it does not add a second order
 * lifecycle.
 */
export async function confirmQuotation(tenantId: string, quotationId: string, userId: string) {
  const q = await db.salesQuotation.findFirst({
    where: { id: quotationId, tenant_id: tenantId },
    include: { lines: { orderBy: { sort_order: 'asc' } }, lead: true },
  });
  if (!q) throw new AppError('Quotation not found', 404);
  if (q.status === QUOTATION_STATUS.CONFIRMED) {
    throw new AppError(`Quotation ${q.quotation_number} is already confirmed.`, 409);
  }
  if (!QUOTATION_OPEN_STATUSES.includes(q.status as QuotationStatus)) {
    throw new AppError(`Quotation ${q.quotation_number} is ${q.status} and cannot be confirmed.`, 409);
  }
  if (!q.lines.length) throw new AppError('Quotation has no lines', 400);

  // `SalesOrderLine.quantity` is an Int while a quotation line is Decimal(12,2).
  // Refuse rather than truncate: silently turning 2.5 pairs into 2 is exactly the
  // class of quiet data damage this codebase has already paid for once.
  const fractional = q.lines.filter((l) => !Number.isInteger(Number(l.quantity)));
  if (fractional.length) {
    throw new AppError(
      `Cannot convert quotation ${q.quotation_number}: sales order lines hold whole quantities only, ` +
        `but ${fractional.length} line(s) have fractional quantities ` +
        `(${fractional.map((l) => Number(l.quantity)).join(', ')}). Adjust the quotation first.`,
      400,
    );
  }

  const params = await db.salesParameters.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: null },
    select: { auto_convert_lead_on_confirm: true },
  });

  // A quotation raised for a LEAD has no customer to invoice. D365 requires an
  // explicit "Convert to customer" first; we do it automatically unless the
  // tenant has asked to keep master-data creation deliberate.
  let customerId = q.customer_id;
  if (!customerId && q.lead_id) {
    if (params?.auto_convert_lead_on_confirm === false) {
      throw new AppError(
        `Quotation ${q.quotation_number} is addressed to lead ${q.lead?.lead_number}. ` +
          `Convert the lead to a customer first (auto_convert_lead_on_confirm is off).`,
        409,
      );
    }
    const customer = await convertLeadToCustomer(tenantId, q.lead_id);
    customerId = customer.id;
    logger.info(
      { tenantId, quotation: q.quotation_number, lead: q.lead?.lead_number, customer: customer.code },
      'Lead converted to customer on quotation confirmation',
    );
  }

  const orderNumber = await nextSalesOrderNumber(tenantId);

  return db.$transaction(async (tx) => {
    const order = await tx.salesOrder.create({
      data: {
        tenant_id: tenantId,
        order_number: orderNumber,
        customer_id: customerId,
        source: 'manual',
        status: 'DRAFT',
        site_id: q.site_id,
        warehouse_id: q.warehouse_id,
        currency: q.currency,
        subtotal: q.subtotal,
        discount_amount: q.discount_amount,
        tax_amount: q.tax_amount,
        total_amount: q.total_amount,
        notes: q.notes,
        created_by: userId,
        // The provenance pair. `source` above is the CHANNEL and stays 'manual';
        // these two are the DOCUMENT it came from. Different axes — see the
        // comment on SalesOrder.source_document_type.
        source_document_type: SALES_SOURCE_DOCUMENT.QUOTATION,
        source_document_id: q.id,
        lines: {
          create: q.lines.map((l) => ({
            product_id: l.product_id,
            variant_id: l.variant_id,
            quantity: Number(l.quantity),
            unit_price: l.unit_price,
            discount_pct: l.discount_pct,
            line_total: l.line_total,
            item_tax_group_id: l.item_tax_group_id,
            sort_order: l.sort_order,
            // Line-level provenance, so partial conversion stays reconstructable.
            source_line_id: l.id,
          })),
        },
      },
      include: { lines: true },
    });

    await tx.salesQuotation.update({
      where: { id: q.id },
      data: {
        status: QUOTATION_STATUS.CONFIRMED,
        confirmed_at: new Date(),
        closed_at: new Date(),
        converted_order_id: order.id,
      },
    });

    // Confirming the offer wins the deal. D365 marks the quotation Won at the
    // same moment; the opportunity is our equivalent of that outcome.
    if (q.opportunity_id) {
      await tx.opportunity.updateMany({
        where: { id: q.opportunity_id, tenant_id: tenantId, status: OPPORTUNITY_STATUS.OPEN },
        data: {
          status: OPPORTUNITY_STATUS.WON,
          probability: 100,
          closed_at: new Date(),
          outcome_reason: `Quotation ${q.quotation_number} confirmed as order ${order.order_number}`,
        },
      });
    }

    if (q.lead_id) {
      await tx.lead.updateMany({
        where: { id: q.lead_id, tenant_id: tenantId, status: 'OPEN' },
        data: { status: 'QUALIFIED', qualified_at: new Date(), converted_customer_id: customerId },
      });
    }

    return { quotation_id: q.id, quotation_number: q.quotation_number, order };
  });
}

/** Close a quotation without an order. */
export async function closeQuotation(
  tenantId: string,
  quotationId: string,
  outcome: 'LOST' | 'CANCELLED',
  reason?: string,
) {
  const q = await db.salesQuotation.findFirst({ where: { id: quotationId, tenant_id: tenantId } });
  if (!q) throw new AppError('Quotation not found', 404);
  if (q.status === QUOTATION_STATUS.CONFIRMED) {
    throw new AppError(`Quotation ${q.quotation_number} became an order and cannot be closed.`, 409);
  }

  return db.salesQuotation.update({
    where: { id: q.id },
    data: { status: outcome, closed_at: new Date(), outcome_reason: reason ?? null },
  });
}

/**
 * Mark SENT quotations past their validity date as EXPIRED.
 *
 * Called on list requests rather than by a scheduler: this product has no job
 * runner, and inventing one for a status sweep would be a heavier dependency
 * than the problem deserves. The trade-off is that expiry is observed when
 * somebody looks, which for an offer is soon enough.
 */
export async function expireOverdueQuotations(tenantId: string): Promise<number> {
  const { count } = await db.salesQuotation.updateMany({
    where: {
      tenant_id: tenantId,
      status: QUOTATION_STATUS.SENT,
      valid_until: { lt: new Date(new Date().toDateString()) },
    },
    data: { status: QUOTATION_STATUS.EXPIRED, closed_at: new Date() },
  });
  if (count > 0) logger.info({ tenantId, count }, 'Quotations expired past their validity date');
  return count;
}
