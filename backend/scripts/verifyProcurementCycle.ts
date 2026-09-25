/**
 * Source to Pay, requisition to stock, end to end on TEST (catalog 75.40 / 75.50).
 *
 *   requester  creates and submits a purchase requisition
 *   buyer      approves it, turns it into an RFQ, invites two vendors, sends it,
 *              records both bids, compares them and awards the cheaper one —
 *              which generates the purchase order — then confirms the order
 *   receiver   posts the product receipt into the order's warehouse
 *
 * and checks, after every step, the state a user would see: document statuses,
 * the price written back to the requisition, the order linked to its source,
 * and the stock that arrived. Segregation of duties is probed on the way: the
 * requester cannot approve, the receiver cannot award.
 *
 * Every call goes through the real HTTP router with a token for the role that
 * performs the step. Writes to TEST only; no FACTURA is involved on this side.
 *
 *   ALLOW_TEST_DATABASE_WRITE=PROCUREMENT_CYCLE npx tsx scripts/verifyProcurementCycle.ts
 */
import 'dotenv/config';
import * as jwt from 'jsonwebtoken';
import { db } from '../src/infrastructure/database/client';

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
const num = (v: unknown) => Number(v ?? 0);

async function main() {
  if (process.env.ALLOW_TEST_DATABASE_WRITE !== 'PROCUREMENT_CYCLE') {
    throw new Error('Set ALLOW_TEST_DATABASE_WRITE=PROCUREMENT_CYCLE to confirm the TEST-only run.');
  }
  const app = (await import('../src/app')).default;

  const tenant = await db.tenant.findFirst({ where: { is_active: true }, orderBy: { created_at: 'asc' }, select: { id: true } });
  if (!tenant) throw new Error('No active tenant.');
  const T = tenant.id;
  const admin = await db.user.findFirst({ where: { tenant_id: T, role: 'admin' }, select: { id: true, email: true } });
  if (!admin) throw new Error('No admin user.');

  // One real user acts in every role; the role in the token decides what it may do.
  const token = (role: string) =>
    jwt.sign({ sub: admin.id, email: admin.email, role, tenantId: T }, process.env.JWT_SECRET!, { expiresIn: '10m' });
  const call = async (role: string, method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-tenant-id': T, authorization: `Bearer ${token(role)}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    return { status: res.status, json, data: json?.data, message: json?.error?.message as string | undefined };
  };
  const explain = (r: { status: number; message?: string }) => `${r.status} ${r.message ?? ''}`;

  // ── Fixtures ────────────────────────────────────────────────────────────────
  const wh = await db.warehouse.findFirst({ where: { tenant_id: T, code: 'WH-MAIN' }, select: { id: true } });
  if (!wh) throw new Error('Expected warehouse WH-MAIN.');
  // Receive where the warehouse receives — its default receive location — which
  // is what makes a putaway warehouse create put-away work. Falls back to any
  // non-shipping location for a warehouse without one.
  const params = await db.warehouseParameters.findFirst({
    where: { warehouse_id: wh.id }, select: { default_receive_location_id: true, require_putaway: true },
  });
  const loc = await db.warehouseLocation.findFirst({
    where: params?.default_receive_location_id
      ? { id: params.default_receive_location_id }
      : { tenant_id: T, is_active: true, zone: { warehouse_id: wh.id, zone_type: { not: 'shipping' } } },
    orderBy: [{ is_pick_location: 'asc' }, { code: 'asc' }], select: { id: true, code: true },
  });
  if (!loc) throw new Error('Expected a receiving location in WH-MAIN.');
  const product = await db.product.findFirst({
    where: {
      tenant_id: T, is_active: true, product_type: 'physical', variants: { none: {} },
      item_model_group: { is: { stocked: true } },
    },
    select: { id: true, sku: true },
  }).catch(() => null) ?? await db.product.findFirst({
    where: { tenant_id: T, is_active: true, product_type: 'physical', variants: { none: {} } },
    select: { id: true, sku: true },
  });
  if (!product) throw new Error('Expected an active physical product without variants.');
  const suppliers = await db.supplier.findMany({ where: { tenant_id: T, is_active: true }, take: 2, orderBy: { code: 'asc' }, select: { id: true, code: true } });
  if (suppliers.length < 2) throw new Error('Expected two active suppliers.');
  const [cheap, dear] = suppliers;
  // Stock is held per location; a warehouse's stock is the sum over its locations.
  const stockInWarehouse = () =>
    db.inventoryStock.aggregate({
      where: { tenant_id: T, product_id: product.id, variant_id: null, location: { zone: { warehouse_id: wh.id } } },
      _sum: { quantity: true },
    }).then((a) => num(a._sum.quantity));
  const stockBefore = await stockInWarehouse();
  console.log(`Fixtures: product ${product.sku}, suppliers ${cheap.code} and ${dear.code}, WH-MAIN/${loc.code}`);

  // ── 1. Requisition ──────────────────────────────────────────────────────────
  const QTY = 3;
  const req = await call('purchasing_requester', 'POST', '/procurement/requisitions', {
    warehouse_id: wh.id, purpose: 'CONSUMPTION', justification: 'VERIFY procurement cycle',
    lines: [{ product_id: product.id, quantity: QTY, estimated_unit_cost: 15 }],
  });
  check('the requester creates a requisition', req.status === 201, explain(req));
  const reqId = req.data?.id as string;
  if (!reqId) throw new Error('No requisition; stopping.');

  const sub = await call('purchasing_requester', 'POST', `/procurement/requisitions/${reqId}/submit`);
  check('the requester submits it for review', sub.status === 200 && sub.data?.status === 'IN_REVIEW', `${explain(sub)} status=${sub.data?.status}`);

  const selfApprove = await call('purchasing_requester', 'POST', `/procurement/requisitions/${reqId}/approve`, {});
  check('the requester cannot approve it (403)', selfApprove.status === 403, explain(selfApprove));

  const appr = await call('buyer', 'POST', `/procurement/requisitions/${reqId}/approve`, {});
  check('the buyer approves it', appr.status === 200 && appr.data?.status === 'APPROVED', `${explain(appr)} status=${appr.data?.status}`);

  // ── 2. RFQ from the requisition ─────────────────────────────────────────────
  const rfq = await call('buyer', 'POST', `/procurement/requisitions/${reqId}/rfq`, { title: 'VERIFY procurement cycle' });
  check('the buyer turns the requisition into an RFQ', rfq.status === 201, explain(rfq));
  const rfqId = rfq.data?.id as string;
  if (!rfqId) throw new Error('No RFQ; stopping.');
  check('the RFQ carries the requisition line', (rfq.data?.lines?.length ?? 0) === 1 && num(rfq.data?.lines?.[0]?.quantity) === QTY,
    JSON.stringify(rfq.data?.lines?.map((l: any) => l.quantity)));

  const inv = await call('buyer', 'POST', `/procurement/rfq/${rfqId}/vendors`, { supplier_ids: [cheap.id, dear.id] });
  check('the buyer invites two vendors', inv.status === 200, explain(inv));
  const sent = await call('buyer', 'POST', `/procurement/rfq/${rfqId}/send`);
  check('the buyer sends the RFQ', sent.status === 200, explain(sent));

  const detail = await call('buyer', 'GET', `/procurement/rfq/${rfqId}`);
  const requests: any[] = detail.data?.requests ?? [];
  check('one request per vendor, both SENT', requests.length === 2 && requests.every((r) => r.status === 'SENT'),
    JSON.stringify(requests.map((r) => r.status)));
  const reqOf = (supplierId: string) => requests.find((r) => r.supplier_id === supplierId);

  // ── 3. Bids, comparison, award ──────────────────────────────────────────────
  for (const [s, price] of [[cheap, 9], [dear, 12]] as const) {
    const r = reqOf(s.id);
    const bid = await call('buyer', 'POST', `/procurement/rfq/bids/${r.id}`, {
      lead_time_days: 5, lines: [{ line_id: r.lines[0].id, unit_price: price, quantity: QTY }],
    });
    check(`the bid of ${s.code} at ${price} is recorded`, bid.status === 200, explain(bid));
  }
  const cmp = await call('buyer', 'GET', `/procurement/rfq/${rfqId}/compare`);
  check('the comparison is available', cmp.status === 200, explain(cmp));

  const receiverAward = await call('receiver', 'POST', `/procurement/rfq/${rfqId}/award`, { request_id: reqOf(cheap.id).id });
  check('a receiver cannot award (403)', receiverAward.status === 403, explain(receiverAward));

  const award = await call('buyer', 'POST', `/procurement/rfq/${rfqId}/award`, { request_id: reqOf(cheap.id).id, reject_others: true });
  check('the buyer awards the cheaper bid', award.status === 201, explain(award));
  const po = award.data?.purchase_order;
  check('the award generates a purchase order for the winning vendor', !!po?.id && po?.supplier_id === cheap.id,
    `po=${po?.po_number} supplier=${po?.supplier_id}`);
  check('the order takes the bid price', num(po?.lines?.[0]?.unit_cost) === 9 && num(po?.lines?.[0]?.quantity) === QTY,
    `unit_cost=${po?.lines?.[0]?.unit_cost} qty=${po?.lines?.[0]?.quantity}`);
  check('the requisition is closed by the award', award.data?.requisition_status === 'CLOSED', `status=${award.data?.requisition_status}`);

  const reqAfter = await call('buyer', 'GET', `/procurement/requisitions/${reqId}`);
  const rl = reqAfter.data?.lines?.[0];
  check('the agreed price is written back to the requisition line', num(rl?.estimated_unit_cost) === 9, `estimated_unit_cost=${rl?.estimated_unit_cost}`);
  check('the requisition lists the generated order', (reqAfter.data?.purchase_orders ?? []).some((o: any) => o.id === po?.id));
  const rfqAfter = await call('buyer', 'GET', `/procurement/rfq/${rfqId}`);
  check('the RFQ is closed, the losing bid rejected',
    rfqAfter.data?.status === 'CLOSED' && reqOfIn(rfqAfter.data, dear.id)?.status === 'REJECTED',
    `case=${rfqAfter.data?.status} loser=${reqOfIn(rfqAfter.data, dear.id)?.status}`);

  // ── 4. Order processing: confirm, receive ───────────────────────────────────
  if (!po?.id) throw new Error('No purchase order; stopping.');
  if (po.status !== 'CONFIRMED') {
    const conf = await call('buyer', 'POST', `/purchase/orders/${po.id}/confirm`);
    check('the buyer confirms the order', conf.status === 200, explain(conf));
  } else {
    check('the generated order is already confirmed', true);
  }
  const rec = await call('receiver', 'POST', `/purchase/orders/${po.id}/receive`, {
    packing_slip: `VERIFY-PC-${Date.now()}`, location_id: loc.id,
  });
  check('the receiver posts the product receipt', rec.status === 200, explain(rec));

  const poAfter = await db.purchaseOrder.findUnique({ where: { id: po.id }, select: { status: true, lines: { select: { received_qty: true } } } });
  check('the order is fully received', poAfter?.status === 'RECEIVED' && num(poAfter?.lines[0]?.received_qty) === QTY,
    `status=${poAfter?.status} received=${poAfter?.lines[0]?.received_qty}`);
  const stockAfter = await stockInWarehouse();
  check(`stock in WH-MAIN rose by ${QTY}`, stockAfter - stockBefore === QTY, `before=${stockBefore} after=${stockAfter}`);
  const txn = await db.inventoryTransaction.findFirst({
    where: { tenant_id: T, product_id: product.id, reference_id: { in: [po.id, rec.data?.id, rec.data?.receipt?.id].filter(Boolean) } },
    select: { id: true, quantity: true },
  }).catch(() => null);
  check('an inventory transaction records the receipt', !!txn, 'none found by order or receipt reference');

  if (params?.require_putaway) {
    const work = await db.warehouseWork.findFirst({
      where: { tenant_id: T, work_type: 'PUTAWAY', warehouse_id: wh.id, status: 'OPEN', lines: { some: { product_id: product.id } } },
      orderBy: { created_at: 'desc' },
      select: { work_id_code: true, lines: { select: { from_location_id: true, to_location_id: true } } },
    });
    check('the warehouse requires putaway, so the receipt raised put-away work off the receiving location',
      !!work && work.lines.every((l) => l.from_location_id === loc.id && l.to_location_id !== loc.id),
      work ? JSON.stringify(work) : 'no open put-away work');
  }

  console.log(`\n${passed} passed, ${failed} failed. Requisition ${req.data?.requisition_number}, RFQ ${rfq.data?.rfq_number}, PO ${po.po_number}.`);
  process.exit(failed ? 1 : 0);
}

function reqOfIn(rfq: any, supplierId: string) {
  return (rfq?.requests ?? []).find((r: any) => r.supplier_id === supplierId);
}

main().catch((e) => { console.error('ERROR', e?.message ?? e); process.exit(2); });
