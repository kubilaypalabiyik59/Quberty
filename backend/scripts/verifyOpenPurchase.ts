import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';
import { getLedgerCurrencies } from '../src/shared/services/currency/ledgerCurrency.service';
import {
  cancelPurchaseOrderRemainder,
  cancellableQuantity,
  updatePurchaseOrderDelivery,
} from '../src/modules/purchase/purchaseOrderChange.service';

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  const tenant = await db.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error('No tenant.');
  const supplier = await db.supplier.findFirst({ where: { tenant_id: tenant.id }, select: { id: true } });
  const warehouse = await db.warehouse.findFirst({ where: { tenant_id: tenant.id }, select: { id: true } });
  const product = await db.product.findFirst({ where: { tenant_id: tenant.id }, select: { id: true } });
  const user = await db.user.findFirst({ where: { tenant_id: tenant.id }, select: { id: true } });
  if (!supplier || !warehouse || !product || !user) throw new Error('Missing purchase fixture data.');

  const poNumber = `VERIFY-OPEN-${Date.now()}`;
  const po = await db.purchaseOrder.create({
    data: {
      tenant_id: tenant.id,
      po_number: poNumber,
      supplier_id: supplier.id,
      warehouse_id: warehouse.id,
      status: 'CONFIRMED',
      currency: (await getLedgerCurrencies(tenant.id)).accountingCurrency,
      expected_date: new Date('2026-10-01T00:00:00.000Z'),
      subtotal: 50,
      total_amount: 50,
      lines: {
        create: {
          product_id: product.id,
          quantity: 5,
          unit_cost: 10,
          line_total: 50,
          requested_delivery_date: new Date('2026-10-01T00:00:00.000Z'),
        },
      },
    },
    include: { lines: true },
  });

  try {
    const line = po.lines[0];
    check('a confirmed line starts with five open units', cancellableQuantity(line) === 5);

    await updatePurchaseOrderDelivery({
      tenantId: tenant.id,
      orderId: po.id,
      requestedDeliveryDate: '2026-10-08',
      confirmedDeliveryDate: '2026-10-10',
      reason: 'Supplier confirmed a later arrival date',
      userId: user.id,
    });
    const dated = await db.purchaseOrderLine.findUnique({ where: { id: line.id } });
    check('delivery update changes the typed line dates',
      dated?.requested_delivery_date?.toISOString().slice(0, 10) === '2026-10-08' &&
      dated?.confirmed_delivery_date?.toISOString().slice(0, 10) === '2026-10-10');

    await cancelPurchaseOrderRemainder({
      tenantId: tenant.id,
      orderId: po.id,
      lineId: line.id,
      quantity: 2,
      reason: 'Supplier cannot fulfil the remaining two units',
      userId: user.id,
    });
    const cancelled = await db.purchaseOrderLine.findUnique({ where: { id: line.id } });
    check('partial remainder cancellation preserves the original quantity',
      Number(cancelled?.quantity) === 5 && Number(cancelled?.cancelled_qty) === 2);
    check('the remaining commitment is three units', cancelled ? cancellableQuantity(cancelled) === 3 : false);

    const changes = await db.purchaseOrderChange.findMany({ where: { purchase_order_id: po.id } });
    check('delivery and cancellation each create immutable change evidence', changes.length === 2, `${changes.length}`);

    let refused = false;
    try {
      await cancelPurchaseOrderRemainder({
        tenantId: tenant.id,
        orderId: po.id,
        lineId: line.id,
        quantity: 4,
        reason: 'Attempt to cancel more than remains',
        userId: user.id,
      });
    } catch (error: any) {
      refused = error?.code === 'CANCEL_QUANTITY_EXCEEDS_REMAINDER';
    }
    check('cancellation above the open remainder is refused', refused);
  } finally {
    await db.purchaseOrderChange.deleteMany({ where: { purchase_order_id: po.id } });
    await db.purchaseOrderLine.deleteMany({ where: { po_id: po.id } });
    await db.purchaseOrder.delete({ where: { id: po.id } });
  }

  const leftover = await db.purchaseOrder.count({ where: { tenant_id: tenant.id, po_number: poNumber } });
  check('verification purchase order is removed', leftover === 0);
  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async error => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
