import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { SalesService } from '../src/modules/sales/sales.service';
import { resolveInventoryDimensions } from '../src/shared/services/inventoryDimension.service';

/**
 * Drives the real service against the real database and asserts that site is
 * derived, never entered. Self-cleaning: everything it creates, it deletes, and
 * it asserts the sales-order count returns to the baseline it started from.
 *
 * This exists because the whole defect it fixes was invisible to reading. The
 * column was there, the type was right, and 41 of 51 rows were empty.
 *
 *   npx tsx scripts/verifySalesDimensionsLive.ts
 */
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } }, log: ['error'] });

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name} ${detail}`); }
}

(async () => {
  const tenant = await prisma.$queryRawUnsafe<any[]>(
    `SELECT DISTINCT tenant_id::text AS id FROM warehouses LIMIT 1`,
  );
  const tenantId = tenant[0].id;

  const warehouses = await prisma.$queryRawUnsafe<any[]>(
    `SELECT w.id, w.code, w.site_id::text AS site_id FROM warehouses w WHERE w.tenant_id::text=$1 ORDER BY w.code`,
    tenantId,
  );
  const wh = warehouses[0];

  const product = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id::text AS id FROM products WHERE tenant_id::text=$1 LIMIT 1`, tenantId,
  );
  const user = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id::text AS id FROM users WHERE tenant_id::text=$1 LIMIT 1`, tenantId,
  );

  const [{ n: baseline }] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*)::int AS n FROM sales_orders WHERE tenant_id::text=$1`, tenantId,
  );

  console.log(`tenant ${tenantId}  ·  baseline sales orders: ${baseline}\n`);

  // ── 1. The resolver derives the site of the warehouse it is given ──────────
  console.log('resolver');
  const explicit = await resolveInventoryDimensions(tenantId, { warehouseId: wh.id });
  check('explicit warehouse resolves', explicit.warehouse_id === wh.id);
  check('site is the warehouse\'s site', explicit.site_id === wh.site_id,
    `got ${explicit.site_id}, expected ${wh.site_id}`);
  check('origin recorded as explicit', explicit.origin === 'explicit', `got ${explicit.origin}`);

  // ── 2. A warehouse from nowhere is refused, not silently swapped ───────────
  let refused = false;
  try {
    await resolveInventoryDimensions(tenantId, { warehouseId: '00000000-0000-0000-0000-000000000000' });
  } catch { refused = true; }
  check('unknown warehouse is refused rather than falling back', refused);

  // ── 3. The service writes the derived site, not whatever it was handed ─────
  console.log('\nsales order creation');
  const svc = new SalesService();
  let orderId: string | null = null;
  try {
    const order: any = await svc.createOrder(
      tenantId,
      {
        warehouse_id: wh.id,
        // Deliberately passed and deliberately ignored: if this ever lands in
        // the row, the derivation has been bypassed somewhere.
        site_id: '11111111-1111-1111-1111-111111111111',
        requested_delivery_date: '2026-09-30',
        lines: [{ product_id: product[0].id, quantity: 1, unit_price: 100 }],
      } as any,
      user[0].id,
    );
    orderId = order.id;

    check('order carries the warehouse', order.warehouse_id === wh.id);
    check('order site is DERIVED from the warehouse', order.site_id === wh.site_id,
      `got ${order.site_id}`);
    check('a site_id passed by the caller is ignored',
      order.site_id !== '11111111-1111-1111-1111-111111111111');
    check('requested_delivery_date is stored', order.requested_delivery_date !== null,
      `got ${order.requested_delivery_date}`);
  } finally {
    if (orderId) {
      await prisma.$executeRawUnsafe(`DELETE FROM sales_order_lines WHERE order_id::text=$1`, orderId);
      await prisma.$executeRawUnsafe(`DELETE FROM sales_orders WHERE id::text=$1`, orderId);
    }
  }

  // ── 4. Nothing left behind ────────────────────────────────────────────────
  const [{ n: after }] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*)::int AS n FROM sales_orders WHERE tenant_id::text=$1`, tenantId,
  );
  console.log('\ncleanup');
  check('sales order count back to baseline', after === baseline, `${after} vs ${baseline}`);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.error('  ✗ ' + f);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
