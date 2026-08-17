import { Hono }    from 'hono';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';

import { logger }   from '../../shared/logger';
import { ok, created, message, paginated } from '../../shared/response';
import { validate } from '../../shared/middleware/validate';
import { CreatePurchaseOrderSchema } from '../../shared/schemas';
import { nextPurchaseOrderNumber } from '../../shared/utils/orderCounter';
import { computeDocumentTax, computePurchaseMoney } from '../../shared/services/documentTax.service';
import { postJournal } from '../../shared/services/journal.service';
import { contextForPurchaseOrder } from '../../shared/services/dimension.service';
import { resolvePostingAccounts_orExplain } from '../../shared/services/posting.service';
import { resolveItemPolicies, groupByItemGroup } from '../../shared/services/itemPolicy.service';
import { createAndPostReceipt } from './productReceipt.service';
import { createInvoice, postInvoice, runMatching, autoMatch } from './vendorInvoice.service';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

// ── Suppliers ─────────────────────────────────────────────────────────────────

app.get('/suppliers', async (c) => {
  const suppliers = await db.supplier.findMany({
    where: { tenant_id: c.get('tenantId'), is_active: true },
    orderBy: { name: 'asc' },
  });
  return ok(c, suppliers);
});

app.post('/suppliers', requireRole('admin', 'store_manager'), async (c) => {
  const { code, name, contact_name, email, phone, address, city, country, payment_terms, currency } = await c.req.json();
  if (!code || !name) throw new AppError('code and name are required');
  const supplier = await db.supplier.create({
    data: {
      code, name,
      contact_name: contact_name || null,
      email:        email || null,
      phone:        phone || null,
      address:      address || null,
      city:         city || null,
      country:      country || 'BO',
      payment_terms: payment_terms ? Number(payment_terms) : 30,
      currency:     currency || 'BOB',
      tenant_id:    c.get('tenantId'),
    },
  });
  return created(c, supplier);
});

app.put('/suppliers/:id', requireRole('admin'), async (c) => {
  const body = await c.req.json();
  await db.supplier.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data: { ...body, updated_at: new Date() },
  });
  return ok(c, null);
});

// ── Purchase Orders ───────────────────────────────────────────────────────────

app.get('/orders', async (c) => {
  const { status, supplier_id, page = '1', limit = '20' } = c.req.query();
  const where: any = { tenant_id: c.get('tenantId') };
  if (status) where.status = status;
  if (supplier_id) where.supplier_id = supplier_id;

  const [orders, total] = await Promise.all([
    db.purchaseOrder.findMany({
      where,
      include: {
        supplier:  { select: { name: true, code: true } },
        lines:     { include: { product: { select: { name: true, sku: true } } } },
        warehouse: { select: { name: true } },
      },
      orderBy: { created_at: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    db.purchaseOrder.count({ where }),
  ]);

  return paginated(c, orders, total, Number(page), Number(limit));
});



/**
 * [OFFICIAL] "Purchase orders received but not invoiced" is a page in its own
 * right — it is where a vendor invoice is raised from. The equivalent grid in the
 * automation workspace is "Documents not invoiced", with an *Invoice now* button
 * per row. Same idea, one list.
 * learn.microsoft.com/dynamics365/finance/accounts-payable/tasks/key-invoice-data-ap-system-vendor-invoice
 */
app.get('/orders/received-not-invoiced', async (c) => {
  const orders = await db.purchaseOrder.findMany({
    where: {
      tenant_id: c.get('tenantId'),
      status: { in: ['RECEIVED', 'PARTIALLY_RECEIVED'] },
      lines: { some: {} },
      // Only orders with a real product receipt document belong here. Orders
      // received before the physical/financial split have no receipt to invoice
      // against — they were invoiced at receipt, in one voucher, under the old
      // behaviour. Listing them would invite double-posting them now.
      product_receipts: { some: { status: 'POSTED' } },
    },
    include: {
      supplier: { select: { code: true, name: true } },
      lines: { select: { quantity: true, received_qty: true, invoiced_qty: true } },
      product_receipts: {
        where: { status: 'POSTED' },
        select: { id: true, receipt_number: true, packing_slip: true, receipt_date: true },
        orderBy: { receipt_date: 'asc' },
      },
    },
    orderBy: { received_at: 'desc' },
    take: 100,
  });

  // Received but not yet invoiced is a per-LINE question: an order can be fully
  // received and half invoiced. Filtering on header status alone would show
  // orders with nothing left to bill.
  const rows = orders
    .map((o) => {
      const receivedNotInvoiced = o.lines.reduce(
        (s, l) => s + Math.max(0, Number(l.received_qty) - Number(l.invoiced_qty)),
        0,
      );
      return { ...o, uninvoiced_qty: Number(receivedNotInvoiced.toFixed(2)) };
    })
    .filter((o) => o.uninvoiced_qty > 0);

  return ok(c, rows);
});

app.get('/orders/:id', async (c) => {
  const po = await db.purchaseOrder.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: {
      supplier:  true,
      warehouse: true,
      lines:     { include: { product: { select: { name: true, sku: true } } } },
    },
  });
  if (!po) throw new AppError('Purchase order not found', 404);
  return ok(c, po);
});

app.put('/orders/:id', requireRole('admin', 'store_manager'), async (c) => {
  const po = await db.purchaseOrder.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId'), status: { in: ['DRAFT', 'CONFIRMED'] } },
  });
  if (!po) throw new AppError('PO not found or not editable (must be DRAFT or CONFIRMED)', 404);

  const { supplier_id, warehouse_id, receive_location_id, expected_date, notes, lines } = await c.req.json();

  if (lines !== undefined) {
    await db.purchaseOrderLine.deleteMany({ where: { po_id: po.id } });

    let subtotal = 0;
    const newLines = (lines ?? []).map((l: any, i: number) => {
      const lineTotal = Number(l.quantity) * Number(l.unit_cost);
      subtotal += lineTotal;
      return {
        po_id:      po.id,
        product_id: l.product_id,
        variant_id: l.variant_id || null,
        quantity:   Number(l.quantity),
        unit_cost:  Number(l.unit_cost),
        line_total: lineTotal,
        sort_order: i,
      };
    });

  // The agreed amount IS the supplier's invoiced figure. `computePurchaseMoney`
  // splits it into what we owe (AP), the recoverable input tax (VAT_INPUT) and
  // what capitalises into inventory. Purchase used to decompose the tax out and
  // then add it straight back on, which produced an effective 11,5% and a total
  // that was neither the net nor the gross. See documentTax.service.ts.
    const money = await computePurchaseMoney(c.get('tenantId'), subtotal, {
      partyId: supplier_id ?? po.supplier_id, legacyConfig: c.get('taxConfig'),
    });

    await db.purchaseOrderLine.createMany({ data: newLines });
    await db.purchaseOrder.updateMany({
      where: { id: po.id },
      data: {
        supplier_id:         supplier_id ?? po.supplier_id,
        warehouse_id:        warehouse_id ?? po.warehouse_id,
        receive_location_id: receive_location_id ?? po.receive_location_id,
        expected_date:       expected_date ? new Date(expected_date) : po.expected_date,
        notes:               notes ?? po.notes,
        subtotal,
        tax_amount:   money.recoverable_tax,
        total_amount: money.total,
        updated_at:   new Date(),
      },
    });
  } else {
    await db.purchaseOrder.updateMany({
      where: { id: po.id },
      data: {
        ...(supplier_id !== undefined && { supplier_id }),
        ...(warehouse_id !== undefined && { warehouse_id }),
        ...(receive_location_id !== undefined && { receive_location_id }),
        ...(expected_date !== undefined && { expected_date: expected_date ? new Date(expected_date) : null }),
        ...(notes !== undefined && { notes }),
        updated_at: new Date(),
      },
    });
  }

  return ok(c, null);
});

app.post('/orders', requireRole('admin', 'store_manager'), validate(CreatePurchaseOrderSchema), async (c) => {
  const body = c.get('body') as any;
  const poNumber = await nextPurchaseOrderNumber(c.get('tenantId'));

  let subtotal = 0;
  const lines = (body.lines ?? []).map((l: any, i: number) => {
    const lineTotal = Number(l.quantity) * Number(l.unit_cost);
    subtotal += lineTotal;
    return {
      product_id: l.product_id,
      variant_id: l.variant_id || null,
      quantity:   Number(l.quantity),
      unit_cost:  Number(l.unit_cost),
      line_total: lineTotal,
      sort_order: i,
    };
  });

  // The agreed amount IS the supplier's invoiced figure. `computePurchaseMoney`
  // splits it into what we owe (AP), the recoverable input tax (VAT_INPUT) and
  // what capitalises into inventory. Purchase used to decompose the tax out and
  // then add it straight back on, which produced an effective 11,5% and a total
  // that was neither the net nor the gross. See documentTax.service.ts.
  const money = await computePurchaseMoney(c.get('tenantId'), subtotal, {
    partyId: body.supplier_id, legacyConfig: c.get('taxConfig'),
  });

  const po = await db.purchaseOrder.create({
    data: {
      tenant_id:           c.get('tenantId'),
      po_number:           poNumber,
      supplier_id:         body.supplier_id,
      warehouse_id:        body.warehouse_id,
      receive_location_id: body.receive_location_id || null,
      expected_date:       body.expected_date ? new Date(body.expected_date) : null,
      currency:            body.currency ?? 'BOB',
      notes:               body.notes,
      subtotal,
      tax_amount:   money.recoverable_tax,
      total_amount: money.total,
      created_by:   c.get('user').id,
      lines: { create: lines },
    },
    include: { lines: true },
  });
  return created(c, po);
});

app.post('/orders/:id/confirm', requireRole('admin', 'store_manager'), async (c) => {
  const po = await db.purchaseOrder.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId'), status: 'DRAFT' },
    data: { status: 'CONFIRMED', confirmed_at: new Date() },
  });
  if (po.count === 0) throw new AppError('PO not found or cannot be confirmed');
  return ok(c, null);
});

// ── Product receipt ───────────────────────────────────────────────────────────
//
// [OFFICIAL] a purchase order may carry MANY product receipts: "Each product
// receipt represents a partial or complete delivery of the items on the purchase
// order." This route therefore raises a document rather than flipping a status,
// and the whole of the physical update lives in productReceipt.service.
//
// The legacy shape (`POST /orders/:id/receive` with a body full of nothing) still
// works and still receives every outstanding line, so no caller breaks.
app.post('/orders/:id/receive', requireRole('admin', 'store_manager'), async (c) => {
  const body = await c.req.json().catch(() => ({} as any));

  const result = await createAndPostReceipt(c.get('tenantId'), c.get('user').id, {
    purchase_order_id: c.req.param('id'),
    // The supplier's packing slip is the audit anchor. Older callers sent a URL to
    // a scanned slip instead of its number; accept either rather than reject a
    // request that used to work, and fall back to the order number so the field is
    // never empty.
    packing_slip: body.packing_slip ?? body.packing_slip_url ?? `receipt-${c.req.param('id').slice(0, 8)}`,
    receipt_date: body.receipt_date ?? null,
    location_id:  body.receive_location_id ?? body.location_id ?? null,
    notes:        body.notes ?? null,
    lines:        body.lines ?? undefined,
  });

  if (body.packing_slip_url) {
    await db.purchaseOrder.updateMany({
      where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
      data: { packing_slip_url: body.packing_slip_url },
    });
  }

  return ok(c, result);
});

app.get('/orders/:id/receipts', async (c) => {
  const receipts = await db.productReceipt.findMany({
    where: { tenant_id: c.get('tenantId'), purchase_order_id: c.req.param('id') },
    include: {
      lines: { include: { product: { select: { sku: true, name: true } } }, orderBy: { sort_order: 'asc' } },
    },
    orderBy: { receipt_date: 'desc' },
  });
  return ok(c, receipts);
});

app.get('/receipts', async (c) => {
  const { status, supplier_id } = c.req.query();
  const receipts = await db.productReceipt.findMany({
    where: {
      tenant_id: c.get('tenantId'),
      ...(status ? { status } : {}),
      ...(supplier_id ? { supplier_id } : {}),
    },
    include: {
      supplier:       { select: { code: true, name: true } },
      purchase_order: { select: { po_number: true } },
      lines:          { select: { id: true, quantity: true, matched_qty: true } },
    },
    orderBy: { created_at: 'desc' },
    take: 200,
  });
  return ok(c, receipts);
});


app.post('/orders/:id/cancel', requireRole('admin'), async (c) => {
  await db.purchaseOrder.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId'), status: { in: ['DRAFT', 'CONFIRMED'] } },
    data: { status: 'CANCELLED' },
  });
  return ok(c, null);
});

// PAY SUPPLIER — clears AP (CxP 2101)
app.post('/orders/:id/pay', requireRole('admin', 'store_manager'), async (c) => {
  const po = await db.purchaseOrder.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId'), status: 'RECEIVED' },
  });
  if (!po) throw new AppError('PO not found or not in RECEIVED status', 404);
  if (po.paid_at) throw new AppError('This PO has already been paid', 409);

  const { payment_date, account_code = '1102', notes } = await c.req.json();
  const paymentDate = payment_date ? new Date(payment_date) : new Date();

  await db.purchaseOrder.updateMany({
    where: { id: po.id },
    data: { paid_at: paymentDate, paid_by: c.get('user').id },
  });

  {
    // AP resolves through the posting profile. The CREDIT side stays a code
    // lookup on purpose: `account_code` is chosen by the user at payment time
    // (which bank or cash account the money left), so it is transaction data, not
    // configuration. It is still validated below rather than silently skipped.
    const acc = await resolvePostingAccounts_orExplain(
      c.get('tenantId'),
      ['AP'] as const,
      { document: `AP payment for ${po.po_number}`, partyId: po.supplier_id ?? null },
    );
    const bankAccount = await db.account.findFirst({
      where: { tenant_id: c.get('tenantId'), code: account_code },
    });
    if (acc && !bankAccount) {
      throw new AppError(`Payment account '${account_code}' does not exist in the chart of accounts.`, 400);
    }

    if (acc && bankAccount) {
      const totalAmount = Number(po.total_amount);

      await postJournal({
        tenantId:    c.get('tenantId'),
        date:        paymentDate,
        description: `AP Payment: ${po.po_number}${notes ? ' — ' + notes : ''}`,
        source:      { module: 'PURCHASE_PAYMENT', id: po.id },
        userId:      c.get('user').id,
        dimensions:  await contextForPurchaseOrder(c.get('tenantId'), po.id),
        lines: [
          { accountId: acc.AP,         debit:  totalAmount, description: `Clear CxP — ${po.po_number}` },
          { accountId: bankAccount.id, credit: totalAmount, description: `Payment to supplier (${account_code})` },
        ],
      });
    }
  }

  return message(c, `PO ${po.po_number} marked as paid. Journal entry created.`);
});

// ── Vendor invoices ───────────────────────────────────────────────────────────
//
// [OFFICIAL] "There are several ways to enter a vendor invoice." Of the five, two
// are in scope: from a confirmed purchase order, and standalone with no order at
// all (a utility bill). The invoice register, the invoice pool and the approval
// journal are deliberately not built — see docs/process/VENDOR_INVOICE.md §7.

app.get('/invoices', async (c) => {
  const { status, supplier_id, match } = c.req.query();
  const invoices = await db.vendorInvoice.findMany({
    where: {
      tenant_id: c.get('tenantId'),
      ...(status ? { status } : {}),
      ...(supplier_id ? { supplier_id } : {}),
      ...(match ? { header_match_status: match } : {}),
    },
    include: {
      supplier:       { select: { code: true, name: true } },
      purchase_order: { select: { po_number: true } },
      lines:          { select: { id: true } },
    },
    orderBy: { created_at: 'desc' },
    take: 200,
  });
  return ok(c, invoices);
});

app.get('/invoices/:id', async (c) => {
  const invoice = await db.vendorInvoice.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: {
      supplier:       true,
      purchase_order: { select: { id: true, po_number: true, status: true } },
      lines: {
        include: {
          product: { select: { sku: true, name: true } },
          po_line: { select: { id: true, quantity: true, unit_cost: true, received_qty: true, invoiced_qty: true } },
          matches: {
            include: {
              receipt_line: {
                select: {
                  id: true, quantity: true, net_unit_cost: true,
                  receipt: { select: { receipt_number: true, packing_slip: true, receipt_date: true } },
                },
              },
            },
          },
        },
        orderBy: { sort_order: 'asc' },
      },
    },
  });
  if (!invoice) throw new AppError('Vendor invoice not found', 404);
  return ok(c, invoice);
});

app.post('/invoices', requireRole('admin', 'store_manager'), async (c) => {
  const body = await c.req.json();
  const result = await createInvoice(c.get('tenantId'), c.get('user').id, body);
  return created(c, result);
});

/** Re-run matching without posting — the "Update match status" action. */
app.post('/invoices/:id/match', requireRole('admin', 'store_manager'), async (c) => {
  const outcome = await db.$transaction(async (tx) => {
    await autoMatch(tx, c.get('tenantId'), c.req.param('id'), c.get('user').id);
    return runMatching(tx, c.get('tenantId'), c.req.param('id'));
  });
  return ok(c, outcome);
});

/**
 * [OFFICIAL] "select the Approve posting with matching discrepancies toggle on the
 * Invoice matching details page before the invoice can be posted with price
 * matching errors and quantity matching errors."
 */
app.post('/invoices/:id/approve-discrepancies', requireRole('admin'), async (c) => {
  const updated = await db.vendorInvoice.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId'), status: 'DRAFT' },
    data: {
      discrepancy_approved: true,
      discrepancy_approved_by: c.get('user').id,
      discrepancy_approved_at: new Date(),
    },
  });
  if (updated.count === 0) throw new AppError('Invoice not found, or not in DRAFT', 404);
  return ok(c, null);
});

app.post('/invoices/:id/post', requireRole('admin', 'store_manager'), async (c) => {
  const result = await postInvoice(c.get('tenantId'), c.get('user').id, c.req.param('id'));
  return ok(c, result);
});

app.post('/invoices/:id/cancel', requireRole('admin'), async (c) => {
  const invoice = await db.vendorInvoice.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    select: { id: true, status: true, lines: { select: { id: true, matches: { select: { id: true, quantity: true, receipt_line_id: true } } } } },
  });
  if (!invoice) throw new AppError('Vendor invoice not found', 404);
  if (invoice.status === 'POSTED') {
    throw new AppError(
      'A posted vendor invoice cannot be cancelled. Reverse it with a credit note so the ledger ' +
        'keeps both sides of the correction.',
      409,
      'INVOICE_ALREADY_POSTED',
    );
  }

  // Releasing the matches matters: a receipt line held by a cancelled invoice
  // would otherwise stay unavailable to the invoice that eventually replaces it.
  await db.$transaction(async (tx) => {
    for (const line of invoice.lines) {
      for (const m of line.matches) {
        await tx.productReceiptLine.update({
          where: { id: m.receipt_line_id }, data: { matched_qty: { decrement: Number(m.quantity) } },
        });
      }
    }
    await tx.vendorInvoiceMatch.deleteMany({ where: { invoice_line_id: { in: invoice.lines.map(l => l.id) } } });
    await tx.vendorInvoiceLine.updateMany({
      where: { invoice_id: invoice.id }, data: { matched_receipt_qty: 0 },
    });
    await tx.vendorInvoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED' } });
  });
  return ok(c, null);
});

/**
 * Receive and invoice in one action.
 *
 * The anchor customer's goods usually arrive WITH the factura, and making the
 * owner post two documents in sequence for that is exactly the enterprise
 * ceremony this product exists to avoid. The two documents are still raised, and
 * the accounting is identical — the accrual is created and reversed within
 * seconds of each other. Only the number of clicks differs.
 *
 * `PurchaseParameters.receipt_invoice_flow` records which way a tenant works;
 * both routes stay available regardless, because suppliers differ.
 */
app.post('/orders/:id/receive-and-invoice', requireRole('admin', 'store_manager'), async (c) => {
  const body = await c.req.json();
  if (!body.invoice_number || !body.invoice_date) {
    throw new AppError('invoice_number and invoice_date are required — this action posts the factura too.', 400);
  }

  const receipt = await createAndPostReceipt(c.get('tenantId'), c.get('user').id, {
    purchase_order_id: c.req.param('id'),
    packing_slip: body.packing_slip ?? body.invoice_number,
    receipt_date: body.receipt_date ?? body.invoice_date,
    location_id:  body.receive_location_id ?? null,
    lines:        body.lines ?? undefined,
  });

  const invoice = await createInvoice(c.get('tenantId'), c.get('user').id, {
    purchase_order_id:         c.req.param('id'),
    invoice_number:            body.invoice_number,
    invoice_date:              body.invoice_date,
    posting_date:              body.posting_date ?? body.invoice_date,
    due_date:                  body.due_date ?? null,
    supplier_tax_id:           body.supplier_tax_id ?? null,
    fiscal_authorization_code: body.fiscal_authorization_code ?? null,
    fiscal_control_code:       body.fiscal_control_code ?? null,
    notes:                     body.notes ?? null,
    auto_match:                true,
  });

  const posted = await postInvoice(c.get('tenantId'), c.get('user').id, invoice.id);
  return created(c, { receipt, invoice: posted });
});

export default app;
