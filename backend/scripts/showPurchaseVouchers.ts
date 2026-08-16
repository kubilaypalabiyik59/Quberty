import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

/**
 * Print the vouchers a purchase order produced, line by line, with the accrual
 * balance at the end.
 *
 *   npx tsx scripts/showPurchaseVouchers.ts PO-2026-00023
 *
 * Written for verifying the split posting by eye after driving the UI: the
 * assertion script proves the arithmetic, this shows the actual ledger rows so a
 * human can agree with them.
 */

const poNumber = process.argv[2];
if (!poNumber) {
  console.error('usage: tsx scripts/showPurchaseVouchers.ts <PO-number>');
  process.exit(1);
}
const money = (n: number) => n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const po = await db.purchaseOrder.findFirst({
    where: { po_number: poNumber },
    include: {
      product_receipts: { select: { id: true, receipt_number: true, packing_slip: true, journal_entry_id: true } },
      vendor_invoices: { select: { id: true, invoice_number: true, internal_number: true, status: true, journal_entry_id: true } },
      lines: { select: { quantity: true, received_qty: true, invoiced_qty: true } },
    },
  });
  if (!po) throw new Error(`${poNumber} not found`);

  console.log(`\n${po.po_number} — status ${po.status}`);
  for (const l of po.lines) {
    console.log(`  line: ordered ${l.quantity} · received ${l.received_qty} · invoiced ${l.invoiced_qty}`);
  }

  const sourceIds = [
    ...po.product_receipts.map(r => r.id),
    ...po.vendor_invoices.map(i => i.id),
  ];

  const entries = await db.journalEntry.findMany({
    where: { source_id: { in: sourceIds } },
    include: { lines: { include: { account: { select: { code: true, name: true, category: true } } } } },
    orderBy: { entry_number: 'asc' },
  });

  let accrual = 0;
  for (const e of entries) {
    console.log(`\n  ${e.entry_number}  ${e.description}  [${e.source_module}]`);
    for (const l of e.lines) {
      const d = Number(l.debit_amount);
      const c = Number(l.credit_amount);
      console.log(
        `    ${l.account.code.padEnd(6)} ${l.account.name.slice(0, 42).padEnd(44)}` +
          `${d ? 'DR ' + money(d).padStart(10) : '   '.padEnd(13)}${c ? 'CR ' + money(c).padStart(10) : ''}`,
      );
      if (l.account.category === 'ACCRUED_PURCHASES') accrual += c - d;
    }
    const bal = e.lines.reduce((s, l) => s + Number(l.debit_amount) - Number(l.credit_amount), 0);
    console.log(`    ${'balance'.padEnd(51)}${money(Number(bal.toFixed(2))).padStart(13)}`);
  }

  console.log(
    `\n  GOODS RECEIVED NOT INVOICED, remaining on this order: ${money(Number(accrual.toFixed(2)))}` +
      `${Math.abs(accrual) < 0.005 ? '   ← cleared' : '   ← still accrued'}`,
  );

  await db.$disconnect();
})().catch(async (e) => {
  console.error('ERR', e.message);
  await db.$disconnect();
  process.exit(1);
});
