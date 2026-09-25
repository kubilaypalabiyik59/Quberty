import { Hono }    from 'hono';
import { SalesService, postIssueCogs } from './sales.service';
import { restoreIssues } from '../../shared/services/stockLedger.service';
import { AppError } from '../../shared/errors/AppError';
import { db }       from '../../infrastructure/database/client';

import { validate }    from '../../shared/middleware/validate';
import { ok, created, message } from '../../shared/response';
import { CreateSalesOrderSchema, InvoiceOrderSchema, PayOrderSchema, ReturnSalesOrderSchema, StorefrontOrderSchema } from '../../shared/schemas';
import type { z } from 'zod';
import { nextSalesOrderNumber } from '../../shared/utils/orderCounter';
import { nextFacturaNumber } from '../../shared/services/numberSequence.service';
import { computeDocumentTax } from '../../shared/services/documentTax.service';
import { postJournal } from '../../shared/services/journal.service';
import { contextForSalesOrder } from '../../shared/services/dimension.service';
import { writeFacturaLines, linesFromSalesOrder, markInvoiced } from '../../shared/services/facturaLine.service';
import { resolvePostingAccounts_orExplain } from '../../shared/services/posting.service';
import { resolveItemPolicies, groupByItemGroup } from '../../shared/services/itemPolicy.service';
import { resolveInventoryDimensions } from '../../shared/services/inventoryDimension.service';
import { assertTenantReferences } from '../../shared/services/tenantReference.service';
import { logger } from '../../shared/logger';
import { physicalStatusFor } from '../../shared/services/inventoryTransactionStatus';
import { assertDocumentCurrencySupported } from '../../shared/services/currency/documentCurrency';
import { routeGuard, type RouteGuards } from '../../shared/middleware/permissions';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

/**
 * The permission each route requires (WORK-030a). Exported so a test can pin the
 * map and prove every route in this file has exactly one entry; the guard is the
 * first middleware, so a denial happens before validation and before the database.
 */
export const SALES_ORDER_ROUTE_PERMISSIONS = Object.freeze({
  'GET /': ['sales.order.read'],
  'POST /': ['sales.order.create'],
  'POST /storefront': ['storefront.order.place'],
  'GET /:id': ['sales.order.read'],
  'POST /:id/invoice': ['sales.invoice.post'],
  'POST /:id/pay': ['sales.customer_payment.post'],
  'PUT /:id': ['sales.order.update'],
  'POST /:id/confirm': ['sales.order.confirm'],
  'POST /:id/ship': ['sales.order.ship'],
  'POST /:id/complete': ['sales.order.complete'],
  'POST /:id/cancel': ['sales.order.cancel'],
  'POST /:id/return': ['sales.return.post'],
} satisfies RouteGuards);

const guard = routeGuard(SALES_ORDER_ROUTE_PERMISSIONS);

const salesService = new SalesService();

// The local `factura_counters` allocator that used to live here is gone. It was
// one of three near-copies (sales, finance, POS) that disagreed about seeding and
// all allocated before the writing transaction, so a rollback burned a legal
// number. `nextFacturaNumber` from the number sequence service replaces all
// three; see migration 023.

app.get('/', guard('GET /'), async (c) => {
  const data = await salesService.getOrders(c.get('tenantId'), c.req.query() as any);
  return ok(c, data);
});

app.post('/', guard('POST /'), validate(CreateSalesOrderSchema), async (c) => {
  const order = await salesService.createOrder(c.get('tenantId'), c.get('body') as any, c.get('user').id);
  return created(c, order);
});

/**
 * A shopper's checkout (WORK-043, with the price half of D-15).
 *
 * The body names products and quantities only. Price, discount, warehouse and
 * currency are refused by the strict schema: the catalogue sets the price, the
 * sales parameters set the warehouse, the ledger sets the currency. The order is
 * created and then confirmed — its stock is RESERVED in the storefront warehouse,
 * not deducted — so shipping it issues exactly what checkout held, once, and
 * cancelling it frees exactly that.
 */
app.post('/storefront', guard('POST /storefront'), validate(StorefrontOrderSchema), async (c) => {
  const body = c.get('body') as z.infer<typeof StorefrontOrderSchema>;
  const tenantId = c.get('tenantId');
  const userId = c.get('user').id;

  const customer = await db.customer.findFirst({
    where: { user_id: userId, tenant_id: tenantId },
    select: { id: true },
  });

  // The storefront warehouse is a sales parameter; without one, the tenant's
  // default or only warehouse. Never the shopper's choice.
  const params = await db.salesParameters.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: null },
    select: { storefront_warehouse_id: true },
  });
  const dims = await resolveInventoryDimensions(tenantId, {
    warehouseId: params?.storefront_warehouse_id ?? null,
    documentKind: 'storefront order',
  });
  if (!dims.warehouse_id) {
    throw new AppError('No warehouse is configured for storefront orders', 422, 'STOREFRONT_WAREHOUSE_REQUIRED');
  }

  const productIds = [...new Set(body.lines.map((l) => l.product_id))];
  const variantIds = [...new Set(body.lines.map((l) => l.variant_id).filter((v): v is string => !!v))];
  const [products, variants] = await Promise.all([
    db.product.findMany({
      where: { tenant_id: tenantId, id: { in: productIds }, is_active: true, is_published: true },
      select: { id: true, selling_price: true, sale_price: true },
    }),
    variantIds.length
      ? db.productVariant.findMany({
          where: { tenant_id: tenantId, id: { in: variantIds }, is_active: true },
          select: { id: true, product_id: true, additional_cost: true },
        })
      : Promise.resolve([] as Array<{ id: string; product_id: string; additional_cost: any }>),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const unsellable: string[] = [];
  const lines = body.lines.map((l, i) => {
    const product = productById.get(l.product_id);
    const variant = l.variant_id ? variantById.get(l.variant_id) : null;
    if (!product || (l.variant_id && (!variant || variant.product_id !== l.product_id))) {
      unsellable.push(`lines[${i}]`);
      return null;
    }
    // The shop shows the sale price when there is one, and a variant surcharge on
    // top — the same price the product page displays.
    const base = Number(product.sale_price ?? product.selling_price);
    return {
      product_id: l.product_id,
      variant_id: l.variant_id ?? undefined,
      quantity: l.quantity,
      unit_price: base + Number(variant?.additional_cost ?? 0),
    };
  });
  if (unsellable.length) {
    throw new AppError(
      `Not available in the shop: ${unsellable.join(', ')}. A product must be active and published.`,
      422,
      'PRODUCT_NOT_SELLABLE',
    );
  }

  const order = await salesService.createOrder(
    tenantId,
    {
      source: 'storefront',
      customer_id: customer?.id ?? undefined,
      warehouse_id: dims.warehouse_id,
      shipping_address: body.shipping_address,
      notes: body.notes,
      lines: lines as any,
    },
    userId,
  );

  try {
    await salesService.confirmOrder(tenantId, order.id, userId);
  } catch (err) {
    // Nothing was held; close the draft so it does not linger as a phantom order.
    await db.salesOrder.updateMany({
      where: { id: order.id, tenant_id: tenantId, status: 'DRAFT' },
      data: { status: 'CANCELLED', notes: 'Checkout could not reserve stock' },
    });
    throw err;
  }

  return created(c, { id: order.id, order_number: order.order_number });
});

app.get('/:id', guard('GET /:id'), async (c) => {
  const order = await db.salesOrder.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: {
      customer: true,
      lines: {
        include: { product: { select: { name: true, sku: true, images: true } } },
        orderBy: { sort_order: 'asc' },
      },
    },
  });
  if (!order) throw new AppError('Order not found', 404);

  // Attach factura if invoiced
  let factura = null;
  if (order.invoice_id) {
    factura = await db.factura.findFirst({ where: { id: order.invoice_id, tenant_id: c.get('tenantId') } });
  }

  return ok(c, { ...order, factura });
});

// Create invoice (Factura) from a sales order
app.post('/:id/invoice', guard('POST /:id/invoice'), validate(InvoiceOrderSchema), async (c) => {
  const order = await db.salesOrder.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: { customer: true },
  });
  if (!order) throw new AppError('Order not found', 404);
  if (order.invoice_id) throw new AppError('This order already has an invoice', 409);
  if (['DRAFT', 'CANCELLED'].includes(order.status)) {
    throw new AppError(`Cannot invoice an order in ${order.status} status. Confirm it first.`, 400);
  }

  // The factura and its voucher are stated in the order's currency, which is only
  // an accounting-currency amount when the two are the same. Refused before the
  // FACTURA number is drawn, so a refusal never spends a legal number (WORK-025).
  await assertDocumentCurrencySupported(c.get('tenantId'), order.currency, {
    errorCode: 'SALES_FX_NOT_IMPLEMENTED',
    capability: 'Sales invoices',
  });

  // [OFFICIAL] "Deduction requirements" prevents posting a sales invoice before
  // the packing slip is posted. Here the shipment IS the packing slip.
  {
    const lines = await db.salesOrderLine.findMany({
      where: { order_id: order.id },
      select: { product_id: true },
    });
    const gatePolicies = await resolveItemPolicies(c.get('tenantId'), lines.map((l) => l.product_id));
    const needDeduction = lines.filter((l) => gatePolicies.get(l.product_id)?.deductionRequirements);
    if (needDeduction.length > 0 && !order.shipped_at) {
      throw new AppError(
        `${needDeduction.length} line(s) require the packing slip to be posted before this order ` +
          `can be invoiced. Ship ${order.order_number} first.`,
        409,
        'DEDUCTION_REQUIRED',
      );
    }
  }

  const { customer_nit, notes, factura_number: manualFacturaNumber } = c.get('body');

  const shippingAddr = order.shipping_address as any;
  const customerName =
    order.customer
      ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
      : shippingAddr?.name ?? 'Cliente Mostrador';

  // Lines and their item-group policy, resolved before the transaction so the
  // revenue split can be computed inside it without extra round trips.
  const orderLines = await db.salesOrderLine.findMany({
    where: { order_id: order.id },
    select: { product_id: true, line_total: true },
  });
  const linePolicies = await resolveItemPolicies(
    c.get('tenantId'),
    orderLines.map((l) => l.product_id),
  );

  const total = Number(order.total_amount);
  // Tax from the configured engine — tax group (customer) ∩ item tax group.
  // For Bolivia this yields exactly what config/tax.ts yielded; there is a test
  // asserting that equivalence across the real amounts in the database.
  const docTax = await computeDocumentTax(c.get('tenantId'), total, {
    partyId: order.customer_id ?? null, legacyConfig: c.get('taxConfig'),
  });
  const { subtotal, vat: ivaAmount, turnover: itAmount } = docTax;

  // GL accounts come from posting profiles, never from account-code literals.
  // See shared/services/posting.ts for why, and for what happens when they are
  // unresolved (it is no longer a silent skip).
  const acc = await resolvePostingAccounts_orExplain(
    c.get('tenantId'),
    ['AR', 'TAX_TURNOVER_EXPENSE', 'REVENUE', 'VAT_OUTPUT', 'TAX_TURNOVER_PAYABLE'] as const,
    { document: `Sales invoice for ${order.order_number}`, partyId: order.customer_id ?? null },
  );

  const factura = await db.$transaction(async (tx) => {
    // Allocated INSIDE the transaction. The FACTURA series is continuous, so the
    // row lock has to be held until this commits — otherwise a failure below
    // (posting profile unresolved, stock gone) would leave a hole in a legally
    // sequential series. This is the whole reason `allocateNumber` refuses to
    // allocate a continuous sequence without a transaction client.
    const facturaNumber = await nextFacturaNumber(c.get('tenantId'), tx, {
      manualNumber: manualFacturaNumber,
    });

    const f = await tx.factura.create({
      data: {
        tenant_id:      c.get('tenantId'),
        factura_number: facturaNumber,
        source_type:    'SALE',
        source_id:      order.id,
        customer_name:  customerName,
        customer_nit:   customer_nit || (order.customer as any)?.nit || null,
        invoice_date:   new Date(),
        subtotal,
        iva_amount:     ivaAmount,
        it_amount:      itAmount,
        total_amount:   total,
        notes:          notes || `Factura por Orden de Venta ${order.order_number}`,
        created_by:     c.get('user').id,
      },
    });

    // The factura now says WHAT it invoiced, not only how much. Until migration 022
    // this document was header-only, which made partial invoicing, per-line tax and
    // a credit note that names what it credits all impossible.
    const facturaLines = await linesFromSalesOrder(c.get('tenantId'), order.id, {
      client: tx,
      // Everything not yet invoiced. On a first invoice that is the whole order,
      // which is why this changes nothing for the existing flow.
      onlyUninvoiced: true,
    });
    await writeFacturaLines(
      c.get('tenantId'),
      f.id,
      facturaLines,
      { subtotal, ivaAmount, itAmount, totalAmount: total },
      { customerId: order.customer_id ?? null, client: tx },
    );
    await markInvoiced(f.id, tx);

    await tx.salesOrder.update({ where: { id: order.id }, data: { invoice_id: f.id } });

    // ── Auto GL Journal Entry ────────────────────────────────────────────────
    if (acc) {
      // Revenue is split by item group.
      //
      // [OFFICIAL] revenue posting is determined by the combination of the party
      // group and the item group, so two products in different item groups can
      // legitimately credit different revenue accounts. AR and the taxes are
      // party- or tax-driven and stay single lines.
      // learn.microsoft.com/dynamics365/business-central/finance-posting-groups
      const revenueTotal = Number(f.subtotal);
      const grossTotal = orderLines.reduce((sTotal, l) => sTotal + Number(l.line_total), 0);
      const revenueBuckets = groupByItemGroup(
        orderLines,
        linePolicies,
        (l) => l.product_id,
        // Apportion the NET revenue across lines by their share of the gross, so
        // the credits always add back to `f.subtotal`.
        (l) => (grossTotal > 0 ? (Number(l.line_total) / grossTotal) * revenueTotal : 0),
      ).filter((b) => b.amount > 0);

      const revenueLines: { account_id: string; debit_amount: number; credit_amount: number; description: string }[] = [];
      for (const b of revenueBuckets) {
        const bucketAcc = await resolvePostingAccounts_orExplain(
          c.get('tenantId'), ['REVENUE'] as const,
          {
            document: `Sales invoice for ${order.order_number}${b.itemGroupCode ? ` (${b.itemGroupCode})` : ''}`,
            partyId: order.customer_id ?? null,
            itemGroupId: b.itemGroupId ?? undefined,
            client: tx,
          },
        );
        if (bucketAcc) {
          revenueLines.push({
            account_id: bucketAcc.REVENUE,
            debit_amount: 0,
            credit_amount: b.amount,
            description: `Revenue${b.itemGroupCode ? ` [${b.itemGroupCode}]` : ''} — ${order.order_number}`,
          });
        }
      }

      // Rounding guard — apportioning can leave a cent, and an unbalanced
      // journal is worse than a cent in the wrong bucket.
      const credited = Number(revenueLines.reduce((sTotal, l) => sTotal + l.credit_amount, 0).toFixed(2));
      if (revenueLines.length > 0 && credited !== revenueTotal) {
        revenueLines[0].credit_amount = Number(
          (revenueLines[0].credit_amount + (revenueTotal - credited)).toFixed(2),
        );
      }
      // If nothing resolved per group, fall back to the single ALL-scope account
      // so an invoice is never posted without its revenue leg.
      if (revenueLines.length === 0) {
        revenueLines.push({
          account_id: acc.REVENUE, debit_amount: 0, credit_amount: revenueTotal,
          description: `Revenue — ${order.order_number}`,
        });
      }

      // D-5: the voucher number used to be `count() + 1`, computed inside the
      // transaction, on a column that is globally @unique — two concurrent invoices
      // produced the same number and one rolled back. postJournal allocates it
      // atomically, and now also asserts the entry balances.
      await postJournal({
        tenantId:    c.get('tenantId'),
        tx,
        description: `Sales Invoice: ${order.order_number} — Factura #${f.factura_number}`,
        source:      { module: 'SALES_INVOICE', id: f.id },
        userId:      c.get('user').id,
        dimensions:  await contextForSalesOrder(c.get('tenantId'), order.id, tx),
        lines: [
          { accountId: acc.AR,                   debit:  total,               description: `AR — ${customerName}` },
          { accountId: acc.TAX_TURNOVER_EXPENSE, debit:  Number(f.it_amount), description: `Turnover tax expense` },
          ...revenueLines.map(l => ({
            accountId:   l.account_id,
            debit:       l.debit_amount,
            credit:      l.credit_amount,
            description: l.description,
          })),
          { accountId: acc.VAT_OUTPUT,           credit: Number(f.iva_amount), description: `Output VAT` },
          { accountId: acc.TAX_TURNOVER_PAYABLE, credit: Number(f.it_amount),  description: `Turnover tax payable` },
        ],
      });
    }

    return f;
  });

  return created(c, factura);
});

// Collect AR payment — clears CxC (1103) balance
app.post('/:id/pay', guard('POST /:id/pay'), validate(PayOrderSchema), async (c) => {
  const order = await db.salesOrder.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: { customer: true },
  });
  if (!order) throw new AppError('Order not found', 404);
  if (!order.invoice_id) throw new AppError('Order has no invoice. Issue a Factura first.', 400);
  if (order.paid_at) throw new AppError('This order has already been paid', 409);

  // The receipt voucher below is written at face value, so it is only correct in
  // the ledger's accounting currency (WORK-025).
  await assertDocumentCurrencySupported(c.get('tenantId'), order.currency, {
    errorCode: 'SALES_FX_NOT_IMPLEMENTED',
    capability: 'Customer payments',
  });

  const { payment_date, account_code = '1102', notes } = c.get('body');
  const paymentDate = payment_date ? new Date(payment_date) : new Date();

  // AR comes from the posting profile; the debit side stays a code lookup because
  // which bank or cash account received the money is transaction data the user
  // picks, not configuration.
  const payAcc = await resolvePostingAccounts_orExplain(
    c.get('tenantId'), ['AR'] as const,
    { document: `AR payment for ${order.order_number}`, partyId: order.customer_id ?? null },
  );
  const bankAccount = await db.account.findFirst({
    where: { tenant_id: c.get('tenantId'), code: account_code },
  });
  if (payAcc && !bankAccount) {
    throw new AppError(`Payment account '${account_code}' does not exist in the chart of accounts.`, 400);
  }

  await db.$transaction(async (tx) => {
    await tx.salesOrder.update({
      where: { id: order.id },
      data: { paid_at: paymentDate, paid_by: c.get('user').id },
    });

    if (bankAccount && payAcc) {
      const totalAmount = Number(order.total_amount);
      await postJournal({
        tenantId:    c.get('tenantId'),
        tx,
        date:        paymentDate,
        description: `AR Payment: ${order.order_number}${notes ? ' — ' + notes : ''}`,
        source:      { module: 'SALES_PAYMENT', id: order.id },
        userId:      c.get('user').id,
        dimensions:  await contextForSalesOrder(c.get('tenantId'), order.id, tx),
        lines: [
          { accountId: bankAccount.id, debit:  totalAmount, description: `Cash receipt — ${order.order_number}` },
          { accountId: payAcc.AR,      credit: totalAmount, description: `Clear AR — ${order.order_number}` },
        ],
      });
    }
  });

  return message(c, `Payment recorded for order ${order.order_number}.`);
});

// Edit SO lines before invoice is posted
app.put('/:id', guard('PUT /:id'), async (c) => {
  const body = await c.req.json();
  const order = await db.salesOrder.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
  });
  if (!order) throw new AppError('Order not found', 404);
  if (order.invoice_id) throw new AppError('Cannot edit an order that has already been invoiced', 400);
  if (!['DRAFT', 'CONFIRMED'].includes(order.status)) throw new AppError('Can only edit DRAFT or CONFIRMED orders', 400);

  const { customer_id, notes, lines, warehouse_id } = body;

  // A CONFIRMED order holds stock for exactly its lines in its warehouse. Changing
  // either in place would leave holds that no longer match what ships. Until the
  // edit releases and re-reserves in one transaction (WORK-048), it is refused.
  // Only a change to what is held refuses: product, variant and quantity per line,
  // or the warehouse. Prices, discounts and notes may still be edited.
  const holdKey = (ls: Array<{ product_id: string; variant_id?: string | null; quantity: number }>) =>
    ls.map((l) => `${l.product_id}|${l.variant_id || ''}|${Number(l.quantity)}`).sort().join(',');
  const heldLines = order.status === 'CONFIRMED' && Array.isArray(lines)
    ? await db.salesOrderLine.findMany({ where: { order_id: order.id }, select: { product_id: true, variant_id: true, quantity: true } })
    : [];
  const linesChangeHolds = order.status === 'CONFIRMED' && Array.isArray(lines) && holdKey(lines) !== holdKey(heldLines);
  if (order.status === 'CONFIRMED' && (linesChangeHolds || (warehouse_id !== undefined && warehouse_id !== order.warehouse_id))) {
    throw new AppError(
      'This order is confirmed and holds stock for its lines. Cancel it and create a new order to change lines or warehouse.',
      409,
      'CONFIRMED_ORDER_STOCK_EDIT_REFUSED',
    );
  }
  await assertTenantReferences(c.get('tenantId'), {
    customerId: customer_id ?? null,
    lines: Array.isArray(lines) ? lines : undefined,
  });

  // `warehouse_id` used to be dropped here without a word. The edit form sends it
  // (frontend sales/orders/page.tsx), this route destructured only three fields,
  // and the request still returned 200 — so changing an order's warehouse in the UI
  // appeared to work and did nothing. The order kept whichever warehouse it was
  // created with, which since `default_warehouse_id` was pinned is WH-001 for
  // anything created without an explicit choice. Confirming then failed on
  // "insufficient stock" while the goods sat visibly in another warehouse.
  //
  // Site is re-derived rather than accepted, for the reason in sales.service.ts:43 —
  // site is the warehouse's site, and accepting both lets them disagree.
  const dimensionUpdate: { warehouse_id?: string; site_id?: string | null } = {};
  if (warehouse_id !== undefined && warehouse_id !== order.warehouse_id) {
    const dims = await resolveInventoryDimensions(
      c.get('tenantId'),
      { warehouseId: warehouse_id || null, documentKind: 'sales order' },
    );
    dimensionUpdate.warehouse_id = dims.warehouse_id ?? undefined;
    dimensionUpdate.site_id = dims.site_id;
  }

  if (lines !== undefined) {
    await db.salesOrderLine.deleteMany({ where: { order_id: order.id } });
    let subtotal = 0;
    const newLines = lines.map((l: any, i: number) => {
      const lineTotal = Number(l.quantity) * Number(l.unit_price) * (1 - (l.discount_pct ?? 0) / 100);
      subtotal += lineTotal;
      return { order_id: order.id, product_id: l.product_id, variant_id: l.variant_id || null, quantity: Number(l.quantity), unit_price: Number(l.unit_price), discount_pct: l.discount_pct ?? 0, line_total: lineTotal, sort_order: i };
    });
    await db.salesOrderLine.createMany({ data: newLines });
    const taxAmount = (await computeDocumentTax(c.get('tenantId'), subtotal, {
      legacyConfig: c.get('taxConfig'),
    })).vat;
    await db.salesOrder.update({ where: { id: order.id }, data: { subtotal, tax_amount: taxAmount, total_amount: subtotal, ...(customer_id !== undefined && { customer_id }), ...(notes !== undefined && { notes }), ...dimensionUpdate } });
  } else {
    const data: any = { ...dimensionUpdate };
    if (customer_id !== undefined) data.customer_id = customer_id;
    if (notes !== undefined) data.notes = notes;
    if (Object.keys(data).length) await db.salesOrder.update({ where: { id: order.id }, data });
  }
  return ok(c, null);
});

app.post('/:id/confirm', guard('POST /:id/confirm'), async (c) => {
  const order = await salesService.confirmOrder(c.get('tenantId'), c.req.param('id'), c.get('user').id);
  return ok(c, order);
});

app.post('/:id/ship', guard('POST /:id/ship'), async (c) => {
  const body = await c.req.json();
  const order = await salesService.shipOrder(c.get('tenantId'), c.req.param('id'), c.get('user').id, body);
  return ok(c, order);
});

// Only a shipped order can be completed, and only the caller's own order. This
// used to update by id alone — any tenant's order, in any status.
app.post('/:id/complete', guard('POST /:id/complete'), async (c) => {
  const tenantId = c.get('tenantId');
  const id = c.req.param('id');
  const order = await db.salesOrder.findFirst({ where: { id, tenant_id: tenantId }, select: { id: true, status: true } });
  if (!order) throw new AppError('Order not found', 404);
  if (order.status !== 'SHIPPED') {
    throw new AppError(`Only a SHIPPED order can be completed (order is ${order.status})`, 409, 'ORDER_NOT_COMPLETABLE');
  }
  const res = await db.salesOrder.updateMany({
    where: { id, tenant_id: tenantId, status: 'SHIPPED' },
    data: { status: 'COMPLETED', completed_at: new Date() },
  });
  if (res.count === 0) throw new AppError('Order changed status concurrently; reload and retry', 409, 'ORDER_NOT_COMPLETABLE');
  const completed = await db.salesOrder.findFirst({ where: { id, tenant_id: tenantId } });
  return ok(c, completed);
});

app.post('/:id/cancel', guard('POST /:id/cancel'), async (c) => {
  const order = await salesService.cancelOrder(c.get('tenantId'), c.req.param('id'), c.get('user').id);
  return ok(c, order);
});

// ── Sales Return ───────────────────────────────────────────────────────────────
app.post('/:id/return', guard('POST /:id/return'), validate(ReturnSalesOrderSchema), async (c) => {
  const tenantId = c.get('tenantId');
  const orderId = c.req.param('id');
  const { notes, factura_number: manualCreditNoteNumber } = c.get('body');

  let responseMessage = '';

  await db.$transaction(async (tx) => {
    // Row lock — serializes concurrent returns on this order row.
    // Invoice and pay handlers do not acquire this lock; their
    // concurrency defects remain open (WORK-048A).
    await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${orderId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;

    const order = await tx.salesOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
      include: { customer: true, lines: true },
    });
    if (!order) throw new AppError('Order not found', 404);
    // returned_at checked before status: gives a specific 409 for the most
    // common re-submit rather than the generic status-mismatch 409.
    if ((order as any).returned_at) {
      throw new AppError('This order has already been returned', 409, 'ORDER_ALREADY_RETURNED');
    }
    if (!['SHIPPED', 'COMPLETED'].includes(order.status)) {
      throw new AppError(`Cannot return an order in ${order.status} status`, 409, 'ORDER_NOT_RETURNABLE');
    }

    const isInvoiced = !!order.invoice_id;

    // Uninvoiced-path guards — before any allocation or stock mutation.
    if (!isInvoiced) {
      if (manualCreditNoteNumber) {
        throw new AppError(
          'This order has no invoice. A fiscal credit-note number cannot be assigned to an uninvoiced shipment reversal.',
          400,
          'RETURN_UNINVOICED_NUMBER_REJECTED',
        );
      }
      if (order.paid_at) {
        throw new AppError(
          'This order is marked paid but has no invoice. Correct the data inconsistency before processing a return.',
          409,
          'RETURN_PAID_WITHOUT_INVOICE',
        );
      }
    }

    const total = Number(order.total_amount);

    // Invoiced prerequisites — currency, tax, posting accounts and FACTURA number
    // are all resolved BEFORE restoreIssues, matching POS ordering (sequence
    // before issueAvailable). A configuration or sequence failure aborts here
    // without touching inventory.
    // Uninvoiced: currency guard only; no fiscal tax, accounts, or number.
    type InvoicedData = {
      subtotal: number; ivaAmount: number; itAmount: number;
      customerName: string; retAcc: any; facturaNumber: string;
    };
    let invoicedData: InvoicedData | null = null;

    if (isInvoiced) {
      await assertDocumentCurrencySupported(tenantId, order.currency, {
        errorCode: 'SALES_FX_NOT_IMPLEMENTED',
        capability: 'Customer returns and credit notes',
        client: tx,
      });

      const taxReturn = await computeDocumentTax(tenantId, total, {
        partyId: order.customer_id ?? null,
        legacyConfig: c.get('taxConfig'),
        client: tx,
      });
      const { subtotal, vat: ivaAmount, turnover: itAmount } = taxReturn;

      const shippingAddr = order.shipping_address as any;
      const customerName = order.customer
        ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
        : shippingAddr?.name ?? 'Cliente Mostrador';

      const retAcc = await resolvePostingAccounts_orExplain(
        tenantId,
        ['REVENUE', 'VAT_OUTPUT', 'TAX_TURNOVER_PAYABLE', 'TAX_TURNOVER_EXPENSE', 'AR', 'INVENTORY', 'COGS', 'BANK'] as const,
        { document: `Return for ${order.order_number}`, partyId: order.customer_id ?? null, client: tx },
      );

      // FACTURA number secured before stock restoration — a sequence failure
      // aborts without mutating inventory.
      const facturaNumber = await nextFacturaNumber(tenantId, tx, {
        manualNumber: manualCreditNoteNumber,
      });

      invoicedData = { subtotal, ivaAmount, itAmount, customerName, retAcc, facturaNumber };
    } else {
      // Uninvoiced: currency guard before stock, no fiscal number.
      await assertDocumentCurrencySupported(tenantId, order.currency, {
        errorCode: 'SALES_FX_NOT_IMPLEMENTED',
        capability: 'Customer returns and credit notes',
        client: tx,
      });
    }

    // Shared stock restoration — runs after all pre-flight checks and, for the
    // invoiced path, after the FACTURA number is secured.
    const shipped = await tx.inventoryTransaction.findMany({
      where: {
        tenant_id: tenantId,
        reference_type: { in: ['SALES_ORDER', 'POS_SALE'] },
        reference_id: order.id,
        transaction_type: 'OUTBOUND',
      },
      select: { id: true },
    });
    const restored = await restoreIssues(tx, {
      tenantId,
      issueTransactionIds: shipped.map((t) => t.id),
      mode: 'NEW_LAYER',
      transactionType: 'RETURN',
      referenceType: 'SALES_ORDER',
      referenceId: order.id,
      referenceNumber: order.order_number,
      notes: notes ? `Return: ${notes}` : `Return of SO ${order.order_number}`,
      userId: c.get('user').id,
    });
    const policies = await resolveItemPolicies(tenantId, order.lines.map((l: any) => l.product_id), tx);
    const hasStocked = order.lines.some((l: any) => policies.get(l.product_id)?.stocked !== false);
    if (hasStocked && restored.transactionIds.length === 0) {
      throw new AppError(
        `No shipped stock of ${order.order_number} is left to take back - it has already been returned, ` +
          `or it was shipped before cost settlements were recorded.`,
        409,
        'RETURN_NOTHING_TO_RESTORE',
      );
    }

    if (isInvoiced && invoicedData) {
      const { subtotal, ivaAmount, itAmount, customerName, retAcc, facturaNumber } = invoicedData;

      // [OPEN] Whether Bolivia requires notas de crédito on a separate series
      // from FACTURA is unresolved (HANDOVER §7). CREDIT_NOTE already exists in
      // SequenceReference; when the answer is known this is a one-word change.
      await tx.factura.create({
        data: {
          tenant_id:      tenantId,
          factura_number: facturaNumber,
          source_type:    'RETURN',
          source_id:      order.id,
          customer_name:  customerName,
          invoice_date:   new Date(),
          subtotal:       -subtotal,
          iva_amount:     -ivaAmount,
          it_amount:      -itAmount,
          total_amount:   -total,
          notes:          notes ? `Nota de crédito - ${notes}` : `Nota de crédito por devolución SO ${order.order_number}`,
          created_by:     c.get('user').id,
        },
      });

      if (retAcc) {
        await postJournal({
          tenantId,
          tx,
          description: `Return - Reverse Invoice: ${order.order_number}`,
          source:      { module: 'SALES_RETURN', id: order.id },
          userId:      c.get('user').id,
          dimensions:  await contextForSalesOrder(tenantId, order.id, tx),
          lines: [
            { accountId: retAcc.REVENUE,              debit:  subtotal,  description: `Return revenue reversal` },
            { accountId: retAcc.VAT_OUTPUT,           debit:  ivaAmount, description: `Return IVA Débito reversal` },
            { accountId: retAcc.TAX_TURNOVER_PAYABLE, debit:  itAmount,  description: `Return IT por Pagar reversal` },
            { accountId: retAcc.AR,                   credit: total,     description: `Return CxC credit` },
            { accountId: retAcc.TAX_TURNOVER_EXPENSE, credit: itAmount,  description: `Return IT Expense reversal` },
          ],
        });
      }

      await postIssueCogs(tx, tenantId, {
        costByProduct: restored.costByProduct,
        document: order.order_number,
        sourceModule: 'SALES_RETURN',
        sourceId: order.id,
        userId: c.get('user').id,
        dimensionsFor: () => contextForSalesOrder(tenantId, order.id, tx),
        reverse: true,
        description: `Return - Reverse COGS: ${order.order_number}`,
      });

      if (order.paid_at && retAcc) {
        await postJournal({
          tenantId,
          tx,
          description: `Return - Refund: ${order.order_number}`,
          source:      { module: 'SALES_RETURN', id: order.id },
          userId:      c.get('user').id,
          dimensions:  await contextForSalesOrder(tenantId, order.id, tx),
          lines: [
            { accountId: retAcc.AR,   debit:  total, description: `Return CxC refund` },
            { accountId: retAcc.BANK, credit: total, description: `Return refund from Bancos` },
          ],
        });
      }

      responseMessage = `Order ${order.order_number} returned. Stock restored, credit note issued, return recorded in accounting.`;
    } else {
      // Uninvoiced path: COGS reversal only. postIssueCogs resolves accounts by
      // item group internally. No factura, no tax, no invoice/payment GL reversal.
      await postIssueCogs(tx, tenantId, {
        costByProduct: restored.costByProduct,
        document: order.order_number,
        sourceModule: 'SALES_RETURN',
        sourceId: order.id,
        userId: c.get('user').id,
        dimensionsFor: () => contextForSalesOrder(tenantId, order.id, tx),
        reverse: true,
        description: `Return - Reverse COGS: ${order.order_number}`,
      });

      responseMessage = `Order ${order.order_number} returned. Shipment and stock reversed. No credit note issued as this order was not invoiced.`;
    }

    // Guarded final write: tenant + id + current status + returned_at null.
    // count 0 means a concurrent session mutated the row; surface 409.
    const updated = await tx.salesOrder.updateMany({
      where: { id: order.id, tenant_id: tenantId, status: order.status, returned_at: null },
      data: { status: 'RETURNED', returned_at: new Date() },
    });
    if (updated.count !== 1) {
      throw new AppError('Order status changed concurrently; reload and retry', 409, 'ORDER_RETURN_CONCURRENT_CONFLICT');
    }

    if (order.customer_id) {
      await tx.customer.updateMany({
        where: { id: order.customer_id, tenant_id: tenantId },
        data: {
          lifetime_value: { decrement: total },
          total_orders:   { decrement: 1 },
        },
      });
    }
  });

  return message(c, responseMessage);
});

export default app;
