import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Set the default sales warehouse, and optionally make the dimension mandatory.
 *
 * ## Why this refuses to choose for you
 *
 * The obvious heuristic — "pick the warehouse most documents already use" —
 * produces the WRONG answer on the anchor tenant. Its busiest warehouse is
 * `WH-IST-01 / Istanbul Main Store`, a leftover from the Turkish template this
 * repo grew out of, in a business that trades in Bolivia. A script that
 * optimised for usage would quietly enshrine the leftover as the default and
 * every future order would inherit it.
 *
 * So this follows the precedent set by `provisionConfiguration.ts` for AR and
 * VAT_OUTPUT: report the candidates with the evidence, and refuse to act
 * without an explicit pin. Guessing is the failure mode, not the slowness.
 *
 *   npx tsx scripts/provisionSalesDimensions.ts                      # report only
 *   npx tsx scripts/provisionSalesDimensions.ts --warehouse WH-MAIN  # set default
 *   npx tsx scripts/provisionSalesDimensions.ts --warehouse WH-MAIN --require
 *
 * `--require` turns on `require_warehouse_on_sales_order`, after which a sales
 * order or POS sale that cannot resolve a warehouse is refused rather than
 * written without one. Do not turn it on before the default is set.
 */
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } }, log: ['error'] });

const argv = process.argv.slice(2);
const codeArg = argv.includes('--warehouse') ? argv[argv.indexOf('--warehouse') + 1] : null;
const doRequire = argv.includes('--require');
const tenantArg = argv.includes('--tenant') ? argv[argv.indexOf('--tenant') + 1] : null;

(async () => {
  const tenants = tenantArg
    ? [{ id: tenantArg }]
    : await prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT tenant_id AS id FROM warehouses ORDER BY 1`,
      );

  for (const t of tenants) {
    const warehouses = await prisma.$queryRawUnsafe<any[]>(
      `SELECT w.id, w.code, w.name, w.is_active,
              s.name AS site_name, s.city, s.country,
              (SELECT COUNT(*)::int FROM sales_orders o WHERE o.warehouse_id = w.id)    AS sales_orders,
              (SELECT COUNT(*)::int FROM purchase_orders p WHERE p.warehouse_id = w.id) AS purchase_orders,
              (SELECT COALESCE(SUM(st.quantity),0)::float
                 FROM warehouse_zones z
                 JOIN warehouse_locations l ON l.zone_id = z.id
                 JOIN inventory_stock st ON st.location_id = l.id
                WHERE z.warehouse_id = w.id)                                            AS on_hand
         FROM warehouses w JOIN sites s ON s.id = w.site_id
        WHERE w.tenant_id::text = $1
        ORDER BY w.code`,
      t.id,
    );

    if (!warehouses.length) continue;

    const params = await prisma.$queryRawUnsafe<any[]>(
      `SELECT default_warehouse_id, require_warehouse_on_sales_order
         FROM sales_parameters WHERE tenant_id::text = $1 AND legal_entity_id IS NULL`,
      t.id,
    );

    console.log(`\n═══ tenant ${t.id} ═══`);
    console.table(
      warehouses.map((w) => ({
        code: w.code,
        name: w.name,
        site: w.site_name,
        city: w.city,
        country: w.country,
        SOs: w.sales_orders,
        POs: w.purchase_orders,
        on_hand: w.on_hand,
        active: w.is_active,
      })),
    );

    const current = params[0];
    if (!current) {
      console.log('  ⚠ no sales_parameters row — run provisionConfiguration first');
      continue;
    }
    const currentWh = current.default_warehouse_id
      ? warehouses.find((w) => w.id === current.default_warehouse_id)?.code ?? current.default_warehouse_id
      : '(none)';
    console.log(`  current default: ${currentWh}   require: ${current.require_warehouse_on_sales_order}`);

    // Flag the thing a human should notice before pinning anything.
    const mixed = new Set(warehouses.map((w) => w.country));
    if (mixed.size > 1) {
      console.log(
        `  ⚠ warehouses span ${mixed.size} countries (${[...mixed].join(', ')}). ` +
          'Confirm which are real before making one the default — the busiest is not necessarily the right one.',
      );
    }

    if (!codeArg) {
      console.log('  → report only. Re-run with --warehouse <CODE> to set the default.');
      continue;
    }

    const picked = warehouses.find((w) => w.code === codeArg);
    if (!picked) {
      console.log(`  ✗ no warehouse with code "${codeArg}" in this tenant — skipping`);
      continue;
    }

    await prisma.$executeRawUnsafe(
      `UPDATE sales_parameters
          SET default_warehouse_id = $1::uuid,
              require_warehouse_on_sales_order = COALESCE($2, require_warehouse_on_sales_order),
              updated_at = NOW()
        WHERE tenant_id::text = $3 AND legal_entity_id IS NULL`,
      picked.id,
      doRequire ? true : null,
      t.id,
    );

    console.log(
      `  ✓ default warehouse = ${picked.code} (${picked.name}, site "${picked.site_name}")` +
        (doRequire ? '  ·  warehouse now MANDATORY on sales orders and POS sales' : ''),
    );
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
