import { Hono }    from 'hono';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requirePermission, type Permission } from '../../shared/middleware/permissions';

import { logger }   from '../../shared/logger';
import { ok, created, message, paginated } from '../../shared/response';
import { validate } from '../../shared/middleware/validate';
import { CreatePurchaseOrderSchema, UpdateSupplierSchema } from '../../shared/schemas';
import type { z } from 'zod';
import { allocateNumber } from '../../shared/services/numberSequence.service';
import { computeDocumentTax, computePurchaseMoney } from '../../shared/services/documentTax.service';
import { purchasePriceFor } from '../../shared/services/tradeAgreement.service';
import { resolveDocumentCurrency } from '../../shared/services/currency/documentCurrency';

import { resolveItemPolicies, groupByItemGroup } from '../../shared/services/itemPolicy.service';
import { createAndPostReceipt } from './productReceipt.service';
import { createInvoice, postInvoice, runMatching, autoMatch } from './vendorInvoice.service';
import { cancelPurchaseOrderRemainder, updatePurchaseOrderDelivery } from './purchaseOrderChange.service';
import vendorPaymentRoutes from './vendorPayment.routes';
import purchaseReturnRoutes from './purchaseReturn.routes';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

export const PURCHASE_ROUTE_PERMISSIONS = {
  'GET /suppliers': ['purchase.supplier.read'],
  'POST /suppliers': ['purchase.supplier.maintain'],
  'PUT /suppliers/:id': ['purchase.supplier.maintain'],
  'GET /orders': ['purchase.order.read'],
  'GET /orders/received-not-invoiced': ['purchase.order.read'],
  'GET /orders/:id': ['purchase.order.read'],
  'GET /orders/:id/changes': ['purchase.order.read'],
  'PUT /orders/:id': ['purchase.order.update'],
  'PATCH /orders/:id/delivery': ['purchase.order.update'],
  'POST /orders/:id/lines/:lineId/cancel-remainder': ['purchase.order.cancel'],
  'POST /orders': ['purchase.order.create'],
  'POST /orders/:id/confirm': ['purchase.order.confirm'],
  'POST /orders/:id/receive': ['purchase.receipt.post'],
  'GET /orders/:id/receipts': ['purchase.receipt.read'],
  'GET /receipts': ['purchase.receipt.read'],
  'POST /orders/:id/cancel': ['purchase.order.cancel'],
  'GET /invoices': ['purchase.vendor_invoice.read'],
  'GET /invoices/:id': ['purchase.vendor_invoice.read'],
  'POST /invoices': ['purchase.vendor_invoice.create'],
  'POST /invoices/:id/match': ['purchase.vendor_invoice.match'],
  'POST /invoices/:id/approve-discrepancies': ['purchase.vendor_invoice.approve_discrepancy'],
  'POST /invoices/:id/post': ['purchase.vendor_invoice.post'],
  'POST /invoices/:id/cancel': ['purchase.vendor_invoice.cancel'],
  'POST /orders/:id/receive-and-invoice': [
    'purchase.receipt.post',
    'purchase.vendor_invoice.create',
    'purchase.vendor_invoice.match',
    'purchase.vendor_invoice.post',
  ],
  'GET /setup/trade-agreements': ['purchase.setup.read'],
  'POST /setup/trade-agreements': ['purchase.setup.maintain'],
  'POST /setup/trade-agreements/:id/close': ['purchase.setup.maintain'],
} as const satisfies Record<string, readonly Permission[]>;

function guard(route: keyof typeof PURCHASE_ROUTE_PERMISSIONS) {
  const permissions = [...PURCHASE_ROUTE_PERMISSIONS[route]] as [Permission, ...Permission[]];
  return requirePermission(...permissions);
}

/**
 * A product's item group, for the ITEM_GROUP scope of a trade agreement.
 *
 * Small and uncached on purpose: a purchase order has a handful of lines, and the
 * alternative — threading the group through every caller — is how the posting-profile
 * context came to be passed inconsistently before `itemPolicy.service.ts` centralised it.
 */
async function itemGroupOf(tenantId: string, productId: string): Promise<string | null> {
  if (!productId) return null;
  const p = await db.product.findFirst({
    where: { id: productId, tenant_id: tenantId },
    select: { item_group_id: true },
  });
  return p?.item_group_id ?? null;
}

// ── Suppliers ─────────────────────────────────────────────────────────────────

app.get('/suppliers', guard('GET /suppliers'), async (c) => {
  const suppliers = await db.supplier.findMany({
    where: { tenant_id: c.get('tenantId'), is_active: true },
    orderBy: { name: 'asc' },
  });
  return ok(c, suppliers);
});

app.post('/suppliers', guard('POST /suppliers'), async (c) => {
  const { code, name, contact_name, email, phone, address, city, country, payment_terms, currency } = await c.req.json();
  if (!code || !name) throw new AppError('code and name are required');
  const supplierCurrency = await resolveDocumentCurrency(c.get('tenantId'), currency);
  const supplier = await db.supplier.create({
    data: {
      code, name,
      contact_name: contact_name || null,
      email:        email || null,
      phone:        phone || null,
      address:      address || null,
      city:         city || null,
      country:      country || null,
      payment_terms: payment_terms ? Number(payment_terms) : 30,
      currency:     supplierCurrency,
      tenant_id:    c.get('tenantId'),
    },
  });
  return created(c, supplier);
});

/**
 * Update a supplier.
 *
 * The body used to be spread straight into `updateMany`, so a caller could set
 * `tenant_id` and move the supplier to another tenant, and a currency reached the
 * column without passing `resolveDocumentCurrency`. Both are closed by an
 * allow-list: only these fields are writable, and the currency goes through the
 * same resolution as every other document (WORK-025).
 */
app.put('/suppliers/:id', guard('PUT /suppliers/:id'), validate(UpdateSupplierSchema), async (c) => {
  const tenantId = c.get('tenantId');
  const body = c.get('body') as z.infer<typeof UpdateSupplierSchema>;
  const result = await db.supplier.updateMany({
    where: { id: c.req.param('id'), tenant_id: tenantId },
    data: {
      ...(body.code !== undefined ? { code: body.code } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.contact_name !== undefined ? { contact_name: body.contact_name } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.address !== undefined ? { address: body.address } : {}),
      ...(body.city !== undefined ? { city: body.city } : {}),
      ...(body.country !== undefined ? { country: body.country } : {}),
      ...(body.tax_id !== undefined ? { tax_id: body.tax_id } : {}),
      ...(body.payment_terms !== undefined ? { payment_terms: body.payment_terms } : {}),
      ...(body.tax_group_id !== undefined ? { tax_group_id: body.tax_group_id } : {}),
      ...(body.is_active !== undefined ? { is_active: body.is_active } : {}),
      ...(body.currency !== undefined ? { currency: await resolveDocumentCurrency(tenantId, body.currency) } : {}),
      updated_at: new Date(),
    },
  });
  if (result.count === 0) throw new AppError('Supplier not found.', 404, 'SUPPLIER_NOT_FOUND');
  return ok(c, null);
});

// ── Purchase Orders ───────────────────────────────────────────────────────────

app.get('/orders', guard('GET /orders'), async (c) => {
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
app.get('/orders/received-not-invoiced', guard('GET /orders/received-not-invoiced'), async (c) => {
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

app.get('/orders/:id', guard('GET /orders/:id'), async (c) => {
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

app.get('/orders/:id/changes', guard('GET /orders/:id/changes'), async (c) => {
  const exists = await db.purchaseOrder.count({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
  });
  if (exists === 0) throw new AppError('Purchase order not found', 404);
  const changes = await db.purchaseOrderChange.findMany({
    where: { tenant_id: c.get('tenantId'), purchase_order_id: c.req.param('id') },
    orderBy: { created_at: 'desc' },
    take: 100,
  });
  return ok(c, changes);
});

app.put('/orders/:id', guard('PUT /orders/:id'), async (c) => {
  const po = await db.purchaseOrder.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId'), status: 'DRAFT' },
  });
  if (!po) {
    throw new AppError(
      'PO not found or not editable. Confirmed orders use delivery updates and remainder cancellation.',
      409,
      'CONFIRMED_ORDER_DIRECT_EDIT_FORBIDDEN',
    );
  }

  const { supplier_id, warehouse_id, receive_location_id, expected_date, notes, lines } = await c.req.json();

  if (lines !== undefined) {
    await db.purchaseOrderLine.deleteMany({ where: { po_id: po.id } });

    // Same precedence as the create path, through the same resolver — see there.
    let subtotal = 0;
    const newLines: any[] = [];
    for (const [i, l] of ((lines ?? []) as any[]).entries()) {
      const priced = await purchasePriceFor(c.get('tenantId'), {
        supplierId: supplier_id ?? po.supplier_id,
        productId:  l.product_id,
        variantId:  l.variant_id || null,
        itemGroupId: await itemGroupOf(c.get('tenantId'), l.product_id),
        quantity:   Number(l.quantity),
        explicitCost: l.unit_cost === undefined ? null : Number(l.unit_cost),
      });

      const lineTotal = Number(l.quantity) * priced.unitCost;
      subtotal += lineTotal;
      newLines.push({
        po_id:      po.id,
        product_id: l.product_id,
        variant_id: l.variant_id || null,
        quantity:   Number(l.quantity),
        unit_cost:  priced.unitCost,
        line_total: lineTotal,
        sort_order: i,
        requested_delivery_date: expected_date ? new Date(expected_date) : po.expected_date,
      });
    }

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

app.post('/orders', guard('POST /orders'), validate(CreatePurchaseOrderSchema), async (c) => {
  const body = c.get('body') as any;
  // Requested currency (must be active for the tenant) or the ledger's accounting
  // currency — never a country literal. Resolved before a number is drawn.
  const currency = await resolveDocumentCurrency(c.get('tenantId'), body.currency);
  const poNumber = await allocateNumber({ tenantId: c.get('tenantId'), reference: 'PURCHASE_ORDER', legalEntityId: null });

  // Each line's cost comes from the trade agreement when one covers it, and from
  // the typed figure otherwise. `purchasePriceFor` owns that precedence —
  // agreement → explicit → product cost — so the two purchase paths (create and
  // update) cannot drift apart on it.
  //
  // A tenant with no agreements resolves EXPLICIT every time, which is exactly the
  // behaviour before migration 021.
  let subtotal = 0;
  const lines: any[] = [];
  for (const [i, l] of ((body.lines ?? []) as any[]).entries()) {
    const priced = await purchasePriceFor(c.get('tenantId'), {
      supplierId: body.supplier_id,
      productId:  l.product_id,
      variantId:  l.variant_id || null,
      itemGroupId: await itemGroupOf(c.get('tenantId'), l.product_id),
      quantity:   Number(l.quantity),
      explicitCost: l.unit_cost === undefined ? null : Number(l.unit_cost),
    });

    const lineTotal = Number(l.quantity) * priced.unitCost;
    subtotal += lineTotal;
    lines.push({
      product_id: l.product_id,
      variant_id: l.variant_id || null,
      quantity:   Number(l.quantity),
      unit_cost:  priced.unitCost,
      line_total: lineTotal,
      sort_order: i,
      requested_delivery_date: body.expected_date ? new Date(body.expected_date) : null,
    });
  }

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
      currency,
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

app.post('/orders/:id/confirm', guard('POST /orders/:id/confirm'), async (c) => {
  const po = await db.purchaseOrder.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId'), status: 'DRAFT' },
    data: { status: 'CONFIRMED', confirmed_at: new Date() },
  });
  if (po.count === 0) throw new AppError('PO not found or cannot be confirmed');
  return ok(c, null);
});

app.patch('/orders/:id/delivery', guard('PATCH /orders/:id/delivery'), async (c) => {
  const body = await c.req.json();
  const result = await updatePurchaseOrderDelivery({
    tenantId: c.get('tenantId'),
    orderId: c.req.param('id'),
    requestedDeliveryDate: body.requested_delivery_date,
    confirmedDeliveryDate: body.confirmed_delivery_date,
    reason: body.reason,
    userId: c.get('user').id,
  });
  return ok(c, result);
});

app.post(
  '/orders/:id/lines/:lineId/cancel-remainder',
  guard('POST /orders/:id/lines/:lineId/cancel-remainder'),
  async (c) => {
    const body = await c.req.json();
    const result = await cancelPurchaseOrderRemainder({
      tenantId: c.get('tenantId'),
      orderId: c.req.param('id'),
      lineId: c.req.param('lineId'),
      quantity: body.quantity,
      reason: body.reason,
      userId: c.get('user').id,
    });
    return ok(c, result);
  },
);

// ── Product receipt ───────────────────────────────────────────────────────────
//
// [OFFICIAL] a purchase order may carry MANY product receipts: "Each product
// receipt represents a partial or complete delivery of the items on the purchase
// order." This route therefore raises a document rather than flipping a status,
// and the whole of the physical update lives in productReceipt.service.
//
// The legacy shape (`POST /orders/:id/receive` with a body full of nothing) still
// works and still receives every outstanding line, so no caller breaks.
app.post('/orders/:id/receive', guard('POST /orders/:id/receive'), async (c) => {
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

app.get('/orders/:id/receipts', guard('GET /orders/:id/receipts'), async (c) => {
  const receipts = await db.productReceipt.findMany({
    where: { tenant_id: c.get('tenantId'), purchase_order_id: c.req.param('id') },
    include: {
      lines: { include: { product: { select: { sku: true, name: true } } }, orderBy: { sort_order: 'asc' } },
    },
    orderBy: { receipt_date: 'desc' },
  });
  return ok(c, receipts);
});

app.get('/receipts', guard('GET /receipts'), async (c) => {
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


app.post('/orders/:id/cancel', guard('POST /orders/:id/cancel'), async (c) => {
  const order = await db.purchaseOrder.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    select: { id: true, status: true },
  });
  if (!order) throw new AppError('Purchase order not found', 404);
  if (order.status === 'DRAFT') {
    await db.purchaseOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    return ok(c, null);
  }
  const body = await c.req.json().catch(() => ({} as any));
  const result = await cancelPurchaseOrderRemainder({
    tenantId: c.get('tenantId'),
    orderId: order.id,
    reason: body.reason,
    userId: c.get('user').id,
  });
  return ok(c, result);
});

// ── Vendor invoices ───────────────────────────────────────────────────────────
//
// [OFFICIAL] "There are several ways to enter a vendor invoice." Of the five, two
// are in scope: from a confirmed purchase order, and standalone with no order at
// all (a utility bill). The invoice register, the invoice pool and the approval
// journal are deliberately not built — see docs/process/VENDOR_INVOICE.md §7.

app.get('/invoices', guard('GET /invoices'), async (c) => {
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

app.get('/invoices/:id', guard('GET /invoices/:id'), async (c) => {
  const invoice = await db.vendorInvoice.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: {
      supplier:       true,
      purchase_order: { select: { id: true, po_number: true, status: true, warehouse_id: true } },
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

app.post('/invoices', guard('POST /invoices'), async (c) => {
  const body = await c.req.json();
  const result = await createInvoice(c.get('tenantId'), c.get('user').id, body);
  return created(c, result);
});

/** Re-run matching without posting — the "Update match status" action. */
app.post('/invoices/:id/match', guard('POST /invoices/:id/match'), async (c) => {
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
app.post('/invoices/:id/approve-discrepancies', guard('POST /invoices/:id/approve-discrepancies'), async (c) => {
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

app.post('/invoices/:id/post', guard('POST /invoices/:id/post'), async (c) => {
  const result = await postInvoice(c.get('tenantId'), c.get('user').id, c.req.param('id'));
  return ok(c, result);
});

app.post('/invoices/:id/cancel', guard('POST /invoices/:id/cancel'), async (c) => {
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
app.post('/orders/:id/receive-and-invoice', guard('POST /orders/:id/receive-and-invoice'), async (c) => {
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

// ── Trade agreements (vendor price lists) — setup ─────────────────────────────
//
// Module-scoped, per the standing rule: these live under Procurement because
// Procurement owns vendor pricing. The sales side reads the same table with
// `side = 'SALES'` and gets its own routes under Sales.

app.get('/setup/trade-agreements', guard('GET /setup/trade-agreements'), async (c) => {
  const rows = await db.tradeAgreement.findMany({
    where: { tenant_id: c.get('tenantId'), side: 'PURCHASE' },
    include: {
      supplier:   { select: { code: true, name: true } },
      product:    { select: { sku: true, name: true } },
      variant:    { select: { sku_variant: true } },
      item_group: { select: { code: true, name: true } },
    },
    orderBy: [{ is_active: 'desc' }, { valid_from: 'desc' }],
  });
  return ok(c, rows);
});

app.post('/setup/trade-agreements', guard('POST /setup/trade-agreements'), async (c) => {
  const b = await c.req.json();

  // The database enforces the shape (see migration 021's CHECKs, including the
  // official rule that a PRICE must name a specific product). This route does not
  // duplicate those rules — it translates the constraint violation into a message a
  // person can act on, so the two can never disagree.
  try {
    const row = await db.tradeAgreement.create({
      data: {
        tenant_id:        c.get('tenantId'),
        side:             'PURCHASE',
        agreement_type:   b.agreement_type ?? 'PRICE',
        party_scope:      b.party_scope ?? (b.supplier_id ? 'PARTY' : 'ALL'),
        supplier_id:      b.supplier_id ?? null,
        party_group_id:   b.party_group_id ?? null,
        product_scope:    b.product_scope ?? (b.product_id ? 'PRODUCT' : 'ALL'),
        product_id:       b.product_id ?? null,
        variant_id:       b.variant_id ?? null,
        item_group_id:    b.item_group_id ?? null,
        quantity_from:    b.quantity_from ?? 0,
        quantity_to:      b.quantity_to ?? null,
        amount:           b.amount ?? null,
        discount_percent: b.discount_percent ?? null,
        currency:         b.currency ?? null,
        price_unit:       b.price_unit ?? 1,
        valid_from:       b.valid_from ? new Date(b.valid_from) : new Date(),
        valid_to:         b.valid_to ? new Date(b.valid_to) : null,
        find_next:        b.find_next ?? false,
        note:             b.note ?? null,
        created_by:       c.get('user').id,
      },
    });
    return created(c, row);
  } catch (e: any) {
    if (typeof e?.message === 'string' && e.message.includes('trade_agreements_price_needs_product_check')) {
      throw new AppError(
        'A price agreement must name one specific product. A price is an absolute amount, so it cannot ' +
          'apply to a product group or to all products — use a line discount for that.',
        400,
        'TRADE_AGREEMENT_PRICE_NEEDS_PRODUCT',
      );
    }
    if (typeof e?.message === 'string' && e.message.includes('trade_agreements_party_target_check')) {
      throw new AppError(
        'The party on this agreement does not match its scope and side. A purchase agreement scoped to a ' +
          'party must name a supplier.',
        400,
        'TRADE_AGREEMENT_PARTY_MISMATCH',
      );
    }
    throw e;
  }
});

// Superseding a price CLOSES the old row rather than editing it. That is what keeps
// the history of what a vendor charged us and when — the reason D365 posts trade
// agreement journals rather than editing the price table in place.
app.post('/setup/trade-agreements/:id/close', guard('POST /setup/trade-agreements/:id/close'), async (c) => {
  const row = await db.tradeAgreement.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
  });
  if (!row) throw new AppError('Trade agreement not found', 404);

  const { valid_to } = await c.req.json().catch(() => ({ valid_to: null }));
  const end = valid_to ? new Date(valid_to) : new Date();

  const updated = await db.tradeAgreement.update({
    where: { id: row.id },
    data: { valid_to: end, is_active: false },
  });
  return ok(c, updated);
});

app.route('/', vendorPaymentRoutes);
app.route('/', purchaseReturnRoutes);

export default app;
