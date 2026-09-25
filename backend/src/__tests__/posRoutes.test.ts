/**
 * POS SALE, VOID AND CLOSE ROUTES (WORK-047 review)
 *
 *   - a tender refusal happens before the FACTURA number is drawn;
 *   - sale, void and close lock the register session before anything else;
 *   - a void of a sale whose register is closed runs nothing inside its transaction;
 *   - a void whose voucher reversal fails annuls nothing: no factura cancel, no tender reversal;
 *   - a factura is not annulled when there is no sale voucher to reverse (strict posting).
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import posRoutes from '../modules/pos/pos.routes';
import paymentMethodRoutes from '../modules/sales/salesPaymentMethod.routes';
import { nextFacturaNumber } from '../shared/services/numberSequence.service';
import { reverseJournal } from '../shared/services/journal.service';
import { restoreIssues } from '../shared/services/stockLedger.service';
import { db } from '../infrastructure/database/client';
import { errorHandler } from '../shared/middleware/errorHandler';
import type { AppEnv } from '../shared/context';

jest.mock('../infrastructure/database/client', () => {
  const m: any = {
    $queryRaw: jest.fn(),
    salesOrder: { findFirst: jest.fn(), updateMany: jest.fn() },
    registerSession: { findFirst: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn() },
    account: { findFirst: jest.fn() },
    salesPaymentMethod: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    posTender: { findMany: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    registerSessionDeclaration: { create: jest.fn() },
    inventoryTransaction: { findMany: jest.fn() },
    journalEntry: { findMany: jest.fn() },
    factura: { updateMany: jest.fn() },
    salesParameters: { findFirst: jest.fn() },
    financeParameters: { findFirst: jest.fn() },
  };
  m.$transaction = jest.fn((fn: any) => fn(m));
  return { db: m };
});
jest.mock('../shared/services/numberSequence.service', () => ({ nextFacturaNumber: jest.fn(), allocateNumber: jest.fn() }));
jest.mock('../shared/utils/orderCounter', () => ({ nextSalesOrderNumber: jest.fn().mockResolvedValue('SO-2026-00001') }));
jest.mock('../shared/services/currency/ledgerCurrency.service', () => ({
  getLedgerCurrencies: jest.fn().mockResolvedValue({ accountingCurrency: 'BOB', reportingCurrency: 'BOB' }),
}));
jest.mock('../shared/services/journal.service', () => ({ postJournal: jest.fn(), reverseJournal: jest.fn() }));
jest.mock('../shared/services/stockLedger.service', () => ({ issueAvailable: jest.fn(), restoreIssues: jest.fn() }));

const mdb = db as any;
const TENANT = 'tenant-1';
const SESSION = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';
const PRODUCT = '33333333-3333-4333-8333-333333333333';
const CASH = '44444444-4444-4444-8444-444444444444';

function mount(role: string, router: any = posRoutes) {
  const app = new Hono<AppEnv>();
  const identity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'user-1', email: 't@t.com', role, tenantId: TENANT });
    c.set('tenantId', TENANT);
    await next();
  };
  app.use('*', identity);
  app.route('/', router);
  app.onError(errorHandler);
  return app;
}
const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  mdb.$queryRaw.mockResolvedValue([{ id: SESSION, status: 'OPEN' }]);
  mdb.salesParameters.findFirst.mockResolvedValue({ pos_void_mode: 'ANNUL_IN_SESSION' });
});

describe('POS sale', () => {
  it('refuses tenders that do not add up before drawing a FACTURA number, after locking the register', async () => {
    mdb.registerSession.findFirst.mockResolvedValue({ id: SESSION, warehouse_id: 'wh-1', terminal_name: 'T1', status: 'OPEN' });
    mdb.salesPaymentMethod.findMany.mockResolvedValue([{ id: CASH, code: 'CASH', tender_type: 'CASH', account_id: 'acc-cash', allow_change: true }]);
    const res = await mount('cashier').request('/sale', post({
      session_id: SESSION, tenders: [{ payment_method_id: CASH, amount: 5, tendered: 5 }],
      lines: [{ product_id: PRODUCT, quantity: 1, unit_price: 10 }],
    }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe('TENDER_TOTAL_MISMATCH');
    expect(nextFacturaNumber).not.toHaveBeenCalled();
    expect(mdb.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mdb.registerSession.findFirst.mock.invocationCallOrder[0]);
  });

  it('refuses a sale into a register the lock finds closed, before a FACTURA number', async () => {
    mdb.$queryRaw.mockResolvedValue([{ id: SESSION, status: 'CLOSED' }]);
    const res = await mount('cashier').request('/sale', post({
      session_id: SESSION, payment_method: 'CASH', lines: [{ product_id: PRODUCT, quantity: 1, unit_price: 10 }],
    }));
    expect(res.status).toBe(400);
    expect(nextFacturaNumber).not.toHaveBeenCalled();
    expect(mdb.salesPaymentMethod.findMany).not.toHaveBeenCalled();
  });
});

describe('POS void', () => {
  const order = { id: ORDER, order_number: 'SO-1', status: 'COMPLETED', source: 'pos', register_session_id: SESSION, invoice_id: 'fac-1', total_amount: 10, lines: [] };

  it('refuses a void when the register is closed and runs nothing in the transaction', async () => {
    mdb.salesOrder.findFirst.mockResolvedValue(order);
    mdb.registerSession.findFirst.mockResolvedValue({ id: SESSION, status: 'CLOSED' });
    const res = await mount('store_manager').request(`/sales/${ORDER}/void`, post({ reason: 'Wrong item' }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe('POS_VOID_SESSION_CLOSED');
    expect(mdb.$transaction).not.toHaveBeenCalled();
    expect(mdb.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('re-checks under the lock: a close that committed meanwhile wins', async () => {
    mdb.salesOrder.findFirst.mockResolvedValue(order);
    mdb.registerSession.findFirst.mockResolvedValue({ id: SESSION, status: 'OPEN' });
    mdb.$queryRaw.mockResolvedValue([{ id: SESSION, status: 'CLOSED' }]);
    const res = await mount('store_manager').request(`/sales/${ORDER}/void`, post({ reason: 'Wrong item' }));
    expect(res.status).toBe(409);
    expect(mdb.salesOrder.updateMany).not.toHaveBeenCalled();
    expect(restoreIssues).not.toHaveBeenCalled();
  });

  it('annuls nothing when the voucher reversal fails', async () => {
    mdb.salesOrder.findFirst.mockResolvedValue(order);
    mdb.registerSession.findFirst.mockResolvedValue({ id: SESSION, status: 'OPEN' });
    mdb.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    mdb.inventoryTransaction.findMany.mockResolvedValue([{ id: 'it-1' }]);
    (restoreIssues as jest.Mock).mockResolvedValue({ transactionIds: ['it-2'] });
    mdb.journalEntry.findMany.mockResolvedValue([{ id: 'je-1', source_module: 'POS_SALE' }]);
    (reverseJournal as jest.Mock).mockRejectedValue(Object.assign(new Error('period closed'), { statusCode: 409 }));
    const res = await mount('store_manager').request(`/sales/${ORDER}/void`, post({ reason: 'Wrong item' }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mdb.factura.updateMany).not.toHaveBeenCalled();
    expect(mdb.posTender.updateMany).not.toHaveBeenCalled();
    expect(mdb.registerSession.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to annul a factura with no sale voucher to reverse under strict posting', async () => {
    mdb.salesOrder.findFirst.mockResolvedValue(order);
    mdb.registerSession.findFirst.mockResolvedValue({ id: SESSION, status: 'OPEN' });
    mdb.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    mdb.inventoryTransaction.findMany.mockResolvedValue([]);
    (restoreIssues as jest.Mock).mockResolvedValue({ transactionIds: [] });
    mdb.journalEntry.findMany.mockResolvedValue([]);
    mdb.financeParameters.findFirst.mockResolvedValue({ require_balanced_posting: true });
    const res = await mount('store_manager').request(`/sales/${ORDER}/void`, post({ reason: 'Wrong item' }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe('POS_VOID_VOUCHER_MISSING');
    expect(mdb.factura.updateMany).not.toHaveBeenCalled();
  });
});

describe('POS close', () => {
  it('locks the register before reading its tenders', async () => {
    mdb.registerSession.findFirst.mockResolvedValue({ id: SESSION, status: 'OPEN', terminal_name: 'T1', opening_float: 0, site_id: null, warehouse_id: 'wh-1' });
    mdb.posTender.findMany.mockResolvedValue([]);
    mdb.salesPaymentMethod.findMany.mockResolvedValue([]);
    mdb.registerSession.updateMany.mockResolvedValue({ count: 1 });
    mdb.registerSession.findUniqueOrThrow.mockResolvedValue({ id: SESSION, closed_at: new Date(), closing_float: 0 });
    const res = await mount('cashier').request(`/sessions/${SESSION}/close`, post({ closing_float: 0 }));
    expect(res.status).toBe(200);
    expect(mdb.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mdb.posTender.findMany.mock.invocationCallOrder[0]);
  });

  it('answers a close of an already closed register with 409, reading nothing', async () => {
    mdb.$queryRaw.mockResolvedValue([{ id: SESSION, status: 'CLOSED' }]);
    const res = await mount('cashier').request(`/sessions/${SESSION}/close`, post({ closing_float: 0 }));
    expect(res.status).toBe(409);
    expect(mdb.posTender.findMany).not.toHaveBeenCalled();
  });

  it('refuses a declaration for a method the register does not count', async () => {
    mdb.registerSession.findFirst.mockResolvedValue({ id: SESSION, status: 'OPEN', terminal_name: 'T1', opening_float: 0, site_id: null, warehouse_id: 'wh-1' });
    mdb.posTender.findMany.mockResolvedValue([]);
    mdb.salesPaymentMethod.findMany.mockResolvedValue([]);
    const res = await mount('cashier').request(`/sessions/${SESSION}/close`, post({ declarations: [{ payment_method_id: CASH, counted: 10 }] }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe('DECLARATION_UNKNOWN_METHOD');
    expect(mdb.registerSession.updateMany).not.toHaveBeenCalled();
  });
});

describe('sales payment method account change', () => {
  const NEW_ACCOUNT = '55555555-5555-4555-8555-555555555555';
  beforeEach(() => {
    mdb.salesPaymentMethod.findFirst.mockResolvedValue({ id: CASH, code: 'CASH', tender_type: 'CASH', account_id: 'acc-old' });
    mdb.account.findFirst.mockResolvedValue({ id: NEW_ACCOUNT, category: 'CASH' });
  });

  it('refuses to move a method to another account while an open register holds its takings', async () => {
    mdb.posTender.count.mockResolvedValue(2);
    const res = await mount('admin', paymentMethodRoutes).request(`/${CASH}`, { ...post({ account_id: NEW_ACCOUNT }), method: 'PUT' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe('PAYMENT_METHOD_IN_USE');
    expect(mdb.salesPaymentMethod.update).not.toHaveBeenCalled();
    // The open registers were locked before the tender count.
    expect(mdb.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mdb.posTender.count.mock.invocationCallOrder[0]);
  });

  it('allows it once no open register holds its takings', async () => {
    mdb.posTender.count.mockResolvedValue(0);
    mdb.salesPaymentMethod.update.mockResolvedValue({ id: CASH });
    const res = await mount('admin', paymentMethodRoutes).request(`/${CASH}`, { ...post({ account_id: NEW_ACCOUNT }), method: 'PUT' });
    expect(res.status).toBe(200);
  });
});
