import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';
import { getLedgerCurrencies } from '../src/shared/services/currency/ledgerCurrency.service';
import {
  createCredit,
  createReturnFromInvoice,
  postCredit,
  shipReturn,
} from '../src/modules/purchase/purchaseReturn.service';
import { createAndPostReceipt } from '../src/modules/purchase/productReceipt.service';
import { createInvoice, postInvoice } from '../src/modules/purchase/vendorInvoice.service';
import { computePurchaseMoney } from '../src/shared/services/documentTax.service';
import { allocateNumber } from '../src/shared/services/numberSequence.service';

const EPSILON = 0.005;
const round2 = (value: number) => Math.round(value * 100) / 100;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function settledAmount(transactionId: string): Promise<number> {
  const rows = await db.vendorSettlement.findMany({
    where: { OR: [{ debit_transaction_id: transactionId }, { credit_transaction_id: transactionId }] },
    select: { amount: true, reverses_settlement_id: true },
  });
  return round2(rows.reduce(
    (sum, row) => sum + (row.reverses_settlement_id ? -Number(row.amount) : Number(row.amount)),
    0,
  ));
}

async function main() {
  if (process.env.ALLOW_TEST_DATABASE_WRITE !== 'WORK019_ACCEPTANCE') {
    throw new Error('Set ALLOW_TEST_DATABASE_WRITE=WORK019_ACCEPTANCE to run this test-data mutation.');
  }
  const marker = `WORK019-${Date.now()}`;

  // Build the source through the same receipt and invoice services used by the
  // application. Historical test invoices predate purchase-side tax filtering
  // and correctly fail WORK-019's non-recoverable-tax guard.
  const base = await db.product.findFirst({
    where: {
      is_active: true,
      product_type: 'physical',
      item_group_id: { not: null },
      item_model_group_id: { not: null },
      purchase_order_lines: { some: { purchase_order: { status: { in: ['RECEIVED', 'INVOICED'] } } } },
    },
    include: {
      purchase_order_lines: {
        where: { purchase_order: { status: { in: ['RECEIVED', 'INVOICED'] } } },
        include: { purchase_order: { include: { warehouse: true } } },
        take: 1,
      },
    },
  });
  assert(base?.purchase_order_lines[0], 'No configured physical product is available for the acceptance fixture.');
  const sourcePo = base.purchase_order_lines[0].purchase_order;
  const supplier = await db.supplier.findFirst({ where: { id: sourcePo.supplier_id, is_active: true } });
  const location = await db.warehouseLocation.findFirst({
    where: { tenant_id: sourcePo.tenant_id, is_active: true, zone: { warehouse_id: sourcePo.warehouse_id } },
  });
  const user = await db.user.findFirst({ where: { tenant_id: sourcePo.tenant_id, is_active: true }, select: { id: true } });
  assert(supplier && location && user, 'Fixture supplier, receiving location, or user is unavailable.');
  const agreedGross = 100;
  // The ledger's own currency, so this harness proves the flow in whatever
  // currency the tenant accounts in rather than in a literal (WORK-025).
  const home = (await getLedgerCurrencies(sourcePo.tenant_id)).accountingCurrency;
  const purchaseMoney = await computePurchaseMoney(sourcePo.tenant_id, agreedGross, { partyId: supplier.id });
  assert(purchaseMoney.non_recoverable_tax === 0, 'Current purchase tax setup still applies a non-recoverable sales-only tax.');
  const poNumber = await allocateNumber({ tenantId: sourcePo.tenant_id, reference: 'PURCHASE_ORDER', legalEntityId: null });
  const fixturePo = await db.purchaseOrder.create({
    data: {
      tenant_id: sourcePo.tenant_id,
      po_number: poNumber,
      supplier_id: supplier.id,
      warehouse_id: sourcePo.warehouse_id,
      site_id: sourcePo.warehouse.site_id,
      receive_location_id: location.id,
      status: 'CONFIRMED',
      confirmed_at: new Date(),
      currency: home,
      subtotal: agreedGross,
      tax_amount: purchaseMoney.recoverable_tax,
      total_amount: purchaseMoney.total,
      notes: marker,
      created_by: user.id,
      lines: { create: [{ product_id: base.id, quantity: 1, unit_cost: agreedGross, line_total: agreedGross }] },
    },
  });
  await createAndPostReceipt(sourcePo.tenant_id, user.id, {
    purchase_order_id: fixturePo.id,
    packing_slip: marker,
    location_id: location.id,
  });
  const fixtureInvoice = await createInvoice(sourcePo.tenant_id, user.id, {
    purchase_order_id: fixturePo.id,
    invoice_number: marker,
    invoice_date: new Date().toISOString().slice(0, 10),
    auto_match: true,
  });
  await postInvoice(sourcePo.tenant_id, user.id, fixtureInvoice.id);

  const invoices = await db.vendorInvoice.findMany({
    where: {
      status: 'POSTED', currency: home,
    },
    include: {
      lines: { include: { matches: { include: { receipt_line: { include: { receipt: true } } } } } },
    },
    orderBy: { created_at: 'desc' },
    take: 50,
  });

  let candidate: {
    invoice: typeof invoices[number];
    invoiceLine: typeof invoices[number]['lines'][number];
    match: typeof invoices[number]['lines'][number]['matches'][number];
    stockId: string;
    locationId: string;
    warehouseId: string;
    layerQuantity: number;
    stockQuantity: number;
    invoiceOpenId: string;
    invoiceOpenBefore: number;
    userId: string;
  } | null = null;

  for (const invoice of invoices) {
    if (Number(invoice.non_recoverable_tax) !== 0) continue;
    const params = await db.purchaseParameters.findFirst({
      where: { tenant_id: invoice.tenant_id, legal_entity_id: invoice.legal_entity_id },
    });
    if (!params?.post_product_receipt_in_ledger) continue;
    const user = await db.user.findFirst({ where: { tenant_id: invoice.tenant_id, is_active: true }, select: { id: true } });
    const invoiceOpen = await db.vendorOpenTransaction.findFirst({
      where: { tenant_id: invoice.tenant_id, source_type: 'INVOICE', source_id: invoice.id, direction: 'CREDIT' },
    });
    if (!user || !invoiceOpen) continue;
    const open = round2(Number(invoiceOpen.amount) - await settledAmount(invoiceOpen.id));

    for (const invoiceLine of invoice.lines) {
      if (!invoiceLine.product_id || Number(invoiceLine.quantity) < 1) continue;
      for (const match of invoiceLine.matches) {
        if (match.receipt_line.receipt.status !== 'POSTED' || Number(match.quantity) < 1) continue;
        const alreadyReturned = await db.purchaseReturnLine.aggregate({
          where: {
            original_invoice_line_id: invoiceLine.id,
            original_receipt_line_id: match.receipt_line_id,
            purchase_return: { status: { not: 'CANCELLED' } },
          },
          _sum: { quantity: true },
        });
        if (Number(alreadyReturned._sum.quantity ?? 0) >= Number(match.quantity)) continue;

        const stocks = await db.inventoryStock.findMany({
          where: {
            tenant_id: invoice.tenant_id,
            product_id: invoiceLine.product_id,
            variant_id: invoiceLine.variant_id ?? null,
            quantity: { gt: 0 },
          },
          include: { location: { include: { zone: { select: { warehouse_id: true } } } } },
        });
        for (const stock of stocks) {
          if (Number(stock.quantity) - Number(stock.reserved_qty) < 1) continue;
          const layers = await db.inventoryCostLayer.aggregate({
            where: {
              tenant_id: invoice.tenant_id,
              product_id: invoiceLine.product_id,
              variant_id: invoiceLine.variant_id ?? null,
              source_po_id: match.receipt_line.receipt.purchase_order_id,
              location_id: stock.location_id,
              unit_cost: match.receipt_line.net_unit_cost,
              quantity: { gt: 0 },
            },
            _sum: { quantity: true },
          });
          const layerQuantity = Number(layers._sum.quantity ?? 0);
          const creditTotal = round2(
            Number(invoiceLine.line_net_amount) / Number(invoiceLine.quantity) +
            Number(invoiceLine.tax_amount ?? 0) / Number(invoiceLine.quantity),
          );
          if (layerQuantity >= 1 && open + EPSILON >= creditTotal) {
            candidate = {
              invoice, invoiceLine, match, stockId: stock.id, locationId: stock.location_id,
              warehouseId: stock.location.zone.warehouse_id, layerQuantity,
              stockQuantity: Number(stock.quantity), invoiceOpenId: invoiceOpen.id,
              invoiceOpenBefore: open, userId: user.id,
            };
            break;
          }
        }
        if (candidate) break;
      }
      if (candidate) break;
    }
    if (candidate) break;
  }

  assert(candidate, 'No posted BOB invoice has one unreserved unit with matching PO cost-layer provenance.');
  const returned = await createReturnFromInvoice(candidate.invoice.tenant_id, candidate.userId, {
    invoice_id: candidate.invoice.id,
    warehouse_id: candidate.warehouseId,
    reason: marker,
    lines: [{
      invoice_line_id: candidate.invoiceLine.id,
      receipt_line_id: candidate.match.receipt_line_id,
      source_location_id: candidate.locationId,
      quantity: 1,
    }],
  });
  const returnRow = await db.purchaseReturn.findUnique({ where: { id: returned.id }, include: { lines: true } });
  assert(returnRow?.lines.length === 1, 'Return line was not persisted.');

  const shipped = await shipReturn(candidate.invoice.tenant_id, candidate.userId, returned.id, {
    shipment_reference: marker,
  });
  assert(shipped.journal_entry_id, 'Return shipment did not create a journal entry.');

  const afterStock = await db.inventoryStock.findUnique({ where: { id: candidate.stockId } });
  assert(afterStock && Number(afterStock.quantity) === candidate.stockQuantity - 1, 'Stock did not decrease by one.');
  const afterLayers = await db.inventoryCostLayer.aggregate({
    where: {
      tenant_id: candidate.invoice.tenant_id,
      product_id: candidate.invoiceLine.product_id!,
      variant_id: candidate.invoiceLine.variant_id ?? null,
      source_po_id: candidate.match.receipt_line.receipt.purchase_order_id,
      location_id: candidate.locationId,
      unit_cost: candidate.match.receipt_line.net_unit_cost,
      quantity: { gt: 0 },
    },
    _sum: { quantity: true },
  });
  assert(Number(afterLayers._sum.quantity ?? 0) === candidate.layerQuantity - 1, 'Exact receipt cost layer did not decrease by one.');

  const creditCreated = await createCredit(candidate.invoice.tenant_id, candidate.userId, {
    invoice_id: candidate.invoice.id,
    purchase_return_id: returned.id,
    external_credit_number: marker,
    credit_date: new Date().toISOString().slice(0, 10),
    lines: [{
      invoice_line_id: candidate.invoiceLine.id,
      return_line_id: returnRow.lines[0].id,
      quantity: 1,
    }],
  });
  const posted = await postCredit(candidate.invoice.tenant_id, candidate.userId, creditCreated.id);
  const credit = await db.supplierCredit.findUnique({ where: { id: creditCreated.id } });
  assert(credit?.status === 'POSTED' && posted.journal_entry_id, 'Supplier credit was not posted.');

  for (const journalId of [shipped.journal_entry_id, posted.journal_entry_id]) {
    const journalLines = await db.journalLine.findMany({ where: { journal_entry_id: journalId! } });
    const debits = round2(journalLines.reduce((sum, line) => sum + Number(line.debit_amount), 0));
    const credits = round2(journalLines.reduce((sum, line) => sum + Number(line.credit_amount), 0));
    assert(Math.abs(debits - credits) < EPSILON && debits > 0, `Journal ${journalId} is not balanced.`);
  }

  const creditOpen = await db.vendorOpenTransaction.findFirst({
    where: { tenant_id: candidate.invoice.tenant_id, source_type: 'SUPPLIER_CREDIT', source_id: creditCreated.id, direction: 'DEBIT' },
  });
  assert(creditOpen, 'Supplier-credit debit open transaction is missing.');
  const settlement = await db.vendorSettlement.findFirst({
    where: { debit_transaction_id: creditOpen.id, credit_transaction_id: candidate.invoiceOpenId },
  });
  assert(settlement && Math.abs(Number(settlement.amount) - Number(credit.total_amount)) < EPSILON, 'Exact invoice settlement is missing.');
  const invoiceOpenAfter = round2(Number((await db.vendorOpenTransaction.findUnique({ where: { id: candidate.invoiceOpenId } }))!.amount) - await settledAmount(candidate.invoiceOpenId));
  assert(Math.abs(invoiceOpenAfter - round2(candidate.invoiceOpenBefore - Number(credit.total_amount))) < EPSILON, 'Invoice open balance did not decrease by the credit total.');

  console.log(JSON.stringify({
    marker,
    returnNumber: returned.return_number,
    creditNumber: creditCreated.credit_number,
    stockDelta: -1,
    costLayerDelta: -1,
    shipmentVoucher: shipped.journal_entry_id,
    creditVoucher: posted.journal_entry_id,
    settledAmount: Number(settlement.amount),
    invoiceOpenBefore: candidate.invoiceOpenBefore,
    invoiceOpenAfter,
  }, null, 2));
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
