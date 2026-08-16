import { Hono }    from 'hono';
import { SalesService } from './sales.service';
import { AppError } from '../../shared/errors/AppError';
import { db }       from '../../infrastructure/database/client';

import { requireRole } from '../../shared/middleware/authMiddleware';
import { validate }    from '../../shared/middleware/validate';
import { ok, created, message } from '../../shared/response';
import { CreateSalesOrderSchema, InvoiceOrderSchema, PayOrderSchema } from '../../shared/schemas';
import { nextSalesOrderNumber } from '../../shared/utils/orderCounter';
import { computeDocumentTax } from '../../shared/services/documentTax.service';
import { nextJournalVoucher } from '../../shared/services/numberSequence.service';
import { resolvePostingAccounts_orExplain } from '../../shared/services/posting.service';
import { resolveItemPolicies, groupByItemGroup } from '../../shared/services/itemPolicy.service';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();
const salesService = new SalesService();

// ── Atomic factura number (race-condition safe) ────────────────────────────────
async function nextFacturaNumber(tenantId: string): Promise<number> {
  const rows = await db.$queryRaw<{ last_number: number }[]>`
    INSERT INTO factura_counters (tenant_id, last_number, updated_at)
    SELECT ${tenantId}::uuid, COALESCE(MAX(factura_number), 0) + 1, NOW()
    FROM facturas WHERE tenant_id = ${tenantId}::uuid
    ON CONFLICT (tenant_id)
    DO UPDATE SET
      last_number = GREATEST(
        factura_counters.last_number + 1,
        (SELECT COALESCE(MAX(factura_number), 0) + 1 FROM facturas WHERE tenant_id = ${tenantId}::uuid)
      ),
      updated_at = NOW()
    RETURNING last_number
  `;
  return Number(rows[0].last_number);
}

app.get('/', async (c) => {
  const data = await salesService.getOrders(c.get('tenantId'), c.req.query() as any);
  return ok(c, data);
});

app.post('/', validate(CreateSalesOrderSchema), async (c) => {
  const order = await salesService.createOrder(c.get('tenantId'), c.get('body') as any, c.get('user').id);
  return created(c, order);
});

app.post('/storefront', async (c) => {
  const body   = await c.req.json();
  const userId = c.get('user').id;

  const lines: Array<{ product_id: string; variant_id?: string; quantity: number; unit_price: number }> = body.lines ?? [];
  if (lines.length === 0) throw new AppError('Cart is empty', 400);

  // Look up customer record linked to this user
  const customer = await db.customer.findFirst({
    where: { user_id: userId, tenant_id: c.get('tenantId') },
    select: { id: true },
  });

  // Stock check per line
  for (const line of lines) {
    const stockWhere: any = { tenant_id: c.get('tenantId'), product_id: line.product_id };
    if (line.variant_id) stockWhere.variant_id = line.variant_id;
    const agg = await db.inventoryStock.aggregate({
      where: stockWhere,
      _sum: { quantity: true, reserved_qty: true },
    });
    const available = (agg._sum.quantity ?? 0) - (agg._sum.reserved_qty ?? 0);
    if (available < line.quantity) {
      const product = await db.product.findFirst({ where: { id: line.product_id }, select: { name: true } });
      throw new AppError(
        `"${product?.name ?? 'Product'}" is out of stock. Available: ${available}, requested: ${line.quantity}`,
        400
      );
    }
  }

  const order = await salesService.createOrder(
    c.get('tenantId'),
    { ...body, source: 'storefront', customer_id: customer?.id ?? undefined, currency: 'BOB' },
    userId
  );

  // Deduct stock immediately and record transactions
  for (const line of lines) {
    const stockWhere: any = { tenant_id: c.get('tenantId'), product_id: line.product_id };
    if (line.variant_id) stockWhere.variant_id = line.variant_id;
    const stockRecords = await db.inventoryStock.findMany({ where: stockWhere, orderBy: { updated_at: 'asc' } });
    let remaining = line.quantity;
    for (const stock of stockRecords) {
      if (remaining <= 0) break;
      const toDeduct = Math.min(remaining, stock.quantity - stock.reserved_qty);
      if (toDeduct <= 0) continue;
      await db.inventoryStock.update({
        where: { id: stock.id },
        data: { quantity: { decrement: toDeduct } },
      });
      await db.inventoryTransaction.create({
        data: {
          tenant_id:        c.get('tenantId'),
          transaction_type: 'OUTBOUND',
          reference_type:   'SALES_ORDER',
          reference_id:     order.id,
          reference_number: order.order_number,
          product_id:       line.product_id,
          variant_id:       line.variant_id ?? null,
          from_location_id: stock.location_id,
          quantity:         toDeduct,
          unit_cost:        line.unit_price,
          notes:            `Storefront · SO ${order.order_number}`,
          performed_by:     userId,
        },
      });
      // Consume FIFO batch
      const fifo = await db.inventoryBatch.findFirst({
        where: {
          tenant_id: c.get('tenantId'), product_id: line.product_id,
          ...(line.variant_id ? { variant_id: line.variant_id } : {}),
          location_id: stock.location_id, quantity: { gt: 0 },
        },
        orderBy: { received_at: 'asc' },
      });
      if (fifo) {
        await db.inventoryBatch.update({ where: { id: fifo.id }, data: { quantity: { decrement: Math.min(toDeduct, fifo.quantity) } } });
      }
      remaining -= toDeduct;
    }
  }

  await db.salesOrder.update({
    where: { id: order.id },
    data: { status: 'CONFIRMED', confirmed_at: new Date() },
  });
  return created(c, { id: order.id, order_number: order.order_number });
});

app.get('/:id', async (c) => {
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
    factura = await db.factura.findUnique({ where: { id: order.invoice_id } });
  }

  return ok(c, { ...order, factura });
});

// Create invoice (Factura) from a sales order
app.post('/:id/invoice', requireRole('admin', 'store_manager'), validate(InvoiceOrderSchema), async (c) => {
  const order = await db.salesOrder.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: { customer: true },
  });
  if (!order) throw new AppError('Order not found', 404);
  if (order.invoice_id) throw new AppError('This order already has an invoice', 409);
  if (['DRAFT', 'CANCELLED'].includes(order.status)) {
    throw new AppError(`Cannot invoice an order in ${order.status} status. Confirm it first.`, 400);
  }

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

  const { customer_nit, notes } = c.get('body');

  const shippingAddr = order.shipping_address as any;
  const customerName =
    order.customer
      ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
      : shippingAddr?.name ?? 'Cliente Mostrador';

  const facturaNumber = await nextFacturaNumber(c.get('tenantId'));

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

      // D-5: this used to be `count() + 1`, computed inside the transaction, on a
      // column that is globally @unique — two concurrent invoices produced the
      // same number and one rolled back. The sequence allocator is atomic.
      const entryNumber = await nextJournalVoucher(c.get('tenantId'), tx);
      await tx.journalEntry.create({
        data: {
          tenant_id:    c.get('tenantId'),
          entry_number: entryNumber,
          entry_date:   new Date(),
          description:  `Sales Invoice: ${order.order_number} — Factura #${String(f.factura_number).padStart(6, '0')}`,
          source_module: 'SALES_INVOICE',
          source_id:    f.id,
          status:       'POSTED',
          posted_at:    new Date(),
          created_by:   c.get('user').id,
          lines: {
            create: [
              { account_id: acc.AR,                   debit_amount: total,               credit_amount: 0,                   description: `AR — ${customerName}` },
              { account_id: acc.TAX_TURNOVER_EXPENSE, debit_amount: Number(f.it_amount), credit_amount: 0,                   description: `Turnover tax expense` },
              ...revenueLines,
              { account_id: acc.VAT_OUTPUT,           debit_amount: 0,                   credit_amount: Number(f.iva_amount), description: `Output VAT` },
              { account_id: acc.TAX_TURNOVER_PAYABLE, debit_amount: 0,                   credit_amount: Number(f.it_amount),  description: `Turnover tax payable` },
            ],
          },
        },
      });
    }

    return f;
  });

  return created(c, factura);
});

// Collect AR payment — clears CxC (1103) balance
app.post('/:id/pay', requireRole('admin', 'store_manager'), validate(PayOrderSchema), async (c) => {
  const order = await db.salesOrder.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: { customer: true },
  });
  if (!order) throw new AppError('Order not found', 404);
  if (!order.invoice_id) throw new AppError('Order has no invoice. Issue a Factura first.', 400);
  if (order.paid_at) throw new AppError('This order has already been paid', 409);

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
      const entryNumber = await nextJournalVoucher(c.get('tenantId'), tx);
      await tx.journalEntry.create({
        data: {
          tenant_id:    c.get('tenantId'),
          entry_number: entryNumber,
          entry_date:   paymentDate,
          description:  `AR Payment: ${order.order_number}${notes ? ' — ' + notes : ''}`,
          source_module: 'SALES_PAYMENT',
          source_id:    order.id,
          status:       'POSTED',
          posted_at:    new Date(),
          created_by:   c.get('user').id,
          lines: {
            create: [
              { account_id: bankAccount.id, debit_amount: totalAmount, credit_amount: 0,           description: `Cash receipt — ${order.order_number}` },
              { account_id: payAcc.AR,      debit_amount: 0,           credit_amount: totalAmount, description: `Clear AR — ${order.order_number}` },
            ],
          },
        },
      });
    }
  });

  return message(c, `Payment recorded for order ${order.order_number}.`);
});

// Edit SO lines before invoice is posted
app.put('/:id', requireRole('admin', 'store_manager'), async (c) => {
  const body = await c.req.json();
  const order = await db.salesOrder.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
  });
  if (!order) throw new AppError('Order not found', 404);
  if (order.invoice_id) throw new AppError('Cannot edit an order that has already been invoiced', 400);
  if (!['DRAFT', 'CONFIRMED'].includes(order.status)) throw new AppError('Can only edit DRAFT or CONFIRMED orders', 400);

  const { customer_id, notes, lines } = body;

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
    await db.salesOrder.update({ where: { id: order.id }, data: { subtotal, tax_amount: taxAmount, total_amount: subtotal, ...(customer_id !== undefined && { customer_id }), ...(notes !== undefined && { notes }) } });
  } else {
    const data: any = {};
    if (customer_id !== undefined) data.customer_id = customer_id;
    if (notes !== undefined) data.notes = notes;
    if (Object.keys(data).length) await db.salesOrder.update({ where: { id: order.id }, data });
  }
  return ok(c, null);
});

app.post('/:id/confirm', requireRole('admin', 'store_manager'), async (c) => {
  const order = await salesService.confirmOrder(c.get('tenantId'), c.req.param('id'), c.get('user').id);
  return ok(c, order);
});

app.post('/:id/ship', requireRole('admin', 'store_manager'), async (c) => {
  const body = await c.req.json();
  const order = await salesService.shipOrder(c.get('tenantId'), c.req.param('id'), c.get('user').id, body);
  return ok(c, order);
});

app.post('/:id/complete', requireRole('admin', 'store_manager'), async (c) => {
  const order = await db.salesOrder.update({
    where: { id: c.req.param('id') },
    data: { status: 'COMPLETED', completed_at: new Date() },
  });
  return ok(c, order);
});

app.post('/:id/cancel', requireRole('admin'), async (c) => {
  const order = await salesService.cancelOrder(c.get('tenantId'), c.req.param('id'), c.get('user').id);
  return ok(c, order);
});

// ── Sales Return ───────────────────────────────────────────────────────────────
app.post('/:id/return', requireRole('admin', 'store_manager'), async (c) => {
  const order = await db.salesOrder.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: { customer: true, lines: true },
  });
  if (!order) throw new AppError('Order not found', 404);
  if (!['SHIPPED', 'COMPLETED'].includes(order.status)) {
    throw new AppError(`Cannot return an order in ${order.status} status. Must be SHIPPED or COMPLETED.`, 400);
  }
  if ((order as any).returned_at) throw new AppError('This order has already been returned', 409);

  const { notes } = await c.req.json();

  const total = Number(order.total_amount);
  const taxReturn = await computeDocumentTax(c.get('tenantId'), Number(order.total_amount), {
    partyId: order.customer_id ?? null, legacyConfig: c.get('taxConfig'),
  });
  const { subtotal, vat: ivaAmount, turnover: itAmount } = taxReturn;

  const shippingAddr = order.shipping_address as any;
  const customerName = order.customer
    ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
    : shippingAddr?.name ?? 'Cliente Mostrador';

  // Pre-fetch factura number and GL accounts outside transaction (read-only)
  const facturaNumber = await nextFacturaNumber(c.get('tenantId'));

  // A return reverses the invoice, the COGS and possibly the payment, so it needs
  // every posting type the forward path used. Resolving them as one set means a
  // partially-configured tenant cannot post half a reversal.
  const retAcc = await resolvePostingAccounts_orExplain(
    c.get('tenantId'),
    ['REVENUE', 'VAT_OUTPUT', 'TAX_TURNOVER_PAYABLE', 'TAX_TURNOVER_EXPENSE', 'AR', 'INVENTORY', 'COGS', 'BANK'] as const,
    { document: `Return for ${order.order_number}`, partyId: order.customer_id ?? null },
  );

  // Pre-fetch stock records for each line outside transaction (findFirst per line)
  const stockByLine: Array<{ stock: any; line: any }> = [];
  for (const line of order.lines) {
    const stockWhere: any = { tenant_id: c.get('tenantId'), product_id: line.product_id };
    if (line.variant_id) stockWhere.variant_id = line.variant_id;
    if (order.warehouse_id) stockWhere.location = { zone: { warehouse_id: order.warehouse_id } };
    const stock = await db.inventoryStock.findFirst({ where: stockWhere });
    stockByLine.push({ stock, line });
  }

  await db.$transaction(async (tx) => {
    // ── 1. Restore stock + record RETURN transactions ───────────────────────────
    for (const { stock, line } of stockByLine) {
      if (stock) {
        await tx.inventoryStock.update({
          where: { id: stock.id },
          data: { quantity: { increment: line.quantity } },
        });
      }
      await tx.inventoryTransaction.create({
        data: {
          tenant_id:        c.get('tenantId'),
          transaction_type: 'RETURN',
          reference_type:   'SALES_ORDER',
          reference_id:     order.id,
          reference_number: order.order_number,
          product_id:       line.product_id,
          variant_id:       line.variant_id ?? null,
          to_location_id:   stock?.location_id ?? null,
          quantity:         line.quantity,
          unit_cost:        line.unit_price,
          notes:            notes ? `Return: ${notes}` : `Return of SO ${order.order_number}`,
          performed_by:     c.get('user').id,
        },
      });
    }

    // ── 2. Credit note Factura (negative amounts) ───────────────────────────────
    await tx.factura.create({
      data: {
        tenant_id:      c.get('tenantId'),
        factura_number: facturaNumber,
        source_type:    'RETURN',
        source_id:      order.id,
        customer_name:  customerName,
        invoice_date:   new Date(),
        subtotal:       -subtotal,
        iva_amount:     -ivaAmount,
        it_amount:      -itAmount,
        total_amount:   -total,
        notes:          notes ? `Nota de crédito — ${notes}` : `Nota de crédito por devolución SO ${order.order_number}`,
        created_by:     c.get('user').id,
      },
    });

    // D-5: was `count() + 1` incremented locally across up to three entries — a
    // race against every other posting in the system. Each entry now draws its own
    // number from the atomic sequence.
    const nextJE = () => nextJournalVoucher(c.get('tenantId'), tx);

    // ── 3. JE 1 — Reverse sales invoice (only if invoiced) ─────────────────────
    // Original invoice: Dr CxC, Dr IT Exp; Cr Revenue, Cr IVA Débito, Cr IT por Pagar
    // Reversal:         Cr CxC, Cr IT Exp; Dr Revenue, Dr IVA Débito, Dr IT por Pagar
    if (order.invoice_id && retAcc) {
      await tx.journalEntry.create({
        data: {
          tenant_id: c.get('tenantId'), entry_number: await nextJE(), entry_date: new Date(),
          description: `Return — Reverse Invoice: ${order.order_number}`,
          source_module: 'SALES_RETURN', source_id: order.id,
          status: 'POSTED', posted_at: new Date(), created_by: c.get('user').id,
          lines: {
            create: [
              { account_id: retAcc.REVENUE,    debit_amount: subtotal,  credit_amount: 0,         description: `Return revenue reversal` },
              { account_id: retAcc.VAT_OUTPUT, debit_amount: ivaAmount, credit_amount: 0,         description: `Return IVA Débito reversal` },
              { account_id: retAcc.TAX_TURNOVER_PAYABLE,     debit_amount: itAmount,  credit_amount: 0,         description: `Return IT por Pagar reversal` },
              { account_id: retAcc.AR,       debit_amount: 0,         credit_amount: total,     description: `Return CxC credit` },
              { account_id: retAcc.TAX_TURNOVER_EXPENSE,     debit_amount: 0,         credit_amount: itAmount,  description: `Return IT Expense reversal` },
            ],
          },
        },
      });
    }

    // ── 4. JE 2 — Reverse COGS ─────────────────────────────────────────────────
    if (retAcc) {
      const productIds = order.lines.map((l: any) => l.product_id);
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, cost_price: true },
      });
      const costMap = new Map(products.map((p: any) => [p.id, Number(p.cost_price ?? 0)]));
      const cogsAmount = order.lines.reduce((sum: number, line: any) =>
        sum + line.quantity * (costMap.get(line.product_id) ?? 0), 0);

      if (cogsAmount > 0) {
        await tx.journalEntry.create({
          data: {
            tenant_id: c.get('tenantId'), entry_number: await nextJE(), entry_date: new Date(),
            description: `Return — Reverse COGS: ${order.order_number}`,
            source_module: 'SALES_RETURN', source_id: order.id,
            status: 'POSTED', posted_at: new Date(), created_by: c.get('user').id,
            lines: {
              create: [
                { account_id: retAcc.INVENTORY, debit_amount: cogsAmount, credit_amount: 0,          description: `Return inventory in` },
                { account_id: retAcc.COGS,      debit_amount: 0,          credit_amount: cogsAmount, description: `Return COGS reversal` },
              ],
            },
          },
        });
      }
    }

    // ── 5. JE 3 — Reverse AR payment (only if already paid) ───────────────────
    if (order.paid_at && retAcc) {
      await tx.journalEntry.create({
        data: {
          tenant_id: c.get('tenantId'), entry_number: await nextJE(), entry_date: new Date(),
          description: `Return — Refund: ${order.order_number}`,
          source_module: 'SALES_RETURN', source_id: order.id,
          status: 'POSTED', posted_at: new Date(), created_by: c.get('user').id,
          lines: {
            create: [
              { account_id: retAcc.AR,  debit_amount: total, credit_amount: 0,     description: `Return CxC refund` },
              { account_id: retAcc.BANK, debit_amount: 0,     credit_amount: total, description: `Return refund from Bancos` },
            ],
          },
        },
      });
    }

    // ── 6. Mark order RETURNED + reverse customer lifetime value ───────────────
    await tx.salesOrder.update({
      where: { id: order.id },
      data: { status: 'RETURNED', returned_at: new Date() } as any,
    });

    if (order.customer_id) {
      await tx.customer.update({
        where: { id: order.customer_id },
        data: {
          lifetime_value: { decrement: total },
          total_orders:   { decrement: 1 },
        },
      });
    }
  });

  return message(c, `Order ${order.order_number} returned. Stock restored, credit note created.`);
});

export default app;
