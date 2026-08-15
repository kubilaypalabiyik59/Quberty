import { Hono }    from 'hono';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';

import { nextSalesOrderNumber, nextJournalEntryNumber } from '../../shared/utils/orderCounter';
import { computeDocumentTax } from '../../shared/services/documentTax.service';
import { validate } from '../../shared/middleware/validate';
import { ok, created, message } from '../../shared/response';
import { OpenSessionSchema, CloseSessionSchema, PosSaleSchema } from '../../shared/schemas';
import { logger }   from '../../shared/logger';
import { resolvePostingAccounts_orExplain } from '../../shared/services/posting.service';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

// ── Atomic factura number (same helper as finance/sales) ──────────────────────
async function nextFacturaNumber(tenantId: string): Promise<number> {
  const rows = await db.$queryRaw<{ last_number: number }[]>`
    INSERT INTO factura_counters (tenant_id, last_number, updated_at)
    VALUES (${tenantId}::uuid, 1, NOW())
    ON CONFLICT (tenant_id)
    DO UPDATE SET last_number = factura_counters.last_number + 1, updated_at = NOW()
    RETURNING last_number
  `;
  return Number(rows[0].last_number);
}

// ── Sessions ──────────────────────────────────────────────────────────────────

// Open register
app.post('/sessions/open', validate(OpenSessionSchema), async (c) => {
  const { terminal_name, opening_float, site_id, warehouse_id } = c.get('body');
  if (!terminal_name) throw new AppError('terminal_name is required');
  if (opening_float === undefined) throw new AppError('opening_float is required');

  const existing = await db.registerSession.findFirst({
    where: { tenant_id: c.get('tenantId'), terminal_name, status: 'OPEN' },
  });
  if (existing) throw new AppError(`Terminal "${terminal_name}" already has an open session (${existing.id}).`, 409);

  const session = await db.registerSession.create({
    data: {
      tenant_id:     c.get('tenantId'),
      terminal_name,
      opened_by:     c.get('user').id,
      opening_float: Number(opening_float),
      site_id:       site_id ?? null,
      warehouse_id:  warehouse_id ?? null,
    },
  });

  return created(c, session);
});

// Get current open session (by terminal_name query param)
app.get('/sessions/current', async (c) => {
  const { terminal_name } = c.req.query();
  if (!terminal_name) throw new AppError('terminal_name query param required');

  const session = await db.registerSession.findFirst({
    where: { tenant_id: c.get('tenantId'), terminal_name, status: 'OPEN' },
    orderBy: { opened_at: 'desc' },
  });

  return ok(c, session ?? null);
});

// List all sessions
app.get('/sessions', async (c) => {
  const sessions = await db.registerSession.findMany({
    where: { tenant_id: c.get('tenantId') },
    orderBy: { opened_at: 'desc' },
    take: 50,
  });
  return ok(c, sessions);
});

// Close register → returns Z-report data
app.post('/sessions/:id/close', validate(CloseSessionSchema), async (c) => {
  const { closing_float } = c.get('body');
  if (closing_float === undefined) throw new AppError('closing_float is required');

  const session = await db.registerSession.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId'), status: 'OPEN' },
  });
  if (!session) throw new AppError('Open session not found', 404);

  const closed = await db.registerSession.update({
    where: { id: session.id },
    data: {
      status:        'CLOSED',
      closed_by:     c.get('user').id,
      closed_at:     new Date(),
      closing_float: Number(closing_float),
    },
  });

  const cashExpected = Number(session.opening_float) + Number(session.total_sales);
  const overshort    = Number(closing_float) - cashExpected;

  return ok(c, {
    session: closed,
    z_report: {
      terminal_name:     session.terminal_name,
      opened_at:         session.opened_at,
      closed_at:         closed.closed_at,
      opening_float:     Number(session.opening_float),
      total_sales:       Number(session.total_sales),
      transaction_count: session.transaction_count,
      cash_expected:     cashExpected,
      closing_float:     Number(closing_float),
      over_short:        overshort,
    },
  });
});

// ── Atomic Sale ───────────────────────────────────────────────────────────────
// Single db.$transaction — stock check → deduct → SO → factura → 2 JEs → update session
// Body: { session_id, customer_name?, customer_nit?, payment_method, cash_tendered?, lines[] }
// lines[]: { product_id, variant_id?, quantity, unit_price, discount_pct? }

app.post('/sale', validate(PosSaleSchema), async (c) => {
  const {
    session_id,
    customer_name = 'Cliente Mostrador',
    customer_nit,
    payment_method = 'CASH',
    cash_tendered,
    lines,
  } = c.get('body');

  if (!session_id) throw new AppError('session_id is required');
  if (!Array.isArray(lines) || lines.length === 0) throw new AppError('lines[] are required');

  const tenantId = c.get('tenantId');
  const userId   = c.get('user').id;

  // Get counters BEFORE the transaction (atomic SQL — race-condition safe)
  const facturaNumber = await nextFacturaNumber(tenantId);
  const orderNumber   = await nextSalesOrderNumber(tenantId);
  const je1Number     = await nextJournalEntryNumber(tenantId); // Sales JE
  const je2Number     = await nextJournalEntryNumber(tenantId); // COGS JE

  const result = await db.$transaction(async (tx) => {

    // 1. Validate session
    const session = await tx.registerSession.findFirst({
      where: { id: session_id, tenant_id: tenantId, status: 'OPEN' },
    });
    if (!session) throw new AppError('Register session not found or already closed', 400);

    // 2. Stock check + deduction per line
    const processedLines: Array<{
      product_id: string; variant_id: string | null;
      quantity: number; unit_price: number; discount_pct: number;
      line_total: number; cost_price: number;
    }> = [];

    for (const line of lines) {
      const qty       = Number(line.quantity);
      const unitPrice = Number(line.unit_price);
      const discPct   = Number(line.discount_pct ?? 0);
      const lineTotal = unitPrice * qty * (1 - discPct / 100);
      const variantId: string | null = line.variant_id ?? null;

      const product = await tx.product.findFirst({
        where: { id: line.product_id, tenant_id: tenantId },
        select: { cost_price: true },
      });
      const costPrice = Number(product?.cost_price ?? 0);

      const stockRows = await tx.inventoryStock.findMany({
        where: { tenant_id: tenantId, product_id: line.product_id, variant_id: variantId },
        orderBy: { quantity: 'desc' },
      });

      const totalAvailable = stockRows.reduce((s, r) => s + r.quantity, 0);
      if (totalAvailable < qty) {
        throw new AppError(
          `Insufficient stock for product ${line.product_id}. Available: ${totalAvailable}, Requested: ${qty}`,
          400
        );
      }

      let remaining = qty;
      for (const stockRow of stockRows) {
        if (remaining <= 0) break;
        const deduct = Math.min(stockRow.quantity, remaining);

        await tx.inventoryStock.updateMany({
          where: { id: stockRow.id },
          data: { quantity: { decrement: deduct } },
        });

        await tx.inventoryTransaction.create({
          data: {
            tenant_id:        tenantId,
            transaction_type: 'OUTBOUND',
            reference_type:   'POS_SALE',
            product_id:       line.product_id,
            variant_id:       variantId,
            from_location_id: stockRow.location_id,
            quantity:         deduct,
            unit_cost:        costPrice,
            notes:            `POS sale — Factura #${String(facturaNumber).padStart(6, '0')}`,
            performed_by:     userId,
          },
        });

        remaining -= deduct;
      }

      processedLines.push({ product_id: line.product_id, variant_id: variantId, quantity: qty, unit_price: unitPrice, discount_pct: discPct, line_total: lineTotal, cost_price: costPrice });
    }

    // 3. Totals
    const totalAmount = processedLines.reduce((s, l) => s + l.line_total, 0);
    const docTax = await computeDocumentTax(tenantId, totalAmount, {
      legacyConfig: c.get('taxConfig'), client: tx,
    });
    const { subtotal, vat: ivaAmount, turnover: itAmount } = docTax;
    const cogsTotal = processedLines.reduce((s, l) => s + l.cost_price * l.quantity, 0);
    const changeDue = cash_tendered !== undefined ? Number(cash_tendered) - totalAmount : 0;

    // 5. Create SalesOrder (COMPLETED immediately)
    const order = await tx.salesOrder.create({
      data: {
        tenant_id:    tenantId,
        order_number: orderNumber,
        source:       'pos',
        status:       'COMPLETED',
        subtotal,
        tax_amount:   ivaAmount,
        total_amount: totalAmount,
        completed_at: new Date(),
        paid_at:      new Date(),
        paid_by:      userId,
        created_by:   userId,
        notes:        `POS sale — ${session.terminal_name}`,
        lines: {
          create: processedLines.map((l, i) => ({
            product_id:   l.product_id,
            variant_id:   l.variant_id,
            quantity:     l.quantity,
            unit_price:   l.unit_price,
            discount_pct: l.discount_pct,
            line_total:   l.line_total,
            sort_order:   i,
          })),
        },
      },
    });

    // 6. Create Factura
    const factura = await tx.factura.create({
      data: {
        tenant_id:      tenantId,
        factura_number: facturaNumber,
        source_type:    'POS_SALE',
        source_id:      order.id,
        customer_name,
        customer_nit:   customer_nit ?? null,
        invoice_date:   new Date(),
        subtotal,
        iva_amount:     ivaAmount,
        it_amount:      itAmount,
        total_amount:   totalAmount,
        notes:          `POS — ${session.terminal_name} — ${orderNumber}`,
        created_by:     userId,
      },
    });

    // Link factura back to order
    await tx.salesOrder.update({ where: { id: order.id }, data: { invoice_id: factura.id } });

    // 7. GL Journal Entries — numbers pre-allocated atomically above (no race condition)
    //
    // Accounts now come from posting profiles. Previously this block used the
    // literals '2105' and '1201', while sales.routes.ts used '2103' and '1103'
    // for the same concepts — two modules, two charts of accounts (D-2). '1201'
    // is *Activo Fijo* under the seed chart, so POS was debiting Fixed Assets on
    // every sale (D-6).
    const acc = await resolvePostingAccounts_orExplain(
      tenantId,
      ['AR', 'REVENUE', 'VAT_OUTPUT', 'TAX_TURNOVER_EXPENSE', 'TAX_TURNOVER_PAYABLE', 'INVENTORY', 'COGS'] as const,
      { document: `POS sale ${orderNumber}`, client: tx },
    );

    if (acc) {
      await tx.journalEntry.create({
        data: {
          tenant_id:    tenantId,
          entry_number: je1Number,
          entry_date:   new Date(),
          description:  `POS Sale: ${orderNumber} — Factura #${String(facturaNumber).padStart(6, '0')}`,
          source_module: 'POS_SALE',
          source_id:    order.id,
          status:       'POSTED',
          posted_at:    new Date(),
          created_by:   userId,
          lines: {
            create: [
              { account_id: acc.AR,      debit_amount: totalAmount, credit_amount: 0,         description: `CxC — ${orderNumber}` },
              { account_id: acc.REVENUE, debit_amount: 0,           credit_amount: subtotal,  description: `Ventas — ${orderNumber}` },
              { account_id: acc.VAT_OUTPUT, debit_amount: 0,        credit_amount: ivaAmount, description: `IVA Débito Fiscal — ${orderNumber}` },
              // D-3: POS never accrued IT. Every POS sale under-declared the 3%
              // transaction tax, and for a retailer whose sales are overwhelmingly
              // POS that was most of the IT liability. Sales invoices always posted
              // these two lines; POS simply omitted them.
              { account_id: acc.TAX_TURNOVER_EXPENSE, debit_amount: itAmount, credit_amount: 0,        description: `IT 3% expense — ${orderNumber}` },
              { account_id: acc.TAX_TURNOVER_PAYABLE, debit_amount: 0,        credit_amount: itAmount, description: `IT por Pagar 3% — ${orderNumber}` },
            ],
          },
        },
      });
    }

    // Gated on the SAME `acc` as the revenue entry above, deliberately. These used
    // to have independent guards, so when the revenue block failed on a missing
    // account the COGS block still posted — inventory relieved and cost recognised
    // against no sale at all. That is the severe half of D-2. Either both post or
    // neither does.
    if (acc && cogsTotal > 0) {
      await tx.journalEntry.create({
        data: {
          tenant_id:    tenantId,
          entry_number: je2Number,
          entry_date:   new Date(),
          description:  `COGS: ${orderNumber}`,
          source_module: 'POS_COGS',
          source_id:    order.id,
          status:       'POSTED',
          posted_at:    new Date(),
          created_by:   userId,
          lines: {
            create: [
              { account_id: acc.COGS,      debit_amount: cogsTotal, credit_amount: 0,         description: `COGS — ${orderNumber}` },
              { account_id: acc.INVENTORY, debit_amount: 0,         credit_amount: cogsTotal, description: `Inventario — ${orderNumber}` },
            ],
          },
        },
      });
    }

    // 8. Update register session totals
    await tx.registerSession.update({
      where: { id: session.id },
      data: {
        total_sales:       { increment: totalAmount },
        transaction_count: { increment: 1 },
      },
    });

    return { order, factura, totalAmount, subtotal, ivaAmount, itAmount, changeDue };
  });

  return created(c, {
    order_id:       result.order.id,
    order_number:   result.order.order_number,
    factura_id:     result.factura.id,
    factura_number: result.factura.factura_number,
    total:          result.totalAmount,
    subtotal:       result.subtotal,
    iva_amount:     result.ivaAmount,
    it_amount:      result.itAmount,
    change_due:     result.changeDue,
  });
});

// ── Void POS Sale ─────────────────────────────────────────────────────────────
// Reverses a same-day COMPLETED POS sale: restores stock, reverses GL entries,
// marks order VOIDED, decrements session totals.
app.post('/sales/:orderId/void', async (c) => {
  const orderId  = c.req.param('orderId');
  const tenantId = c.get('tenantId');
  const userId   = c.get('user').id;

  const order = await db.salesOrder.findFirst({
    where: { id: orderId, tenant_id: tenantId, status: 'COMPLETED', source: 'pos' },
    include: { lines: true },
  });

  if (!order) {
    throw new AppError('POS sale not found or cannot be voided (must be COMPLETED and from POS)', 404);
  }

  // Only allow void on same calendar day
  const today     = new Date();
  const orderDate = new Date(order.created_at);
  const sameDay =
    orderDate.getFullYear() === today.getFullYear() &&
    orderDate.getMonth()    === today.getMonth()    &&
    orderDate.getDate()     === today.getDate();

  if (!sameDay) {
    throw new AppError('POS sales can only be voided on the same day they were created', 400);
  }

  await db.$transaction(async (tx) => {

    // 1. Mark order VOIDED
    await tx.salesOrder.update({
      where: { id: orderId },
      data: { status: 'VOIDED', returned_at: new Date() },
    });

    // 2. Restore stock for each line
    for (const line of order.lines) {
      const variantId: string | null = line.variant_id ?? null;

      const stockRow = await tx.inventoryStock.findFirst({
        where: { tenant_id: tenantId, product_id: line.product_id, variant_id: variantId },
        orderBy: { quantity: 'desc' },
      });

      if (stockRow) {
        await tx.inventoryStock.update({
          where: { id: stockRow.id },
          data: { quantity: { increment: line.quantity } },
        });
      } else {
        await tx.inventoryStock.create({
          data: {
            tenant_id:    tenantId,
            product_id:   line.product_id,
            variant_id:   variantId,
            location_id:  null as any,
            quantity:     line.quantity,
            reserved_qty: 0,
          },
        });
      }

      await tx.inventoryTransaction.create({
        data: {
          tenant_id:        tenantId,
          transaction_type: 'VOID_RETURN',
          reference_type:   'POS_VOID',
          reference_id:     orderId,
          product_id:       line.product_id,
          variant_id:       variantId,
          quantity:         line.quantity,
          notes:            `Void of POS sale ${order.order_number}`,
          performed_by:     userId,
        },
      });
    }

    // 3. Reversal GL entries
    try {
      const totalAmount = Number(order.total_amount);
      const voidTax = await computeDocumentTax(tenantId, totalAmount, {
        legacyConfig: c.get('taxConfig'), client: tx,
      });
      const { subtotal, vat: ivaAmount } = voidTax;

      // Calculate COGS from current product cost prices
      let cogsTotal = 0;
      for (const line of order.lines) {
        const product = await tx.product.findFirst({
          where:  { id: line.product_id, tenant_id: tenantId },
          select: { cost_price: true },
        });
        cogsTotal += Number(product?.cost_price ?? 0) * line.quantity;
      }

      // Pre-allocate JE numbers atomically
      const voidJe1 = await nextJournalEntryNumber(tenantId); // Sales reversal
      const voidJe2 = cogsTotal > 0 ? await nextJournalEntryNumber(tenantId) : null; // COGS reversal

      // Same posting profiles as the forward sale, so a void can never reverse
      // into different accounts than the sale it is undoing.
      const vAcc = await resolvePostingAccounts_orExplain(
        tenantId,
        ['AR', 'REVENUE', 'VAT_OUTPUT', 'INVENTORY', 'COGS'] as const,
        { document: `POS void ${order.order_number}`, client: tx },
      );

      if (vAcc) {
        await tx.journalEntry.create({
          data: {
            tenant_id:     tenantId,
            entry_number:  voidJe1,
            entry_date:    new Date(),
            description:   `VOID: ${order.order_number}`,
            source_module: 'POS_VOID',
            source_id:     orderId,
            status:        'POSTED',
            posted_at:     new Date(),
            created_by:    userId,
            lines: {
              create: [
                { account_id: vAcc.REVENUE,    debit_amount: subtotal,     credit_amount: 0,           description: `Reverse Ventas — ${order.order_number}` },
                { account_id: vAcc.VAT_OUTPUT, debit_amount: ivaAmount,    credit_amount: 0,           description: `Reverse IVA Débito — ${order.order_number}` },
                { account_id: vAcc.AR,         debit_amount: 0,            credit_amount: totalAmount, description: `Reverse CxC — ${order.order_number}` },
              ],
            },
          },
        });
      }

      // COGS reversal — was missing before (Dr 1110 Inventario / Cr 5101 COGS)
      if (voidJe2 && vAcc && cogsTotal > 0) {
        await tx.journalEntry.create({
          data: {
            tenant_id:     tenantId,
            entry_number:  voidJe2,
            entry_date:    new Date(),
            description:   `VOID COGS: ${order.order_number}`,
            source_module: 'POS_VOID',
            source_id:     orderId,
            status:        'POSTED',
            posted_at:     new Date(),
            created_by:    userId,
            lines: {
              create: [
                { account_id: vAcc.INVENTORY, debit_amount: cogsTotal, credit_amount: 0,         description: `Restore Inventario — ${order.order_number}` },
                { account_id: vAcc.COGS,      debit_amount: 0,         credit_amount: cogsTotal, description: `Reverse COGS — ${order.order_number}` },
              ],
            },
          },
        });
      }
    } catch (jeErr) {
      logger.error({ err: jeErr }, 'GL reversal journal failed for POS void');
    }

    // 4. Decrement session totals
    const openSession = await tx.registerSession.findFirst({
      where: { tenant_id: tenantId, status: 'OPEN' },
      orderBy: { opened_at: 'desc' },
    });

    if (openSession) {
      await tx.registerSession.update({
        where: { id: openSession.id },
        data: {
          total_sales:       { decrement: Number(order.total_amount) },
          transaction_count: { decrement: 1 },
        },
      });
    }
  });

  return message(c, `Sale ${order.order_number} voided. Stock restored.`);
});

export default app;
