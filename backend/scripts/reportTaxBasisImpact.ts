import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

/**
 * Backfill `TaxCode.base_kind` for an existing tenant, and quantify what the old
 * arithmetic cost.
 *
 *   npx tsx scripts/reportTaxBasisImpact.ts            report only
 *   npx tsx scripts/reportTaxBasisImpact.ts --apply    also set base_kind
 *
 * WHY THIS IS A SCRIPT AND NOT PART OF MIGRATION 007
 *
 * The migration adds the column with the international default (NET). Deciding
 * that a particular tenant's IVA13 is Bolivian and therefore GROSS is a judgement
 * about that tenant's jurisdiction, and it changes tax figures. It gets a script
 * that says what it is about to do and prints the size of the historical gap,
 * for the same reason provisionConfiguration refuses to guess a GL account.
 *
 * NOTHING HERE RESTATES A POSTED DOCUMENT. Facturas keep the amounts they were
 * issued with. The report exists so the Finance co-founder can decide whether a
 * correction is needed and how large it is.
 */

const APPLY = process.argv.includes('--apply');
const money = (n: number) => n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** What Bolivian law says the tax on an invoiced amount is. */
const lawIva = (gross: number) => Math.round(gross * 0.13 * 100) / 100;
const lawIt = (gross: number) => Math.round(gross * 0.03 * 100) / 100;
/** What the old engine computed. */
const oldIva = (gross: number) => Math.round((gross - gross / 1.13) * 100) / 100;
const oldIt = (gross: number) => Math.round((gross / 1.13) * 0.03 * 100) / 100;

(async () => {
  const tenants = await db.tenant.findMany({ select: { id: true, slug: true, name: true, currency_code: true } });

  for (const t of tenants) {
    console.log(`\n${'='.repeat(78)}\n${t.name} (${t.slug}) — ${t.currency_code}\n${'='.repeat(78)}`);

    const codes = await db.taxCode.findMany({
      where: { tenant_id: t.id },
      select: { id: true, code: true, name: true, tax_type: true, rate: true, is_inclusive: true, base_kind: true },
      orderBy: { code: 'asc' },
    });

    if (!codes.length) {
      console.log('  no tax codes configured — nothing to do');
      continue;
    }

    // Only a Bolivian tenant's codes move. Identified by currency, not by code
    // name: "IVA13" could in principle be anything, but BOB is unambiguous.
    const isBolivia = t.currency_code === 'BOB';
    console.log(`  jurisdiction: ${isBolivia ? 'Bolivia (BOB) — IVA por dentro applies' : 'not Bolivia — base stays NET'}`);

    for (const c of codes) {
      const target = isBolivia && (c.tax_type === 'VAT' || c.tax_type === 'TURNOVER') ? 'GROSS' : 'NET';
      const change = c.base_kind === target ? 'unchanged' : `${c.base_kind} → ${target}`;
      console.log(
        `  ${c.code.padEnd(8)} ${(Number(c.rate) * 100).toFixed(0).padStart(3)}%  ${c.tax_type.padEnd(9)}` +
        ` ${c.is_inclusive ? 'inclusive' : 'exclusive'}   base ${change}`,
      );
      if (APPLY && c.base_kind !== target) {
        await db.taxCode.update({ where: { id: c.id }, data: { base_kind: target } });
      }
    }

    if (!isBolivia) continue;

    // ── What the old arithmetic cost, over documents already issued ──────────
    const facturas = await db.factura.findMany({
      where: { tenant_id: t.id, status: 'ISSUED' },
      select: { factura_number: true, invoice_date: true, total_amount: true, iva_amount: true, it_amount: true },
      orderBy: { factura_number: 'asc' },
    });

    if (!facturas.length) {
      console.log('\n  no issued facturas — nothing to quantify');
      continue;
    }

    let ivaGap = 0;
    let itGap = 0;
    let grossTotal = 0;
    for (const f of facturas) {
      const gross = Math.abs(Number(f.total_amount));
      const sign = Number(f.total_amount) < 0 ? -1 : 1;
      grossTotal += sign * gross;
      ivaGap += sign * (lawIva(gross) - Math.abs(Number(f.iva_amount)));
      itGap += sign * (lawIt(gross) - Math.abs(Number(f.it_amount)));
    }

    console.log(`\n  ── Historical impact over ${facturas.length} issued facturas ──`);
    console.log(`  invoiced total                     ${money(grossTotal).padStart(14)}`);
    console.log(`  IVA débito as issued (≈11,50%)     ${money(facturas.reduce((s, f) => s + Number(f.iva_amount), 0)).padStart(14)}`);
    console.log(`  IVA débito per Ley 843 (13,00%)    ${money(facturas.reduce((s, f) => s + Math.sign(Number(f.total_amount)) * lawIva(Math.abs(Number(f.total_amount))), 0)).padStart(14)}`);
    console.log(`  UNDERSTATED IVA                    ${money(ivaGap).padStart(14)}`);
    console.log(`  IT as issued (3% of net)           ${money(facturas.reduce((s, f) => s + Number(f.it_amount), 0)).padStart(14)}`);
    console.log(`  IT per Ley 843 art. 74 (3% gross)  ${money(facturas.reduce((s, f) => s + Math.sign(Number(f.total_amount)) * lawIt(Math.abs(Number(f.total_amount))), 0)).padStart(14)}`);
    console.log(`  UNDERSTATED IT                     ${money(itGap).padStart(14)}`);
    console.log(`  TOTAL TAX UNDERSTATED              ${money(ivaGap + itGap).padStart(14)}`);

    console.log(`\n  Worked example, first factura:`);
    const f0 = facturas[0];
    const g0 = Math.abs(Number(f0.total_amount));
    console.log(`    factura #${f0.factura_number}  invoiced ${money(g0)}`);
    console.log(`      IVA  issued ${money(oldIva(g0)).padStart(10)}   law ${money(lawIva(g0)).padStart(10)}   diff ${money(lawIva(g0) - oldIva(g0)).padStart(9)}`);
    console.log(`      IT   issued ${money(oldIt(g0)).padStart(10)}   law ${money(lawIt(g0)).padStart(10)}   diff ${money(lawIt(g0) - oldIt(g0)).padStart(9)}`);

    console.log(
      `\n  NOTE  These are TEST-database figures. No factura was modified by this script.\n` +
      `        Whether a correction is filed is a decision for the Finance co-founder.\n` +
      `        Ley 1733 (27 May 2026) moves Bolivia to IVA por fuera once its\n` +
      `        reglamentary Decreto Supremo is published — at that point add a NEW\n` +
      `        date-effective TaxCode with base_kind = NET, is_inclusive = false.`,
    );
  }

  console.log(`\n${APPLY ? 'APPLIED.' : 'Report only — pass --apply to set base_kind.'}`);
  await db.$disconnect();
})().catch(async (e) => {
  console.error('ERR', e.message);
  await db.$disconnect();
  process.exit(1);
});
