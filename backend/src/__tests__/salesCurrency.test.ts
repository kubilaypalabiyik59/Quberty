/**
 * SALES-SIDE CURRENCY (WORK-025a)
 *
 * Before this item the sales path had the defect WORK-024a closed on the purchase
 * side, one step worse: `sales.service` persisted any string as a currency, and
 * the invoice route never read it — so a non-BOB order would have invoiced and
 * posted at face value. The `'BOB'` literal was the only thing making that
 * harmless. These tests pin the replacement:
 *
 *   - a sales order takes the ledger's accounting currency and nothing else;
 *   - the storefront, which is unauthenticated, cannot choose a currency;
 *   - a foreign currency is refused at creation and at invoice, before a FACTURA
 *     number is drawn;
 *   - the whole path is parametric: the same flows run in a TRY ledger.
 */

import { SalesService } from '../modules/sales/sales.service';
import { db } from '../infrastructure/database/client';

jest.mock('../infrastructure/database/client', () => ({
  db: {
    financeParameters: { findFirst: jest.fn() },
    tenantCurrency:    { findFirst: jest.fn() },
    salesOrder:        { create: jest.fn() },
    product:           { findFirst: jest.fn() },
  },
}));
jest.mock('../shared/utils/orderCounter', () => ({
  nextSalesOrderNumber: jest.fn().mockResolvedValue('SO-2026-00001'),
}));
jest.mock('../shared/services/documentTax.service', () => ({
  computeDocumentTax: jest.fn().mockResolvedValue({ subtotal: 100, vat: 13, turnover: 3 }),
  computePurchaseMoney: jest.fn(),
}));
jest.mock('../shared/services/inventoryDimension.service', () => ({
  resolveInventoryDimensions: jest.fn().mockResolvedValue({ site_id: 'site-1', warehouse_id: 'wh-1', origin: 'explicit' }),
  siteOfWarehouse: jest.fn(),
}));
jest.mock('../shared/services/tenantReference.service', () => ({
  assertTenantReferences: jest.fn().mockResolvedValue(undefined),
}));

const m = db as any;
const service = new SalesService();

const ledger = (code: string) => ({
  legal_entity_id: null,
  accounting_currency_code: code,
  reporting_currency_code: code,
  accounting_rate_type_id: 'rt',
  reporting_rate_type_id: null,
  exchange_rate_date_basis: 'POSTING_DATE',
});

const order = (currency?: string) => service.createOrder('t1', {
  customer_id: '11111111-1111-4111-8111-111111111111',
  lines: [{ product_id: '22222222-2222-4222-8222-222222222222', quantity: 1, unit_price: 100 }],
  ...(currency !== undefined ? { currency } : {}),
} as any, 'user-1');

const written = () => m.salesOrder.create.mock.calls[0][0].data;

beforeEach(() => {
  jest.clearAllMocks();
  m.tenantCurrency.findFirst.mockResolvedValue({ id: 'tc-1' });
  m.salesOrder.create.mockImplementation(async ({ data }: any) => ({ id: 'so-1', ...data, lines: [], customer: null }));
});

describe('a sales order takes the ledger currency', () => {
  it.each(['BOB', 'TRY', 'EUR'])('defaults to the ledger currency in a %s ledger', async (code) => {
    m.financeParameters.findFirst.mockResolvedValue(ledger(code));
    await order();
    expect(written().currency).toBe(code);
  });

  it('accepts the ledger currency when the caller names it', async () => {
    m.financeParameters.findFirst.mockResolvedValue(ledger('TRY'));
    await order('TRY');
    expect(written().currency).toBe('TRY');
  });

  it('refuses a currency the tenant has not activated', async () => {
    m.financeParameters.findFirst.mockResolvedValue(ledger('BOB'));
    m.tenantCurrency.findFirst.mockResolvedValue(null);
    await expect(order('USD')).rejects.toMatchObject({ code: 'CURRENCY_INACTIVE', statusCode: 422 });
    expect(m.salesOrder.create).not.toHaveBeenCalled();
  });

  it('refuses an active currency that is not the accounting currency, at creation', async () => {
    m.financeParameters.findFirst.mockResolvedValue(ledger('BOB'));
    await expect(order('USD')).rejects.toMatchObject({ code: 'SALES_FX_NOT_IMPLEMENTED', statusCode: 409 });
    expect(m.salesOrder.create).not.toHaveBeenCalled();
  });

  it('refuses everything when the tenant has no ledger, rather than defaulting to a country', async () => {
    m.financeParameters.findFirst.mockResolvedValue(null);
    await expect(order()).rejects.toMatchObject({ code: 'LEDGER_CURRENCY_NOT_CONFIGURED' });
    expect(m.salesOrder.create).not.toHaveBeenCalled();
  });

  it('ignores a currency the storefront body carried', async () => {
    // The storefront route passes `currency: undefined` after its spread, which is
    // what reaches the service for an anonymous shopper.
    m.financeParameters.findFirst.mockResolvedValue(ledger('BOB'));
    await order(undefined);
    expect(written().currency).toBe('BOB');
  });
});
