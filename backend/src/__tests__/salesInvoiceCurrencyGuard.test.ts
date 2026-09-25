/**
 * THE SALES GUARDS FIRE BEFORE A FACTURA NUMBER IS DRAWN (WORK-025a)
 *
 * Bolivia's factura series is continuous, so a refusal that happens after the
 * number is allocated leaves a legal gap. The invoice, payment and credit-note
 * routes therefore check the document currency before their transaction opens.
 *
 * Reading the code proves the order today; this test keeps it that way. Move a
 * guard below `nextFacturaNumber` and these assertions fail.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import salesRoutes from '../modules/sales/sales.routes';
import { errorHandler } from '../shared/middleware/errorHandler';
import { db } from '../infrastructure/database/client';
import { nextFacturaNumber } from '../shared/services/numberSequence.service';
import type { AppEnv } from '../shared/context';

jest.mock('../infrastructure/database/client', () => {
  const m: any = {
    salesOrder:        { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    salesOrderLine:    { findMany: jest.fn().mockResolvedValue([]) },
    factura:           { create: jest.fn(), findFirst: jest.fn() },
    financeParameters: { findFirst: jest.fn() },
    account:           { findFirst: jest.fn() },
    inventoryStock:    { findFirst: jest.fn() },
  };
  m.$transaction = jest.fn((fn: any) => fn(m));
  return { db: m };
});
jest.mock('../shared/services/numberSequence.service', () => ({
  nextFacturaNumber: jest.fn().mockResolvedValue('000099'),
  allocateNumber: jest.fn(),
  nextJournalVoucher: jest.fn(),
}));
jest.mock('../shared/services/itemPolicy.service', () => ({
  resolveItemPolicies: jest.fn().mockResolvedValue(new Map()),
  groupByItemGroup: jest.fn(),
}));
jest.mock('../shared/services/documentTax.service', () => ({
  computeDocumentTax: jest.fn().mockResolvedValue({ subtotal: 100, vat: 13, turnover: 3 }),
  computePurchaseMoney: jest.fn(),
}));
jest.mock('../shared/services/posting.service', () => ({
  resolvePostingAccounts_orExplain: jest.fn().mockResolvedValue(null),
}));
jest.mock('../shared/services/journal.service', () => ({ postJournal: jest.fn(), reverseJournal: jest.fn() }));
jest.mock('../shared/services/facturaLine.service', () => ({
  linesFromSalesOrder: jest.fn().mockResolvedValue([]),
  writeFacturaLines: jest.fn(),
  markInvoiced: jest.fn(),
}));
jest.mock('../shared/services/dimension.service', () => ({
  contextForSalesOrder: jest.fn().mockResolvedValue({}),
  EMPTY_SLOTS: {},
  resolveDimensions: jest.fn(),
  assertRequiredDimensions: jest.fn(),
}));
jest.mock('../shared/services/inventoryDimension.service', () => ({
  resolveInventoryDimensions: jest.fn().mockResolvedValue({ warehouse_id: 'wh-1', site_id: 'site-1', origin: 'explicit' }),
  siteOfWarehouse: jest.fn(),
}));

const m = db as any;
const TENANT = 'tenant-1';
const ORDER = '33333333-3333-4333-8333-333333333333';

function app() {
  const a = new Hono<AppEnv>();
  const identity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'user-1', email: 'a@a.com', role: 'admin', tenantId: TENANT });
    c.set('tenantId', TENANT);
    c.set('taxConfig', null);
    await next();
  };
  a.use('*', identity);
  a.route('/', salesRoutes);
  a.onError(errorHandler);
  return a;
}

const post = (path: string, body: unknown) => app().request(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  jest.clearAllMocks();
  m.salesOrderLine.findMany.mockResolvedValue([]);
  // A BOB ledger, and an order that somehow carries USD — the state WORK-026 will
  // support and this release must refuse.
  m.financeParameters.findFirst.mockResolvedValue({
    legal_entity_id: null,
    accounting_currency_code: 'BOB',
    reporting_currency_code: 'BOB',
    accounting_rate_type_id: 'rt-1',
    reporting_rate_type_id: null,
    exchange_rate_date_basis: 'POSTING_DATE',
  });
});

describe('a foreign-currency order is refused before the FACTURA series is touched', () => {
  it('on the invoice route', async () => {
    m.salesOrder.findFirst.mockResolvedValue({
      id: ORDER, order_number: 'SO-1', status: 'SHIPPED', currency: 'USD',
      invoice_id: null, shipped_at: new Date(), total_amount: 116, customer_id: null, customer: null,
      shipping_address: null,
    });

    const res = await post(`/${ORDER}/invoice`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe('SALES_FX_NOT_IMPLEMENTED');
    expect(nextFacturaNumber).not.toHaveBeenCalled();
    expect(m.factura.create).not.toHaveBeenCalled();
  });

  it('on the AR payment route', async () => {
    m.salesOrder.findFirst.mockResolvedValue({
      id: ORDER, order_number: 'SO-1', status: 'SHIPPED', currency: 'USD',
      invoice_id: 'f-1', paid_at: null, total_amount: 116, customer_id: null, customer: null,
    });

    const res = await post(`/${ORDER}/pay`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe('SALES_FX_NOT_IMPLEMENTED');
    expect(m.salesOrder.update).not.toHaveBeenCalled();
  });

  it('lets the ledger currency through to the next step', async () => {
    // Same order in BOB: the guard passes and the route continues — it fails later
    // for an unrelated reason, which is enough to prove the currency check is not
    // what stopped it.
    m.salesOrder.findFirst.mockResolvedValue({
      id: ORDER, order_number: 'SO-1', status: 'SHIPPED', currency: 'BOB',
      invoice_id: 'f-1', paid_at: null, total_amount: 116, customer_id: null, customer: null,
    });
    m.account.findFirst.mockResolvedValue(null);

    const res = await post(`/${ORDER}/pay`, {});
    expect(res.status).not.toBe(409);
  });
});
