import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';
import { computePurchaseMoney } from '../src/shared/services/documentTax.service';

/**
 * Restate purchase orders that still carry the pre-fix tax arithmetic.
 *
 *   npx tsx scripts/restatePurchaseOrderTax.ts            report only
 *   npx tsx scripts/restatePurchaseOrderTax.ts --apply    rewrite the UNPOSTED ones
 *
 * WHY THIS IS NARROWER THAN "FIX ALL PURCHASE ORDERS"
 *
 * A received PO has already produced a POSTED journal entry whose VAT_INPUT and
 * AP lines were taken from `tax_amount` / `total_amount`
 * (purchase.routes.ts — PO receipt block). Rewriting the header of such an order
 * does not correct the ledger; it desynchronises the subledger from the GL,
 * which is strictly worse than leaving two arithmetics side by side.
 *
 * So this script splits the population in three:
 *
 *   MATCHES   header already agrees with the engine — nothing to do
 *   UNPOSTED  drifted, and no journal entry references it → safe to restate,
 *             because nothing downstream has consumed the figure yet
 *   POSTED    drifted, and a journal entry exists → reported, never touched.
 *             Correcting these means a reversing/adjusting journal, which is a
 *             Finance decision (BOLIVIA_TAX_BASIS.md §5, open question 3).
 *
 * The `subtotal` column is the agreed (gross) figure with the supplier and is
 * NOT recomputed — only the split of it into recoverable tax and total.
 */

const APPLY = process.argv.includes('--apply');
const money = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const tenants = await db.tenant.findMany({
    select: { id: true, slug: true, name: true, currency_code: true },
  });

  for (const t of tenants) {
    console.log(`\n${'='.repeat(94)}\n${t.name} (${t.slug}) — ${t.currency_code}\n${'='.repeat(94)}`);

    const orders = await db.purchaseOrder.findMany({
      where: { tenant_id: t.id },
      select: {
        id: true, po_number: true, status: true, supplier_id: true,
        subtotal: true, tax_amount: true, total_amount: true,
        source_document_type: true, received_at: true,
      },
      orderBy: { po_number: 'asc' },
    });

    if (!orders.length) {
      console.log('  no purchase orders');
      continue;
    }

    // One query for every journal entry that references one of these orders, so
    // "has this order been posted?" is a set lookup rather than N queries.
    //
    // Both posting points must be counted: the receipt posts under `PURCHASE`
    // and the supplier payment under `PURCHASE_PAYMENT` (purchase.routes.ts),
    // and the payment journal takes its amount from `total_amount` as well. An
    // order that was received before auto-posting existed but has since been
    // paid is still anchored to the GL and must not be rewritten.
    const entries = await db.journalEntry.findMany({
      where: { tenant_id: t.id, source_id: { in: orders.map((o) => o.id) } },
      select: { source_id: true, entry_number: true, source_module: true },
      orderBy: { entry_number: 'asc' },
    });
    const postedBy = new Map<string, string>();
    for (const e of entries) {
      if (!e.source_id) continue;
      const prev = postedBy.get(e.source_id);
      postedBy.set(e.source_id, prev ? `${prev}, ${e.entry_number}` : `${e.entry_number} (${e.source_module})`);
    }

    const matches: string[] = [];
    const unposted: { po: (typeof orders)[number]; tax: number; total: number }[] = [];
    const posted: { po: (typeof orders)[number]; tax: number; total: number; voucher: string }[] = [];

    for (const po of orders) {
      const subtotal = Number(po.subtotal);
      if (subtotal === 0) { matches.push(po.po_number); continue; }

      const m = await computePurchaseMoney(t.id, subtotal, { partyId: po.supplier_id });
      const drifted =
        Math.abs(m.recoverable_tax - Number(po.tax_amount)) >= 0.01 ||
        Math.abs(m.total - Number(po.total_amount)) >= 0.01;

      if (!drifted) { matches.push(po.po_number); continue; }

      const voucher = postedBy.get(po.id);
      if (voucher) posted.push({ po, tax: m.recoverable_tax, total: m.total, voucher });
      else unposted.push({ po, tax: m.recoverable_tax, total: m.total });
    }

    const eff = (tax: number, total: number) => (total > 0 ? (tax / total) * 100 : 0);
    const row = (n: string, s: string, src: string, was: [number, number], now: [number, number], tail = '') =>
      `  ${n.padEnd(16)} ${s.padEnd(10)} ${src.padEnd(12)}` +
      ` ${money(was[0]).padStart(10)} /${money(was[1]).padStart(11)} (${eff(was[0], was[1]).toFixed(2).padStart(5)}%)` +
      ` → ${money(now[0]).padStart(10)} /${money(now[1]).padStart(11)} (${eff(now[0], now[1]).toFixed(2).padStart(5)}%)${tail}`;

    console.log(`\n  ${orders.length} purchase orders — ${matches.length} already correct, ` +
      `${unposted.length} drifted & unposted, ${posted.length} drifted & POSTED`);

    if (unposted.length) {
      console.log(`\n  ── Drifted, no journal entry → safe to restate ──`);
      console.log(`  ${'PO'.padEnd(16)} ${'status'.padEnd(10)} ${'origin'.padEnd(12)}` +
        ` ${'tax / total as stored'.padStart(33)}    ${'tax / total per engine'.padStart(33)}`);
      for (const u of unposted) {
        console.log(row(u.po.po_number, u.po.status, u.po.source_document_type,
          [Number(u.po.tax_amount), Number(u.po.total_amount)], [u.tax, u.total]));
      }
    }

    if (posted.length) {
      console.log(`\n  ── Drifted, ALREADY POSTED → not touched, needs a Finance decision ──`);
      for (const p of posted) {
        console.log(row(p.po.po_number, p.po.status, p.po.source_document_type,
          [Number(p.po.tax_amount), Number(p.po.total_amount)], [p.tax, p.total],
          `   voucher ${p.voucher}`));
      }
      const gap = posted.reduce((s, p) => s + (p.tax - Number(p.po.tax_amount)), 0);
      const totalGap = posted.reduce((s, p) => s + (p.total - Number(p.po.total_amount)), 0);
      console.log(`\n  understated recoverable input tax on posted orders  ${money(gap).padStart(12)}`);
      console.log(`  difference in AP owed on posted orders              ${money(totalGap).padStart(12)}`);
    }

    if (APPLY && unposted.length) {
      for (const u of unposted) {
        await db.purchaseOrder.update({
          where: { id: u.po.id },
          data: { tax_amount: u.tax, total_amount: u.total, updated_at: new Date() },
        });
      }
      console.log(`\n  RESTATED ${unposted.length} unposted purchase orders.`);
    }
  }

  console.log(`\n${APPLY ? 'APPLIED — posted documents were left untouched.' : 'Report only — pass --apply to restate the unposted orders.'}`);
  await db.$disconnect();
})().catch(async (e) => {
  console.error('ERR', e.message);
  await db.$disconnect();
  process.exit(1);
});
