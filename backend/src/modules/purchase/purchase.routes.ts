import { Hono }    from 'hono';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';

import { logger }   from '../../shared/logger';
import { ok, created, message, paginated } from '../../shared/response';
import { validate } from '../../shared/middleware/validate';
import { CreatePurchaseOrderSchema } from '../../shared/schemas';
import { nextPurchaseOrderNumber } from '../../shared/utils/orderCounter';
import { computeDocumentTax } from '../../shared/services/documentTax.service';
import { nextJournalVoucher } from '../../shared/services/numberSequence.service';
import { resolvePostingAccounts_orExplain } from '../../shared/services/posting.service';
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

    // Tax now comes from the tenant's configured engine instead of the hardcoded
    // Bolivian constant. The TOTAL formula is left exactly as it was on purpose:
    // purchase treats `subtotal` as net and adds tax on top (the receipt posting
    // debits Inventory + IVA and credits AP for the total, so it only balances
    // that way), whereas the Bolivian IVA code is price-INCLUSIVE. Reconciling
    // those two is a finance question — parked with the co-founder list, not
    // silently changed here, because it would move every purchase total.
    const poTax = await computeDocumentTax(c.get('tenantId'), subtotal, {
      partyId: supplier_id ?? po.supplier_id, side: 'PURCHASE', legacyConfig: c.get('taxConfig'),
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
        tax_amount:   poTax.vat,
        total_amount: subtotal + poTax.vat,
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

  // Tax now comes from the tenant's configured engine instead of the hardcoded
  // Bolivian constant. The TOTAL formula is left exactly as it was on purpose:
  // purchase treats `subtotal` as net and adds tax on top (the receipt posting
  // debits Inventory + IVA and credits AP for the total, so it only balances
  // that way), whereas the Bolivian IVA code is price-INCLUSIVE. Reconciling
  // those two is a finance question — parked with the co-founder list, not
  // silently changed here, because it would move every purchase total.
  const poTax = await computeDocumentTax(c.get('tenantId'), subtotal, {
    partyId: body.supplier_id, side: 'PURCHASE', legacyConfig: c.get('taxConfig'),
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
      tax_amount:   poTax.vat,
      total_amount: subtotal + poTax.vat,
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

// RECEIVE PO — adds stock at the receive_location_id
app.post('/orders/:id/receive', requireRole('admin', 'store_manager'), async (c) => {
  const body = await c.req.json();
  const po = await db.purchaseOrder.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId'), status: { in: ['CONFIRMED', 'DRAFT'] } },
    include: { lines: true },
  });
  if (!po) throw new AppError('PO not found or already received/cancelled', 404);

  const locationId = body.receive_location_id || po.receive_location_id;
  if (!locationId) throw new AppError('Please select a receive location before receiving this PO.', 400);

  const packingSlipUrl: string | null = body.packing_slip_url || null;

  for (const line of po.lines) {
    const qty = Number(line.quantity);
    const variantId = line.variant_id ?? null;

    const existing = await db.inventoryStock.findFirst({
      where: { tenant_id: c.get('tenantId'), product_id: line.product_id, variant_id: variantId, location_id: locationId },
    });

    if (existing) {
      await db.inventoryStock.update({ where: { id: existing.id }, data: { quantity: { increment: qty } } });
    } else {
      await db.inventoryStock.create({
        data: { tenant_id: c.get('tenantId'), product_id: line.product_id, variant_id: variantId, location_id: locationId, quantity: qty, reserved_qty: 0 },
      });
    }

    await db.inventoryTransaction.create({
      data: {
        tenant_id:        c.get('tenantId'),
        transaction_type: 'PURCHASE_RECEIPT',
        reference_type:   'PURCHASE_ORDER',
        reference_id:     po.id,
        reference_number: po.po_number,
        product_id:       line.product_id,
        variant_id:       variantId,
        to_location_id:   locationId,
        quantity:         qty,
        unit_cost:        line.unit_cost,
        notes:            `PO ${po.po_number}${packingSlipUrl ? ' · packing slip attached' : ''}`,
        performed_by:     c.get('user').id,
      },
    });

    await db.inventoryBatch.create({
      data: {
        tenant_id:    c.get('tenantId'),
        product_id:   line.product_id,
        variant_id:   variantId,
        location_id:  locationId,
        source_po_id: po.id,
        po_number:    po.po_number,
        quantity:     qty,
        unit_cost:    Number(line.unit_cost),
        received_at:  new Date(),
      },
    });

    await db.purchaseOrderLine.updateMany({
      where: { id: line.id },
      data: { received_qty: { increment: qty } },
    });
  }

  const updateData: any = { status: 'RECEIVED', received_at: new Date(), received_by: c.get('user').id, receive_location_id: locationId };
  if (packingSlipUrl) updateData.packing_slip_url = packingSlipUrl;
  await db.purchaseOrder.updateMany({ where: { id: po.id }, data: updateData });

  // ── Automatic Journal Entry ────────────────────────────────────────────────
  //
  // This block used to be wrapped in `try { … } catch { logger.error(…) }`, which
  // meant a receipt could succeed with no GL entry and no error reaching the user
  // — the worst instance of D-4, because the swallow was unconditional. The catch
  // is gone: `resolvePostingAccounts_orExplain` decides, per tenant configuration,
  // whether an unresolvable posting throws or is logged loudly and skipped.
  const acc = await resolvePostingAccounts_orExplain(
    c.get('tenantId'),
    ['INVENTORY', 'VAT_INPUT', 'AP'] as const,
    { document: `PO receipt ${po.po_number}`, partyId: po.supplier_id ?? null },
  );

  if (acc) {
    const subtotal    = Number(po.subtotal);
    const ivaAmount   = Number(po.tax_amount);
    const totalAmount = Number(po.total_amount);
    // D-5: was `count() + 1` computed OUTSIDE any transaction, on a globally
    // @unique column — the loosest of the three racing implementations.
    const entryNumber = await nextJournalVoucher(c.get('tenantId'));

    await db.journalEntry.create({
      data: {
        tenant_id:    c.get('tenantId'),
        entry_number: entryNumber,
        entry_date:   new Date(),
        description:  `PO Receipt: ${po.po_number}`,
        source_module: 'PURCHASE',
        source_id:    po.id,
        status:       'POSTED',
        posted_at:    new Date(),
        created_by:   c.get('user').id,
        lines: {
          create: [
            { account_id: acc.INVENTORY, debit_amount: subtotal,  credit_amount: 0,           description: `Inventory — ${po.po_number}` },
            { account_id: acc.VAT_INPUT, debit_amount: ivaAmount, credit_amount: 0,           description: `IVA Crédito Fiscal 13%` },
            { account_id: acc.AP,        debit_amount: 0,         credit_amount: totalAmount, description: `AP — ${po.supplier_id}` },
          ],
        },
      },
    });
  }

  return message(c, `PO ${po.po_number} received successfully. Stock updated.${packingSlipUrl ? ' Packing slip attached.' : ''}`);
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
      const entryNumber = await nextJournalVoucher(c.get('tenantId'));

      await db.journalEntry.create({
        data: {
          tenant_id:    c.get('tenantId'),
          entry_number: entryNumber,
          entry_date:   paymentDate,
          description:  `AP Payment: ${po.po_number}${notes ? ' — ' + notes : ''}`,
          source_module: 'PURCHASE_PAYMENT',
          source_id:    po.id,
          status:       'POSTED',
          posted_at:    new Date(),
          created_by:   c.get('user').id,
          lines: {
            create: [
              { account_id: acc.AP,         debit_amount: totalAmount, credit_amount: 0,           description: `Clear CxP — ${po.po_number}` },
              { account_id: bankAccount.id, debit_amount: 0,           credit_amount: totalAmount, description: `Payment to supplier (${account_code})` },
            ],
          },
        },
      });
    }
  }

  return message(c, `PO ${po.po_number} marked as paid. Journal entry created.`);
});

export default app;
