/**
 * CURRENCY FOUNDATION — PURCHASE-TO-PAY GUARDS (WORK-024a)
 *
 * Before WORK-024 a USD purchase-order receipt valued stock and FIFO layers at
 * the USD face value as if it were the ledger currency, and the invoice post
 * wrote rate 1 for any currency. These tests pin the fix and its parametric
 * nature:
 *   - a document outside the ledger's accounting currency is refused BEFORE any
 *     number, stock, cost layer or voucher is written;
 *   - the same flows pass the guard in a Turkish (TRY) ledger with TRY documents,
 *     proving no Bolivian literal remains on the path.
 *
 * "Passing the guard" is observed by making the next read after it throw a
 * sentinel: reaching that read means the currency check let the document through.
 */

import { createAndPostReceipt } from '../modules/purchase/productReceipt.service';
import { postInvoice } from '../modules/purchase/vendorInvoice.service';
import { createVendorPayment } from '../modules/purchase/vendorPayment.service';
import { WarehouseService } from '../modules/warehouse/warehouse.service';
import { allocateNumber } from '../shared/services/numberSequence.service';
import { postJournal } from '../shared/services/journal.service';
import { db } from '../infrastructure/database/client';

jest.mock('../infrastructure/database/client', () => ({
  db: {
    $transaction: jest.fn(),
    arrivalJournal: { findFirst: jest.fn() },
    financeParameters: { findFirst: jest.fn() },
    inventoryStock: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    inventoryCostLayer: { create: jest.fn() },
  },
}));
jest.mock('../shared/services/numberSequence.service', () => ({ allocateNumber: jest.fn() }));
jest.mock('../shared/services/journal.service', () => ({ postJournal: jest.fn(), reverseJournal: jest.fn() }));

const PAST_GUARD = new Error('PAST_GUARD');
const ledger = (code: string) => ({
  legal_entity_id: null, accounting_currency_code: code, reporting_currency_code: code,
  accounting_rate_type_id: 'rt', reporting_rate_type_id: null, exchange_rate_date_basis: 'POSTING_DATE',
});

function withTx(tx: any) {
  (db.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));
  return tx;
}

beforeEach(() => jest.clearAllMocks());

describe('product receipt', () => {
  const tx = (ledgerCode: string, poCurrency: string) => withTx({
    financeParameters: { findFirst: jest.fn().mockResolvedValue(ledger(ledgerCode)) },
    purchaseOrder: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'po-1', po_number: 'PO-1', status: 'CONFIRMED', currency: poCurrency, supplier_id: 's-1',
        warehouse_id: 'wh-1', receive_location_id: 'loc-1',
        lines: [{ id: 'l-1', product_id: 'p-1', variant_id: null, quantity: 5, cancelled_qty: 0, received_qty: 0, unit_cost: 100 }],
      }),
    },
    purchaseParameters: { findFirst: jest.fn().mockRejectedValue(PAST_GUARD) },
    productReceipt: { create: jest.fn() },
    inventoryStock: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    inventoryCostLayer: { create: jest.fn() },
    inventoryTransaction: { create: jest.fn() },
  });

  it('refuses a USD order in a BOB ledger before any number, stock, layer or voucher', async () => {
    const t = tx('BOB', 'USD');
    await expect(createAndPostReceipt('t1', 'u1', { purchase_order_id: 'po-1', packing_slip: 'PS-1' }))
      .rejects.toMatchObject({ code: 'RECEIPT_FX_NOT_IMPLEMENTED', statusCode: 409 });
    expect(allocateNumber).not.toHaveBeenCalled();
    expect(t.productReceipt.create).not.toHaveBeenCalled();
    expect(t.inventoryStock.create).not.toHaveBeenCalled();
    expect(t.inventoryCostLayer.create).not.toHaveBeenCalled();
    expect(postJournal).not.toHaveBeenCalled();
  });

  it('lets a TRY order through in a TRY ledger', async () => {
    tx('TRY', 'TRY');
    await expect(createAndPostReceipt('t1', 'u1', { purchase_order_id: 'po-1', packing_slip: 'PS-1' })).rejects.toBe(PAST_GUARD);
  });
});

describe('arrival journal receipt', () => {
  it('refuses a USD order in a BOB ledger before any stock or layer', async () => {
    const d = db as any;
    d.arrivalJournal.findFirst.mockResolvedValue({
      id: 'aj-1', status: 'DRAFT', purchase_order: { id: 'po-1', currency: 'USD' },
      lines: [{ id: 'ajl-1', received_qty: 5, product_id: 'p-1', variant_id: null, location_id: 'loc-1' }],
    });
    d.financeParameters.findFirst.mockResolvedValue(ledger('BOB'));
    await expect(new WarehouseService().postArrivalJournal('t1', 'aj-1', 'u1'))
      .rejects.toMatchObject({ code: 'RECEIPT_FX_NOT_IMPLEMENTED' });
    expect(d.inventoryStock.create).not.toHaveBeenCalled();
    expect(d.inventoryStock.update).not.toHaveBeenCalled();
    expect(d.inventoryCostLayer.create).not.toHaveBeenCalled();
  });
});

describe('vendor invoice posting', () => {
  const tx = (ledgerCode: string, invoiceCurrency: string) => withTx({
    financeParameters: { findFirst: jest.fn().mockResolvedValue(ledger(ledgerCode)) },
    vendorInvoice: {
      findFirst: jest.fn().mockResolvedValue({ id: 'vi-1', status: 'DRAFT', currency: invoiceCurrency, lines: [] }),
      update: jest.fn(),
    },
    purchaseParameters: { findFirst: jest.fn().mockRejectedValue(PAST_GUARD) },
    vendorOpenTransaction: { create: jest.fn() },
  });

  it('refuses a USD invoice in a BOB ledger before any voucher or open transaction', async () => {
    const t = tx('BOB', 'USD');
    await expect(postInvoice('t1', 'u1', 'vi-1')).rejects.toMatchObject({ code: 'VENDOR_INVOICE_FX_NOT_IMPLEMENTED' });
    expect(t.purchaseParameters.findFirst).not.toHaveBeenCalled();
    expect(postJournal).not.toHaveBeenCalled();
    expect(t.vendorInvoice.update).not.toHaveBeenCalled();
    expect(t.vendorOpenTransaction.create).not.toHaveBeenCalled();
  });

  it('lets a TRY invoice through in a TRY ledger', async () => {
    tx('TRY', 'TRY');
    await expect(postInvoice('t1', 'u1', 'vi-1')).rejects.toBe(PAST_GUARD);
  });
});

describe('vendor payment', () => {
  const tx = (ledgerCode: string) => withTx({
    financeParameters: { findFirst: jest.fn().mockResolvedValue(ledger(ledgerCode)) },
    supplier: { findFirst: jest.fn().mockRejectedValue(PAST_GUARD) },
    purchasePaymentMethod: { findFirst: jest.fn().mockResolvedValue(null) },
    vendorPayment: { create: jest.fn() },
  });
  const body = { supplier_id: 's-1', payment_method_id: 'pm-1', amount: 100 };

  it('refuses a USD payment in a BOB ledger before anything is written', async () => {
    const t = tx('BOB');
    await expect(createVendorPayment('t1', 'u1', { ...body, currency: 'USD' }))
      .rejects.toMatchObject({ code: 'VENDOR_PAYMENT_FX_NOT_IMPLEMENTED' });
    expect(t.supplier.findFirst).not.toHaveBeenCalled();
    expect(t.vendorPayment.create).not.toHaveBeenCalled();
  });

  it('defaults to, and accepts, the ledger currency of a TRY ledger', async () => {
    tx('TRY');
    await expect(createVendorPayment('t1', 'u1', body)).rejects.toBe(PAST_GUARD);
  });
});
