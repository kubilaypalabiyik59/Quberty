import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

/** Read-only. Re-derive D-2, D-3, D-6 and the 2105/2103 split from the data. */
(async () => {
  const t = (await db.tenant.findFirst({ select: { id: true, name: true } }))!;
  console.log(`Tenant: ${t.name}\n`);

  console.log('── Account balances that matter');
  const bal = await db.$queryRawUnsafe<any[]>(`
    SELECT a.code, a.name, a.category,
           SUM(jl.debit_amount)::float AS dr,
           SUM(jl.credit_amount)::float AS cr,
           (SUM(jl.debit_amount) - SUM(jl.credit_amount))::float AS net,
           COUNT(*)::int AS lines
    FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = $1::uuid AND a.code IN ('1103','1201','2103','2105','2104','5101','4101')
    GROUP BY 1,2,3 ORDER BY 1
  `, t.id);
  for (const r of bal) {
    console.log(`  ${r.code}  ${String(r.name).padEnd(28)} ${String(r.category ?? '-').padEnd(22)} dr=${r.dr.toFixed(2)} cr=${r.cr.toFixed(2)} net=${r.net.toFixed(2)} (${r.lines})`);
  }

  console.log('\n── D-6: lines sitting in 1201');
  const d6 = await db.$queryRawUnsafe<any[]>(`
    SELECT je.entry_number, je.entry_date, je.description, je.source_module, je.source_id,
           jl.debit_amount::float AS dr, jl.credit_amount::float AS cr, jl.description AS line_desc
    FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = $1::uuid AND a.code = '1201'
    ORDER BY je.entry_date, je.entry_number
  `, t.id);
  for (const r of d6) {
    console.log(`  ${r.entry_number} ${new Date(r.entry_date).toISOString().slice(0,10)} ${String(r.source_module ?? '-').padEnd(14)} dr=${r.dr} cr=${r.cr}  ${r.line_desc ?? r.description}`);
  }

  console.log('\n── D-7 / 2105: lines sitting in 2105');
  const d7 = await db.$queryRawUnsafe<any[]>(`
    SELECT je.entry_number, je.entry_date, je.source_module,
           jl.debit_amount::float AS dr, jl.credit_amount::float AS cr, jl.description AS line_desc
    FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = $1::uuid AND a.code = '2105'
    ORDER BY je.entry_date, je.entry_number
  `, t.id);
  for (const r of d7) {
    console.log(`  ${r.entry_number} ${new Date(r.entry_date).toISOString().slice(0,10)} ${String(r.source_module ?? '-').padEnd(14)} dr=${r.dr} cr=${r.cr}  ${r.line_desc}`);
  }

  console.log('\n── D-2: COGS vouchers whose ORDER has no revenue voucher');
  //
  // The first version of this query matched revenue to COGS on `source_id` alone
  // and reported 21 vouchers / Bs 44 000 — nearly every COGS entry in the tenant.
  // It was wrong, and wrong in an instructive way: a COGS voucher carries
  // `source_id = sales_order.id` while the revenue voucher carries
  // `source_id = factura.id`. The two never match, so everything looked orphaned.
  //
  // A defect report that over-reports by 13× is worse than none — it would have
  // driven Bs 44 000 of corrections against Bs 3 250 of actual damage. The join has
  // to go through the ORDER, resolving the factura on the way.
  const d2 = await db.$queryRawUnsafe<any[]>(`
    WITH cogs_vouchers AS (
      SELECT je.id, je.entry_number, je.entry_date, je.description,
             je.source_module, je.source_id,
             SUM(jl.debit_amount) FILTER (WHERE a.category = 'COGS')::float AS cogs
      FROM journal_entries je
      JOIN journal_lines jl ON jl.journal_entry_id = je.id
      JOIN accounts a ON a.id = jl.account_id
      WHERE je.tenant_id = $1::uuid
      GROUP BY je.id
      HAVING SUM(jl.debit_amount) FILTER (WHERE a.category = 'COGS') > 0
    )
    SELECT cv.*
    FROM cogs_vouchers cv
    LEFT JOIN sales_orders so ON so.id = cv.source_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM journal_entries r
      JOIN journal_lines rl ON rl.journal_entry_id = r.id
      JOIN accounts ra ON ra.id = rl.account_id
      WHERE r.tenant_id = $1::uuid
        AND ra.category = 'REVENUE'
        AND rl.credit_amount > 0
        AND (
          r.source_id = cv.source_id          -- POS: revenue voucher keyed on the order
          OR r.source_id = so.invoice_id      -- ERP: revenue voucher keyed on the factura
        )
    )
    ORDER BY cv.entry_date, cv.entry_number
  `, t.id);
  let d2total = 0;
  for (const r of d2) {
    d2total += r.cogs;
    console.log(`  ${r.entry_number} ${new Date(r.entry_date).toISOString().slice(0,10)} ${String(r.source_module ?? '-').padEnd(12)} COGS=${r.cogs.toFixed(2)}  src=${r.source_id ?? '-'}  ${r.description}`);
  }
  console.log(`  TOTAL orphan COGS = ${d2total.toFixed(2)}`);

  if (d2.length > 0) {
    console.log('\n  Can the missing revenue be recovered? (order + factura for each source)');
    for (const r of d2) {
      if (!r.source_id) { console.log(`    ${r.entry_number}: no source_id — unrecoverable`); continue; }
      const so = await db.salesOrder.findFirst({
        where: { id: r.source_id },
        select: { order_number: true, subtotal: true, tax_amount: true, total_amount: true, status: true, site_id: true, invoice_id: true },
      });
      if (!so) { console.log(`    ${r.entry_number}: source ${r.source_id} is not a sales order`); continue; }
      const f = so.invoice_id ? await db.factura.findFirst({ where: { id: so.invoice_id }, select: { factura_number: true, subtotal: true, iva_amount: true, it_amount: true, total_amount: true } }) : null;
      console.log(
        `    ${r.entry_number}: ${so.order_number} status=${so.status} total=${so.total_amount} site=${so.site_id ?? 'NULL'}` +
        (f ? `  factura#${f.factura_number} sub=${f.subtotal} iva=${f.iva_amount} it=${f.it_amount} tot=${f.total_amount}` : '  NO FACTURA'),
      );
    }
  }

  console.log('\n── D-3: IT accrued on facturas vs IT in the GL');
  const itF = await db.factura.aggregate({ where: { tenant_id: t.id }, _sum: { it_amount: true } });
  const itGL = await db.$queryRawUnsafe<any[]>(`
    SELECT SUM(jl.credit_amount - jl.debit_amount)::float AS net
    FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = $1::uuid AND a.category = 'TURNOVER_TAX_PAYABLE'
  `, t.id);
  console.log(`  facturas accrue IT: ${Number(itF._sum.it_amount ?? 0).toFixed(2)}`);
  console.log(`  GL turnover payable: ${(itGL[0]?.net ?? 0).toFixed(2)}`);
  console.log(`  gap: ${(Number(itF._sum.it_amount ?? 0) - (itGL[0]?.net ?? 0)).toFixed(2)}`);

  console.log('\n── Posting profiles in force');
  const pp = await db.postingProfile.findMany({
    where: { tenant_id: t.id },
    select: { posting_type: true, scope_kind: true, account: { select: { code: true, name: true } } },
    orderBy: { posting_type: 'asc' },
  });
  for (const p of pp) console.log(`  ${p.posting_type.padEnd(26)} ${p.scope_kind.padEnd(12)} → ${p.account.code} ${p.account.name}`);

  await db.$disconnect();
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
