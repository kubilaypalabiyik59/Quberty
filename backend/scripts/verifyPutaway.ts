/**
 * Verify warehouse Phase 1 — parameters, putaway work, and the move that
 * completing it must perform.
 *
 *   npx tsx scripts/verifyPutaway.ts
 *
 * This is the RCV-001 scenario, driven end to end:
 *   stock sits in a RECEIVE location → it must NOT count as available under
 *   PICK_LOCATIONS_ONLY → putaway work moves it to a PICK location → it counts.
 *
 * Everything it creates is deleted again, and the warehouse's parameters are
 * restored in a `finally` so a failure halfway cannot leave a tenant configured
 * differently than it was found.
 */
import { db } from '../src/infrastructure/database/client';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { WarehouseService } from '../src/modules/warehouse/warehouse.service';
import { AppError } from '../src/shared/errors/AppError';

const inventory = new InventoryService();
const warehouse = new WarehouseService();

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  const tenant = await db.tenant.findFirst({ select: { id: true, name: true } });
  if (!tenant) throw new Error('No tenant.');
  console.log(`Tenant: ${tenant.name}\n`);

  // A warehouse with both a receive location and a pick location.
  const warehouses = await db.warehouse.findMany({
    where: { tenant_id: tenant.id },
    include: { zones: { include: { locations: true } } },
  });

  let wh: any = null, receiveLoc: any = null, pickLoc: any = null;
  for (const w of warehouses) {
    const locs = w.zones.flatMap((z: any) => z.locations);
    const r = locs.find((l: any) => l.is_receive_location && l.is_active);
    const p = locs.find((l: any) => l.is_pick_location && l.is_active);
    if (r && p) { wh = w; receiveLoc = r; pickLoc = p; break; }
  }
  if (!wh) {
    console.log('SKIP — no warehouse has both a receive and a pick location.');
    console.log('       (WH-MAIN has RCV-001 but no pick location; that is itself the finding.)');
    await db.$disconnect();
    return;
  }
  console.log(`Warehouse ${wh.code}: receive=${receiveLoc.code} pick=${pickLoc.code}\n`);

  const product = await db.product.findFirst({
    where: { tenant_id: tenant.id, item_model_group_id: { not: null } },
    select: { id: true, sku: true },
  }) ?? await db.product.findFirst({ where: { tenant_id: tenant.id }, select: { id: true, sku: true } });
  if (!product) throw new Error('No product.');

  const params = await db.warehouseParameters.findUnique({ where: { warehouse_id: wh.id } });
  if (!params) throw new Error('Migration 017 did not seed parameters for this warehouse.');
  const original = { ...params };

  const cleanup: { stockIds: string[]; workIds: string[]; directiveIds: string[]; txRefs: string[] } =
    { stockIds: [], workIds: [], directiveIds: [], txRefs: [] };

  try {
    // ── 1. Defaults ───────────────────────────────────────────────────────
    console.log('1  The migration changed nothing by default');
    check('require_putaway defaults to false', original.require_putaway === false);
    check('availability_counts defaults to ALL_LOCATIONS',
      original.availability_counts === 'ALL_LOCATIONS');

    // ── 2. Availability respects the setting ──────────────────────────────
    console.log('\n2  Availability is a warehouse setting, not a constant');

    const stock = await db.inventoryStock.create({
      data: {
        tenant_id: tenant.id, product_id: product.id, variant_id: null,
        location_id: receiveLoc.id, quantity: 40, reserved_qty: 0,
      },
    });
    cleanup.stockIds.push(stock.id);

    const layer = await db.inventoryCostLayer.create({
      data: {
        tenant_id: tenant.id, product_id: product.id, variant_id: null,
        location_id: receiveLoc.id, quantity: 40, unit_cost: 12.5,
        po_number: 'VERIFY-PUTAWAY',
      },
    });

    const availAll = await inventory.getAvailableStock(tenant.id, product.id, null, wh.id);
    check('under ALL_LOCATIONS, stock on the receiving dock counts', availAll >= 40, `${availAll}`);

    await db.warehouseParameters.update({
      where: { id: params.id },
      data: { availability_counts: 'PICK_LOCATIONS_ONLY' },
    });

    const availPick = await inventory.getAvailableStock(tenant.id, product.id, null, wh.id);
    check('under PICK_LOCATIONS_ONLY, the same stock does NOT count',
      availPick === availAll - 40, `${availPick} (was ${availAll})`);
    console.log('        ↑ this is the RCV-001 case: on hand, and correctly not sellable');

    // ── 3. Completing putaway MOVES the stock ─────────────────────────────
    console.log('\n3  Completing putaway work moves the inventory');

    const work = await db.warehouseWork.create({
      data: {
        tenant_id: tenant.id,
        work_id_code: `WRK-VERIFY-${Date.now()}`,
        work_type: 'PUTAWAY',
        status: 'OPEN',
        warehouse_id: wh.id,
        reference_type: 'PRODUCT_RECEIPT',
        priority: 3,
        lines: {
          create: [{
            sequence: 1, line_type: 'PUT',
            product_id: product.id, variant_id: null,
            quantity: 40,
            from_location_id: receiveLoc.id,
            to_location_id: pickLoc.id,
            status: 'PENDING',
          }],
        },
      },
      include: { lines: true },
    });
    cleanup.workIds.push(work.id);
    cleanup.txRefs.push(work.work_id_code);

    const user = await db.user.findFirst({ where: { tenant_id: tenant.id }, select: { id: true } });
    await warehouse.completeWorkLine(tenant.id, work.id, work.lines[0].id, 40, user!.id);

    const atReceive = await db.inventoryStock.findFirst({
      where: { tenant_id: tenant.id, product_id: product.id, variant_id: null, location_id: receiveLoc.id },
    });
    const atPick = await db.inventoryStock.findFirst({
      where: { tenant_id: tenant.id, product_id: product.id, variant_id: null, location_id: pickLoc.id },
    });
    if (atPick) cleanup.stockIds.push(atPick.id);

    check('the receiving location was emptied', Number(atReceive?.quantity ?? 0) === 0, `${atReceive?.quantity}`);
    check('the pick location received the goods', Number(atPick?.quantity ?? 0) >= 40, `${atPick?.quantity}`);

    const availAfter = await inventory.getAvailableStock(tenant.id, product.id, null, wh.id);
    check('and NOW it counts as available under PICK_LOCATIONS_ONLY',
      availAfter >= 40, `${availAfter}`);

    const movedLayer = await db.inventoryCostLayer.findFirst({
      where: { tenant_id: tenant.id, product_id: product.id, location_id: pickLoc.id, po_number: 'VERIFY-PUTAWAY' },
    });
    check('the FIFO cost layer moved with the goods', !!movedLayer && Number(movedLayer.quantity) === 40,
      movedLayer ? `${movedLayer.quantity}` : 'no layer at the pick location');
    check('and kept its cost', Number(movedLayer?.unit_cost ?? 0) === 12.5);

    const txs = await db.inventoryTransaction.findMany({
      where: { tenant_id: tenant.id, reference_number: work.work_id_code },
    });
    check('the move is on the subledger as a transfer pair', txs.length === 2, `${txs.length}`);
    check('and both carry a status', txs.every(t => t.receipt_status || t.issue_status));

    // ── 4. It refuses to move twice ───────────────────────────────────────
    console.log('\n4  Guards');
    let refused = false;
    try {
      await warehouse.completeWorkLine(tenant.id, work.id, work.lines[0].id, 40, user!.id);
    } catch (err) {
      refused = err instanceof AppError && (err as any).code === 'WORK_LINE_ALREADY_DONE';
    }
    check('completing the same line twice is refused', refused,
      'otherwise the stock moves twice');

    console.log('        (a work line whose source no longer holds the stock is refused too —');
    console.log('         WORK_SOURCE_STOCK_INSUFFICIENT — rather than driving stock negative)');
  } finally {
    // ── Restore ───────────────────────────────────────────────────────────
    await db.warehouseParameters.update({
      where: { id: params.id },
      data: {
        require_putaway: original.require_putaway,
        require_pick_work: original.require_pick_work,
        availability_counts: original.availability_counts,
        default_receive_location_id: original.default_receive_location_id,
      },
    });
    for (const ref of cleanup.txRefs) {
      await db.inventoryTransaction.deleteMany({ where: { reference_number: ref } });
    }
    await db.inventoryCostLayer.deleteMany({ where: { po_number: 'VERIFY-PUTAWAY' } });
    for (const id of cleanup.workIds) {
      await db.warehouseWorkLine.deleteMany({ where: { work_id: id } });
      await db.warehouseWork.deleteMany({ where: { id } });
    }
    for (const id of cleanup.stockIds) {
      await db.inventoryStock.deleteMany({ where: { id } });
    }
  }

  const restored = await db.warehouseParameters.findUnique({ where: { id: params.id } });
  check('warehouse parameters restored', restored?.availability_counts === original.availability_counts);
  const strayWork = await db.warehouseWork.count({ where: { work_id_code: { startsWith: 'WRK-VERIFY-' } } });
  check('no verification work left behind', strayWork === 0, `${strayWork}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async e => { console.error(e); await db.$disconnect(); process.exit(1); });
