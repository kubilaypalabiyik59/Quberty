import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';
import { postJournal } from '../src/shared/services/journal.service';
import { resolvePostingAccounts } from '../src/shared/services/postingProfile.service';
import { contextForSalesOrder } from '../src/shared/services/dimension.service';

/**
 * Post the correcting entries for D-2, D-3, D-6 and the 2103/2105 split.
 *
 *   npx tsx scripts/postDefectCorrections.ts             # dry run, prints every voucher
 *   npx tsx scripts/postDefectCorrections.ts --apply
 *
 * Evidence: docs/process/GAP_ANALYSIS.md §0.0. **Every amount below is re-derived
 * from the database**, never copied from that document — the document is the
 * finding, the database is the fact. Where the two disagree the script says so and
 * stops rather than posting the document's number.
 *
 * ── What is corrected, and what is deliberately NOT ─────────────────────────
 * The five D-2 sales were invoiced. Their facturas exist and state their own
 * subtotal, IVA and IT — computed with the pre-Ley-843-fix arithmetic (IVA 11,5% of
 * the invoiced amount instead of 13%). This script posts the missing voucher **as
 * the factura states it**, not recomputed.
 *
 * That is deliberate and it is the whole distinction between two different
 * corrections:
 *   · this one restores a voucher that was never written for a document that WAS
 *     issued — bookkeeping catching up with a legal document;
 *   · restating the Bs 637,47 of historically understated IVA and IT would change
 *     what 27 issued facturas say, which is a filing decision for the Finance
 *     co-founder and is NOT in this script.
 * Conflating them would quietly restate tax returns under cover of a bug fix.
 *
 * ── One voucher per transaction ─────────────────────────────────────────────
 * **[OFFICIAL]** "Vouchers always represent individual transactions, never a group
 * of transactions." So this posts one correcting voucher per affected SALE, not one
 * per defect class aggregating several sales. Nine vouchers, each traceable to its
 * own order.
 */

const APPLY = process.argv.includes('--apply');
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Line {
  accountId: string;
  debit?: number;
  credit?: number;
  description: string;
}
interface Voucher {
  order: string;
  orderId: string;
  reason: string;
  description: string;
  lines: Line[];
}

(async () => {
  const tenant = (await db.tenant.findFirst({ select: { id: true, name: true } }))!;
  const tenantId = tenant.id;
  console.log(`Tenant: ${tenant.name}\n`);

  const acc = await resolvePostingAccounts(
    ['AR', 'REVENUE', 'VAT_OUTPUT', 'TAX_TURNOVER_EXPENSE', 'TAX_TURNOVER_PAYABLE'] as const,
    { tenantId, legalEntityId: null, on: new Date() },
  );

  const byCode = async (code: string) => {
    const a = await db.account.findFirst({
      where: { tenant_id: tenantId, code },
      select: { id: true, code: true, name: true },
    });
    if (!a) throw new Error(`Account ${code} not found — cannot build the correction.`);
    return a;
  };

  // Every account that can appear on a line, not only the profile-resolved ones —
  // a correction report that prints a UUID where an account code belongs is not a
  // report anybody can approve.
  const accountName = new Map<string, string>();
  for (const a of await db.account.findMany({
    where: { tenant_id: tenantId },
    select: { id: true, code: true, name: true },
  })) {
    accountName.set(a.id, `${a.code} ${a.name}`);
  }

  const vouchers: Voucher[] = [];

  // ══ 1. D-2 — five POS sales whose revenue voucher was never written ═══════
  //
  // Detected by the join that goes through the ORDER. Matching revenue to COGS on
  // `source_id` alone reports nearly every COGS voucher in the tenant, because a
  // COGS voucher is keyed on the order and a revenue voucher on the factura.
  console.log('── D-2  COGS posted with no revenue voucher');
  const orphans = await db.$queryRawUnsafe<any[]>(
    `
    WITH cogs_vouchers AS (
      SELECT je.id, je.entry_number, je.source_id,
             SUM(jl.debit_amount) FILTER (WHERE a.category = 'COGS')::float AS cogs
      FROM journal_entries je
      JOIN journal_lines jl ON jl.journal_entry_id = je.id
      JOIN accounts a ON a.id = jl.account_id
      WHERE je.tenant_id = $1::uuid AND je.source_module = 'POS_COGS'
      GROUP BY je.id
      HAVING SUM(jl.debit_amount) FILTER (WHERE a.category = 'COGS') > 0
    )
    SELECT cv.* FROM cogs_vouchers cv
    LEFT JOIN sales_orders so ON so.id = cv.source_id
    WHERE NOT EXISTS (
      SELECT 1 FROM journal_entries r
      JOIN journal_lines rl ON rl.journal_entry_id = r.id
      JOIN accounts ra ON ra.id = rl.account_id
      WHERE r.tenant_id = $1::uuid AND ra.category = 'REVENUE' AND rl.credit_amount > 0
        AND (r.source_id = cv.source_id OR r.source_id = so.invoice_id)
    )
    ORDER BY cv.entry_number
  `,
    tenantId,
  );

  for (const o of orphans) {
    const order = await db.salesOrder.findFirst({
      where: { id: o.source_id },
      select: { id: true, order_number: true, invoice_id: true },
    });
    if (!order) {
      console.log(`  SKIP  ${o.entry_number}: source is not a sales order — cannot derive the revenue`);
      continue;
    }
    const f = order.invoice_id
      ? await db.factura.findFirst({
          where: { id: order.invoice_id },
          select: { factura_number: true, subtotal: true, iva_amount: true, it_amount: true, total_amount: true, status: true },
        })
      : null;

    if (!f) {
      console.log(
        `  SKIP  ${order.order_number}: no factura. The sale was never invoiced, so there is no ` +
          `legal document to derive revenue from. Inventing one would fabricate a sale.`,
      );
      continue;
    }
    if (f.status !== 'ISSUED') {
      console.log(`  SKIP  ${order.order_number}: factura #${f.factura_number} is ${f.status}, not ISSUED`);
      continue;
    }

    const sub = round2(Number(f.subtotal));
    const iva = round2(Number(f.iva_amount));
    const it = round2(Number(f.it_amount));
    const total = round2(Number(f.total_amount));

    // The factura must internally balance, or the voucher derived from it cannot.
    if (round2(sub + iva) !== total) {
      console.log(
        `  STOP  ${order.order_number}: factura #${f.factura_number} does not add up ` +
          `(${sub} + ${iva} ≠ ${total}). Not correcting a document that is itself inconsistent.`,
      );
      continue;
    }

    vouchers.push({
      order: order.order_number,
      orderId: order.id,
      reason: `D-2: POS revenue voucher was never written. COGS of ${o.cogs.toFixed(2)} was posted by ${o.entry_number} against no sale.`,
      description: `Correction D-2 — missing revenue for ${order.order_number} (Factura #${String(f.factura_number).padStart(6, '0')})`,
      lines: [
        { accountId: acc.AR, debit: total, description: `AR — ${order.order_number}` },
        { accountId: acc.REVENUE, credit: sub, description: `Revenue — ${order.order_number}` },
        { accountId: acc.VAT_OUTPUT, credit: iva, description: `Output VAT per factura #${f.factura_number}` },
        ...(it > 0
          ? [
              { accountId: acc.TAX_TURNOVER_EXPENSE, debit: it, description: `IT expense — ${order.order_number}` },
              { accountId: acc.TAX_TURNOVER_PAYABLE, credit: it, description: `IT payable — ${order.order_number}` },
            ]
          : []),
      ],
    });
  }

  // ══ 2. D-6 + 2105 + D-3 — the four POS sales posted to the wrong accounts ══
  //
  // Each of those vouchers has three lines: AR debited to 1201 *Activo Fijo*,
  // revenue correctly to 4101, and output VAT to 2105 rather than 2103. The IT pair
  // is absent entirely. One correcting voucher per sale fixes all three, because
  // all three are one transaction: "correct POS sale X".
  console.log('\n── D-6 / 2105 / D-3  POS sales posted to the wrong accounts');
  const fixedAsset = await byCode('1201');
  const strayVat = await byCode('2105');

  const wrong = await db.$queryRawUnsafe<any[]>(
    `
    SELECT je.id, je.entry_number, je.entry_date, je.source_id,
           SUM(jl.debit_amount) FILTER (WHERE a.code = '1201')::float AS in_fixed_asset,
           SUM(jl.credit_amount) FILTER (WHERE a.code = '2105')::float AS in_stray_vat
    FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.tenant_id = $1::uuid AND je.is_correction = false
    GROUP BY je.id
    HAVING SUM(jl.debit_amount) FILTER (WHERE a.code = '1201') > 0
        OR SUM(jl.credit_amount) FILTER (WHERE a.code = '2105') > 0
    ORDER BY je.entry_number
  `,
    tenantId,
  );

  for (const w of wrong) {
    const order = await db.salesOrder.findFirst({
      where: { id: w.source_id },
      select: { id: true, order_number: true, invoice_id: true },
    });
    if (!order) {
      console.log(`  SKIP  ${w.entry_number}: no sales order behind it`);
      continue;
    }
    const f = order.invoice_id
      ? await db.factura.findFirst({
          where: { id: order.invoice_id },
          select: { factura_number: true, it_amount: true },
        })
      : null;

    const misAR = round2(w.in_fixed_asset ?? 0);
    const misVat = round2(w.in_stray_vat ?? 0);
    const missingIt = round2(Number(f?.it_amount ?? 0));

    const lines: Line[] = [];
    const parts: string[] = [];

    if (misAR > 0) {
      lines.push(
        { accountId: acc.AR, debit: misAR, description: `Reclassify to receivables — ${order.order_number}` },
        { accountId: fixedAsset.id, credit: misAR, description: `Out of ${fixedAsset.code} ${fixedAsset.name} — ${order.order_number}` },
      );
      parts.push(`D-6 AR ${misAR.toFixed(2)}`);
    }
    if (misVat > 0) {
      lines.push(
        { accountId: strayVat.id, debit: misVat, description: `Clear ${strayVat.code} — ${order.order_number}` },
        { accountId: acc.VAT_OUTPUT, credit: misVat, description: `Into the canonical output VAT account — ${order.order_number}` },
      );
      parts.push(`2105→2103 ${misVat.toFixed(2)}`);
    }
    if (missingIt > 0) {
      lines.push(
        { accountId: acc.TAX_TURNOVER_EXPENSE, debit: missingIt, description: `IT expense never posted — ${order.order_number}` },
        { accountId: acc.TAX_TURNOVER_PAYABLE, credit: missingIt, description: `IT payable never posted — ${order.order_number}` },
      );
      parts.push(`D-3 IT ${missingIt.toFixed(2)}`);
    } else if (f) {
      console.log(`  NOTE  ${order.order_number}: factura #${f.factura_number} accrues no IT — nothing to post for D-3`);
    }

    if (lines.length === 0) continue;

    vouchers.push({
      order: order.order_number,
      orderId: order.id,
      reason:
        `D-6 / D-7 / D-3: ${w.entry_number} debited receivables to ${fixedAsset.code} ${fixedAsset.name}, ` +
        `credited output VAT to ${strayVat.code} instead of the canonical account, and posted no IT.`,
      description: `Correction — POS sale ${order.order_number} (${parts.join(', ')})`,
      lines,
    });
  }

  // ══ Report ════════════════════════════════════════════════════════════════
  console.log(`\n══ ${vouchers.length} correcting voucher(s)\n`);
  let totalDr = 0;
  for (const v of vouchers) {
    const dr = round2(v.lines.reduce((s, l) => s + (l.debit ?? 0), 0));
    const cr = round2(v.lines.reduce((s, l) => s + (l.credit ?? 0), 0));
    totalDr += dr;
    console.log(`${v.description}`);
    console.log(`  why: ${v.reason}`);
    for (const l of v.lines) {
      const label = accountName.get(l.accountId) ?? l.accountId;
      console.log(
        `    ${label.padEnd(34)} ${l.debit ? `dr ${l.debit.toFixed(2)}`.padStart(12) : ''.padStart(12)} ` +
          `${l.credit ? `cr ${l.credit.toFixed(2)}`.padStart(12) : ''.padStart(12)}  ${l.description}`,
      );
    }
    console.log(`    ${'—'.repeat(34)} dr ${dr.toFixed(2)} / cr ${cr.toFixed(2)} ${dr === cr ? '✓' : '✗ UNBALANCED'}\n`);
    if (dr !== cr) {
      console.error('Refusing to continue: a correction that does not balance is not a correction.');
      process.exit(1);
    }
  }
  console.log(`Total corrected: ${totalDr.toFixed(2)}\n`);

  if (!APPLY) {
    console.log('Dry run. Re-run with --apply to post them.');
    await db.$disconnect();
    return;
  }

  // ══ Apply ═════════════════════════════════════════════════════════════════
  // Posted on TODAY'S date, not the original's. CORRECTIONS.md §4.2: backdating
  // would post into a period that may already have been declared, which is what
  // postJournal's closed-period check exists to prevent.
  for (const v of vouchers) {
    const entry = await postJournal({
      tenantId,
      description: v.description,
      source: { module: 'CORRECTION', id: v.orderId },
      // Dimensions resolve from the order. These orders have no site, so the
      // corrections land in "(unassigned)" — the same bucket as the sales they
      // correct, which is what keeps the two comparable.
      dimensions: await contextForSalesOrder(tenantId, v.orderId),
      lines: v.lines.map(l => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
      })),
    });
    console.log(`  posted ${entry.entry_number}  ${v.description}`);
  }

  console.log(`\nPosted ${vouchers.length} voucher(s).`);
  await db.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
