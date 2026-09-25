import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

/**
 * TEST-only reset of every transactional table (WORK-043).
 *
 *   ALLOW_TEST_DATABASE_WRITE=RESET_TEST_TRANSACTIONS npx tsx scripts/resetTestTransactions.ts [--apply]
 *
 * Kubi authorised wiping the Supabase TEST data on 2026-09-14: the stock, cost
 * layers, ledger and receivables there had diverged under the defects WORK-043/044
 * fix, and TEST is disposable. This keeps what a person set up — tenant, users,
 * chart of accounts, tax, posting profiles, parameters, number sequences, products,
 * customers, suppliers, sites, warehouses and locations, audit log — and empties
 * every document, movement and voucher, so the new stock ledger starts from a
 * consistent zero.
 *
 * One TRUNCATE without CASCADE: if any table outside this list still references
 * one inside it, PostgreSQL refuses the whole statement, so master data cannot be
 * emptied by accident. Customer lifetime counters, which were derived from the
 * deleted orders, return to zero. Prints table names and counts, never rows.
 */

const TRANSACTIONAL = [
  'inventory_cost_settlements', 'inventory_reservations',
  'arrival_journal_lines', 'arrival_journals',
  'factura_lines', 'facturas', 'factura_counters',
  'import_jobs',
  'inventory_cost_layers', 'inventory_count_lines', 'inventory_counts',
  'inventory_stock', 'inventory_transactions',
  'journal_lines', 'journal_entries',
  'leads', 'opportunities',
  'product_receipt_lines', 'product_receipts',
  'purchase_order_changes', 'purchase_order_lines', 'purchase_orders',
  'purchase_requisition_lines', 'purchase_requisitions',
  'purchase_return_lines', 'purchase_returns',
  'register_sessions',
  'rfq_request_lines', 'rfq_requests', 'rfq_case_lines', 'rfq_cases',
  'sales_order_lines', 'sales_orders', 'sales_quotation_lines', 'sales_quotations',
  'shipments',
  'supplier_credit_lines', 'supplier_credits',
  'vendor_invoice_lines', 'vendor_invoice_matches', 'vendor_invoices',
  'vendor_open_transactions', 'vendor_payments', 'vendor_settlements',
  'warehouse_work_lines', 'warehouse_work', 'waves',
];

async function main() {
  if (process.env.ALLOW_TEST_DATABASE_WRITE !== 'RESET_TEST_TRANSACTIONS') {
    throw new Error('Set ALLOW_TEST_DATABASE_WRITE=RESET_TEST_TRANSACTIONS to confirm this is the TEST database.');
  }
  const apply = process.argv.includes('--apply');

  const present = await db.$queryRaw<Array<{ name: string }>>`
    SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY(${TRANSACTIONAL}::text[])`;
  const tables = TRANSACTIONAL.filter((t) => present.some((p) => p.name === t));

  const counts: string[] = [];
  for (const t of tables) {
    const [{ n }] = await db.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${t}"`);
    if (n > 0) counts.push(`${t}=${n}`);
  }
  console.log(`Tables to empty (${tables.length}); non-empty: ${counts.join(', ') || 'none'}`);

  // Anything outside the list that points into it would block the truncate; name
  // it up front instead of letting the statement fail opaquely.
  const blockers = await db.$queryRaw<Array<{ referencing: string; referenced: string }>>`
    SELECT DISTINCT c.conrelid::regclass::text AS referencing, c.confrelid::regclass::text AS referenced
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.confrelid::regclass::text = ANY(${tables.map((t) => `${t}`)}::text[])
       AND NOT (c.conrelid::regclass::text = ANY(${tables}::text[]))`;
  if (blockers.length) {
    throw new Error(`Refusing: tables outside the reset reference it — ${blockers.map((b) => `${b.referencing} → ${b.referenced}`).join(', ')}`);
  }

  if (!apply) {
    console.log('Dry run. Re-run with --apply to empty these tables.');
    return;
  }

  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')}`);
    await tx.$executeRawUnsafe(`UPDATE "customers" SET "lifetime_value" = 0, "total_orders" = 0`);
  });
  console.log(`Emptied ${tables.length} transactional tables; customer lifetime counters reset.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
