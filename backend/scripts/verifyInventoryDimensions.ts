import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * What migration 011 and inventoryDimension.service.ts actually did.
 *
 * Run it BEFORE applying the migration to capture the baseline, and again after
 * — the numbers are the evidence. The invariant it asserts is the one the whole
 * change exists to establish:
 *
 *   on every demand table, COUNT(site_id) == COUNT(warehouse_id)
 *
 * i.e. every row that knows its warehouse also knows its site, and no row has
 * invented a site it cannot derive. A row with neither is honest; a row with a
 * warehouse but no site is the bug.
 *
 *   npx tsx scripts/verifyInventoryDimensions.ts
 */
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } }, log: ['error'] });

type Row = { table: string; total: number; wh: number; site: number };

const TABLES = ['sales_orders', 'purchase_orders', 'sales_quotations', 'purchase_requisitions'];

async function counts(): Promise<Row[]> {
  const out: Row[] = [];
  for (const t of TABLES) {
    const [r] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total, COUNT(warehouse_id)::int AS wh, COUNT(site_id)::int AS site FROM ${t}`,
    );
    out.push({ table: t, total: r.total, wh: r.wh, site: r.site });
  }
  return out;
}

(async () => {
  const rows = await counts();
  console.table(rows);

  const failures: string[] = [];

  for (const r of rows) {
    if (r.site !== r.wh) {
      failures.push(
        `${r.table}: ${r.wh} rows have a warehouse but only ${r.site} have a site — the derived copy is out of step`,
      );
    }
  }

  // A site that does not match its warehouse's site is the failure mode the
  // denormalisation risks. Checking it is cheap and it is the whole reason
  // site_id is written in one place only.
  for (const t of TABLES) {
    const [bad] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS n
         FROM ${t} d JOIN warehouses w ON w.id = d.warehouse_id
        WHERE d.site_id IS DISTINCT FROM w.site_id`,
    );
    if (bad.n > 0) failures.push(`${t}: ${bad.n} row(s) have a site that disagrees with their warehouse's site`);
  }

  // How much of the sales history remains unattributable. Not a failure — those
  // rows have no warehouse to derive from and must stay null — but it is the
  // number that says how much of the panel will read "unassigned".
  const [orphan] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*)::int AS n FROM sales_orders WHERE warehouse_id IS NULL`,
  );
  console.log(`\nsales orders with no warehouse (cannot be backfilled, report as unassigned): ${orphan.n}`);

  if (failures.length) {
    console.error('\nFAILED:');
    for (const f of failures) console.error('  ✗ ' + f);
    process.exitCode = 1;
  } else {
    console.log('\nOK — every row that has a warehouse has the matching derived site.');
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
