import 'dotenv/config';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { db } from '../src/infrastructure/database/client';

/**
 * WORK-045 acceptance on Supabase TEST: inventory journals, counts and opening
 * balances post quantity AND value, through the real routes.
 *
 *   ALLOW_TEST_DATABASE_WRITE=WORK045_ACCEPTANCE npm run verify:inventory-journals
 *
 * Creates its own products (VERIFY-045-…) and leaves them in place. Consumes no
 * FACTURA number. Prints PASS/FAIL lines, never data rows.
 */

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
const num = (v: unknown) => Number(v ?? 0);

async function main() {
  if (process.env.ALLOW_TEST_DATABASE_WRITE !== 'WORK045_ACCEPTANCE') {
    throw new Error('Set ALLOW_TEST_DATABASE_WRITE=WORK045_ACCEPTANCE to confirm the TEST-only acceptance run.');
  }
  const app = (await import('../src/app')).default;
  const tenant = await db.tenant.findFirstOrThrow({ where: { is_active: true }, orderBy: { created_at: 'asc' }, select: { id: true } });
  const T = tenant.id;
  const admin = await db.user.findFirstOrThrow({ where: { tenant_id: T, role: 'admin' }, select: { id: true, email: true } });
  const token = (role: string) =>
    jwt.sign({ sub: admin.id, email: admin.email, role, tenantId: T }, process.env.JWT_SECRET!, { expiresIn: '10m' });
  const call = async (role: string, method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-tenant-id': T, authorization: `Bearer ${token(role)}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    return { status: res.status, data: json.data, error: json.error };
  };

  const factura = async () => (await db.numberSequence.findFirstOrThrow({ where: { tenant_id: T, reference: 'FACTURA', legal_entity_id: null } })).next_number;
  const facturaBefore = await factura();

  const wh = await db.warehouse.findFirstOrThrow({ where: { tenant_id: T, code: 'WH-MAIN' }, select: { id: true } });
  const other = await db.warehouse.findFirstOrThrow({ where: { tenant_id: T, code: 'WH-001' }, select: { id: true } });
  const loc = (await db.warehouseLocation.findFirstOrThrow({ where: { tenant_id: T, zone: { warehouse_id: wh.id, zone_type: { not: 'shipping' } } }, orderBy: { code: 'asc' }, select: { id: true } })).id;
  const otherLoc = (await db.warehouseLocation.findFirstOrThrow({ where: { tenant_id: T, zone: { warehouse_id: other.id } }, select: { id: true } })).id;
  const fifo = await db.itemModelGroup.findFirst({ where: { tenant_id: T, costing_method: 'FIFO', stocked: true }, select: { id: true } });
  const mk = async (cost: number | null) => (await db.product.create({
    data: { tenant_id: T, sku: `VERIFY-045-${randomUUID().slice(0, 8)}`, name: 'Verify 045', selling_price: 100, cost_price: cost, item_model_group_id: fifo?.id ?? null },
    select: { id: true },
  })).id;
  const P = await mk(40);
  const bare = await mk(null);

  const stock = async (p: string, l = loc) => (await db.inventoryStock.findFirst({ where: { tenant_id: T, product_id: p, location_id: l } }))?.quantity ?? 0;
  const layerQty = async (p: string, l = loc) =>
    (await db.inventoryCostLayer.findMany({ where: { tenant_id: T, product_id: p, location_id: l } })).reduce((s, x) => s + x.quantity, 0);
  const voucher = async (journalId: string) => {
    const entry = await db.journalEntry.findFirst({ where: { tenant_id: T, source_module: 'INVENTORY_JOURNAL', source_id: journalId }, select: { id: true } });
    if (!entry) return null;
    const lines = await db.journalLine.findMany({ where: { journal_entry_id: entry.id } });
    const accounts = await db.account.findMany({ where: { id: { in: lines.map((l) => l.account_id) } }, select: { id: true, category: true } });
    const cat = new Map(accounts.map((a) => [a.id, a.category]));
    return lines.map((l) => ({ category: cat.get(l.account_id), debit: num(l.debit_amount), credit: num(l.credit_amount) }));
  };

  // ── Adjustments ─────────────────────────────────────────────────────────────
  console.log('Adjustments');
  const managerCost = await call('store_manager', 'POST', '/inventory/adjust', { product_id: P, location_id: loc, quantity: 5, unit_cost: 50 });
  check('a store manager cannot state the cost of added stock', managerCost.status === 403, String(managerCost.status));
  const plus = await call('admin', 'POST', '/inventory/adjust', { product_id: P, location_id: loc, quantity: 5, unit_cost: 50, notes: 'VERIFY-045 found' });
  check('a positive adjustment posts', plus.status === 200 && plus.data?.status === 'POSTED', `${plus.status} ${plus.error?.message ?? ''}`);
  check('it adds stock and a cost layer of the same quantity', (await stock(P)) === 5 && (await layerQty(P)) === 5);
  const v1 = plus.data ? await voucher(plus.data.id) : null;
  check('its voucher debits inventory and credits inventory profit 250',
    !!v1 && v1.some((l) => l.category === 'INVENTORY' && l.debit === 250) && v1.some((l) => l.category === 'INVENTORY_PROFIT' && l.credit === 250),
    JSON.stringify(v1));

  const minus = await call('store_manager', 'POST', '/inventory/adjust', { product_id: P, location_id: loc, quantity: -2 });
  check('a negative adjustment posts', minus.status === 200, `${minus.status} ${minus.error?.message ?? ''}`);
  check('it removes stock and consumes layers', (await stock(P)) === 3 && (await layerQty(P)) === 3);
  const v2 = minus.data ? await voucher(minus.data.id) : null;
  check('its voucher debits inventory loss and credits inventory 100 (FIFO cost)',
    !!v2 && v2.some((l) => l.category === 'INVENTORY_LOSS' && l.debit === 100) && v2.some((l) => l.category === 'INVENTORY' && l.credit === 100),
    JSON.stringify(v2));

  const tooMuch = await call('store_manager', 'POST', '/inventory/adjust', { product_id: P, location_id: loc, quantity: -10 });
  check('removing more than is on hand is refused', tooMuch.status === 409 && tooMuch.error?.code === 'STOCK_INSUFFICIENT', `${tooMuch.status} ${tooMuch.error?.code}`);
  check('and nothing moved', (await stock(P)) === 3);

  const noCost = await call('store_manager', 'POST', '/inventory/adjust', { product_id: bare, location_id: loc, quantity: 1 });
  check('adding stock with no known cost is refused', noCost.status === 422 && noCost.error?.code === 'UNIT_COST_REQUIRED', `${noCost.status} ${noCost.error?.code}`);
  const defaulted = await call('store_manager', 'POST', '/inventory/adjust', { product_id: P, location_id: loc, quantity: 1 });
  check('adding stock without a cost uses the warehouse newest open layer cost (50)', defaulted.status === 200 && num(defaulted.data?.lines?.[0]?.unit_cost) === 50, `${defaulted.status} ${defaulted.data?.lines?.[0]?.unit_cost}`);

  const foreign = await call('store_manager', 'POST', '/inventory/adjust', { product_id: P, location_id: randomUUID(), quantity: 1 });
  check('an unknown location is refused', foreign.status === 422, String(foreign.status));

  // ── Draft journals, reasons, opening ────────────────────────────────────────
  console.log('Journals');
  const reasonCode = `VRF${Date.now() % 100000}`;
  const reason = await call('store_manager', 'POST', '/inventory-journals/reason-codes', { code: reasonCode, name: 'Damaged', direction: 'DECREASE' });
  check('a reason code is created', reason.status === 201, `${reason.status} ${reason.error?.message ?? ''}`);
  const wrongWay = await call('store_manager', 'POST', '/inventory-journals', {
    journal_type: 'ADJUSTMENT', warehouse_id: wh.id, lines: [{ product_id: P, location_id: loc, quantity: 1, reason_code_id: reason.data?.id }],
  });
  check('a DECREASE reason on an increase is refused', wrongWay.status === 422 && wrongWay.error?.code === 'REASON_DIRECTION_MISMATCH', `${wrongWay.status} ${wrongWay.error?.code}`);
  const outside = await call('store_manager', 'POST', '/inventory-journals', {
    journal_type: 'ADJUSTMENT', warehouse_id: wh.id, lines: [{ product_id: P, location_id: otherLoc, quantity: 1 }],
  });
  check("a location outside the journal's warehouse is refused", outside.status === 422 && outside.error?.code === 'LOCATION_OUTSIDE_WAREHOUSE', `${outside.status} ${outside.error?.code}`);

  const draft = await call('store_manager', 'POST', '/inventory-journals', {
    journal_type: 'ADJUSTMENT', warehouse_id: wh.id, description: 'VERIFY-045 draft',
    lines: [{ product_id: P, location_id: loc, quantity: -1, reason_code_id: reason.data?.id }],
  });
  check('a draft journal is created without moving stock', draft.status === 201 && draft.data?.status === 'DRAFT' && (await stock(P)) === 4);
  const edited = await call('store_manager', 'PUT', `/inventory-journals/${draft.data?.id}`, {
    lines: [{ product_id: P, location_id: loc, quantity: -2, reason_code_id: reason.data?.id }],
  });
  check('the draft can be edited and keeps its number', edited.status === 200 && edited.data?.journal_number === draft.data?.journal_number && edited.data?.lines?.[0]?.quantity === -2);
  const posted = await call('store_manager', 'POST', `/inventory-journals/${draft.data?.id}/post`);
  check('posting the draft moves stock', posted.status === 200 && (await stock(P)) === 2, `${posted.status} ${posted.error?.message ?? ''}`);
  const again = await call('store_manager', 'POST', `/inventory-journals/${draft.data?.id}/post`);
  check('posting it again is refused', again.status === 409 && again.error?.code === 'JOURNAL_NOT_DRAFT', `${again.status}`);
  const editPosted = await call('store_manager', 'PUT', `/inventory-journals/${draft.data?.id}`, { lines: [{ product_id: P, location_id: loc, quantity: -1 }] });
  check('a posted journal cannot be edited', editPosted.status === 409);

  const openingDenied = await call('store_manager', 'POST', '/inventory-journals', {
    journal_type: 'OPENING', warehouse_id: wh.id, lines: [{ product_id: P, location_id: loc, quantity: 2, unit_cost: 45 }],
  });
  check('a store manager cannot enter an opening balance', openingDenied.status === 403, String(openingDenied.status));
  const opening = await call('admin', 'POST', '/inventory-journals', {
    journal_type: 'OPENING', warehouse_id: wh.id, lines: [{ product_id: P, location_id: loc, quantity: 2, unit_cost: 45 }],
  });
  const managerEditsOpening = await call('store_manager', 'PUT', `/inventory-journals/${opening.data?.id}`, { lines: [{ product_id: P, location_id: loc, quantity: 9, unit_cost: 1 }] });
  const managerCancelsOpening = await call('store_manager', 'POST', `/inventory-journals/${opening.data?.id}/cancel`);
  check('a store manager can neither edit nor cancel an opening draft', managerEditsOpening.status === 403 && managerCancelsOpening.status === 403,
    `${managerEditsOpening.status}/${managerCancelsOpening.status}`);
  const openingPosted = opening.data ? await call('admin', 'POST', `/inventory-journals/${opening.data.id}/post`) : { status: 0 } as any;
  const v3 = opening.data ? await voucher(opening.data.id) : null;
  check('an admin opening balance credits opening balance equity 90',
    openingPosted.status === 200 && !!v3 && v3.some((l) => l.category === 'OPENING_BALANCE_EQUITY' && l.credit === 90), JSON.stringify(v3));
  const negativeOpening = await call('admin', 'POST', '/inventory-journals', {
    journal_type: 'OPENING', warehouse_id: wh.id, lines: [{ product_id: P, location_id: loc, quantity: -1, unit_cost: 45 }],
  });
  check('an opening balance cannot remove stock', negativeOpening.status === 400, String(negativeOpening.status));

  // ── Counts ──────────────────────────────────────────────────────────────────
  console.log('Counts');
  const before = await stock(P); // 4
  const count = await call('store_manager', 'POST', '/inventory-counts', { warehouse_id: wh.id, location_id: loc, notes: 'VERIFY-045' });
  const line = count.data?.lines?.find((l: any) => l.product_id === P);
  check('a count snapshots the stock of its location', count.status === 201 && line?.system_qty === before, `${count.status} ${line?.system_qty}`);
  await call('warehouse_worker', 'PUT', `/inventory-counts/${count.data?.id}/lines/${line?.id}`, { counted_qty: before - 1 });
  const denied = await call('warehouse_worker', 'POST', `/inventory-counts/${count.data?.id}/finalize`);
  check('the worker who counted cannot post the count', denied.status === 403);
  const fin = await call('store_manager', 'POST', `/inventory-counts/${count.data?.id}/finalize`);
  check('finalising posts a COUNT journal', fin.status === 200 && !!fin.data?.journal, `${fin.status} ${fin.error?.message ?? ''}`);
  check('the difference is applied, not an overwrite', (await stock(P)) === before - 1);
  const v4 = fin.data?.journal ? await voucher(fin.data.journal.id) : null;
  check('the count voucher posts an inventory loss', !!v4 && v4.some((l) => l.category === 'INVENTORY_LOSS' && l.debit > 0), JSON.stringify(v4));
  const fin2 = await call('store_manager', 'POST', `/inventory-counts/${count.data?.id}/finalize`);
  check('a finalised count cannot be finalised again', fin2.status === 409);

  const stale = await call('store_manager', 'POST', '/inventory-counts', { warehouse_id: wh.id, location_id: loc });
  const staleLine = stale.data?.lines?.find((l: any) => l.product_id === P);
  await call('admin', 'POST', '/inventory/adjust', { product_id: P, location_id: loc, quantity: 1, unit_cost: 50 });
  await call('store_manager', 'PUT', `/inventory-counts/${stale.data?.id}/lines/${staleLine?.id}`, { counted_qty: staleLine?.system_qty });
  const staleAfter = await stock(P);
  const staleFin = await call('store_manager', 'POST', `/inventory-counts/${stale.data?.id}/finalize`);
  check('a count whose stock moved after the snapshot is refused', staleFin.status === 409 && staleFin.error?.code === 'COUNT_STOCK_CHANGED', `${staleFin.status} ${staleFin.error?.code}`);
  const staleCount = await db.inventoryCount.findUniqueOrThrow({ where: { id: stale.data.id } });
  check('the refused count stays open and stock is untouched', staleCount.status === 'IN_PROGRESS' && (await stock(P)) === staleAfter);

  const wide = await call('store_manager', 'POST', '/inventory-counts', { warehouse_id: wh.id, notes: 'VERIFY-045 warehouse-wide' });
  const wideLine = wide.data?.lines?.find((l: any) => l.product_id === P);
  await call('warehouse_worker', 'PUT', `/inventory-counts/${wide.data?.id}/lines/${wideLine?.id}`, { counted_qty: wideLine?.system_qty + 1 });
  const wideStock = await stock(P);
  const wideFin = await call('store_manager', 'POST', `/inventory-counts/${wide.data?.id}/finalize`);
  check(`a warehouse-wide count (${wide.data?.lines?.length ?? 0} lines) finalises and posts its one difference`,
    wideFin.status === 200 && (await stock(P)) === wideStock + 1, `${wideFin.status} ${wideFin.error?.message ?? ''}`);

  // ── Integrity ───────────────────────────────────────────────────────────────
  console.log('Integrity');
  check('on-hand equals the cost layers at the location', (await stock(P)) === (await layerQty(P)), `${await stock(P)} vs ${await layerQty(P)}`);
  check('no FACTURA number was used', (await factura()) === facturaBefore);

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await db.$disconnect();
  process.exit(1);
});
