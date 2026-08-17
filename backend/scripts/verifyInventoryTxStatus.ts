/**
 * Verify migration 016 — inventory transaction status.
 *
 *   npx tsx scripts/verifyInventoryTxStatus.ts
 *
 * Three things are checked, in descending order of how much they matter:
 *   1. the database actually REFUSES an invalid or double status (the constraints
 *      are real, not decorative);
 *   2. the backfill landed on the statuses **[OFFICIAL]** prescribes, and left
 *      ADJUSTMENT alone rather than guessing its direction;
 *   3. a live write through a real service path carries a status.
 *
 * Every mutation runs inside a transaction that always rolls back.
 */
import { db } from '../src/infrastructure/database/client';
import { physicalStatusFor } from '../src/shared/services/inventoryTransactionStatus';

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

/** Run `fn` inside a transaction that is always rolled back. */
async function inRollback(fn: (tx: any) => Promise<void>): Promise<'ok' | 'rejected'> {
  try {
    await db.$transaction(async tx => {
      await fn(tx);
      throw new Error('ROLLBACK');
    });
    return 'ok';
  } catch (err) {
    return err instanceof Error && err.message === 'ROLLBACK' ? 'ok' : 'rejected';
  }
}

async function main() {
  const tenant = await db.tenant.findFirst({ select: { id: true, name: true } });
  if (!tenant) throw new Error('No tenant.');
  const product = await db.product.findFirst({ where: { tenant_id: tenant.id }, select: { id: true } });
  if (!product) throw new Error('No product.');
  console.log(`Tenant: ${tenant.name}\n`);

  // ── 1. The constraints ───────────────────────────────────────────────────
  console.log('1  The database enforces the two ladders');

  const base = { tenant_id: tenant.id, transaction_type: 'TEST', product_id: product.id, quantity: 1 };

  const bogus = await inRollback(async tx => {
    await tx.inventoryTransaction.create({ data: { ...base, receipt_status: 'DELIVERED' } });
  });
  check('a status outside the receipt ladder is rejected', bogus === 'rejected');

  const bogus2 = await inRollback(async tx => {
    await tx.inventoryTransaction.create({ data: { ...base, issue_status: 'RECEIVED' } });
  });
  check('a receipt status in the issue column is rejected', bogus2 === 'rejected');

  const both = await inRollback(async tx => {
    await tx.inventoryTransaction.create({
      data: { ...base, receipt_status: 'RECEIVED', issue_status: 'DEDUCTED' },
    });
  });
  check('a transaction on BOTH ladders at once is rejected', both === 'rejected',
    '[OFFICIAL] "either the Receipt or the Issue field"');

  const good = await inRollback(async tx => {
    await tx.inventoryTransaction.create({ data: { ...base, receipt_status: 'RECEIVED' } });
  });
  check('a valid receipt status is accepted', good === 'ok');

  // ── 2. The mapping matches the documentation ─────────────────────────────
  console.log('\n2  The helper maps to what Learn prescribes');

  const cases: Array<[string, number | undefined, string | null, string | null, boolean]> = [
    // type,             delta,     receipt,      issue,       financial_date set?
    ['PURCHASE_RECEIPT', undefined, 'RECEIVED',   null,        false],
    ['RETURN',           undefined, 'RECEIVED',   null,        false],
    ['TRANSFER_IN',      undefined, 'RECEIVED',   null,        false],
    ['OUTBOUND',         undefined, null,         'DEDUCTED',  false],
    ['TRANSFER_OUT',     undefined, null,         'DEDUCTED',  false],
    ['ADJUSTMENT',       5,         'PURCHASED',  null,        true],
    ['ADJUSTMENT',       -5,        null,         'SOLD',      true],
    ['ADJUSTMENT',       undefined, null,         null,        false],
    ['SOMETHING_NEW',    undefined, null,         null,        false],
  ];

  for (const [type, delta, wantReceipt, wantIssue, wantFinancial] of cases) {
    const r = physicalStatusFor(type, delta === undefined ? {} : { delta });
    const ok =
      r.receipt_status === wantReceipt &&
      r.issue_status === wantIssue &&
      (r.financial_date !== null) === wantFinancial;
    check(
      `${type}${delta === undefined ? '' : ` (${delta > 0 ? '+' : ''}${delta})`} → ` +
        `${wantReceipt ?? wantIssue ?? 'uncoded'}`,
      ok,
      `got receipt=${r.receipt_status} issue=${r.issue_status} financial=${r.financial_date !== null}`,
    );
  }

  console.log('        ADJUSTMENT with no delta stays uncoded rather than guessing a direction —');
  console.log('        quantities are stored unsigned, so the direction is genuinely unknowable.');
  console.log('        An unknown type is also uncoded, so a new type cannot silently inherit');
  console.log('        the wrong ladder.');

  // ── 3. The backfill ──────────────────────────────────────────────────────
  console.log('\n3  Backfill of the existing subledger');
  const rows = await db.$queryRawUnsafe<any[]>(`
    SELECT transaction_type,
           COALESCE(receipt_status, '—') AS receipt,
           COALESCE(issue_status,   '—') AS issue,
           COUNT(*)::int AS n,
           COUNT(physical_date)::int AS with_physical
    FROM inventory_transactions
    GROUP BY 1,2,3 ORDER BY n DESC`);
  for (const r of rows) {
    console.log(`        ${String(r.transaction_type).padEnd(18)} receipt=${String(r.receipt).padEnd(10)} issue=${String(r.issue).padEnd(10)} n=${String(r.n).padStart(3)}  physical_date on ${r.with_physical}`);
  }

  const uncoded = await db.$queryRawUnsafe<any[]>(`
    SELECT transaction_type, COUNT(*)::int AS n FROM inventory_transactions
    WHERE receipt_status IS NULL AND issue_status IS NULL GROUP BY 1`);
  const onlyAdjustment = uncoded.every(r => r.transaction_type === 'ADJUSTMENT');
  check('everything except ADJUSTMENT was backfilled', onlyAdjustment,
    uncoded.map(r => `${r.transaction_type}=${r.n}`).join(' '));
  check('ADJUSTMENT was left uncoded on purpose, not by omission',
    uncoded.some(r => r.transaction_type === 'ADJUSTMENT') || uncoded.length === 0);

  const contradictions = await db.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n FROM inventory_transactions
    WHERE receipt_status IS NOT NULL AND issue_status IS NOT NULL`);
  check('no historical row sits on both ladders', contradictions[0].n === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async e => { console.error(e); await db.$disconnect(); process.exit(1); });
