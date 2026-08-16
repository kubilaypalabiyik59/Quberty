import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';
import { calculateTax, resolveApplicableTaxCodes } from '../src/shared/services/tax.service';
import { resolveTax } from '../src/config/tax';

/**
 * Backfill `TaxCode.base_kind`, and quantify what the old arithmetic cost.
 *
 *   npx tsx scripts/reportTaxBasisImpact.ts            report only
 *   npx tsx scripts/reportTaxBasisImpact.ts --apply    also set base_kind
 *
 * WHY THIS IS A SCRIPT AND NOT PART OF MIGRATION 007
 *
 * The migration adds the column with the international default (NET). Deciding
 * that a particular tenant's codes are Bolivian and therefore GROSS is a
 * judgement about that tenant's jurisdiction, and it changes tax figures. So it
 * gets a script that says what it is about to do and prints the size of the
 * historical gap — the same rule provisionConfiguration follows for GL accounts.
 *
 * ── NO HARDCODED RATES ─────────────────────────────────────────────────────
 * The "what the law says" column is produced by running the REAL engine over the
 * tenant's OWN tax codes, not by a 0.13 written into this file. An earlier draft
 * did hardcode Bolivia's rates here; that would have made this script the one
 * place in the codebase that could not be pointed at Turkey. The only
 * jurisdiction-shaped decision left is which codes get GROSS, and that is
 * derived from the tenant's currency and stated out loud before it is applied.
 *
 * NOTHING HERE RESTATES A POSTED DOCUMENT. Facturas keep the amounts they were
 * issued with. The report exists so the Finance co-founder can decide whether a
 * correction is needed and how large it is.
 */

const APPLY = process.argv.includes('--apply');
const money = (n: number) => n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Jurisdictions whose VAT is levied on the tax-INCLUSIVE price. Keyed by
 * currency because that is the least ambiguous signal a tenant row carries.
 * A list, not an `if` — adding a country is adding an entry.
 */
const GROSS_BASE_BY_CURRENCY: Record<string, string> = {
  BOB: 'Bolivia — Ley 843 art. 5/7 (IVA por dentro) and art. 74 (IT on ingresos brutos)',
};

(async () => {
  const tenants = await db.tenant.findMany({
    select: { id: true, slug: true, name: true, currency_code: true },
  });

  for (const t of tenants) {
    console.log(`\n${'='.repeat(78)}\n${t.name} (${t.slug}) — ${t.currency_code}\n${'='.repeat(78)}`);

    const codes = await db.taxCode.findMany({
      where: { tenant_id: t.id },
      select: {
        id: true, code: true, name: true, tax_type: true, rate: true,
        is_inclusive: true, base_kind: true,
      },
      orderBy: { code: 'asc' },
    });

    if (!codes.length) {
      console.log('  no tax codes configured — nothing to do');
      continue;
    }

    const reason = GROSS_BASE_BY_CURRENCY[t.currency_code];
    console.log(`  jurisdiction: ${reason ?? `${t.currency_code} — VAT on the net, base stays NET`}`);

    for (const c of codes) {
      const target = reason && (c.tax_type === 'VAT' || c.tax_type === 'TURNOVER') ? 'GROSS' : 'NET';
      const change = c.base_kind === target ? 'unchanged' : `${c.base_kind} → ${target}`;
      console.log(
        `  ${c.code.padEnd(8)} ${(Number(c.rate) * 100).toFixed(0).padStart(3)}%  ${c.tax_type.padEnd(9)}` +
        ` ${c.is_inclusive ? 'inclusive' : 'exclusive'}   base ${change}`,
      );
      if (APPLY && c.base_kind !== target) {
        await db.taxCode.update({ where: { id: c.id }, data: { base_kind: target } });
      }
    }

    // ── What the old arithmetic cost, over documents already issued ──────────
    const facturas = await db.factura.findMany({
      where: { tenant_id: t.id, status: 'ISSUED' },
      select: { factura_number: true, total_amount: true, iva_amount: true, it_amount: true },
      orderBy: { factura_number: 'asc' },
    });

    if (!facturas.length) {
      console.log('\n  no issued facturas — nothing to quantify');
      continue;
    }

    // The correct figures come from the engine, driven by this tenant's own
    // configured codes. If they have not been set to GROSS yet, run with
    // --apply first or this comparison will simply show no difference.
    const params = await db.salesParameters.findFirst({
      where: { tenant_id: t.id, legal_entity_id: null },
      select: { default_tax_group_id: true, default_item_tax_group_id: true },
    });
    const applicable = await resolveApplicableTaxCodes(
      t.id,
      params?.default_tax_group_id ?? null,
      params?.default_item_tax_group_id ?? null,
    );
    if (!applicable.length) {
      console.log('\n  default tax groups resolve to no codes — cannot compute the comparison');
      continue;
    }

    // What the OLD engine did, for every jurisdiction: extract at 1+rate, and
    // put turnover tax on the resulting net. Reproduced from config/tax.ts
    // rather than restated, so this stays honest about what shipped.
    const legacy = resolveTax(undefined);

    let ivaGap = 0;
    let itGap = 0;
    let issuedIva = 0;
    let issuedIt = 0;
    let lawIvaTotal = 0;
    let lawItTotal = 0;
    let grossTotal = 0;

    for (const f of facturas) {
      const signed = Number(f.total_amount);
      const sign = signed < 0 ? -1 : 1;
      const gross = Math.abs(signed);

      const calc = calculateTax(gross, applicable);
      const lawIva = calc.lines.filter(l => l.tax_type === 'VAT').reduce((s, l) => s + l.amount, 0);
      const lawIt = calc.lines.filter(l => l.tax_type === 'TURNOVER').reduce((s, l) => s + l.amount, 0);

      grossTotal += signed;
      issuedIva += Number(f.iva_amount);
      issuedIt += Number(f.it_amount);
      lawIvaTotal += sign * lawIva;
      lawItTotal += sign * lawIt;
      ivaGap += sign * (lawIva - Math.abs(Number(f.iva_amount)));
      itGap += sign * (lawIt - Math.abs(Number(f.it_amount)));
    }

    console.log(`\n  ── Historical impact over ${facturas.length} issued facturas ──`);
    console.log(`  invoiced total                     ${money(grossTotal).padStart(14)}`);
    console.log(`  VAT as issued                      ${money(issuedIva).padStart(14)}`);
    console.log(`  VAT per the configured codes       ${money(lawIvaTotal).padStart(14)}`);
    console.log(`  UNDERSTATED VAT                    ${money(ivaGap).padStart(14)}`);
    console.log(`  turnover tax as issued             ${money(issuedIt).padStart(14)}`);
    console.log(`  turnover tax per configured codes  ${money(lawItTotal).padStart(14)}`);
    console.log(`  UNDERSTATED turnover tax           ${money(itGap).padStart(14)}`);
    console.log(`  TOTAL TAX UNDERSTATED              ${money(ivaGap + itGap).padStart(14)}`);

    const f0 = facturas[0];
    const g0 = Math.abs(Number(f0.total_amount));
    const c0 = calculateTax(g0, applicable);
    const old0 = legacy.breakdown(g0);
    console.log(`\n  Worked example, factura #${f0.factura_number} — invoiced ${money(g0)}`);
    console.log(
      `    VAT       issued ${money(old0.iva).padStart(10)}   configured ` +
      `${money(c0.lines.filter(l => l.tax_type === 'VAT').reduce((s, l) => s + l.amount, 0)).padStart(10)}`,
    );
    console.log(
      `    turnover  issued ${money(old0.it).padStart(10)}   configured ` +
      `${money(c0.lines.filter(l => l.tax_type === 'TURNOVER').reduce((s, l) => s + l.amount, 0)).padStart(10)}`,
    );

    console.log(
      `\n  NOTE  Test-database figures. No factura was modified by this script.\n` +
      `        Whether a correction is filed is a decision for the Finance co-founder.\n` +
      `        For Bolivia: Ley 1733 (27 May 2026) moves the country to IVA por fuera once\n` +
      `        its reglamentary Decreto Supremo is published. At that point add a NEW\n` +
      `        date-effective TaxCode with base_kind = NET and is_inclusive = false —\n` +
      `        do not edit the existing row, or history stops reproducing.`,
    );
  }

  console.log(`\n${APPLY ? 'APPLIED.' : 'Report only — pass --apply to set base_kind.'}`);
  await db.$disconnect();
})().catch(async (e) => {
  console.error('ERR', e.message);
  await db.$disconnect();
  process.exit(1);
});
