/**
 * Supplier return and credit service – unit tests.
 *
 * Acceptance criteria (WORK-019 §8):
 *  1. Partial return from posted invoice + matched receipt
 *  2. Duplicate / excess quantity refused
 *  3. Unavailable / reserved stock refused at ship
 *  4. Immutable source links (posted = unchangeable)
 *  5. Supplier-credit posting: balanced voucher + DEBIT open transaction
 *  6. Settlement against original invoice
 *  7. Tenant / supplier / currency isolation
 */

import { createReturnFromInvoice, shipReturn, createCredit, postCredit } from '../modules/purchase/purchaseReturn.service';
import { db } from '../infrastructure/database/client';
import { AppError } from '../shared/errors/AppError';

jest.mock('../infrastructure/database/client', () => ({
  db: { $transaction: jest.fn(), tenant: { findUnique: jest.fn() } },
}));
jest.mock('../shared/services/numberSequence.service', () => ({
  allocateNumber: jest.fn().mockResolvedValue('PR-2026-00001'),
}));
jest.mock('../shared/services/posting.service', () => ({
  resolvePostingAccounts_orExplain: jest.fn(),
}));
jest.mock('../shared/services/journal.service', () => ({
  postJournal: jest.fn().mockResolvedValue({ id: 'je-1', entry_number: 'JE-2026-00001' }),
}));

const { resolvePostingAccounts_orExplain } = require('../shared/services/posting.service');

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTx(overrides: Record<string, any> = {}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    tenant: { findUnique: jest.fn().mockResolvedValue({ currency_code: 'BOB' }) },
    // The currency guard reads the ledger, not the tenant record (WORK-024).
    financeParameters: {
      findFirst: jest.fn().mockResolvedValue({
        legal_entity_id: null, accounting_currency_code: 'BOB', reporting_currency_code: 'BOB',
        accounting_rate_type_id: 'rt-1', reporting_rate_type_id: null, exchange_rate_date_basis: 'POSTING_DATE',
      }),
    },
    vendorInvoice: { findFirst: jest.fn(), updateMany: jest.fn() },
    vendorInvoiceLine: { findFirst: jest.fn() },
    purchaseReturn: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    purchaseReturnLine: {
      create: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      findMany: jest.fn().mockResolvedValue([{ id: 'return-line-1', frozen_net_unit_cost: '80' }]),
    },
    supplierCredit: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    supplierCreditLine: { create: jest.fn(), aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }) },
    warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'wh-1' }) },
    warehouseLocation: { findFirst: jest.fn().mockResolvedValue({ id: 'loc-1' }) },
    inventoryStock: { findFirst: jest.fn(), update: jest.fn() },
    inventoryCostLayer: { findMany: jest.fn(), update: jest.fn() },
    inventoryTransaction: { create: jest.fn() },
    productReceiptLine: { findUnique: jest.fn() },
    purchaseParameters: { findFirst: jest.fn() },
    vendorOpenTransaction: { create: jest.fn(), findFirst: jest.fn() },
    vendorSettlement: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    ...overrides,
  };
}

function runInTx<T>(fn: (tx: any) => Promise<T>) {
  (db.$transaction as jest.Mock).mockImplementation((cb: any) => cb(makeTx()));
  return fn(makeTx());
}

// ── createReturnFromInvoice ───────────────────────────────────────────────────

describe('createReturnFromInvoice', () => {
  const tenantId = 'tenant-1';
  const userId = 'user-1';

  it('rejects a non-posted invoice', async () => {
    const tx = makeTx();
    tx.vendorInvoice.findFirst.mockResolvedValue({ id: 'inv-1', status: 'DRAFT', currency: 'BOB', internal_number: 'VI-001', supplier_id: 's-1', lines: [] });
    tx.tenant.findUnique.mockResolvedValue({ currency_code: 'BOB' });
    (db.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

    await expect(
      createReturnFromInvoice(tenantId, userId, { invoice_id: 'inv-1', warehouse_id: 'wh-1', lines: [{ invoice_line_id: 'il-1', quantity: 1 }] }),
    ).rejects.toMatchObject({ code: 'INVOICE_NOT_POSTED' });
  });

  it("rejects an invoice outside the ledger's accounting currency", async () => {
    const tx = makeTx();
    tx.vendorInvoice.findFirst.mockResolvedValue({ id: 'inv-1', status: 'POSTED', currency: 'USD', internal_number: 'VI-001', supplier_id: 's-1', lines: [] });
    tx.tenant.findUnique.mockResolvedValue({ currency_code: 'BOB' });
    (db.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

    await expect(
      createReturnFromInvoice(tenantId, userId, { invoice_id: 'inv-1', warehouse_id: 'wh-1', lines: [{ invoice_line_id: 'il-1', quantity: 1 }] }),
    ).rejects.toMatchObject({ code: 'RETURN_FX_NOT_IMPLEMENTED' });
  });

  it('rejects excess return quantity beyond matched', async () => {
    const tx = makeTx();
    const invoiceLine = {
      id: 'il-1', unit_price: '100', quantity: '5', product_id: 'p-1', variant_id: null,
      line_net_amount: '500', tax_amount: '75',
      matches: [{ receipt_line_id: 'rl-1', quantity: '3', receipt_line: { id: 'rl-1', product_id: 'p-1', variant_id: null, net_unit_cost: '80', receipt: { status: 'POSTED', warehouse_id: 'wh-1' } } }],
    };
    tx.vendorInvoice.findFirst.mockResolvedValue({
      id: 'inv-1', status: 'POSTED', currency: 'BOB', supplier_id: 's-1',
      internal_number: 'VI-001', non_recoverable_tax: 0, tax_amount: 75, total_amount: 575, legal_entity_id: null,
      purchase_order: { warehouse_id: 'wh-1' }, lines: [invoiceLine],
    });
    tx.tenant.findUnique.mockResolvedValue({ currency_code: 'BOB' });
    tx.purchaseReturn.create.mockResolvedValue({ id: 'r-1' });
    // Already 2 returned on this pair
    tx.purchaseReturnLine.aggregate.mockResolvedValue({ _sum: { quantity: 2 } });
    (db.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

    // Try to return 2 more when only 1 remains (3 matched - 2 existing = 1 available)
    await expect(
      createReturnFromInvoice(tenantId, userId, {
        invoice_id: 'inv-1', warehouse_id: 'wh-1',
        lines: [{ invoice_line_id: 'il-1', receipt_line_id: 'rl-1', source_location_id: 'loc-1', quantity: 2 }],
      }),
    ).rejects.toMatchObject({ code: 'EXCESS_RETURN_QUANTITY' });
  });

  it('creates a return with frozen costs from the invoice line', async () => {
    const tx = makeTx();
    const invoiceLine = {
      id: 'il-1', unit_price: '1000', quantity: '5', product_id: 'p-1', variant_id: null,
      line_net_amount: '5000', tax_amount: '750',
      matches: [{ receipt_line_id: 'rl-1', quantity: '5', receipt_line: { id: 'rl-1', product_id: 'p-1', variant_id: null, net_unit_cost: '900', receipt: { status: 'POSTED', warehouse_id: 'wh-1' } } }],
    };
    tx.vendorInvoice.findFirst.mockResolvedValue({
      id: 'inv-1', status: 'POSTED', currency: 'BOB', supplier_id: 's-1',
      internal_number: 'VI-001', non_recoverable_tax: 0, tax_amount: 750, total_amount: 5750, legal_entity_id: null,
      purchase_order: { warehouse_id: 'wh-1' }, lines: [invoiceLine],
    });
    tx.tenant.findUnique.mockResolvedValue({ currency_code: 'BOB' });
    tx.purchaseReturn.create.mockResolvedValue({ id: 'r-1', return_number: 'PR-2026-00001' });
    (db.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

    const result = await createReturnFromInvoice(tenantId, userId, {
      invoice_id: 'inv-1', warehouse_id: 'wh-1',
      lines: [{ invoice_line_id: 'il-1', receipt_line_id: 'rl-1', source_location_id: 'loc-1', quantity: 2 }],
    });

    expect(tx.purchaseReturnLine.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        quantity: 2,
        frozen_gross_unit_cost: 1000,
        original_invoice_line_id: 'il-1',
      }),
    }));
    expect(result).toMatchObject({ return_number: 'PR-2026-00001' });
  });
});

// ── shipReturn ────────────────────────────────────────────────────────────────

describe('shipReturn', () => {
  const tenantId = 'tenant-1';
  const userId = 'user-1';

  it('fails closed when post_product_receipt_in_ledger is off', async () => {
    const tx = makeTx();
    tx.purchaseReturn.findFirst.mockResolvedValue({
      id: 'r-1', tenant_id: tenantId, status: 'DRAFT', return_number: 'PR-2026-00001',
      supplier_id: 's-1', lines: [],
      original_invoice: { purchase_order_id: 'po-1', supplier_id: 's-1', currency: 'BOB' },
    });
    tx.purchaseParameters.findFirst.mockResolvedValue({ post_product_receipt_in_ledger: false });
    (db.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

    await expect(shipReturn(tenantId, userId, 'r-1', {}))
      .rejects.toMatchObject({ code: 'RECEIPT_LEDGER_MODE_REQUIRED' });
  });

  it('rejects unavailable stock', async () => {
    const tx = makeTx();
    tx.purchaseReturn.findFirst.mockResolvedValue({
      id: 'r-1', tenant_id: tenantId, status: 'DRAFT', return_number: 'PR-2026-00001',
      supplier_id: 's-1',
      original_invoice: { purchase_order_id: 'po-1', supplier_id: 's-1', currency: 'BOB' },
      lines: [{
        id: 'rl-1', original_receipt_line_id: 'rcl-1', product_id: 'p-1', variant_id: null,
        source_location_id: 'loc-1', quantity: 5,
        frozen_net_unit_cost: '86.957', frozen_gross_unit_cost: '100',
      }],
    });
    tx.purchaseParameters.findFirst.mockResolvedValue({ post_product_receipt_in_ledger: true });
    tx.tenant.findUnique.mockResolvedValue({ currency_code: 'BOB' });
    // Only 3 available, 1 reserved = 2 unreserved – not enough for quantity 5
    tx.inventoryStock.findFirst.mockResolvedValue({ id: 'is-1', quantity: 3, reserved_qty: 1 });
    (db.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

    await expect(shipReturn(tenantId, userId, 'r-1', {}))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  it('rejects when no PO-origin cost layers exist', async () => {
    const tx = makeTx();
    tx.purchaseReturn.findFirst.mockResolvedValue({
      id: 'r-1', tenant_id: tenantId, status: 'DRAFT', return_number: 'PR-2026-00001',
      supplier_id: 's-1',
      original_invoice: { purchase_order_id: 'po-1', supplier_id: 's-1', currency: 'BOB' },
      lines: [{
        id: 'rl-1', original_receipt_line_id: 'rcl-1', product_id: 'p-1', variant_id: null,
        source_location_id: 'loc-1', quantity: 2,
        frozen_net_unit_cost: '86.957', frozen_gross_unit_cost: '100',
      }],
    });
    tx.purchaseParameters.findFirst.mockResolvedValue({ post_product_receipt_in_ledger: true });
    tx.tenant.findUnique.mockResolvedValue({ currency_code: 'BOB' });
    tx.inventoryStock.findFirst.mockResolvedValue({ id: 'is-1', quantity: 10, reserved_qty: 0 });
    tx.productReceiptLine.findUnique.mockResolvedValue({ receipt: { purchase_order_id: 'po-1' } });
    tx.inventoryCostLayer.findMany.mockResolvedValue([]); // no layers
    (db.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

    await expect(shipReturn(tenantId, userId, 'r-1', {}))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_PO_COST_LAYERS' });
  });
});

// ── postCredit ────────────────────────────────────────────────────────────────

describe('postCredit', () => {
  const tenantId = 'tenant-1';
  const userId = 'user-1';

  it('rejects posting an already-posted credit', async () => {
    const tx = makeTx();
    tx.supplierCredit.findFirst.mockResolvedValue({
      id: 'sc-1', status: 'POSTED', currency: 'BOB',
      credit_number: 'SC-2026-00001', supplier_id: 's-1',
      external_credit_number: 'SUP-CR-1', legal_entity_id: null,
      purchase_return: { id: 'r-1', status: 'SHIPPED' },
      lines: [{ return_line_id: 'return-line-1', quantity: 1 }],
      net_amount: '869.57', tax_amount: '130.43', total_amount: '1000',
      original_invoice_id: 'inv-1', credit_date: new Date(), posting_date: new Date(),
    });
    tx.tenant.findUnique.mockResolvedValue({ currency_code: 'BOB' });
    (db.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

    await expect(postCredit(tenantId, userId, 'sc-1'))
      .rejects.toMatchObject({ code: 'CREDIT_NOT_DRAFT' });
  });

  it('posts voucher Dr AP / Cr PURCHASE_ACCRUAL / Cr VAT_INPUT and creates DEBIT open tx', async () => {
    const { postJournal } = require('../shared/services/journal.service');
    const tx = makeTx();
    tx.supplierCredit.findFirst.mockResolvedValue({
      id: 'sc-1', status: 'DRAFT', currency: 'BOB',
      credit_number: 'SC-2026-00001', supplier_id: 's-1',
      external_credit_number: 'SUP-CR-1', legal_entity_id: null,
      purchase_return: { id: 'r-1', status: 'SHIPPED' },
      lines: [{ return_line_id: 'return-line-1', quantity: 1 }],
      net_amount: '869.57', tax_amount: '130.43', total_amount: '1000',
      original_invoice_id: 'inv-1', credit_date: new Date(), posting_date: new Date(),
    });
    tx.tenant.findUnique.mockResolvedValue({ currency_code: 'BOB' });
    resolvePostingAccounts_orExplain.mockResolvedValue({
      AP: 'acct-ap', PURCHASE_ACCRUAL: 'acct-pa', VAT_INPUT: 'acct-vi',
    });
    tx.vendorOpenTransaction.findFirst.mockResolvedValue({
      id: 'ot-inv-1', amount: '2000', direction: 'CREDIT', supplier_id: 's-1',
      legal_entity_id: null, currency: 'BOB',
      // WORK-024b: the AP subledger carries the reporting basis too.
      amount_reporting: expect.anything(), exchange_rate_reporting: expect.anything(),
    });
    tx.vendorOpenTransaction.create.mockResolvedValue({ id: 'ot-sc-1' });
    tx.supplierCredit.update.mockResolvedValue({});
    (db.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

    await postCredit(tenantId, userId, 'sc-1');

    const { postJournal: pj } = require('../shared/services/journal.service');
    expect(postJournal).toHaveBeenCalledWith(expect.objectContaining({
      lines: expect.arrayContaining([
        expect.objectContaining({ accountId: 'acct-ap', debit: 1000 }),
        expect.objectContaining({ accountId: 'acct-pa', credit: 80 }),
        expect.objectContaining({ accountId: 'acct-vi', credit: 130.43 }),
      ]),
    }));
    expect(tx.vendorOpenTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ direction: 'DEBIT', source_type: 'SUPPLIER_CREDIT', amount: 1000 }),
    }));
  });

  it('settles the credit against the original invoice open transaction', async () => {
    const tx = makeTx();
    tx.supplierCredit.findFirst.mockResolvedValue({
      id: 'sc-1', status: 'DRAFT', currency: 'BOB',
      credit_number: 'SC-2026-00001', supplier_id: 's-1',
      external_credit_number: 'SUP-CR-1', legal_entity_id: null,
      purchase_return: { id: 'r-1', status: 'SHIPPED' },
      lines: [{ return_line_id: 'return-line-1', quantity: 1 }],
      net_amount: '869.57', tax_amount: '130.43', total_amount: '1000',
      original_invoice_id: 'inv-1', credit_date: new Date(), posting_date: new Date(),
    });
    tx.tenant.findUnique.mockResolvedValue({ currency_code: 'BOB' });
    resolvePostingAccounts_orExplain.mockResolvedValue({
      AP: 'acct-ap', PURCHASE_ACCRUAL: 'acct-pa', VAT_INPUT: 'acct-vi',
    });
    // Invoice has open amount 2000; credit is 1000 → settle 1000
    tx.vendorOpenTransaction.findFirst.mockResolvedValue({
      id: 'ot-inv-1', amount: '2000', direction: 'CREDIT', supplier_id: 's-1',
      legal_entity_id: null, currency: 'BOB',
      // WORK-024b: the AP subledger carries the reporting basis too.
      amount_reporting: expect.anything(), exchange_rate_reporting: expect.anything(),
    });
    tx.vendorSettlement.findMany.mockResolvedValue([]);
    tx.vendorOpenTransaction.create.mockResolvedValue({ id: 'ot-sc-1' });
    tx.supplierCredit.update.mockResolvedValue({});
    (db.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

    await postCredit(tenantId, userId, 'sc-1');

    expect(tx.vendorSettlement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        debit_transaction_id: 'ot-sc-1',
        credit_transaction_id: 'ot-inv-1',
        amount: 1000,
      }),
    }));
  });
});
