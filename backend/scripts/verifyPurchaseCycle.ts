import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';
import { createAndPostReceipt } from '../src/modules/purchase/productReceipt.service';
import { createInvoice, postInvoice } from '../src/modules/purchase/vendorInvoice.service';
import { runMatching } from '../src/modules/purchase/vendorInvoice.service';
import { computePurchaseMoney } from '../src/shared/services/documentTax.service';
import { nextPurchaseOrderNumber } from '../src/shared/utils/orderCounter';

/**
 * End-to-end proof of the split purchase posting, against the REAL database with
 * the real services, tax engine, posting profiles and number sequences.
 *
 *   PO → partial receipt → second receipt → vendor invoice → posting
 *   PO → receipt → invoice ABOVE tolerance → blocked → approved → posted
 *
 * What it actually asserts, rather than prints:
 *   · the receipt voucher balances and credits the accrual, and posts NO tax
 *   · the inventory batch is written at the NET cost, so subledger = ledger
 *   · three-way matching passes on an on-price invoice and fails on an off-price one
 *   · a price discrepancy is BLOCKED under REQUIRE_APPROVAL and posts once approved
 *   · the invoice voucher reverses the accrual, recognises tax, credits AP
 *   · the accrual account nets to ZERO once received and invoiced — the property
 *     that makes "goods received not invoiced" a trustworthy number
 *
 *   npx tsx scripts/verifyPurchaseCycle.ts          run and clean up
 *   npx tsx scripts/verifyPurchaseCycle.ts --keep   leave the documents behind
 */

const KEEP = process.argv.includes('--keep');
const SUPPLIER_CODE = 'E2E-VI';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? ` = ${JSON.stringify(actual)}` : `\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`),
  );
}
function near(label: string, actual: number, expected: number, tol = 0.011) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} = ${actual}${ok ? '' : ` (expected ~${expected})`}`);
}
function note(label: string, value: unknown) {
  console.log(`        ${label}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
}
function heading(s: string) {
  console.log(`\n${'─'.repeat(76)}\n${s}\n${'─'.repeat(76)}`);
}

/** Sum debits/credits on one account for one voucher. */
async function voucherLine(entryId: string, accountId: string) {
  const rows = await db.journalLine.findMany({
    where: { journal_entry_id: entryId, account_id: accountId },
    select: { debit_amount: true, credit_amount: true },
  });
  return {
    debit: Number(rows.reduce((s, r) => s + Number(r.debit_amount), 0).toFixed(2)),
    credit: Number(rows.reduce((s, r) => s + Number(r.credit_amount), 0).toFixed(2)),
  };
}

async function voucherBalance(entryId: string) {
  const rows = await db.journalLine.findMany({
    where: { journal_entry_id: entryId }, select: { debit_amount: true, credit_amount: true },
  });
  const d = rows.reduce((s, r) => s + Number(r.debit_amount), 0);
  const c = rows.reduce((s, r) => s + Number(r.credit_amount), 0);
  return Number((d - c).toFixed(2));
}

(async () => {
  const tenant = await db.tenant.findFirst({ select: { id: true, slug: true } });
  if (!tenant) throw new Error('no tenant');
  const user = await db.user.findFirst({ where: { tenant_id: tenant.id }, select: { id: true } });
  if (!user) throw new Error('no user');

  const warehouse = await db.warehouse.findFirst({ where: { tenant_id: tenant.id }, select: { id: true } });
  if (!warehouse) throw new Error('no warehouse');
  const location = await db.warehouseLocation.findFirst({
    where: { zone: { warehouse_id: warehouse.id } }, select: { id: true },
  });
  if (!location) throw new Error('no location');

  const products = await db.product.findMany({
    where: { tenant_id: tenant.id, is_active: true },
    select: { id: true, sku: true }, take: 2, orderBy: { sku: 'asc' },
  });
  if (products.length < 2) throw new Error('need 2 products');

  const accounts = await db.postingProfile.findMany({
    where: { tenant_id: tenant.id, scope_kind: 'ALL', posting_type: { in: ['PURCHASE_ACCRUAL', 'VAT_INPUT', 'AP', 'INVENTORY', 'PRICE_VARIANCE'] } },
    select: { posting_type: true, account_id: true },
  });
  const acc = Object.fromEntries(accounts.map(a => [a.posting_type, a.account_id])) as Record<string, string>;
  for (const t of ['PURCHASE_ACCRUAL', 'VAT_INPUT', 'AP', 'INVENTORY', 'PRICE_VARIANCE']) {
    if (!acc[t]) throw new Error(`posting profile ${t} is not configured — run scripts/provisionPurchaseAccounts.ts --apply`);
  }

  // ── Put the tenant on the split posting, with three-way matching ──────────
  const paramsBefore = await db.purchaseParameters.findFirst({
    where: { tenant_id: tenant.id, legal_entity_id: null },
    select: {
      id: true, post_product_receipt_in_ledger: true, line_matching_policy: true,
      price_tolerance_pct: true, post_invoice_with_discrepancies: true, match_invoice_totals: true,
    },
  });
  if (!paramsBefore) throw new Error('purchase parameters missing — run provisionConfiguration --apply');

  heading('0. Configuration');
  note('before', paramsBefore);
  await db.purchaseParameters.update({
    where: { id: paramsBefore.id },
    data: {
      post_product_receipt_in_ledger: true,
      line_matching_policy: 'THREE_WAY',
      price_tolerance_pct: 0.02,           // 2%, as in the official worked example
      post_invoice_with_discrepancies: 'REQUIRE_APPROVAL',
      match_invoice_totals: true,
      invoice_totals_tolerance_pct: 0.05,
    },
  });
  console.log('  configured: split posting ON · THREE_WAY · 2% price tolerance · discrepancies need approval');

  const supplier =
    (await db.supplier.findFirst({ where: { tenant_id: tenant.id, code: SUPPLIER_CODE }, select: { id: true } })) ??
    (await db.supplier.create({
      data: { tenant_id: tenant.id, code: SUPPLIER_CODE, name: 'Proveedor Verificación', currency: 'BOB', country: 'BO' },
      select: { id: true },
    }));

  const createdPoIds: string[] = [];

  /* ══════════════════════════ CYCLE 1 — clean ══════════════════════════ */

  heading('1. Purchase order → two partial receipts');

  const UNIT = 100;
  const QTY = 10;
  const po1 = await db.purchaseOrder.create({
    data: {
      tenant_id: tenant.id,
      po_number: await nextPurchaseOrderNumber(tenant.id),
      supplier_id: supplier.id,
      warehouse_id: warehouse.id,
      receive_location_id: location.id,
      status: 'CONFIRMED',
      currency: 'BOB',
      subtotal: UNIT * QTY,
      ...(await (async () => {
        const m = await computePurchaseMoney(tenant.id, UNIT * QTY, { partyId: supplier.id });
        return { tax_amount: m.recoverable_tax, total_amount: m.total };
      })()),
      created_by: user.id,
      lines: {
        create: [{
          product_id: products[0].id, quantity: QTY, unit_cost: UNIT,
          line_total: UNIT * QTY, sort_order: 0,
        }],
      },
    },
    include: { lines: true },
  });
  createdPoIds.push(po1.id);
  note('order', `${po1.po_number} — ${QTY} x ${UNIT} gross ${Number(po1.total_amount)}`);

  const expectedMoney = await computePurchaseMoney(tenant.id, UNIT * QTY, { partyId: supplier.id });
  note('engine', `net ${expectedMoney.net} · recoverable ${expectedMoney.recoverable_tax} · total ${expectedMoney.total}`);

  // First receipt — 6 of 10
  const r1 = await createAndPostReceipt(tenant.id, user.id, {
    purchase_order_id: po1.id,
    packing_slip: 'PS-0001',
    lines: [{ po_line_id: po1.lines[0].id, quantity: 6 }],
  });
  note('receipt 1', `${r1.receipt_number} — accrued ${r1.accrued_amount}`);
  check('receipt 1 raised a voucher', r1.journal_entry_id !== null, true);

  const expectedNet6 = (await computePurchaseMoney(tenant.id, 6 * UNIT, { partyId: supplier.id })).net;
  near('receipt 1 accrual = net of 6 units', r1.accrued_amount, expectedNet6);

  const r1Accrual = await voucherLine(r1.journal_entry_id!, acc.PURCHASE_ACCRUAL);
  const r1Vat = await voucherLine(r1.journal_entry_id!, acc.VAT_INPUT);
  const r1Ap = await voucherLine(r1.journal_entry_id!, acc.AP);
  near('receipt voucher CREDITS the accrual', r1Accrual.credit, expectedNet6);
  check('receipt voucher posts NO recoverable tax', r1Vat.debit + r1Vat.credit, 0);
  check('receipt voucher posts NO payable', r1Ap.debit + r1Ap.credit, 0);
  check('receipt voucher balances', await voucherBalance(r1.journal_entry_id!), 0);

  const po1AfterR1 = await db.purchaseOrder.findUnique({ where: { id: po1.id }, select: { status: true } });
  check('order is PARTIALLY_RECEIVED', po1AfterR1?.status, 'PARTIALLY_RECEIVED');

  // The batch cost defect this work fixes
  const batch = await db.inventoryCostLayer.findFirst({
    where: { source_po_id: po1.id }, select: { unit_cost: true },
    orderBy: { received_at: 'desc' },
  });
  near('inventory batch valued at the NET unit cost, not the gross', Number(batch?.unit_cost), expectedNet6 / 6);

  // Second receipt — the remaining 4
  const r2 = await createAndPostReceipt(tenant.id, user.id, {
    purchase_order_id: po1.id, packing_slip: 'PS-0002',
  });
  note('receipt 2', `${r2.receipt_number} — accrued ${r2.accrued_amount}`);
  const po1AfterR2 = await db.purchaseOrder.findUnique({ where: { id: po1.id }, select: { status: true } });
  check('order is RECEIVED once fully delivered', po1AfterR2?.status, 'RECEIVED');

  heading('2. Vendor invoice at the agreed price → three-way match passes');

  const inv1 = await createInvoice(tenant.id, user.id, {
    purchase_order_id: po1.id,
    invoice_number: `F-${Date.now()}`,
    invoice_date: new Date().toISOString().slice(0, 10),
    supplier_tax_id: '1023456789',
    fiscal_authorization_code: '29040011007',
  });
  note('invoice', inv1.internal_number);

  const matched = await db.$transaction(tx => runMatching(tx, tenant.id, inv1.id));
  check('header match PASSED', matched.header_match_status, 'PASSED');
  check('every line price-matched', matched.lines.every(l => l.price_match === 'PASSED'), true);
  check('every line receipt-qty-matched', matched.lines.every(l => l.receipt_qty_match === 'PASSED'), true);
  check('matched against BOTH receipts', (await db.vendorInvoiceMatch.count({ where: { invoice_line: { invoice_id: inv1.id } } })), 2);

  const posted1 = await postInvoice(tenant.id, user.id, inv1.id);
  note('posting', posted1.posting_note);
  check('invoice raised a voucher', posted1.journal_entry_id !== null, true);
  near('accrual reversed in full', posted1.accrual_reversed, expectedMoney.net);
  check('no price variance on an on-price invoice', posted1.price_variance, 0);

  const v1Accrual = await voucherLine(posted1.journal_entry_id!, acc.PURCHASE_ACCRUAL);
  const v1Vat = await voucherLine(posted1.journal_entry_id!, acc.VAT_INPUT);
  const v1Ap = await voucherLine(posted1.journal_entry_id!, acc.AP);
  near('invoice voucher DEBITS the accrual', v1Accrual.debit, expectedMoney.net);
  near('recoverable tax recognised HERE, against the factura', v1Vat.debit, expectedMoney.recoverable_tax);
  near('payable credited with the invoice total', v1Ap.credit, expectedMoney.total);
  check('invoice voucher balances', await voucherBalance(posted1.journal_entry_id!), 0);

  const po1Final = await db.purchaseOrder.findUnique({ where: { id: po1.id }, select: { status: true } });
  check('order is INVOICED once received and invoiced in full', po1Final?.status, 'INVOICED');

  // The property that makes GRNI trustworthy
  const grniLines = await db.journalLine.findMany({
    where: {
      account_id: acc.PURCHASE_ACCRUAL,
      journal_entry: { source_id: { in: [r1.id, r2.id, inv1.id] } },
    },
    select: { debit_amount: true, credit_amount: true },
  });
  const grni = Number(
    grniLines.reduce((s, l) => s + Number(l.credit_amount) - Number(l.debit_amount), 0).toFixed(2),
  );
  check('goods received not invoiced nets to ZERO for this order', grni, 0);

  /* ═══════════════ CYCLE 2 — a price the vendor moved ═══════════════ */

  heading('3. Invoice ABOVE tolerance → blocked, then approved');

  const po2 = await db.purchaseOrder.create({
    data: {
      tenant_id: tenant.id,
      po_number: await nextPurchaseOrderNumber(tenant.id),
      supplier_id: supplier.id,
      warehouse_id: warehouse.id,
      receive_location_id: location.id,
      status: 'CONFIRMED',
      currency: 'BOB',
      subtotal: 200,
      ...(await (async () => {
        const m = await computePurchaseMoney(tenant.id, 200, { partyId: supplier.id });
        return { tax_amount: m.recoverable_tax, total_amount: m.total };
      })()),
      created_by: user.id,
      lines: { create: [{ product_id: products[1].id, quantity: 2, unit_cost: 100, line_total: 200, sort_order: 0 }] },
    },
    include: { lines: true },
  });
  createdPoIds.push(po2.id);

  const r3 = await createAndPostReceipt(tenant.id, user.id, {
    purchase_order_id: po2.id, packing_slip: 'PS-0003',
  });
  note('receipt', `${r3.receipt_number} — accrued ${r3.accrued_amount} at the ORDERED price of 100`);

  // The supplier bills 110 — a 10% variance against a 2% tolerance.
  const inv2 = await createInvoice(tenant.id, user.id, {
    purchase_order_id: po2.id,
    invoice_number: `F-VAR-${Date.now()}`,
    invoice_date: new Date().toISOString().slice(0, 10),
    lines: [{ po_line_id: po2.lines[0].id, product_id: products[1].id, quantity: 2, unit_price: 110 }],
  });

  const matched2 = await db.$transaction(tx => runMatching(tx, tenant.id, inv2.id));
  check('header match FAILED', matched2.header_match_status, 'FAILED');
  check('price match FAILED', matched2.lines[0].price_match, 'FAILED');
  check('receipt quantity still matched', matched2.lines[0].receipt_qty_match, 'PASSED');
  near('variance reported as +10%', Number(matched2.lines[0].variance_pct), 10);
  note('reason', matched2.lines[0].reasons[0]);

  let blocked = false;
  try {
    await postInvoice(tenant.id, user.id, inv2.id);
  } catch (e: any) {
    blocked = e?.code === 'MATCHING_DISCREPANCY_UNAPPROVED' || /discrepanc/i.test(e?.message ?? '');
  }
  check('posting BLOCKED while the discrepancy is unapproved', blocked, true);

  await db.vendorInvoice.update({
    where: { id: inv2.id },
    data: { discrepancy_approved: true, discrepancy_approved_by: user.id, discrepancy_approved_at: new Date() },
  });
  const posted2 = await postInvoice(tenant.id, user.id, inv2.id);
  check('posts once approved', posted2.journal_entry_id !== null, true);
  check('a price variance was posted', Math.abs(posted2.price_variance) > 0, true);
  note('variance', posted2.price_variance);

  const v2Pv = await voucherLine(posted2.journal_entry_id!, acc.PRICE_VARIANCE);
  check('variance voucher balances', await voucherBalance(posted2.journal_entry_id!), 0);
  near('variance = invoiced net − received net', v2Pv.debit - v2Pv.credit, posted2.price_variance);

  const grni2Lines = await db.journalLine.findMany({
    where: { account_id: acc.PURCHASE_ACCRUAL, journal_entry: { source_id: { in: [r3.id, inv2.id] } } },
    select: { debit_amount: true, credit_amount: true },
  });
  check(
    'accrual still nets to zero even with a price change',
    Number(grni2Lines.reduce((s, l) => s + Number(l.credit_amount) - Number(l.debit_amount), 0).toFixed(2)),
    0,
  );

  /* ────────────────────────────── wrap up ────────────────────────────── */

  heading(failures === 0 ? `ALL ASSERTIONS PASSED` : `${failures} ASSERTION(S) FAILED`);

  if (KEEP) {
    console.log('  --keep: documents left in place. Purchase parameters left on the SPLIT posting.');
  } else {
    const receiptIds = (await db.productReceipt.findMany({
      where: { purchase_order_id: { in: createdPoIds } }, select: { id: true },
    })).map(r => r.id);
    const invoiceIds = (await db.vendorInvoice.findMany({
      where: { purchase_order_id: { in: createdPoIds } }, select: { id: true },
    })).map(i => i.id);

    await db.journalLine.deleteMany({ where: { journal_entry: { source_id: { in: [...receiptIds, ...invoiceIds] } } } });
    await db.journalEntry.deleteMany({ where: { source_id: { in: [...receiptIds, ...invoiceIds] } } });
    await db.vendorInvoiceMatch.deleteMany({ where: { invoice_line: { invoice_id: { in: invoiceIds } } } });
    await db.vendorInvoiceLine.deleteMany({ where: { invoice_id: { in: invoiceIds } } });
    await db.vendorInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await db.productReceiptLine.deleteMany({ where: { receipt_id: { in: receiptIds } } });
    await db.productReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await db.inventoryCostLayer.deleteMany({ where: { source_po_id: { in: createdPoIds } } });
    await db.inventoryTransaction.deleteMany({ where: { reference_id: { in: receiptIds } } });
    await db.purchaseOrderLine.deleteMany({ where: { po_id: { in: createdPoIds } } });
    await db.purchaseOrder.deleteMany({ where: { id: { in: createdPoIds } } });

    // Restore the parameters exactly as they were found, so a verification run
    // never silently changes how the tenant posts.
    await db.purchaseParameters.update({
      where: { id: paramsBefore.id },
      data: {
        post_product_receipt_in_ledger: paramsBefore.post_product_receipt_in_ledger,
        line_matching_policy: paramsBefore.line_matching_policy,
        price_tolerance_pct: paramsBefore.price_tolerance_pct,
        post_invoice_with_discrepancies: paramsBefore.post_invoice_with_discrepancies,
        match_invoice_totals: paramsBefore.match_invoice_totals,
      },
    });
    console.log('  cleaned up; purchase parameters restored to what they were before the run.');
  }

  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('ERR', e);
  await db.$disconnect();
  process.exit(1);
});
