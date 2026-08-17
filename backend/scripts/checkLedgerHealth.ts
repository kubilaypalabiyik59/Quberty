import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

(async () => {
  const t = (await db.tenant.findFirst({ select: { id: true } }))!.id;

  const tb = await db.$queryRawUnsafe<any[]>(`
    SELECT SUM(jl.debit_amount)::float AS dr, SUM(jl.credit_amount)::float AS cr
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = $1::uuid
  `, t);
  console.log(`TRIAL BALANCE  dr ${tb[0].dr.toFixed(2)}  cr ${tb[0].cr.toFixed(2)}  diff ${(tb[0].dr - tb[0].cr).toFixed(2)}`);

  const unbal = await db.$queryRawUnsafe<any[]>(`
    SELECT je.entry_number, SUM(jl.debit_amount - jl.credit_amount)::float AS d
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = $1::uuid GROUP BY je.entry_number
    HAVING ABS(SUM(jl.debit_amount - jl.credit_amount)) > 0.005
  `, t);
  console.log(`unbalanced vouchers: ${unbal.length}`);
  for (const u of unbal) console.log(`  ${u.entry_number} out by ${u.d.toFixed(2)}`);

  const itF = await db.factura.aggregate({ where: { tenant_id: t }, _sum: { it_amount: true } });
  const itGL = await db.$queryRawUnsafe<any[]>(`
    SELECT SUM(jl.credit_amount - jl.debit_amount)::float AS net
    FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = $1::uuid AND a.category = 'TURNOVER_TAX_PAYABLE'
  `, t);
  const f = Number(itF._sum.it_amount ?? 0), g = itGL[0]?.net ?? 0;
  console.log(`\nIT  facturas ${f.toFixed(2)}  ·  GL ${g.toFixed(2)}  ·  gap ${(f - g).toFixed(2)}`);

  const ivaF = await db.factura.aggregate({ where: { tenant_id: t, status: 'ISSUED' }, _sum: { iva_amount: true } });
  const ivaGL = await db.$queryRawUnsafe<any[]>(`
    SELECT SUM(jl.credit_amount - jl.debit_amount)::float AS net
    FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.tenant_id = $1::uuid AND a.category = 'VAT_PAYABLE'
  `, t);
  console.log(`IVA facturas ${Number(ivaF._sum.iva_amount ?? 0).toFixed(2)}  ·  GL ${(ivaGL[0]?.net ?? 0).toFixed(2)}  ·  gap ${(Number(ivaF._sum.iva_amount ?? 0) - (ivaGL[0]?.net ?? 0)).toFixed(2)}`);

  console.log('\nWhere the remaining IT gap sits — facturas with no IT voucher line');
  const rows = await db.$queryRawUnsafe<any[]>(`
    SELECT f.factura_number, f.invoice_date, f.it_amount::float AS it, f.source_type, f.status
    FROM facturas f
    WHERE f.tenant_id = $1::uuid AND f.it_amount > 0
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        JOIN journal_lines jl ON jl.journal_entry_id = je.id
        JOIN accounts a ON a.id = jl.account_id
        WHERE je.tenant_id = $1::uuid AND a.category = 'TURNOVER_TAX_PAYABLE'
          AND (je.source_id = f.id OR je.source_id = f.source_id)
      )
    ORDER BY f.factura_number
  `, t);
  let miss = 0;
  for (const r of rows) { miss += r.it; console.log(`  #${r.factura_number} ${new Date(r.invoice_date).toISOString().slice(0,10)} ${r.source_type} ${r.status} IT=${r.it.toFixed(2)}`); }
  console.log(`  total IT on facturas with no payable line: ${miss.toFixed(2)}`);

  await db.$disconnect();
})().catch(async e => { console.error(e); await db.$disconnect(); process.exit(1); });
