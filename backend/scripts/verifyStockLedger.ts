import 'dotenv/config';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { db } from '../src/infrastructure/database/client';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { SalesService } from '../src/modules/sales/sales.service';
import { WarehouseService } from '../src/modules/warehouse/warehouse.service';

/**
 * WORK-043/044 acceptance on Supabase TEST: reservations, FIFO issue costing and
 * every path that moves stock, against the real database.
 *
 *   ALLOW_TEST_DATABASE_WRITE=WORK043_ACCEPTANCE npm run verify:stock-ledger
 *
 * Creates its own product (VERIFY-043-…) and documents and leaves them in place:
 * TEST is disposable and a factura is never deleted. Prints PASS/FAIL lines, never
 * data rows.
 *
 * The POS sale and the customer return each consume a real FACTURA number. Kubi
 * allowed at most three per work item, and WORK-043/044 used all three on
 * 2026-09-14, so those two sections run only with ALLOW_FACTURA_CONSUMPTION=YES,
 * which needs a fresh approval.
 */

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
async function refused(label: string, work: () => Promise<unknown>, code?: string) {
  try {
    await work();
    check(label, false, 'was not refused');
  } catch (e: any) {
    check(label, code ? e?.code === code : true, `${e?.code ?? ''} ${e?.message ?? ''}`.trim());
  }
}
const num = (v: unknown) => Number(v ?? 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (process.env.ALLOW_TEST_DATABASE_WRITE !== 'WORK043_ACCEPTANCE') {
    throw new Error('Set ALLOW_TEST_DATABASE_WRITE=WORK043_ACCEPTANCE to confirm the TEST-only acceptance run.');
  }
  const app = (await import('../src/app')).default;
  const inventory = new InventoryService();
  const sales = new SalesService();
  const warehouse = new WarehouseService();

  const tenant = await db.tenant.findFirst({ where: { is_active: true }, orderBy: { created_at: 'asc' }, select: { id: true } });
  if (!tenant) throw new Error('No active tenant.');
  const T = tenant.id;
  const admin = await db.user.findFirst({ where: { tenant_id: T, role: 'admin' }, select: { id: true, email: true } });
  if (!admin) throw new Error('No admin user.');

  const token = (role: string) =>
    jwt.sign({ sub: admin.id, email: admin.email, role, tenantId: T }, process.env.JWT_SECRET!, { expiresIn: '10m' });
  const call = (role: string, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-tenant-id': T, authorization: `Bearer ${token(role)}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  // ── Fixtures ────────────────────────────────────────────────────────────────
  const whA = await db.warehouse.findFirst({ where: { tenant_id: T, code: 'WH-MAIN' }, select: { id: true } });
  const whB = await db.warehouse.findFirst({ where: { tenant_id: T, code: 'WH-001' }, select: { id: true } });
  if (!whA || !whB) throw new Error('Expected BO warehouses WH-MAIN and WH-001.');
  const locsA = await db.warehouseLocation.findMany({
    where: { tenant_id: T, is_active: true, zone: { warehouse_id: whA.id, zone_type: { not: 'shipping' } } },
    orderBy: [{ is_pick_location: 'desc' }, { code: 'asc' }], select: { id: true },
  });
  const locB = await db.warehouseLocation.findFirst({ where: { tenant_id: T, zone: { warehouse_id: whB.id } }, select: { id: true } });
  if (locsA.length < 2 || !locB) throw new Error('Expected at least two non-shipping locations in WH-MAIN and one in WH-001.');
  const [locA, locA2] = [locsA[0].id, locsA[1].id];
  await db.warehouseParameters.updateMany({ where: { warehouse_id: { in: [whA.id, whB.id] } }, data: { availability_counts: 'ALL_LOCATIONS' } });

  const fifoGroup = await db.itemModelGroup.findFirst({ where: { tenant_id: T, costing_method: 'FIFO', stocked: true }, select: { id: true } });
  const sku = `VERIFY-043-${Date.now()}`;
  const product = await db.product.create({
    data: {
      tenant_id: T, sku, name: `Verify ${sku}`, selling_price: 565, cost_price: 999,
      is_active: true, is_published: true, item_model_group_id: fifoGroup?.id ?? null,
    },
    select: { id: true },
  });
  const P = product.id;

  const facturaBefore = (await db.numberSequence.findFirst({ where: { tenant_id: T, reference: 'FACTURA', legal_entity_id: null } }))!.next_number;

  // Oldest layer in El Alto's stand-in (WH-001), then two layers in WH-MAIN.
  await inventory.receiveStock(T, P, null, locB.id, 4, 90, randomUUID(), admin.id, 'VERIFY-043-B');
  await sleep(20);
  await inventory.receiveStock(T, P, null, locA, 2, 100, randomUUID(), admin.id, 'VERIFY-043-A1');
  await sleep(20);
  await inventory.receiveStock(T, P, null, locA, 3, 120, randomUUID(), admin.id, 'VERIFY-043-A2');

  const stockAt = async (loc: string) => db.inventoryStock.findFirst({ where: { tenant_id: T, product_id: P, location_id: loc } });
  const layersAt = async (loc: string) => db.inventoryCostLayer.findMany({
    where: { tenant_id: T, product_id: P, location_id: loc }, orderBy: [{ received_at: 'asc' }, { id: 'asc' }],
  });
  const linesOf = async (module: string, sourceId: string) => {
    const entries = await db.journalEntry.findMany({ where: { tenant_id: T, source_module: module, source_id: sourceId }, select: { id: true } });
    return db.journalLine.findMany({ where: { journal_entry_id: { in: entries.map((e) => e.id) } } });
  };
  const cogsOf = async (module: string, sourceId: string) =>
    (await linesOf(module, sourceId)).filter((l) => (l.description ?? '').startsWith('COGS')).reduce((s, l) => s + num(l.debit_amount), 0);

  // ── 1. ERP order: reserve in its warehouse, ship once at FIFO layer cost ─────
  console.log('ERP order');
  const o1 = await sales.createOrder(T, { warehouse_id: whA.id, lines: [{ product_id: P, quantity: 3, unit_price: 565 }] }, admin.id);
  await sales.confirmOrder(T, o1.id, admin.id);
  const holds1 = await db.inventoryReservation.findMany({ where: { tenant_id: T, source_id: o1.id, status: 'ACTIVE' } });
  check('confirm holds exactly 3 in WH-MAIN', holds1.reduce((s, h) => s + h.quantity, 0) === 3 && holds1.every((h) => h.location_id === locA));
  check('stock row carries the hold as reserved_qty', (await stockAt(locA))?.reserved_qty === 3);
  await refused('a second confirm is refused', () => sales.confirmOrder(T, o1.id, admin.id));
  await sales.shipOrder(T, o1.id, admin.id);
  check('ship deducts 3 in WH-MAIN and releases the hold', (await stockAt(locA))?.quantity === 2 && (await stockAt(locA))?.reserved_qty === 0);
  check('WH-001 stock and its older layer are untouched', (await stockAt(locB.id))?.quantity === 4 && (await layersAt(locB.id))[0]?.quantity === 4);
  const la = await layersAt(locA);
  check('FIFO within the warehouse: the 100 layer is consumed first', la[0]?.quantity === 0 && la[1]?.quantity === 2);
  const out1 = await db.inventoryTransaction.findMany({ where: { tenant_id: T, reference_id: o1.id, transaction_type: 'OUTBOUND' } });
  const cost1 = out1.reduce((s, t) => s + num(t.cost_amount), 0);
  check('the issue is costed from layers: 2 × 100 + 1 × 120 = 320, not the 999 item cost', cost1 === 320, String(cost1));
  const cogs1 = await cogsOf('SALES_COGS', o1.id);
  check('COGS voucher equals the settled cost', cogs1 === 320, String(cogs1));
  await refused('shipping the same order again is refused', () => sales.shipOrder(T, o1.id, admin.id));
  check('the refused re-ship moved nothing', (await stockAt(locA))?.quantity === 2);

  // ── 2. Cancel frees only its own holds ───────────────────────────────────────
  console.log('Cancel isolation');
  const o2 = await sales.createOrder(T, { warehouse_id: whA.id, lines: [{ product_id: P, quantity: 1, unit_price: 565 }] }, admin.id);
  const o3 = await sales.createOrder(T, { warehouse_id: whB.id, lines: [{ product_id: P, quantity: 1, unit_price: 565 }] }, admin.id);
  await sales.confirmOrder(T, o2.id, admin.id);
  await sales.confirmOrder(T, o3.id, admin.id);
  await sales.cancelOrder(T, o2.id, admin.id);
  check('cancelling the WH-MAIN order frees WH-MAIN', (await stockAt(locA))?.reserved_qty === 0);
  check('and leaves the WH-001 order holding its unit', (await stockAt(locB.id))?.reserved_qty === 1);
  await sales.cancelOrder(T, o3.id, admin.id);
  check('cancelling the second order frees WH-001', (await stockAt(locB.id))?.reserved_qty === 0);
  await refused('an order that cannot be covered is refused whole', async () => {
    const big = await sales.createOrder(T, { warehouse_id: whA.id, lines: [{ product_id: P, quantity: 50, unit_price: 565 }] }, admin.id);
    await sales.confirmOrder(T, big.id, admin.id);
  }, 'STOCK_INSUFFICIENT');

  // ── 3. Storefront: priced by the catalogue, reserved once, shipped once ──────
  console.log('Storefront');
  const tampered = await call('customer', 'POST', '/sales/orders/storefront', { lines: [{ product_id: P, quantity: 1, unit_price: 1 }] });
  check('a checkout carrying a price is refused', tampered.status === 400, String(tampered.status));
  const sfRes = await call('customer', 'POST', '/sales/orders/storefront', { lines: [{ product_id: P, quantity: 1 }] });
  const sfBody = (await sfRes.json()) as any;
  check('a checkout of products and quantities is accepted', sfRes.status === 201, String(sfRes.status));
  if (sfRes.status === 201) {
    const sf = await db.salesOrder.findFirstOrThrow({ where: { id: sfBody.data.id }, include: { lines: true } });
    check('the storefront order is priced from the catalogue (565)', num(sf.lines[0].unit_price) === 565 && sf.status === 'CONFIRMED');
    const sfLoc = (await db.inventoryReservation.findFirst({ where: { source_id: sf.id, status: 'ACTIVE' } }))?.location_id;
    const before = sfLoc ? await stockAt(sfLoc) : null;
    check('checkout reserves instead of deducting', !!before && before.reserved_qty === 1);
    await sales.shipOrder(T, sf.id, admin.id);
    const after = sfLoc ? await stockAt(sfLoc) : null;
    check('shipping the storefront order deducts exactly once', !!before && !!after && after.quantity === before.quantity - 1 && after.reserved_qty === 0);
  }

  const facturaSteps = process.env.ALLOW_FACTURA_CONSUMPTION === 'YES';
  if (!facturaSteps) console.log('POS sale/void and return skipped: they consume FACTURA numbers (set ALLOW_FACTURA_CONSUMPTION=YES with approval).');

  // ── 4. POS sale and void: same layers back, exact COGS reversal ─────────────
  if (facturaSteps) {
  console.log('POS');
  const terminal = `VERIFY-043-${Date.now()}`;
  const open = await call('cashier', 'POST', '/pos/sessions/open', { terminal_name: terminal, opening_float: 0, warehouse_id: whA.id });
  const session = ((await open.json()) as any).data;
  check('a register opens against WH-MAIN', open.status === 201, String(open.status));
  const layerBeforeSale = (await layersAt(locA)).find((l) => num(l.unit_cost) === 120)!;
  const sale = await call('cashier', 'POST', '/pos/sale', {
    session_id: session?.id, payment_method: 'CASH', cash_tendered: 600, lines: [{ product_id: P, quantity: 1, unit_price: 565 }],
  });
  const saleBody = (await sale.json()) as any;
  check('the POS sale posts', sale.status === 201, `${sale.status} ${saleBody?.error?.code ?? ''}`);
  if (sale.status === 201) {
    const orderId = saleBody.data.order_id;
    const saleOrder = await db.salesOrder.findFirstOrThrow({ where: { id: orderId } });
    check('the sale records its register session', saleOrder.register_session_id === session.id);
    const layerAfterSale = await db.inventoryCostLayer.findUniqueOrThrow({ where: { id: layerBeforeSale.id } });
    check('the sale consumed the 120 layer', layerAfterSale.quantity === layerBeforeSale.quantity - 1);
    check('POS COGS is the layer cost (120)', (await cogsOf('POS_COGS', orderId)) === 120);
    const voidRes = await call('store_manager', 'POST', `/pos/sales/${orderId}/void`, { reason: 'WORK-043 acceptance' });
    check('the void posts', voidRes.status === 200, `${voidRes.status} ${((await voidRes.json()) as any)?.error?.message ?? ''}`);
    const layerAfterVoid = await db.inventoryCostLayer.findUniqueOrThrow({ where: { id: layerBeforeSale.id } });
    check('the void put the unit back on the same layer', layerAfterVoid.quantity === layerBeforeSale.quantity);
    // Since WORK-047 the void reverses the COGS voucher itself, so COGS nets to zero.
    const cogsNet = (await linesOf('POS_COGS', orderId))
      .filter((l) => (l.description ?? '').startsWith('COGS')).reduce((s, l) => s + num(l.debit_amount) - num(l.credit_amount), 0);
    check('the void reverses COGS exactly (nets to zero)', cogsNet === 0, String(cogsNet));
    const again = await call('store_manager', 'POST', `/pos/sales/${orderId}/void`, { reason: 'WORK-043 acceptance' });
    check('a second void is refused', again.status === 404 || again.status === 409, String(again.status));
  }
  if (session?.id) await call('store_manager', 'POST', `/pos/sessions/${session.id}/close`, { closing_float: 0 });
  }

  // ── 5. Customer return: new layers at the issued cost ────────────────────────
  if (facturaSteps) {
  console.log('Return');
  const ret = await call('store_manager', 'POST', `/sales/orders/${o1.id}/return`, { notes: 'VERIFY-043' });
  check('the return posts', ret.status === 200, `${ret.status} ${((await ret.json()) as any)?.error?.message ?? ''}`);
  if (ret.status === 200) {
    const returned = await db.inventoryCostLayer.findMany({ where: { tenant_id: T, product_id: P, source_type: 'SALES_RETURN' } });
    const byCost = returned.map((l) => `${l.quantity}@${num(l.unit_cost)}`).sort();
    check('returned units are re-layered at the cost they shipped at (2@100, 1@120)', JSON.stringify(byCost) === JSON.stringify(['1@120', '2@100']), byCost.join(','));
    const reversal = (await linesOf('SALES_RETURN', o1.id))
      .filter((l) => (l.description ?? '').startsWith('COGS reversal')).reduce((s, l) => s + num(l.credit_amount), 0);
    check('the return reverses COGS at 320', reversal === 320, String(reversal));
    const again = await call('store_manager', 'POST', `/sales/orders/${o1.id}/return`, {});
    // Refused by the status rule (400, the order is RETURNED) or by the settlement
    // claim (409) — either way nothing is restored twice.
    check('a second return is refused', again.status === 400 || again.status === 409, String(again.status));
  }

  }

  // ── 6. The database refuses impossible stock ─────────────────────────────────
  console.log('Constraints');
  const row = (await stockAt(locA))!;
  await refused('negative on-hand is refused by the database', () => db.$executeRaw`UPDATE inventory_stock SET quantity = -1 WHERE id = ${row.id}::uuid`);
  await refused('a hold above on-hand is refused by the database', () => db.$executeRaw`UPDATE inventory_stock SET reserved_qty = quantity + 1 WHERE id = ${row.id}::uuid`);
  await refused('a second stock row for the same product and location is refused', () => db.inventoryStock.create({
    data: { tenant_id: T, product_id: P, variant_id: null, location_id: locA, quantity: 0 },
  }));

  // ── 7. Transfer ──────────────────────────────────────────────────────────────
  console.log('Transfer');
  await refused('a transfer to the same location is refused', () =>
    inventory.transferStock(T, { product_id: P, from_location_id: locA, to_location_id: locA, quantity: 1 }, admin.id), 'MOVE_SAME_LOCATION');
  const beforeMove = (await stockAt(locA))!.quantity;
  await inventory.transferStock(T, { product_id: P, from_location_id: locA, to_location_id: locA2, quantity: 1 }, admin.id);
  const movedLayers = await layersAt(locA2);
  check('the transfer moves the stock', (await stockAt(locA))!.quantity === beforeMove - 1 && (await stockAt(locA2))!.quantity === 1);
  check('and the oldest remaining layer goes with it', movedLayers.length === 1 && movedLayers[0].quantity === 1);

  // ── 8. Pick work moves the order's own hold to the dock ──────────────────────
  console.log('Pick work');
  const o4 = await sales.createOrder(T, { warehouse_id: whA.id, lines: [{ product_id: P, quantity: 1, unit_price: 565 }] }, admin.id);
  await sales.confirmOrder(T, o4.id, admin.id);
  const heldAt = (await db.inventoryReservation.findFirst({ where: { source_id: o4.id, status: 'ACTIVE' } }))?.location_id;
  const wave = await db.salesOrder.findUniqueOrThrow({ where: { id: o4.id }, select: { wave_id: true } });
  if (wave.wave_id) {
    try { await warehouse.releaseWave(T, wave.wave_id); } catch { /* already released by a template */ }
    const work = await db.warehouseWork.findFirst({ where: { tenant_id: T, reference_id: o4.id }, include: { lines: { orderBy: { sequence: 'asc' } } } });
    const put = work?.lines.find((l) => l.line_type === 'PUT' && l.to_location_id);
    if (work && put) {
      check('the pick starts where the order holds its unit', !!heldAt && work.lines.every((l) => l.from_location_id === heldAt));
      for (const l of work.lines) await warehouse.completeWorkLine(T, work.id, l.id, Number(l.quantity), admin.id);
      const dockHold = await db.inventoryReservation.findFirst({ where: { source_id: o4.id, status: 'ACTIVE' } });
      check('completing the put moves the hold to the shipping location', dockHold?.location_id === put.to_location_id);
      await sales.shipOrder(T, o4.id, admin.id);
      check('the picked order ships from the dock', (await stockAt(put.to_location_id!))?.quantity === 0);
    } else {
      check('pick work was generated for the order', false, 'no work with a put line — WH-MAIN may have no shipping zone');
    }
  } else {
    check('the confirmed order joined a wave', false);
  }

  const facturaAfter = (await db.numberSequence.findFirst({ where: { tenant_id: T, reference: 'FACTURA', legal_entity_id: null } }))!.next_number;
  const expected = facturaSteps ? 2 : 0;
  check(`FACTURA numbers used: ${expected}`, facturaAfter - facturaBefore === expected, `${facturaBefore} → ${facturaAfter}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error instanceof Error ? `${error.message}` : error);
  await db.$disconnect();
  process.exit(1);
});
