import { Hono }    from 'hono';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { TAX, resolveTax } from '../../config/tax';
import { validate } from '../../shared/middleware/validate';
import { ok, created, message, paginated } from '../../shared/response';
import { CreateJournalEntrySchema, CreateManualFacturaSchema } from '../../shared/schemas';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

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

// ── Accounts (Chart of Accounts) ──────────────────────────────────────────────

app.get('/accounts', async (c) => {
  const accounts = await db.account.findMany({
    where: { tenant_id: c.get('tenantId'), is_active: true },
    orderBy: [{ code: 'asc' }],
  });
  return ok(c, accounts);
});

app.post('/accounts', requireRole('admin'), async (c) => {
  const { code, name, type, normal_balance, parent_id } = await c.req.json();
  if (!code || !name || !type) throw new AppError('code, name, and type are required');
  const account = await db.account.create({
    data: {
      tenant_id:      c.get('tenantId'),
      code, name, type,
      normal_balance: normal_balance ?? (type === 'REVENUE' || type === 'LIABILITY' || type === 'EQUITY' ? 'CREDIT' : 'DEBIT'),
      parent_id:      parent_id || null,
    },
  });
  return created(c, account);
});

app.put('/accounts/:id', requireRole('admin'), async (c) => {
  const { code, name, type, normal_balance, parent_id, is_active } = await c.req.json();
  const data: any = {};
  if (code !== undefined) data.code = code;
  if (name !== undefined) data.name = name;
  if (type !== undefined) data.type = type;
  if (normal_balance !== undefined) data.normal_balance = normal_balance;
  if (parent_id !== undefined) data.parent_id = parent_id || null;
  if (is_active !== undefined) data.is_active = is_active;
  await db.account.updateMany({ where: { id: c.req.param('id'), tenant_id: c.get('tenantId') }, data });
  return ok(c, null);
});

// ── Seed default Bolivian Chart of Accounts ───────────────────────────────────

app.post('/accounts/seed-default', requireRole('admin'), async (c) => {
  const existing = await db.account.count({ where: { tenant_id: c.get('tenantId') } });
  if (existing > 0) throw new AppError('Chart of accounts already exists for this tenant. Delete accounts first or add manually.', 409);

  const accounts = [
    // ASSETS
    { code: '1101', name: 'Caja (Cash)',                      type: 'ASSET',     normal_balance: 'DEBIT' },
    { code: '1102', name: 'Bancos',                           type: 'ASSET',     normal_balance: 'DEBIT' },
    { code: '1103', name: 'Cuentas por Cobrar',               type: 'ASSET',     normal_balance: 'DEBIT' },
    { code: '1105', name: 'IVA Crédito Fiscal',               type: 'ASSET',     normal_balance: 'DEBIT' },
    { code: '1110', name: 'Inventario / Mercaderías',         type: 'ASSET',     normal_balance: 'DEBIT' },
    { code: '1201', name: 'Activo Fijo',                      type: 'ASSET',     normal_balance: 'DEBIT' },
    // LIABILITIES
    { code: '2101', name: 'Cuentas por Pagar (AP)',           type: 'LIABILITY', normal_balance: 'CREDIT' },
    { code: '2103', name: 'IVA Débito Fiscal',                type: 'LIABILITY', normal_balance: 'CREDIT' },
    { code: '2104', name: 'IT por Pagar',                     type: 'LIABILITY', normal_balance: 'CREDIT' },
    // EQUITY
    { code: '3101', name: 'Capital Social',                   type: 'EQUITY',    normal_balance: 'CREDIT' },
    { code: '3301', name: 'Resultados Acumulados',            type: 'EQUITY',    normal_balance: 'CREDIT' },
    { code: '3401', name: 'Resultado de la Gestión',          type: 'EQUITY',    normal_balance: 'CREDIT' },
    // REVENUE
    { code: '4101', name: 'Ventas de Mercaderías',            type: 'REVENUE',   normal_balance: 'CREDIT' },
    // EXPENSES
    { code: '5101', name: 'Costo de Ventas (COGS)',           type: 'EXPENSE',   normal_balance: 'DEBIT' },
    { code: '5201', name: 'Gastos de Administración',         type: 'EXPENSE',   normal_balance: 'DEBIT' },
    { code: '5202', name: 'Gastos de Venta',                  type: 'EXPENSE',   normal_balance: 'DEBIT' },
    { code: '5203', name: 'Impuesto a las Transacciones (IT 3%)', type: 'EXPENSE', normal_balance: 'DEBIT' },
    { code: '5204', name: 'Gastos Financieros',               type: 'EXPENSE',   normal_balance: 'DEBIT' },
  ];

  await db.account.createMany({
    data: accounts.map(a => ({ ...a, tenant_id: c.get('tenantId') })),
  });

  return message(c, `Created ${accounts.length} default accounts (Bolivian PCG)`);
});

// ── CoA Templates ────────────────────────────────────────────────────────────

// List available CoA templates
app.get('/coa-templates', async (c) => {
  const { COA_TEMPLATES } = await import('../../data/coa-templates/index');
  return ok(c, COA_TEMPLATES.map(t => ({ id: t.id, name: t.name, country: t.country, currency: t.currency })));
});

// Seed CoA from a template (safe: skips existing account codes)
app.post('/seed-coa', async (c) => {
  const { template_id } = await c.req.json();
  if (!template_id) throw new AppError('template_id is required');

  const { getTemplate } = await import('../../data/coa-templates/index');
  const template = getTemplate(template_id);
  if (!template) throw new AppError(`Template "${template_id}" not found`, 404);

  const tenantId = c.get('tenantId');
  let created = 0;
  let skipped = 0;

  // Build code→id map for parent resolution
  const codeToId = new Map<string, string>();

  // First pass: get existing accounts
  const existing = await db.account.findMany({
    where:  { tenant_id: tenantId },
    select: { id: true, code: true },
  });
  existing.forEach(a => codeToId.set(a.code, a.id));

  // Second pass: create missing accounts in order
  for (const acct of template.accounts) {
    const exists = codeToId.has(acct.code);
    if (exists) { skipped++; continue; }

    const parentId = acct.parent_code ? (codeToId.get(acct.parent_code) ?? null) : null;

    const newAcct = await db.account.create({
      data: {
        tenant_id:      tenantId,
        code:           acct.code,
        name:           acct.name,
        type:           acct.type,
        normal_balance: acct.normal_balance,
        parent_id:      parentId,
      },
    });
    codeToId.set(acct.code, newAcct.id);
    created++;
  }

  return ok(c, { template: template.name, created, skipped });
});

// ── Journal Entries ───────────────────────────────────────────────────────────

app.get('/journal-entries', async (c) => {
  const { page = '1', limit = '50', status } = c.req.query();
  const where: any = { tenant_id: c.get('tenantId') };
  if (status) where.status = status;

  const [entries, total] = await Promise.all([
    db.journalEntry.findMany({
      where,
      include: {
        lines: { include: { account: { select: { code: true, name: true, type: true } } } },
      },
      orderBy: { entry_date: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    db.journalEntry.count({ where }),
  ]);
  return paginated(c, entries, total, Number(page), Number(limit));
});

app.post('/journal-entries', requireRole('admin', 'store_manager'), validate(CreateJournalEntrySchema), async (c) => {
  const { entry_date, description, source_module, source_id, lines } = c.get('body');
  if (!entry_date || !description || !lines?.length) {
    throw new AppError('entry_date, description, and lines are required');
  }

  // Check if the target period is closed
  const d = new Date(entry_date);
  const closedPeriod = await db.accountingPeriod.findFirst({
    where: { tenant_id: c.get('tenantId'), year: d.getFullYear(), month: d.getMonth() + 1, status: 'CLOSED' },
  });
  if (closedPeriod) throw new AppError(`Period ${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')} is closed. Reopen it before posting entries.`, 400);

  // Validate balanced entry
  const totalDebit  = lines.reduce((s: number, l: any) => s + Number(l.debit_amount ?? 0), 0);
  const totalCredit = lines.reduce((s: number, l: any) => s + Number(l.credit_amount ?? 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new AppError(`Journal entry must balance. Debits: ${totalDebit.toFixed(2)}, Credits: ${totalCredit.toFixed(2)}`);
  }

  const count = await db.journalEntry.count({ where: { tenant_id: c.get('tenantId') } });
  const entryNumber = `JE-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

  const entry = await db.journalEntry.create({
    data: {
      tenant_id:    c.get('tenantId'),
      entry_number: entryNumber,
      entry_date:   new Date(entry_date),
      description,
      source_module: source_module || null,
      source_id:     source_id || null,
      created_by:    c.get('user').id,
      lines: {
        create: lines.map((l: any) => ({
          account_id:    l.account_id,
          debit_amount:  Number(l.debit_amount ?? 0),
          credit_amount: Number(l.credit_amount ?? 0),
          description:   l.description || null,
        })),
      },
    },
    include: { lines: { include: { account: true } } },
  });
  return created(c, entry);
});

app.post('/journal-entries/:id/post', requireRole('admin'), async (c) => {
  const updated = await db.journalEntry.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId'), status: 'DRAFT' },
    data: { status: 'POSTED', posted_at: new Date() },
  });
  if (updated.count === 0) throw new AppError('Entry not found or already posted');
  return ok(c, null);
});

// ── Facturas ──────────────────────────────────────────────────────────────────

// Helper: attach sales order lines to facturas that have source_type = 'SALE'
async function attachLines(facturas: any[]) {
  const saleIds = facturas
    .filter(f => f.source_type === 'SALE' && f.source_id)
    .map(f => f.source_id as string);

  if (saleIds.length === 0) return facturas.map(f => ({ ...f, lines: [] }));

  const orderLines = await db.salesOrderLine.findMany({
    where: { order_id: { in: saleIds } },
    include: { product: { select: { name: true, sku: true } } },
    orderBy: { sort_order: 'asc' },
  });

  const variantIds = orderLines.filter(l => l.variant_id).map(l => l.variant_id as string);
  const variants = variantIds.length > 0
    ? await db.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, sku_variant: true, attributes: true } })
    : [];
  const variantMap = new Map(variants.map(v => [v.id, v]));

  const linesWithVariant = orderLines.map(l => ({
    ...l,
    variant: l.variant_id ? variantMap.get(l.variant_id) ?? null : null,
  }));

  return facturas.map(f => ({
    ...f,
    lines: f.source_type === 'SALE' && f.source_id
      ? linesWithVariant.filter(l => l.order_id === f.source_id)
      : [],
  }));
}

app.get('/facturas', async (c) => {
  const { page = '1', limit = '50', status } = c.req.query();
  const where: any = { tenant_id: c.get('tenantId') };
  if (status) where.status = status;

  const [facturas, total] = await Promise.all([
    db.factura.findMany({ where, orderBy: { invoice_date: 'desc' }, skip: (Number(page) - 1) * Number(limit), take: Number(limit) }),
    db.factura.count({ where }),
  ]);

  const facturasWithLines = await attachLines(facturas);
  return paginated(c, facturasWithLines, total, Number(page), Number(limit));
});

app.get('/facturas/:id', async (c) => {
  const factura = await db.factura.findFirst({ where: { id: c.req.param('id'), tenant_id: c.get('tenantId') } });
  if (!factura) throw new AppError('Factura not found', 404);
  const [withLines] = await attachLines([factura]);
  return ok(c, withLines);
});

app.post('/facturas', requireRole('admin', 'store_manager'), validate(CreateManualFacturaSchema), async (c) => {
  const { customer_name, customer_nit, invoice_date, total_amount, source_type, source_id, notes } = c.get('body');
  if (!customer_name || !total_amount) throw new AppError('customer_name and total_amount are required');

  const facturaNumber = await nextFacturaNumber(c.get('tenantId'));
  const total = Number(total_amount);
  const tax = resolveTax(c.get('taxConfig'));
  const { subtotal, iva: ivaAmount, it: itAmount } = tax.breakdown(total);

  const factura = await db.factura.create({
    data: {
      tenant_id:      c.get('tenantId'),
      factura_number: facturaNumber,
      source_type:    source_type || 'MANUAL',
      source_id:      source_id || null,
      customer_name,
      customer_nit:   customer_nit || null,
      invoice_date:   invoice_date ? new Date(invoice_date) : new Date(),
      subtotal,
      iva_amount:     ivaAmount,
      it_amount:      itAmount,
      total_amount:   total,
      notes:          notes || null,
      invoice_metadata: {
        vat_label:          (c.get('taxConfig') as any)?.vat_label          ?? 'IVA',
        secondary_tax_name: (c.get('taxConfig') as any)?.secondary_tax_name ?? 'IT',
        invoice_label:      (c.get('taxConfig') as any)?.invoice_label       ?? 'Factura',
        currency_code:      c.get('currencyCode') ?? 'BOB',
      },
      created_by:     c.get('user').id,
    },
  });
  return created(c, factura);
});

app.post('/facturas/:id/cancel', requireRole('admin'), async (c) => {
  await db.factura.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId'), status: 'ISSUED' },
    data: { status: 'CANCELLED' },
  });
  return ok(c, null);
});

// ── IVA Report ────────────────────────────────────────────────────────────────

app.get('/iva-report', async (c) => {
  const { year, month } = c.req.query();
  if (!year || !month) throw new AppError('year and month query params are required');

  const from = new Date(Number(year), Number(month) - 1, 1);
  const to   = new Date(Number(year), Number(month), 0, 23, 59, 59);

  const facturas = await db.factura.findMany({
    where: { tenant_id: c.get('tenantId'), status: 'ISSUED', invoice_date: { gte: from, lte: to } },
    orderBy: { factura_number: 'asc' },
  });

  const totals = facturas.reduce((acc, f) => ({
    subtotal: acc.subtotal + Number(f.subtotal),
    iva:      acc.iva      + Number(f.iva_amount),
    it:       acc.it       + Number(f.it_amount),
    total:    acc.total    + Number(f.total_amount),
  }), { subtotal: 0, iva: 0, it: 0, total: 0 });

  return ok(c, { facturas, totals, period: { year: Number(year), month: Number(month) } });
});

// ── Trial Balance ─────────────────────────────────────────────────────────────

app.get('/trial-balance', async (c) => {
  const accounts = await db.account.findMany({
    where: { tenant_id: c.get('tenantId'), is_active: true },
    include: {
      journal_lines: { include: { journal_entry: { select: { status: true } } } },
    },
    orderBy: { code: 'asc' },
  });

  const trialBalance = accounts
    .map(account => {
      const postedLines = account.journal_lines.filter(l => l.journal_entry.status === 'POSTED');
      const totalDebit  = postedLines.reduce((s, l) => s + Number(l.debit_amount), 0);
      const totalCredit = postedLines.reduce((s, l) => s + Number(l.credit_amount), 0);
      const balance = account.normal_balance === 'CREDIT'
        ? totalCredit - totalDebit
        : totalDebit - totalCredit;
      return { account_id: account.id, code: account.code, name: account.name, type: account.type, normal_balance: account.normal_balance, total_debit: totalDebit, total_credit: totalCredit, balance };
    })
    .filter(a => a.total_debit !== 0 || a.total_credit !== 0);

  return ok(c, trialBalance);
});

// ── IVA Net Report (Débito vs Crédito) ───────────────────────────────────────

app.get('/iva-net-report', async (c) => {
  const { year, month } = c.req.query();
  if (!year || !month) throw new AppError('year and month query params are required');

  const from = new Date(Number(year), Number(month) - 1, 1);
  const to   = new Date(Number(year), Number(month), 0, 23, 59, 59);

  const debitoAccount  = await db.account.findFirst({ where: { tenant_id: c.get('tenantId'), code: '2103' } });
  const creditoAccount = await db.account.findFirst({ where: { tenant_id: c.get('tenantId'), code: '1105' } });

  const [debitoLines, creditoLines] = await Promise.all([
    debitoAccount ? db.journalLine.findMany({
      where: { account_id: debitoAccount.id, journal_entry: { tenant_id: c.get('tenantId'), status: 'POSTED', entry_date: { gte: from, lte: to } } },
      include: { journal_entry: { select: { entry_date: true, description: true, entry_number: true } } },
    }) : [],
    creditoAccount ? db.journalLine.findMany({
      where: { account_id: creditoAccount.id, journal_entry: { tenant_id: c.get('tenantId'), status: 'POSTED', entry_date: { gte: from, lte: to } } },
      include: { journal_entry: { select: { entry_date: true, description: true, entry_number: true } } },
    }) : [],
  ]);

  const totalDebito  = (debitoLines as any[]).reduce((s: number, l: any) => s + Number(l.credit_amount), 0);
  const totalCredito = (creditoLines as any[]).reduce((s: number, l: any) => s + Number(l.debit_amount), 0);
  const netPayable   = totalDebito - totalCredito;

  return ok(c, {
    period: { year: Number(year), month: Number(month) },
    debito_fiscal:  totalDebito,
    credito_fiscal: totalCredito,
    net_payable:    netPayable,
    debito_lines:   debitoLines,
    credito_lines:  creditoLines,
  });
});

// ── AP Aging ──────────────────────────────────────────────────────────────────

app.get('/ap-aging', async (c) => {
  const today = new Date();

  const unpaidPOs = await db.purchaseOrder.findMany({
    where: { tenant_id: c.get('tenantId'), status: 'RECEIVED', paid_at: null },
    include: { supplier: { select: { name: true, code: true } } },
    orderBy: { received_at: 'asc' },
  });

  const rows = unpaidPOs.map(po => {
    const refDate  = po.received_at ?? po.created_at;
    const ageDays  = Math.floor((today.getTime() - new Date(refDate).getTime()) / 86400000);
    const bucket   = ageDays <= 30 ? '0-30' : ageDays <= 60 ? '31-60' : ageDays <= 90 ? '61-90' : '90+';
    return { ...po, age_days: ageDays, bucket };
  });

  const summary = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  rows.forEach(r => { summary[r.bucket as keyof typeof summary] += Number(r.total_amount); });

  return ok(c, { rows, summary, total: rows.reduce((s, r) => s + Number(r.total_amount), 0) });
});

// ── AR Aging ──────────────────────────────────────────────────────────────────

app.get('/ar-aging', async (c) => {
  const today = new Date();

  const unpaidSOs = await db.salesOrder.findMany({
    where: { tenant_id: c.get('tenantId'), invoice_id: { not: null }, paid_at: null, status: { notIn: ['DRAFT', 'CANCELLED'] } },
    include: { customer: { select: { first_name: true, last_name: true, code: true } } },
    orderBy: { created_at: 'asc' },
  });

  const rows = unpaidSOs.map(so => {
    const ageDays = Math.floor((today.getTime() - new Date(so.created_at).getTime()) / 86400000);
    const bucket  = ageDays <= 30 ? '0-30' : ageDays <= 60 ? '31-60' : ageDays <= 90 ? '61-90' : '90+';
    return { ...so, age_days: ageDays, bucket };
  });

  const summary = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  rows.forEach(r => { summary[r.bucket as keyof typeof summary] += Number(r.total_amount); });

  return ok(c, { rows, summary, total: rows.reduce((s, r) => s + Number(r.total_amount), 0) });
});

// ── Profit & Loss ─────────────────────────────────────────────────────────────

app.get('/profit-loss', async (c) => {
  const { from, to } = c.req.query();
  const dateFilter: any = {};
  if (from) dateFilter.gte = new Date(from);
  if (to)   dateFilter.lte = new Date(to + 'T23:59:59');

  const accounts = await db.account.findMany({
    where: { tenant_id: c.get('tenantId'), is_active: true, type: { in: ['REVENUE', 'EXPENSE'] } },
    include: {
      journal_lines: {
        include: { journal_entry: { select: { status: true, entry_date: true } } },
        where: Object.keys(dateFilter).length ? { journal_entry: { entry_date: dateFilter } } : undefined,
      },
    },
    orderBy: { code: 'asc' },
  });

  let totalRevenue = 0;
  let totalExpenses = 0;
  const revenue: any[] = [];
  const expenses: any[] = [];

  accounts.forEach(acc => {
    const posted    = acc.journal_lines.filter(l => l.journal_entry.status === 'POSTED');
    const netCredit = posted.reduce((s, l) => s + Number(l.credit_amount) - Number(l.debit_amount), 0);
    const netDebit  = posted.reduce((s, l) => s + Number(l.debit_amount) - Number(l.credit_amount), 0);
    const balance   = acc.type === 'REVENUE' ? netCredit : netDebit;
    if (balance === 0) return;

    const row = { code: acc.code, name: acc.name, balance };
    if (acc.type === 'REVENUE') { revenue.push(row); totalRevenue += balance; }
    else                        { expenses.push(row); totalExpenses += balance; }
  });

  return ok(c, {
    revenue, expenses,
    total_revenue:   totalRevenue,
    total_expenses:  totalExpenses,
    net_income:      totalRevenue - totalExpenses,
    period:          { from: from ?? null, to: to ?? null },
  });
});

// ── Balance Sheet ─────────────────────────────────────────────────────────────

app.get('/balance-sheet', async (c) => {
  const { date } = c.req.query();
  const dateTo = date ? new Date(date + 'T23:59:59') : new Date();

  const accounts = await db.account.findMany({
    where: { tenant_id: c.get('tenantId'), is_active: true },
    include: {
      journal_lines: {
        include: { journal_entry: { select: { status: true, entry_date: true } } },
        where: { journal_entry: { entry_date: { lte: dateTo }, status: 'POSTED' } },
      },
    },
    orderBy: { code: 'asc' },
  });

  let totalAssets = 0, totalLiabilities = 0, totalEquity = 0;
  let totalRevenue = 0, totalExpenses = 0;
  const assets: any[] = [], liabilities: any[] = [], equity: any[] = [];

  accounts.forEach(acc => {
    const lines       = acc.journal_lines;
    const totalDebit  = lines.reduce((s, l) => s + Number(l.debit_amount), 0);
    const totalCredit = lines.reduce((s, l) => s + Number(l.credit_amount), 0);

    if (acc.type === 'ASSET') {
      const balance = totalDebit - totalCredit;
      if (balance !== 0) { assets.push({ code: acc.code, name: acc.name, balance }); totalAssets += balance; }
    } else if (acc.type === 'LIABILITY') {
      const balance = totalCredit - totalDebit;
      if (balance !== 0) { liabilities.push({ code: acc.code, name: acc.name, balance }); totalLiabilities += balance; }
    } else if (acc.type === 'EQUITY') {
      const balance = totalCredit - totalDebit;
      if (balance !== 0) { equity.push({ code: acc.code, name: acc.name, balance }); totalEquity += balance; }
    } else if (acc.type === 'REVENUE') {
      totalRevenue  += totalCredit - totalDebit;
    } else if (acc.type === 'EXPENSE') {
      totalExpenses += totalDebit - totalCredit;
    }
  });

  const netIncome = totalRevenue - totalExpenses;
  if (netIncome !== 0) {
    equity.push({ code: '—', name: 'Current Year Earnings (Net Income)', balance: netIncome });
    totalEquity += netIncome;
  }

  return ok(c, {
    assets, liabilities, equity,
    total_assets:             totalAssets,
    total_liabilities:        totalLiabilities,
    total_equity:             totalEquity,
    net_income:               netIncome,
    total_liabilities_equity: totalLiabilities + totalEquity,
    is_balanced:              Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    as_of:                    dateTo,
  });
});

// ── Accounting Periods ────────────────────────────────────────────────────────

app.get('/periods', async (c) => {
  const existing = await db.accountingPeriod.findMany({
    where: { tenant_id: c.get('tenantId') },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

  const today = new Date();
  const periods: any[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const record = existing.find(p => p.year === y && p.month === m);
    periods.push({ year: y, month: m, status: record?.status ?? 'OPEN', id: record?.id ?? null, closed_at: record?.closed_at ?? null });
  }

  return ok(c, periods);
});

app.post('/periods/:year/:month/close', requireRole('admin'), async (c) => {
  const year  = Number(c.req.param('year'));
  const month = Number(c.req.param('month'));

  const existing = await db.accountingPeriod.findFirst({ where: { tenant_id: c.get('tenantId'), year, month } });
  if (existing?.status === 'CLOSED') throw new AppError('Period is already closed', 409);

  if (existing) {
    await db.accountingPeriod.update({ where: { id: existing.id }, data: { status: 'CLOSED', closed_at: new Date(), closed_by: c.get('user').id } });
  } else {
    await db.accountingPeriod.create({ data: { tenant_id: c.get('tenantId'), year, month, status: 'CLOSED', closed_at: new Date(), closed_by: c.get('user').id } });
  }

  return message(c, `Period ${year}/${String(month).padStart(2, '0')} closed.`);
});

app.post('/periods/:year/:month/reopen', requireRole('admin'), async (c) => {
  const year  = Number(c.req.param('year'));
  const month = Number(c.req.param('month'));

  const existing = await db.accountingPeriod.findFirst({ where: { tenant_id: c.get('tenantId'), year, month } });
  if (!existing || existing.status === 'OPEN') throw new AppError('Period is not closed', 400);

  await db.accountingPeriod.update({ where: { id: existing.id }, data: { status: 'OPEN', closed_at: null, closed_by: null } });

  return message(c, `Period ${year}/${String(month).padStart(2, '0')} reopened.`);
});

app.get('/periods/:year/:month/status', async (c) => {
  const year  = Number(c.req.param('year'));
  const month = Number(c.req.param('month'));
  const record = await db.accountingPeriod.findFirst({ where: { tenant_id: c.get('tenantId'), year, month } });
  return ok(c, { status: record?.status ?? 'OPEN', year, month });
});

// ── Bank Reconciliation ───────────────────────────────────────────────────────

app.get('/bank-reconciliation', async (c) => {
  const { year, month, statement_balance } = c.req.query();
  if (!year || !month) throw new AppError('year and month are required');

  const from = new Date(Number(year), Number(month) - 1, 1);
  const to   = new Date(Number(year), Number(month), 1);

  const bankAccount = await db.account.findFirst({ where: { tenant_id: c.get('tenantId'), code: '1101' } });
  if (!bankAccount) throw new AppError('Bank account 1101 not found. Seed the chart of accounts first.');

  const lines = await db.journalLine.findMany({
    where: {
      account_id: bankAccount.id,
      journal_entry: { tenant_id: c.get('tenantId'), status: 'POSTED', entry_date: { gte: from, lt: to } },
    },
    include: {
      journal_entry: { select: { entry_number: true, entry_date: true, description: true, source_module: true } },
    },
    orderBy: { journal_entry: { entry_date: 'asc' } },
  });

  const prior = await db.journalLine.aggregate({
    where: {
      account_id: bankAccount.id,
      journal_entry: { tenant_id: c.get('tenantId'), status: 'POSTED', entry_date: { lt: from } },
    },
    _sum: { debit_amount: true, credit_amount: true },
  });
  const openingBalance = Number(prior._sum.debit_amount ?? 0) - Number(prior._sum.credit_amount ?? 0);

  let running = openingBalance;
  const ledger = lines.map((l) => {
    const debit  = Number(l.debit_amount);
    const credit = Number(l.credit_amount);
    running += debit - credit;
    return {
      entry_number:     l.journal_entry.entry_number,
      entry_date:       l.journal_entry.entry_date,
      description:      l.journal_entry.description,
      source_module:    l.journal_entry.source_module,
      line_description: l.description,
      debit, credit, balance: running,
    };
  });

  const bookBalance    = running;
  const statementBal   = statement_balance ? Number(statement_balance) : null;
  const difference     = statementBal !== null ? bookBalance - statementBal : null;

  return ok(c, {
    period: { year: Number(year), month: Number(month) },
    opening_balance:    openingBalance,
    book_balance:       bookBalance,
    statement_balance:  statementBal,
    difference,
    is_reconciled: difference !== null ? Math.abs(difference) < 0.01 : null,
    ledger,
  });
});

export default app;
