import 'dotenv/config';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { db } from '../src/infrastructure/database/client';
import { InventoryService } from '../src/modules/inventory/inventory.service';

/**
 * WORK-047 acceptance on Supabase TEST: POS tenders, register declarations and the
 * void as an annulment, against the real database.
 *
 *   ALLOW_TEST_DATABASE_WRITE=WORK047_ACCEPTANCE npm run verify:pos-ledger
 *
 * The full run consumes exactly THREE FACTURA numbers — Kubi's allowance per work
 * item. Once a run has spent them, later runs (without ALLOW_FACTURA_CONSUMPTION=YES)
 * skip every sale and verify only what spends no number: the tender refusals and the
 * register close on a float-only session. The full run covers:
 *   1. a split cash + QR sale at 1,299 (Bolivia anchor), closed with a short count;
 *   2. a sale voided in its open session;
 *   3. a sale whose session is closed before the void is attempted.
 * Every refusal that must not spend a number is checked against the counter.
 * Creates its own product and registers (VERIFY-047-…) and leaves them in place.
 * Prints PASS/FAIL lines, never data rows.
 */

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
const num = (v: unknown) => Number(v ?? 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  if (process.env.ALLOW_TEST_DATABASE_WRITE !== 'WORK047_ACCEPTANCE') {
    throw new Error('Set ALLOW_TEST_DATABASE_WRITE=WORK047_ACCEPTANCE to confirm the TEST-only acceptance run.');
  }
  const app = (await import('../src/app')).default;
  const inventory = new InventoryService();

  const tenant = await db.tenant.findFirst({ where: { is_active: true }, orderBy: { created_at: 'asc' }, select: { id: true } });
  if (!tenant) throw new Error('No active tenant.');
  const T = tenant.id;
  const admin = await db.user.findFirst({ where: { tenant_id: T, role: 'admin' }, select: { id: true, email: true } });
  if (!admin) throw new Error('No admin user.');

  const earlierRun = await db.registerSession.count({ where: { tenant_id: T, terminal_name: { startsWith: 'VERIFY-047-' } } });
  const sales = process.env.ALLOW_FACTURA_CONSUMPTION === 'YES' || earlierRun === 0;
  if (!sales) console.log('FACTURA allowance already spent by an earlier run: sales, voids and the split tender are skipped.');

  const token = (role: string) =>
    jwt.sign({ sub: admin.id, email: admin.email, role, tenantId: T }, process.env.JWT_SECRET!, { expiresIn: '10m' });
  const call = async (role: string, method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-tenant-id': T, authorization: `Bearer ${token(role)}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    return { status: res.status, json, code: json?.error?.code as string | undefined };
  };

  // ── Fixtures ────────────────────────────────────────────────────────────────
  const wh = await db.warehouse.findFirst({ where: { tenant_id: T, code: 'WH-MAIN' }, select: { id: true } });
  if (!wh) throw new Error('Expected warehouse WH-MAIN.');
  const loc = await db.warehouseLocation.findFirst({
    where: { tenant_id: T, is_active: true, zone: { warehouse_id: wh.id, zone_type: { not: 'shipping' } } },
    orderBy: [{ is_pick_location: 'desc' }, { code: 'asc' }], select: { id: true },
  });
  if (!loc) throw new Error('Expected a non-shipping location in WH-MAIN.');
  await db.warehouseParameters.updateMany({ where: { warehouse_id: wh.id }, data: { availability_counts: 'ALL_LOCATIONS' } });

  const methods = await db.salesPaymentMethod.findMany({ where: { tenant_id: T, is_active: true } });
  const CASH = methods.find((m) => m.code === 'CASH');
  const QR = methods.find((m) => m.code === 'QR');
  const CARD = methods.find((m) => m.code === 'CARD');
  if (!CASH || !QR || !CARD) throw new Error('Expected provisioned payment methods CASH, QR and CARD.');
  // Any cash difference needs a manager on this run, whatever an earlier run left.
  await db.salesPaymentMethod.update({ where: { id: CASH.id }, data: { max_difference_amount: null, declaration_policy: 'COUNT', allow_change: true } });
  await db.salesParameters.updateMany({ where: { tenant_id: T, legal_entity_id: null }, data: { pos_void_mode: 'ANNUL_IN_SESSION' } });

  const fifoGroup = await db.itemModelGroup.findFirst({ where: { tenant_id: T, costing_method: 'FIFO', stocked: true }, select: { id: true } });
  const stamp = Date.now();
  const product = await db.product.create({
    data: { tenant_id: T, sku: `VERIFY-047-${stamp}`, name: `Verify POS ${stamp}`, selling_price: 1299, cost_price: 999, is_active: true, item_model_group_id: fifoGroup?.id ?? null },
    select: { id: true },
  });
  const P = product.id;
  await inventory.receiveStock(T, P, null, loc.id, 5, 700, randomUUID(), admin.id, 'VERIFY-047');

  const facturaCounter = async () => (await db.numberSequence.findFirst({ where: { tenant_id: T, reference: 'FACTURA', legal_entity_id: null } }))!.next_number;
  const facturaStart = await facturaCounter();
  const stockQty = async () => (await db.inventoryStock.findFirst({ where: { tenant_id: T, product_id: P, location_id: loc.id } }))?.quantity ?? 0;
  const layer = async () => db.inventoryCostLayer.findFirst({ where: { tenant_id: T, product_id: P, location_id: loc.id } });
  const entryLines = async (module: string, sourceId: string) => {
    const entries = await db.journalEntry.findMany({ where: { tenant_id: T, source_module: module, source_id: sourceId }, select: { id: true } });
    return db.journalLine.findMany({ where: { journal_entry_id: { in: entries.map((e) => e.id) } }, include: { account: { select: { category: true, code: true } } } });
  };
  const saleLine = () => [{ product_id: P, quantity: 1, unit_price: 1299 }];
  const openRegister = async (suffix: string, float: number) => {
    const res = await call('cashier', 'POST', '/pos/sessions/open', { terminal_name: `VERIFY-047-${stamp}-${suffix}`, opening_float: float, warehouse_id: wh.id });
    check(`register ${suffix} opens`, res.status === 201, `${res.status} ${res.code ?? ''}`);
    return res.json?.data as { id: string };
  };

  // ── 1. Refusals that spend no FACTURA number ────────────────────────────────
  console.log('Tender refusals');
  const s1 = await openRegister('A', 100);
  const refusals: Array<[string, unknown, string, number]> = [
    ['tenders short of the total', { tenders: [{ payment_method_id: CASH.id, amount: 1000, tendered: 1000 }] }, 'TENDER_TOTAL_MISMATCH', 400],
    ['change from a card', { tenders: [{ payment_method_id: CARD.id, amount: 1299, tendered: 1300 }] }, 'TENDER_NO_CHANGE', 400],
    ['cash received below what it pays', { tenders: [{ payment_method_id: CASH.id, amount: 1299, tendered: 1200 }] }, 'TENDER_SHORT', 400],
    ['another tenant\'s or unknown payment method', { tenders: [{ payment_method_id: randomUUID(), amount: 1299 }] }, 'FOREIGN_REFERENCE', 422],
    ['an unknown customer', { customer_id: randomUUID(), tenders: [{ payment_method_id: CASH.id, amount: 1299, tendered: 1299 }] }, 'FOREIGN_REFERENCE', 422],
  ];
  for (const [label, extra, code, status] of refusals) {
    const res = await call('cashier', 'POST', '/pos/sale', { session_id: s1.id, lines: saleLine(), ...(extra as object) });
    check(`refused: ${label} (${code})`, res.status === status && res.code === code, `${res.status} ${res.code ?? ''}`);
  }
  check('no FACTURA number was spent by the refusals', (await facturaCounter()) === facturaStart);
  check('no stock moved on the refusals', (await stockQty()) === 5);

  // ── 2. Split tender at the Bolivia anchor ───────────────────────────────────
  if (sales) {
  console.log('Split tender sale');
  const sale1 = await call('cashier', 'POST', '/pos/sale', {
    session_id: s1.id, lines: saleLine(),
    tenders: [{ payment_method_id: CASH.id, amount: 299, tendered: 300 }, { payment_method_id: QR.id, amount: 1000 }],
  });
  check('the split cash + QR sale posts', sale1.status === 201, `${sale1.status} ${sale1.code ?? ''} ${sale1.json?.error?.message ?? ''}`);
  const order1 = sale1.json?.data?.order_id as string;
  if (order1) {
    const tenders = await db.posTender.findMany({ where: { tenant_id: T, sales_order_id: order1 } });
    const cashT = tenders.find((t) => t.payment_method_id === CASH.id);
    const qrT = tenders.find((t) => t.payment_method_id === QR.id);
    check('two tenders are stored with the method account snapshotted', tenders.length === 2 && cashT?.account_id === CASH.account_id && qrT?.account_id === QR.account_id);
    check('change of 1 is given from cash only', num(cashT?.change) === 1 && qrT?.change == null);
    const order = await db.salesOrder.findUniqueOrThrow({ where: { id: order1 } });
    const factura = await db.factura.findUniqueOrThrow({ where: { id: order.invoice_id! } });
    check('Bolivia anchor: IVA 168.87 and IT 38.97 on 1,299', num(factura.iva_amount) === 168.87 && num(factura.it_amount) === 38.97, `${factura.iva_amount} / ${factura.it_amount}`);
    const saleLines = await entryLines('POS_SALE', order1);
    check('the sale debits no accounts receivable', saleLines.every((l) => l.account.category !== 'ACCOUNTS_RECEIVABLE' || num(l.debit_amount) === 0));
    const debitOn = (accountId: string) => r2(saleLines.filter((l) => l.account_id === accountId).reduce((s, l) => s + num(l.debit_amount), 0));
    check('cash is debited 299 and the bank 1,000', debitOn(CASH.account_id) === 299 && debitOn(QR.account_id) === 1000, `${debitOn(CASH.account_id)} / ${debitOn(QR.account_id)}`);
    const dr = r2(saleLines.reduce((s, l) => s + num(l.debit_amount), 0));
    const cr = r2(saleLines.reduce((s, l) => s + num(l.credit_amount), 0));
    check('the sale voucher balances', dr === cr && dr > 0, `${dr} / ${cr}`);
  }
  }

  // ── 3. Close with declarations and a difference voucher ─────────────────────
  console.log('Close with declarations');
  // Expected cash = float 100 + cash tender 299 (the QR thousand is not in the drawer).
  const cashExpected = sales ? 399 : 100;
  const short = cashExpected - 10;
  const noCount = await call('cashier', 'POST', `/pos/sessions/${s1.id}/close`, { declarations: [{ payment_method_id: QR.id, counted: sales ? 1000 : 0 }] });
  check('closing without counting cash is refused (DECLARATION_REQUIRED)', noCount.status === 400 && noCount.code === 'DECLARATION_REQUIRED', `${noCount.status} ${noCount.code ?? ''}`);
  const cashierShort = await call('cashier', 'POST', `/pos/sessions/${s1.id}/close`, { declarations: [{ payment_method_id: CASH.id, counted: short }] });
  check('a cashier may not close 10 short', cashierShort.code === 'DECLARATION_DIFFERENCE_TOO_LARGE', `${cashierShort.status} ${cashierShort.code ?? ''}`);
  check('the refused close left the register open', (await db.registerSession.findUniqueOrThrow({ where: { id: s1.id } })).status === 'OPEN');
  const close1 = await call('store_manager', 'POST', `/pos/sessions/${s1.id}/close`, { declarations: [{ payment_method_id: CASH.id, counted: short }] });
  check('a store manager closes 10 short', close1.status === 200, `${close1.status} ${close1.code ?? ''} ${close1.json?.error?.message ?? ''}`);
  const z = close1.json?.data?.z_report;
  const cashRow = (z?.tenders ?? []).find((t: any) => t.payment_method_id === CASH.id);
  const qrRow = (z?.tenders ?? []).find((t: any) => t.payment_method_id === QR.id);
  check(`Z report: cash expected ${cashExpected}, counted ${short}, difference -10`, cashRow?.expected === cashExpected && cashRow?.counted === short && cashRow?.difference === -10, JSON.stringify(cashRow ?? {}));
  if (sales) check('Z report: QR expected 1,000 and not counted as cash', qrRow?.expected === 1000 && z?.cash_expected === 399, `${qrRow?.expected} / ${z?.cash_expected}`);
  const declarations = await db.registerSessionDeclaration.findMany({ where: { register_session_id: s1.id } });
  check('one declaration per method with tenders or a count', declarations.length >= (sales ? 2 : 1));
  const diffLines = z?.difference_journal_entry_id
    ? await db.journalLine.findMany({ where: { journal_entry_id: z.difference_journal_entry_id }, include: { account: { select: { code: true } } } })
    : [];
  const diffDr = diffLines.find((l) => num(l.debit_amount) === 10);
  const diffCr = diffLines.find((l) => num(l.credit_amount) === 10);
  check('difference voucher: Dr cash difference 10 / Cr cash 10', diffLines.length === 2 && diffCr?.account_id === CASH.account_id && !!diffDr && diffDr.account_id !== CASH.account_id,
    diffLines.map((l) => `${l.account.code} ${l.debit_amount}/${l.credit_amount}`).join(', '));
  check('the difference voucher is the cash difference account (5306)', diffDr?.account.code === '5306', diffDr?.account.code ?? 'none');
  const detail = await call('store_manager', 'GET', `/pos/sessions/${s1.id}`);
  check('the session review returns the declarations', detail.status === 200 && (detail.json?.data?.declarations ?? []).length === declarations.length);
  const again = await call('store_manager', 'POST', `/pos/sessions/${s1.id}/close`, { declarations: [{ payment_method_id: CASH.id, counted: short }] });
  check('closing the same register again is refused (409)', again.status === 409, String(again.status));

  // Two closes racing on one register serialise on the session lock (review 1).
  console.log('Parallel close');
  const sp = await openRegister('P', 50);
  const closes = await Promise.all([1, 2].map(() =>
    call('store_manager', 'POST', `/pos/sessions/${sp.id}/close`, { declarations: [{ payment_method_id: CASH.id, counted: 45 }] })));
  const statuses = closes.map((r) => r.status).sort();
  check('two parallel closes give exactly one 200 and one 409', statuses[0] === 200 && statuses[1] === 409, statuses.join(','));
  check('one set of declarations', (await db.registerSessionDeclaration.count({ where: { register_session_id: sp.id } })) === 1);
  check('at most one difference voucher', (await db.journalEntry.count({ where: { tenant_id: T, source_module: 'POS_SESSION_CLOSE', source_id: sp.id } })) === 1);
  const unknownDecl = await call('store_manager', 'POST', `/pos/sessions/${sp.id}/close`, { declarations: [{ payment_method_id: randomUUID(), counted: 1 }] });
  check('a closed register refuses any further close', unknownDecl.status === 409, String(unknownDecl.status));

  if (sales) {
  // ── 4. Void in an open session: annulment ───────────────────────────────────
  console.log('Void in session');
  const s2 = await openRegister('B', 0);
  const stockBefore2 = await stockQty();
  const layerBefore2 = await layer();
  const sale2 = await call('cashier', 'POST', '/pos/sale', { session_id: s2.id, payment_method: 'CASH', cash_tendered: 1300, lines: saleLine() });
  check('the older single payment_method still sells (mapped to CASH)', sale2.status === 201, `${sale2.status} ${sale2.code ?? ''}`);
  const order2 = sale2.json?.data?.order_id as string;
  if (order2) {
    const o2 = await db.salesOrder.findUniqueOrThrow({ where: { id: order2 } });
    const f2Before = await db.factura.findUniqueOrThrow({ where: { id: o2.invoice_id! } });
    const noReason = await call('store_manager', 'POST', `/pos/sales/${order2}/void`, {});
    check('a void without a reason is refused', noReason.status === 400, String(noReason.status));
    const cashierVoid = await call('cashier', 'POST', `/pos/sales/${order2}/void`, { reason: 'Customer changed mind' });
    check('a cashier may not void', cashierVoid.status === 403, String(cashierVoid.status));
    const void2 = await call('store_manager', 'POST', `/pos/sales/${order2}/void`, { reason: 'Customer changed mind' });
    check('the store manager voids the sale', void2.status === 200, `${void2.status} ${void2.code ?? ''} ${void2.json?.error?.message ?? ''}`);
    const f2 = await db.factura.findUniqueOrThrow({ where: { id: o2.invoice_id! } });
    check('the factura is CANCELLED and keeps its number', f2.status === 'CANCELLED' && f2.factura_number === f2Before.factura_number && f2.cancellation_reason === 'Customer changed mind' && !!f2.cancelled_at);
    check('the factura points at the reversal voucher', !!f2.reversal_journal_entry_id);
    const net = (lines: any[], pick: (l: any) => boolean) => r2(lines.filter(pick).reduce((s, l) => s + num(l.debit_amount) - num(l.credit_amount), 0));
    const saleLines2 = await entryLines('POS_SALE', order2);
    const cogsLines2 = await entryLines('POS_COGS', order2);
    check('every sale account nets to zero after the void (IVA and IT included)',
      saleLines2.length > 0 && [...new Set(saleLines2.map((l) => l.account_id))].every((a) => net(saleLines2, (l) => l.account_id === a) === 0));
    check('IT lines exist and are reversed', saleLines2.filter((l) => (l.description ?? '').startsWith('IT 3%')).length >= 2);
    check('COGS nets to zero after the void', cogsLines2.length > 0 && [...new Set(cogsLines2.map((l) => l.account_id))].every((a) => net(cogsLines2, (l) => l.account_id === a) === 0));
    check('stock is back', (await stockQty()) === stockBefore2);
    check('the unit is back on the same cost layer', (await layer())?.id === layerBefore2?.id && (await layer())?.quantity === layerBefore2?.quantity);
    const t2 = await db.posTender.findMany({ where: { sales_order_id: order2 } });
    check('the tender is marked reversed', t2.length === 1 && !!t2[0].reversed_at);
    const sess2 = await db.registerSession.findUniqueOrThrow({ where: { id: s2.id } });
    check('session totals are back to zero', num(sess2.total_sales) === 0 && sess2.transaction_count === 0, `${sess2.total_sales} / ${sess2.transaction_count}`);
    const void2b = await call('store_manager', 'POST', `/pos/sales/${order2}/void`, { reason: 'Customer changed mind' });
    check('a second void is refused', void2b.status === 404 || void2b.status === 409, `${void2b.status} ${void2b.code ?? ''}`);
    const close2 = await call('cashier', 'POST', `/pos/sessions/${s2.id}/close`, { declarations: [{ payment_method_id: CASH.id, counted: 0 }] });
    const cash2 = (close2.json?.data?.z_report?.tenders ?? []).find((t: any) => t.payment_method_id === CASH.id);
    check('closing after the void expects no cash from the voided sale', close2.status === 200 && cash2?.expected === 0 && cash2?.difference === 0, `${close2.status} ${JSON.stringify(cash2 ?? {})}`);
  }

  // ── 5. Void after the session closed ────────────────────────────────────────
  console.log('Void after close');
  const s3 = await openRegister('C', 0);
  const sale3 = await call('cashier', 'POST', '/pos/sale', { session_id: s3.id, tenders: [{ payment_method_id: CARD.id, amount: 1299 }], lines: saleLine() });
  check('a card sale posts', sale3.status === 201, `${sale3.status} ${sale3.code ?? ''}`);
  const close3 = await call('cashier', 'POST', `/pos/sessions/${s3.id}/close`, { declarations: [{ payment_method_id: CASH.id, counted: 0 }] });
  check('the card sale does not make the drawer short', close3.status === 200, `${close3.status} ${close3.code ?? ''}`);
  if (sale3.json?.data?.order_id) {
    const void3 = await call('store_manager', 'POST', `/pos/sales/${sale3.json.data.order_id}/void`, { reason: 'Too late for a void' });
    check('a void after the session closed is refused (POS_VOID_SESSION_CLOSED)', void3.status === 409 && void3.code === 'POS_VOID_SESSION_CLOSED', `${void3.status} ${void3.code ?? ''}`);
  }

  }

  const used = (await facturaCounter()) - facturaStart;
  check(`exactly ${sales ? 3 : 0} FACTURA numbers were used`, used === (sales ? 3 : 0), String(used));

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error('ERROR', e?.message ?? e);
  await db.$disconnect();
  process.exit(1);
});
