import { Hono }    from 'hono';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';

import { nextSalesOrderNumber } from '../../shared/utils/orderCounter';
import { nextFacturaNumber } from '../../shared/services/numberSequence.service';
import { postJournal } from '../../shared/services/journal.service';
import { contextForSalesOrder } from '../../shared/services/dimension.service';
import { writeFacturaLines, linesFromSalesOrder, markInvoiced } from '../../shared/services/facturaLine.service';
import { computeDocumentTax } from '../../shared/services/documentTax.service';
import { validate } from '../../shared/middleware/validate';
import { ok, created, message } from '../../shared/response';
import { OpenSessionSchema, CloseSessionSchema, PosSaleSchema, VoidPosSaleSchema } from '../../shared/schemas';
import { planTenders, tenderDebitLines, closeSessionDeclarations, lockRegisterSession } from './posTender.service';
import { reverseJournal } from '../../shared/services/journal.service';
import { assertTenantReferences } from '../../shared/services/tenantReference.service';
import { logger }   from '../../shared/logger';
import { resolvePostingAccounts_orExplain } from '../../shared/services/posting.service';
import { resolveInventoryDimensions } from '../../shared/services/inventoryDimension.service';
import { resolveRegisterWarehouse } from './posStock.service';
import { issueAvailable, restoreIssues } from '../../shared/services/stockLedger.service';
import { postIssueCogs } from '../sales/sales.service';
import { getLedgerCurrencies } from '../../shared/services/currency/ledgerCurrency.service';
import { routeGuard, type RouteGuards } from '../../shared/middleware/permissions';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

/**
 * The permission each route requires (WORK-030a). Exported so a test can pin the
 * map and prove every route in this file has exactly one entry; the guard is the
 * first middleware, so a denial happens before validation and before the database.
 */
export const POS_ROUTE_PERMISSIONS = Object.freeze({
  'POST /sessions/open': ['pos.session.operate'],
  'GET /sessions/current': ['pos.session.operate'],
  'GET /sessions': ['pos.session.read'],
  'GET /sessions/:id': ['pos.session.read'],
  'POST /sessions/:id/close': ['pos.session.operate'],
  'POST /sale': ['pos.sale.post'],
  'POST /sales/:orderId/void': ['pos.sale.void'],
} satisfies RouteGuards);

const guard = routeGuard(POS_ROUTE_PERMISSIONS);


// The local allocator that used to live here was the most dangerous of the three
// copies: on a tenant with no `factura_counters` row yet it started the LEGAL
// series at the literal 1, regardless of how many facturas had already been
// issued, and left the unique constraint to notice. The series is now owned by
// the FACTURA number sequence like every other document. See migration 023.

// ── Sessions ──────────────────────────────────────────────────────────────────

// Open register
app.post('/sessions/open', guard('POST /sessions/open'), validate(OpenSessionSchema), async (c) => {
  // `site_id` from the body is ignored: the site is the warehouse's site.
  const { terminal_name, opening_float, warehouse_id } = c.get('body');
  if (!terminal_name) throw new AppError('terminal_name is required');
  if (opening_float === undefined) throw new AppError('opening_float is required');

  const existing = await db.registerSession.findFirst({
    where: { tenant_id: c.get('tenantId'), terminal_name, status: 'OPEN' },
  });
  if (existing) throw new AppError(`Terminal "${terminal_name}" already has an open session (${existing.id}).`, 409);

  const store = await resolveRegisterWarehouse(c.get('tenantId'), warehouse_id);

  const session = await db.registerSession.create({
    data: {
      tenant_id:     c.get('tenantId'),
      terminal_name,
      opened_by:     c.get('user').id,
      opening_float: Number(opening_float),
      site_id:       store.site_id,
      warehouse_id:  store.warehouse_id,
    },
  });

  return created(c, session);
});

// Get current open session (by terminal_name query param)
app.get('/sessions/current', guard('GET /sessions/current'), async (c) => {
  const { terminal_name } = c.req.query();
  if (!terminal_name) throw new AppError('terminal_name query param required');

  const session = await db.registerSession.findFirst({
    where: { tenant_id: c.get('tenantId'), terminal_name, status: 'OPEN' },
    orderBy: { opened_at: 'desc' },
  });

  return ok(c, session ?? null);
});

// List sessions — a manager's or auditor's review of the registers (WORK-047).
app.get('/sessions', guard('GET /sessions'), async (c) => {
  const sessions = await db.registerSession.findMany({
    where: { tenant_id: c.get('tenantId') },
    orderBy: { opened_at: 'desc' },
    take: 50,
  });
  return ok(c, sessions);
});

// One session with its declarations: the Z report of a closed register.
app.get('/sessions/:id', guard('GET /sessions/:id'), async (c) => {
  const session = await db.registerSession.findFirst({ where: { id: c.req.param('id'), tenant_id: c.get('tenantId') } });
  if (!session) throw new AppError('Register session not found', 404);
  const declarations = await db.registerSessionDeclaration.findMany({
    where: { register_session_id: session.id },
    include: { payment_method: { select: { code: true, name: true, tender_type: true } } },
  });
  return ok(c, { ...session, declarations });
});

// Close register → declarations per payment method, the difference voucher and the
// Z report (WORK-047). Card and QR are no longer counted as cash.
app.post('/sessions/:id/close', guard('POST /sessions/:id/close'), validate(CloseSessionSchema), async (c) => {
  const body = c.get('body') as { closing_float?: number; declarations?: Array<{ payment_method_id: string; counted: number }> };
  const tenantId = c.get('tenantId');
  const user = c.get('user');

  const result = await db.$transaction(async (tx) => {
    // Locked first: no sale or void can commit into this register while it closes.
    const locked = await lockRegisterSession(tx, tenantId, c.req.param('id'));
    if (!locked) throw new AppError('Register session not found', 404);
    if (locked.status !== 'OPEN') throw new AppError('This register is already closed.', 409, 'SESSION_ALREADY_CLOSED');
    const session = await tx.registerSession.findFirst({
      where: { id: c.req.param('id'), tenant_id: tenantId, status: 'OPEN' },
    });
    if (!session) throw new AppError('Open session not found', 404);

    const declared = await closeSessionDeclarations(tx, {
      tenantId, session, declarations: body.declarations ?? [], closingFloat: body.closing_float,
      userRole: user.role, userId: user.id,
    });

    const claimed = await tx.registerSession.updateMany({
      where: { id: session.id, status: 'OPEN' },
      data: {
        status: 'CLOSED', closed_by: user.id, closed_at: new Date(),
        closing_float: declared.cashCounted ?? body.closing_float ?? 0,
      },
    });
    if (claimed.count === 0) throw new AppError('This register was closed meanwhile', 409, 'SESSION_ALREADY_CLOSED');
    const closed = await tx.registerSession.findUniqueOrThrow({ where: { id: session.id } });
    return { session, closed, declared };
  });

  const cashRow = result.declared.rows.find((r) => r.tender_type === 'CASH');
  return ok(c, {
    session: result.closed,
    z_report: {
      terminal_name:     result.session.terminal_name,
      opened_at:         result.session.opened_at,
      closed_at:         result.closed.closed_at,
      opening_float:     Number(result.session.opening_float),
      total_sales:       Number(result.session.total_sales),
      transaction_count: result.session.transaction_count,
      // Kept for the older screens: the cash drawer only.
      cash_expected:     cashRow?.expected ?? Number(result.session.opening_float),
      closing_float:     cashRow?.counted ?? Number(result.closed.closing_float ?? 0),
      over_short:        cashRow?.difference ?? 0,
      tenders:           result.declared.rows,
      difference_journal_entry_id: result.declared.journalEntryId,
    },
  });
});

// Single db.$transaction — stock check → deduct → SO → factura → 2 JEs → update session
// Body: { session_id, customer_name?, customer_nit?, payment_method, cash_tendered?, lines[] }
// lines[]: { product_id, variant_id?, quantity, unit_price, discount_pct? }

app.post('/sale', guard('POST /sale'), validate(PosSaleSchema), async (c) => {
  const body = c.get('body');
  const {
    session_id,
    customer_id,
    customer_name = 'Cliente Mostrador',
    customer_nit,
    lines,
    factura_number: manualFacturaNumber,
  } = body;

  if (!session_id) throw new AppError('session_id is required');
  if (!Array.isArray(lines) || lines.length === 0) throw new AppError('lines[] are required');

  const tenantId = c.get('tenantId');
  const userId   = c.get('user').id;

  // The order number is still drawn before the transaction: it is an internal
  // commercial reference with no legal sequence requirement, so a gap costs
  // nothing. The FACTURA number is not — it is now allocated inside the
  // transaction below, because a continuous legal series allocated out here
  // leaves a hole in the ledger every time a sale fails after allocation.
  const orderNumber = await nextSalesOrderNumber(tenantId);

  // The register sells in the ledger's accounting currency. **[OFFICIAL]** a retail
  // channel is configured with one currency, so the till never sends one:
  //   learn.microsoft.com/dynamics365/commerce/channel-setup-retail
  // Resolved before the transaction opens, so a tenant with no ledger is refused
  // with 422 LEDGER_CURRENCY_NOT_CONFIGURED before any FACTURA number is drawn.
  const ledger = await getLedgerCurrencies(tenantId);
  // A named customer must be this tenant's; the sale is taxed and recorded against it.
  if (customer_id) await assertTenantReferences(tenantId, { customerId: customer_id });

  // Voucher numbers are no longer pre-allocated here. POS drew them from
  // `order_counters` via nextJournalEntryNumber (format `JE-000001`) while every
  // other module drew them from the configured NumberSequence (format
  // `JE-2026-00081`) — two independent series numbering the same ledger, and only
  // one of them a tenant can configure. postJournal allocates from the sequence,
  // so there is one series again.

  const result = await db.$transaction(async (tx) => {

    // 1. Lock and validate the session — before the FACTURA number, so a sale can
    //    never commit into a register that closed meanwhile.
    const locked = await lockRegisterSession(tx, tenantId, session_id);
    if (!locked || locked.status !== 'OPEN') throw new AppError('Register session not found or already closed', 400, 'SESSION_NOT_OPEN');
    const session = await tx.registerSession.findFirst({
      where: { id: session_id, tenant_id: tenantId, status: 'OPEN' },
    });
    if (!session) throw new AppError('Register session not found or already closed', 400);

    // Refused before the FACTURA number is allocated, so no legal number is spent.
    if (!session.warehouse_id) {
      throw new AppError(
        'This register session has no warehouse. Close it and reopen the register against a warehouse.',
        422,
        'POS_SESSION_WAREHOUSE_REQUIRED',
      );
    }
    const sessionWarehouseId = session.warehouse_id;

    // 2. Lines, then the tenders, then the legal number, then the stock issue
    const processedLines: Array<{
      product_id: string; variant_id: string | null;
      quantity: number; unit_price: number; discount_pct: number;
      line_total: number;
    }> = [];

    for (const line of lines) {
      const qty       = Number(line.quantity);
      const unitPrice = Number(line.unit_price);
      const discPct   = Number(line.discount_pct ?? 0);
      const lineTotal = unitPrice * qty * (1 - discPct / 100);
      processedLines.push({ product_id: line.product_id, variant_id: line.variant_id ?? null, quantity: qty, unit_price: unitPrice, discount_pct: discPct, line_total: lineTotal });
    }
    const saleTotal = processedLines.reduce((s, l) => s + l.line_total, 0);

    // How it was paid, validated before the FACTURA number is allocated: tenders
    // must add up to the total, only cash gives change, customer account is refused.
    const tenders = await planTenders(tx, tenantId, saleTotal, body);

    // Allocated inside the transaction: the FACTURA series is continuous, so the
    // row lock is held until this sale commits and a failed sale burns no number.
    // Already rendered through the sequence format — do not pad it again.
    const facturaNumber = await nextFacturaNumber(tenantId, tx, {
      manualNumber: manualFacturaNumber,
    });

    // Only the register's own warehouse, only stock nobody else holds, and at the
    // cost of the FIFO layers it consumes there (WORK-043/044). A line that cannot
    // be covered refuses the sale inside this transaction, so the FACTURA number
    // allocated above is rolled back with it.
    const issue = await issueAvailable(tx, {
      warehouseId: sessionWarehouseId,
      lines: processedLines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity })),
      meta: {
        tenantId,
        transactionType: 'OUTBOUND',
        referenceType: 'POS_SALE',
        referenceId: null,
        referenceNumber: orderNumber,
        notes: `POS sale — Factura #${facturaNumber}`,
        userId,
      },
    });
    const posTransactionIds = issue.transactionIds;

    // 3. Totals
    const totalAmount = processedLines.reduce((s, l) => s + l.line_total, 0);
    const docTax = await computeDocumentTax(tenantId, totalAmount, {
      legacyConfig: c.get('taxConfig'), client: tx, partyId: customer_id ?? null,
    });
    const { subtotal, vat: ivaAmount, turnover: itAmount } = docTax;
    const changeDue = Math.round(tenders.reduce((s, t) => s + (t.change ?? 0), 0) * 100) / 100;

    // 5. Create SalesOrder (COMPLETED immediately)
    //
    // The register session has carried a site and a warehouse since it was
    // opened, and until now the sale simply did not copy them — which is the
    // larger half of why 41 of 51 sales orders could not say where they shipped
    // from. The session's warehouse is the explicit answer here; the resolver
    // still runs so a session opened without one falls through to the tenant
    // default and so the tenant's `require_warehouse_on_sales_order` switch
    // applies to the counter exactly as it does to the back office.
    const dims = await resolveInventoryDimensions(
      tenantId,
      { warehouseId: session.warehouse_id, documentKind: 'POS sale' },
      tx,
    );

    const order = await tx.salesOrder.create({
      data: {
        tenant_id:    tenantId,
        order_number: orderNumber,
        source:       'pos',
        status:       'COMPLETED',
        customer_id:  customer_id ?? null,
        currency:     ledger.accountingCurrency,
        site_id:      dims.site_id,
        warehouse_id: dims.warehouse_id,
        subtotal,
        tax_amount:   ivaAmount,
        total_amount: totalAmount,
        completed_at: new Date(),
        paid_at:      new Date(),
        paid_by:      userId,
        created_by:   userId,
        register_session_id: session.id,
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

    // How it was paid, one row per tender, with the method's type and account
    // snapshotted so a later change to the method does not rewrite this sale.
    for (const t of tenders) {
      await tx.posTender.create({
        data: {
          tenant_id: tenantId, sales_order_id: order.id, register_session_id: session.id,
          payment_method_id: t.method.id, tender_type: t.method.tender_type, account_id: t.method.account_id,
          amount: t.amount, tendered: t.tendered, change: t.change,
        },
      });
    }

    // Stamp the stock movements with the sale they belong to. A void uses this
    // link to put each unit back where it was taken from.
    if (posTransactionIds.length) {
      await tx.inventoryTransaction.updateMany({
        where: { id: { in: posTransactionIds }, tenant_id: tenantId },
        data: { reference_id: order.id, reference_number: orderNumber },
      });
    }

    // 6. Create Factura (number allocated at the top of this transaction)
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

    // Lines, so a POS factura says what was sold. For a retailer whose revenue is
    // overwhelmingly POS this is where the line detail actually matters.
    const posLines = await linesFromSalesOrder(tenantId, order.id, { client: tx, onlyUninvoiced: true });
    await writeFacturaLines(
      tenantId,
      factura.id,
      posLines,
      { subtotal, ivaAmount, itAmount, totalAmount },
      { customerId: order.customer_id ?? null, client: tx },
    );
    await markInvoiced(factura.id, tx);

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
      ['REVENUE', 'VAT_OUTPUT', 'TAX_TURNOVER_EXPENSE', 'TAX_TURNOVER_PAYABLE', 'INVENTORY', 'COGS'] as const,
      { document: `POS sale ${orderNumber}`, client: tx },
    );

    if (acc) {
      await postJournal({
        tenantId,
        tx,
        description:  `POS Sale: ${orderNumber} — Factura #${facturaNumber}`,
        source:       { module: 'POS_SALE', id: order.id },
        userId,
        // The register session's warehouse, derived to a site by migration 011 when
        // the order was created a few lines above. This is the store axis on a POS
        // sale, which for this business is most of the revenue.
        dimensions:   await contextForSalesOrder(tenantId, order.id, tx),
        lines: [
              // Each tender debits its method's account — cash, card clearing, bank —
              // not accounts receivable, which nothing would ever clear (WORK-047).
              ...tenderDebitLines(tenders, orderNumber),
              { accountId: acc.REVENUE, credit: subtotal,    description: `Ventas — ${orderNumber}` },
              { accountId: acc.VAT_OUTPUT, credit: ivaAmount, description: `IVA Débito Fiscal — ${orderNumber}` },
              // D-3: POS never accrued IT. Every POS sale under-declared the 3%
              // transaction tax, and for a retailer whose sales are overwhelmingly
              // POS that was most of the IT liability. Sales invoices always posted
              // these two lines; POS simply omitted them.
              { accountId: acc.TAX_TURNOVER_EXPENSE, debit:  itAmount, description: `IT 3% expense — ${orderNumber}` },
              { accountId: acc.TAX_TURNOVER_PAYABLE, credit: itAmount, description: `IT por Pagar 3% — ${orderNumber}` },
        ],
      });
    }

    // Gated on the SAME `acc` as the revenue entry above, deliberately. These used
    // to have independent guards, so when the revenue block failed on a missing
    // account the COGS block still posted — inventory relieved and cost recognised
    // against no sale at all. That is the severe half of D-2. Either both post or
    // neither does.
    //
    // COGS is the cost of the layers the sale consumed, per item group — no longer
    // quantity × Product.cost_price.
    if (acc) {
      await postIssueCogs(tx, tenantId, {
        costByProduct: issue.costByProduct,
        document: orderNumber,
        sourceModule: 'POS_COGS',
        sourceId: order.id,
        userId,
        dimensionsFor: () => contextForSalesOrder(tenantId, order.id, tx),
      });
    }

    // 8. Update register session totals — only while it is still open.
    const counted = await tx.registerSession.updateMany({
      where: { id: session.id, status: 'OPEN' },
      data: {
        total_sales:       { increment: totalAmount },
        transaction_count: { increment: 1 },
      },
    });
    if (counted.count !== 1) throw new AppError('This register was closed meanwhile.', 409, 'SESSION_ALREADY_CLOSED');

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
// Annuls a sale while the session it was rung in is still open (WORK-047): its
// factura is CANCELLED and keeps its number, every voucher it posted is reversed —
// revenue, IVA, IT and COGS, at the amounts it posted — the stock returns to the
// layers it came from, and the tenders leave that session's totals.
app.post('/sales/:orderId/void', guard('POST /sales/:orderId/void'), validate(VoidPosSaleSchema), async (c) => {
  const orderId  = c.req.param('orderId');
  const tenantId = c.get('tenantId');
  const userId   = c.get('user').id;
  const { reason } = c.get('body') as { reason: string };

  const params = await db.salesParameters.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: null },
    select: { pos_void_mode: true },
  });
  const mode = params?.pos_void_mode ?? 'ANNUL_IN_SESSION';
  if (mode !== 'ANNUL_IN_SESSION') {
    throw new AppError('Voiding POS sales is switched off for this company. Post a return instead.', 409, 'POS_VOID_DISABLED');
  }

  const order = await db.salesOrder.findFirst({
    where: { id: orderId, tenant_id: tenantId, source: 'pos' },
    include: { lines: true },
  });
  if (!order || order.status !== 'COMPLETED') {
    throw new AppError('POS sale not found or cannot be voided (must be COMPLETED and from POS)', 404);
  }
  const session = order.register_session_id
    ? await db.registerSession.findFirst({ where: { id: order.register_session_id, tenant_id: tenantId } })
    : null;
  if (!session || session.status !== 'OPEN') {
    throw new AppError(
      'This sale can no longer be voided: the register session it was rung in is closed. Post a return instead.',
      409,
      'POS_VOID_SESSION_CLOSED',
    );
  }

  await db.$transaction(async (tx) => {
    // 0. Lock the register and re-check it is open: a close committing meanwhile
    //    must win, and the void then refuses rather than annulling after close.
    const locked = await lockRegisterSession(tx, tenantId, session.id);
    if (!locked || locked.status !== 'OPEN') {
      throw new AppError(
        'This sale can no longer be voided: the register session it was rung in is closed. Post a return instead.',
        409,
        'POS_VOID_SESSION_CLOSED',
      );
    }

    // 1. Claim the sale. A second void of the same sale finds nothing to claim.
    const claimed = await tx.salesOrder.updateMany({
      where: { id: orderId, tenant_id: tenantId, status: 'COMPLETED', source: 'pos' },
      data: { status: 'VOIDED', returned_at: new Date() },
    });
    if (claimed.count === 0) {
      throw new AppError('This POS sale has already been voided.', 409, 'POS_SALE_ALREADY_VOIDED');
    }

    // 2. Stock back on the very layers it was sold from.
    const issues = await tx.inventoryTransaction.findMany({
      where: { tenant_id: tenantId, reference_type: 'POS_SALE', reference_id: order.id, transaction_type: 'OUTBOUND' },
      select: { id: true },
    });
    const restored = await restoreIssues(tx, {
      tenantId,
      issueTransactionIds: issues.map((t) => t.id),
      mode: 'SAME_LAYERS',
      transactionType: 'VOID_RETURN',
      referenceType: 'POS_VOID',
      referenceId: order.id,
      referenceNumber: order.order_number,
      notes: `Void of POS sale ${order.order_number}: ${reason}`,
      userId,
    });
    if (issues.length > 0 && restored.transactionIds.length === 0) {
      throw new AppError(`The stock of ${order.order_number} has already been put back.`, 409, 'POS_VOID_NOTHING_TO_RESTORE');
    }

    // 3. Every voucher the sale posted is reversed exactly — revenue, IVA, IT and
    //    COGS — rather than recomputed at today's tax setup.
    const entries = await tx.journalEntry.findMany({
      where: { tenant_id: tenantId, source_id: order.id, source_module: { in: ['POS_SALE', 'POS_COGS'] }, status: 'POSTED', is_correction: false },
      select: { id: true, source_module: true },
    });
    let saleReversalId: string | null = null;
    for (const entry of entries) {
      const reversal = await reverseJournal({ tenantId, entryId: entry.id, reason: `POS void: ${reason}`, userId, tx });
      if (entry.source_module === 'POS_SALE') saleReversalId = (reversal as any).id ?? null;
    }
    // A factura is never annulled without the reversal of its sale voucher, unless
    // the tenant deliberately posts without balanced vouchers (review 6).
    if (order.invoice_id && !saleReversalId) {
      const finance = await tx.financeParameters.findFirst({
        where: { tenant_id: tenantId, legal_entity_id: null },
        select: { require_balanced_posting: true },
      });
      if (finance?.require_balanced_posting ?? true) {
        throw new AppError(
          `${order.order_number} has no posted sale voucher to reverse, so its factura cannot be annulled.`,
          409,
          'POS_VOID_VOUCHER_MISSING',
        );
      }
    }

    // 4. The factura is annulled, keeping its number.
    if (order.invoice_id) {
      const annulled = await tx.factura.updateMany({
        where: { id: order.invoice_id, tenant_id: tenantId, status: 'ISSUED' },
        data: {
          status: 'CANCELLED', cancelled_at: new Date(), cancelled_by: userId,
          cancellation_reason: reason, reversal_journal_entry_id: saleReversalId,
        },
      });
      if (annulled.count !== 1) {
        throw new AppError('The factura of this sale is not ISSUED, so it cannot be annulled.', 409, 'FACTURA_NOT_ISSUED');
      }
    }

    // 5. The tenders leave the session the sale was rung in.
    await tx.posTender.updateMany({
      where: { tenant_id: tenantId, sales_order_id: order.id, reversed_at: null },
      data: { reversed_at: new Date() },
    });
    const decremented = await tx.registerSession.updateMany({
      where: { id: session.id, status: 'OPEN' },
      data: {
        total_sales:       { decrement: Number(order.total_amount) },
        transaction_count: { decrement: 1 },
      },
    });
    if (decremented.count !== 1) throw new AppError('This register was closed meanwhile.', 409, 'POS_VOID_SESSION_CLOSED');
  });

  return message(c, `Sale ${order.order_number} voided. Its factura is annulled and stock restored.`);
});

export default app;
