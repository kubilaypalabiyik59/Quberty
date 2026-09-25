/**
 * CURRENCY FOUNDATION — ROUTES AND SEGREGATION OF DUTIES (WORK-024a)
 *
 * Kubi's decisions (2026-09-11):
 *   - the ledger's currencies, activating currencies and rate types are accounting
 *     setup — administrators only;
 *   - store managers and finance approvers may ADD dated exchange rates, and only
 *     add: correcting an existing rate is an administrator action;
 *   - AP clerks, buyers and auditors may read; cashiers see nothing.
 * Every denial happens before any database or service call.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import currencyRoutes, { CURRENCY_ROUTE_PERMISSIONS } from '../modules/finance/currency.routes';
import { errorHandler } from '../shared/middleware/errorHandler';
import { hasPermission } from '../shared/middleware/permissions';
import { db } from '../infrastructure/database/client';
import { setLedgerCurrencies } from '../shared/services/currency/ledgerCurrency.service';
import { addExchangeRate, updateExchangeRate } from '../shared/services/currency/exchangeRate.service';
import type { AppEnv } from '../shared/context';

jest.mock('../infrastructure/database/client', () => ({
  db: {
    journalEntry:      { count: jest.fn() },
    exchangeRateType:  { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    tenantCurrency:    { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    currency:          { findMany: jest.fn(), findUnique: jest.fn() },
    financeParameters: { count: jest.fn() },
    exchangeRate:      { findMany: jest.fn() },
  },
}));
jest.mock('../shared/services/currency/ledgerCurrency.service', () => ({
  getLedgerCurrencies: jest.fn(),
  setLedgerCurrencies: jest.fn().mockResolvedValue({ accountingCurrency: 'BOB' }),
  hasLedgerActivity: jest.fn(),
}));
jest.mock('../shared/services/currency/exchangeRate.service', () => ({
  addExchangeRate: jest.fn().mockResolvedValue({ id: 'rate-1' }),
  updateExchangeRate: jest.fn().mockResolvedValue({ id: 'rate-1' }),
  resolveRate: jest.fn(),
  translate: jest.fn(),
}));

const mocked = db as any;

function appFor(role: string) {
  const app = new Hono<AppEnv>();
  const setIdentity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'user-1', email: 'x@x.com', role, tenantId: 'tenant-1' });
    c.set('tenantId', 'tenant-1');
    await next();
  };
  app.use('*', setIdentity);
  app.route('/', currencyRoutes);
  app.onError(errorHandler);
  return app;
}

const json = (method: string, body: unknown) => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

const RATE_TYPE = '33333333-3333-4333-8333-333333333333';
const RATE_ID = '44444444-4444-4444-8444-444444444444';
const validRate = { rate_type_id: RATE_TYPE, from_currency_code: 'USD', to_currency_code: 'BOB', valid_from: '2026-09-11', rate: 6.96 };
const validLedger = { accounting_currency_code: 'BOB', reporting_currency_code: 'BOB', accounting_rate_type_id: RATE_TYPE };

const anyTouched = () =>
  Object.values(mocked).flatMap((model: any) => Object.values(model)).some((fn: any) => fn.mock.calls.length > 0) ||
  (setLedgerCurrencies as jest.Mock).mock.calls.length > 0 ||
  (addExchangeRate as jest.Mock).mock.calls.length > 0 ||
  (updateExchangeRate as jest.Mock).mock.calls.length > 0;

beforeEach(() => jest.clearAllMocks());

describe('permission map', () => {
  it('publishes the exact route → permission contract', () => {
    expect(CURRENCY_ROUTE_PERMISSIONS).toEqual({
      'GET /ledger-currencies':       ['finance.currency.read'],
      'PUT /ledger-currencies':       ['finance.setup.maintain'],
      'GET /currencies':              ['finance.currency.read'],
      'GET /currencies/iso':          ['finance.currency.read'],
      'POST /currencies':             ['finance.setup.maintain'],
      'PUT /currencies/:code':        ['finance.setup.maintain'],
      'GET /exchange-rate-types':     ['finance.currency.read'],
      'POST /exchange-rate-types':    ['finance.setup.maintain'],
      'PUT /exchange-rate-types/:id': ['finance.setup.maintain'],
      'GET /exchange-rates':          ['finance.currency.read'],
      'GET /exchange-rates/resolve':  ['finance.currency.read'],
      'POST /exchange-rates':         ['finance.exchange_rate.maintain'],
      'PUT /exchange-rates/:id':      ['finance.setup.maintain'],
    });
  });

  it.each([
    ['admin',            true,  true,  true],
    ['store_manager',    true,  true,  false],
    ['finance_approver', true,  true,  false],
    ['ap_clerk',         true,  false, false],
    ['buyer',            true,  false, false],
    ['auditor',          true,  false, false],
    ['cashier',          false, false, false],
    ['warehouse_worker', false, false, false],
  ])('%s: read=%s addRate=%s setup=%s', (role, read, add, setup) => {
    expect(hasPermission(role, 'finance.currency.read')).toBe(read);
    expect(hasPermission(role, 'finance.exchange_rate.maintain')).toBe(add);
    expect(hasPermission(role, 'finance.setup.maintain')).toBe(setup);
  });
});

describe('segregation of duties on the routes', () => {
  it.each(['cashier', 'customer', 'unregistered-role'])('denies %s everywhere before any database call', async (role) => {
    const app = appFor(role);
    expect((await app.request('/ledger-currencies')).status).toBe(403);
    expect((await app.request('/ledger-currencies', json('PUT', validLedger))).status).toBe(403);
    expect((await app.request('/currencies')).status).toBe(403);
    expect((await app.request('/exchange-rates')).status).toBe(403);
    expect((await app.request('/exchange-rates', json('POST', validRate))).status).toBe(403);
    expect(anyTouched()).toBe(false);
  });

  it.each(['store_manager', 'finance_approver'])('lets %s add a dated rate, but not back-date one', async (role) => {
    const res = await appFor(role).request('/exchange-rates', json('POST', validRate));
    expect(res.status).toBe(201);
    expect(addExchangeRate).toHaveBeenCalledWith('tenant-1', 'user-1', validRate, { canBackdate: false });
  });

  it('lets an admin back-date a rate', async () => {
    expect((await appFor('admin').request('/exchange-rates', json('POST', validRate))).status).toBe(201);
    expect(addExchangeRate).toHaveBeenCalledWith('tenant-1', 'user-1', validRate, { canBackdate: true });
  });

  it.each(['store_manager', 'finance_approver'])('refuses %s correcting a rate or changing accounting setup', async (role) => {
    const app = appFor(role);
    expect((await app.request(`/exchange-rates/${RATE_ID}`, json('PUT', { rate: 7 }))).status).toBe(403);
    expect((await app.request('/ledger-currencies', json('PUT', validLedger))).status).toBe(403);
    expect((await app.request('/currencies', json('POST', { currency_code: 'USD' }))).status).toBe(403);
    expect((await app.request('/exchange-rate-types', json('POST', { code: 'BCB', name: 'BCB' }))).status).toBe(403);
    expect(anyTouched()).toBe(false);
  });

  it('lets an AP clerk read rates but not add one', async () => {
    mocked.exchangeRate.findMany.mockResolvedValue([]);
    const app = appFor('ap_clerk');
    expect((await app.request('/exchange-rates')).status).toBe(200);
    expect((await app.request('/exchange-rates', json('POST', validRate))).status).toBe(403);
    expect(addExchangeRate).not.toHaveBeenCalled();
  });

  it('lets an admin correct a rate and set the ledger, keyed by the token tenant', async () => {
    const app = appFor('admin');
    expect((await app.request(`/exchange-rates/${RATE_ID}`, json('PUT', { rate: 7 }))).status).toBe(200);
    expect(updateExchangeRate).toHaveBeenCalledWith('tenant-1', 'user-1', RATE_ID, { rate: 7 });
    expect((await app.request('/ledger-currencies', json('PUT', validLedger))).status).toBe(200);
    expect(setLedgerCurrencies).toHaveBeenCalledWith('tenant-1', validLedger);
  });
});

describe('validation', () => {
  it.each([
    ['an unknown key', { ...validLedger, tenant_id: 'x' }],
    ['a lowercase code', { ...validLedger, accounting_currency_code: 'bob' }],
    ['a missing rate type', { accounting_currency_code: 'BOB', reporting_currency_code: 'BOB' }],
  ])('rejects %s on the ledger body', async (_label, body) => {
    expect((await appFor('admin').request('/ledger-currencies', json('PUT', body))).status).toBe(400);
    expect(setLedgerCurrencies).not.toHaveBeenCalled();
  });

  it.each([
    ['a zero rate', { ...validRate, rate: 0 }],
    ['a negative rate', { ...validRate, rate: -1 }],
    ['a bad date', { ...validRate, valid_from: '11/09/2026' }],
    ['a fractional factor', { ...validRate, conversion_factor: 1.5 }],
  ])('rejects %s', async (_label, body) => {
    expect((await appFor('admin').request('/exchange-rates', json('POST', body))).status).toBe(400);
    expect(addExchangeRate).not.toHaveBeenCalled();
  });

  it('refuses deactivating a ledger currency', async () => {
    mocked.financeParameters.count.mockResolvedValue(1);
    const res = await appFor('admin').request('/currencies/BOB', json('PUT', { is_active: false }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CURRENCY_IN_USE_BY_LEDGER');
    expect(mocked.tenantCurrency.updateMany).not.toHaveBeenCalled();
  });

  it('refuses activating a currency with more than two decimals', async () => {
    mocked.currency.findUnique.mockResolvedValue({ code: 'KWD', name: 'Kuwaiti Dinar', minor_unit: 3 });
    const res = await appFor('admin').request('/currencies', json('POST', { currency_code: 'KWD' }));
    expect(res.status).toBe(422);
    expect(mocked.tenantCurrency.create).not.toHaveBeenCalled();
  });
});
