import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';
import { computeDocumentTax, computePurchaseMoney } from '../src/shared/services/documentTax.service';

/**
 * Migration 020: a tax code applies to a side.
 *
 *   npx tsx scripts/verifyTaxSide.ts
 *
 * Read-only. Proves two things by calling the engine, not by reading it:
 *   · Bolivia's IT is gone from the purchase side (Ley 843 art. 74 — IT is on
 *     gross INCOME, and a purchase is the supplier's income, not ours);
 *   · the SALES side is bit-for-bit unchanged, which is the regression that
 *     matters. CLAUDE.md §6: Bolivia must keep working exactly as it does now.
 */
let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

(async () => {
  const tenant = (await db.tenant.findFirst({ select: { id: true, name: true } }))!;
  console.log(`Tenant: ${tenant.name}\n`);

  const codes = await db.taxCode.findMany({
    where: { tenant_id: tenant.id },
    select: { code: true, tax_type: true, applies_to: true, rate: true, base_kind: true },
    orderBy: { code: 'asc' },
  });
  console.log('Tax codes');
  for (const c of codes) {
    console.log(`  ${c.code.padEnd(8)} ${c.tax_type.padEnd(10)} applies_to=${c.applies_to} base=${c.base_kind} rate=${c.rate}`);
  }

  console.log('\nThe data says what the law says');
  const it = codes.find(c => c.tax_type === 'TURNOVER');
  const iva = codes.find(c => c.tax_type === 'VAT');
  check('IT is SALES only (Ley 843 art. 74 — tax on gross INCOME)', it?.applies_to === 'SALES', `got ${it?.applies_to}`);
  check('IVA stays BOTH (output on sales, recoverable input on purchases)', iva?.applies_to === 'BOTH', `got ${iva?.applies_to}`);

  // ── The sales side must not move ─────────────────────────────────────────
  // Bs 1 299,00 is the live factura #26 used throughout BOLIVIA_TAX_BASIS.md.
  console.log('\nSALES — Bs 1 299,00 (live factura #26)');
  const sale = await computeDocumentTax(tenant.id, 1299.0, { side: 'SALES' });
  console.log(`  subtotal ${sale.subtotal.toFixed(2)} · IVA ${sale.vat.toFixed(2)} · IT ${sale.turnover.toFixed(2)} · total ${sale.total.toFixed(2)}`);
  check('IVA is 13% of the invoiced amount (por dentro, art. 5 + art. 7)', near(sale.vat, 168.87), `${sale.vat}`);
  check('IT is 3% of the invoiced amount (ingresos brutos, art. 74)', near(sale.turnover, 38.97), `${sale.turnover}`);
  check('IT is still charged on sales — this fix must not remove it', sale.turnover > 0);
  check('the total is what the customer is invoiced', near(sale.total, 1299.0), `${sale.total}`);

  // ── The purchase side loses IT and nothing else ──────────────────────────
  console.log('\nPURCHASE — Bs 2 500,00 (the figure in S2P_O2C_STATUS §5)');
  const buy = await computePurchaseMoney(tenant.id, 2500.0);
  console.log(
    `  net ${buy.net.toFixed(2)} · recoverable ${buy.recoverable_tax.toFixed(2)} · ` +
      `non-recoverable ${buy.non_recoverable_tax.toFixed(2)} · total ${buy.total.toFixed(2)}`,
  );
  check('non-recoverable tax is now ZERO (was Bs 75 of IT)', near(buy.non_recoverable_tax, 0), `${buy.non_recoverable_tax}`);
  check('recoverable IVA is unchanged at 13% of gross', near(buy.recoverable_tax, 325.0), `${buy.recoverable_tax}`);
  check('AP still owes the agreed amount in full', near(buy.total, 2500.0), `${buy.total}`);
  check('inventory is still debited net of the recoverable tax', near(buy.net, 2175.0), `${buy.net}`);
  check('the voucher still balances: net + recoverable = total',
    near(buy.net + buy.recoverable_tax, buy.total));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await db.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
