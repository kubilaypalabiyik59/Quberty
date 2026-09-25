/**
 * CURRENCY FOUNDATION — SERVICES (WORK-024a)
 *
 * Pins the D365 rate rules and the ledger lock:
 *   - the rate used is the latest on or before the date, per tenant and rate type;
 *   - a reciprocal pair is applied by division; no triangulation;
 *   - the same currency needs no rate and no database read;
 *   - a missing rate or an inactive currency fails closed;
 *   - rounding follows the currency's own rule, and BOB half-up equals round2;
 *   - the ledger's currencies lock once anything has posted; re-sending is a no-op;
 *   - a document is supported only in the ledger's accounting currency, whatever
 *     that currency is.
 */

import { Prisma } from '@prisma/client';
import { db } from '../infrastructure/database/client';
import { resolveRate, translate, addExchangeRate, updateExchangeRate } from '../shared/services/currency/exchangeRate.service';
import { roundAmount, precisionForMinorUnit } from '../shared/services/currency/currencyRounding';
import { getLedgerCurrencies, setLedgerCurrencies } from '../shared/services/currency/ledgerCurrency.service';
import { assertDocumentCurrencySupported, resolveDocumentCurrency } from '../shared/services/currency/documentCurrency';

jest.mock('../infrastructure/database/client', () => {
  const m: any = {
    financeParameters:        { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    tenantCurrency:           { findFirst: jest.fn(), findMany: jest.fn() },
    exchangeRateType:         { findFirst: jest.fn() },
    exchangeRateCurrencyPair: { findFirst: jest.fn(), create: jest.fn() },
    exchangeRate:             { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    journalEntry:             { count: jest.fn() },
    inventoryCostLayer:       { count: jest.fn() },
    vendorOpenTransaction:    { count: jest.fn() },
    auditLog:                 { create: jest.fn() },
    tenant:                   { update: jest.fn() },
    $queryRaw:                jest.fn(),
  };
  m.$transaction = jest.fn((cb: any) => cb(m));
  return { db: m };
});

const m = db as any;
const D = (v: string | number) => new Prisma.Decimal(v);
const ledgerRow = (accounting: string, reporting = accounting) => ({
  legal_entity_id: null,
  accounting_currency_code: accounting,
  reporting_currency_code: reporting,
  accounting_rate_type_id: 'rt-acc',
  reporting_rate_type_id: null,
  exchange_rate_date_basis: 'POSTING_DATE',
});

beforeEach(() => {
  jest.clearAllMocks();
  m.financeParameters.findFirst.mockReset();
  m.tenantCurrency.findFirst.mockReset();
  m.tenantCurrency.findMany.mockReset();
  m.exchangeRateCurrencyPair.findFirst.mockReset();
  m.exchangeRate.findFirst.mockReset();
  m.exchangeRateType.findFirst.mockReset();
  m.journalEntry.count.mockReset();
  m.inventoryCostLayer.count.mockReset().mockResolvedValue(0);
  m.vendorOpenTransaction.count.mockReset().mockResolvedValue(0);
  m.$queryRaw.mockReset();
});

describe('resolveRate', () => {
  const date = new Date('2026-09-11T15:30:00.000Z');
  const activeBoth = () => m.tenantCurrency.findMany.mockResolvedValue([{ currency_code: 'USD' }, { currency_code: 'BOB' }]);

  it('returns 1 for the same currency without touching the database', async () => {
    const r = await resolveRate({ tenantId: 't1', rateTypeId: 'rt', from: 'BOB', to: 'BOB', date });
    expect(r.kind).toBe('IDENTITY');
    expect(r.rate.toString()).toBe('1');
    expect(m.tenantCurrency.findMany).not.toHaveBeenCalled();
    expect(m.exchangeRate.findFirst).not.toHaveBeenCalled();
  });

  it('uses the latest rate on or before the date, scoped to tenant and rate type', async () => {
    activeBoth();
    m.exchangeRateCurrencyPair.findFirst.mockResolvedValueOnce({ id: 'p1', conversion_factor: D(1) });
    m.exchangeRate.findFirst.mockResolvedValueOnce({ id: 'r1', rate: D('6.96'), valid_from: new Date('2026-09-10') });

    const r = await resolveRate({ tenantId: 't1', rateTypeId: 'rt', from: 'USD', to: 'BOB', date });

    expect(r.kind).toBe('DIRECT');
    expect(m.exchangeRateCurrencyPair.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenant_id: 't1', rate_type_id: 'rt', from_currency_code: 'USD', to_currency_code: 'BOB' },
    }));
    expect(m.exchangeRate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenant_id: 't1', currency_pair_id: 'p1', valid_from: { lte: new Date('2026-09-11T00:00:00.000Z') } },
      orderBy: { valid_from: 'desc' },
    }));
    expect(translate(100, r).toString()).toBe('696');
  });

  it('applies the reciprocal pair by division, never through a rounded reciprocal', async () => {
    activeBoth();
    m.exchangeRateCurrencyPair.findFirst
      .mockResolvedValueOnce(null)                                   // BOB→USD not quoted
      .mockResolvedValueOnce({ id: 'p1', conversion_factor: D(1) }); // USD→BOB is
    m.exchangeRate.findFirst.mockResolvedValueOnce({ id: 'r1', rate: D('6.96'), valid_from: new Date('2026-09-10') });

    const r = await resolveRate({ tenantId: 't1', rateTypeId: 'rt', from: 'BOB', to: 'USD', date });
    expect(r.kind).toBe('RECIPROCAL');
    expect(translate('69.60', r).toString()).toBe('10');
  });

  it('honours a conversion factor of 100', () => {
    const r = { kind: 'DIRECT' as const, rate: D('2.35'), conversionFactor: D(100), validFrom: null, exchangeRateId: null };
    expect(translate(1000, r).toString()).toBe('23.5');
  });

  it('fails closed when no rate is valid on the date', async () => {
    activeBoth();
    m.exchangeRateCurrencyPair.findFirst.mockResolvedValueOnce({ id: 'p1', conversion_factor: D(1) }).mockResolvedValueOnce(null);
    m.exchangeRate.findFirst.mockResolvedValueOnce(null); // only future rates exist
    await expect(resolveRate({ tenantId: 't1', rateTypeId: 'rt', from: 'USD', to: 'BOB', date }))
      .rejects.toMatchObject({ code: 'EXCHANGE_RATE_MISSING', statusCode: 422 });
  });

  it('refuses an inactive currency', async () => {
    m.tenantCurrency.findMany.mockResolvedValue([{ currency_code: 'BOB' }]);
    await expect(resolveRate({ tenantId: 't1', rateTypeId: 'rt', from: 'USD', to: 'BOB', date }))
      .rejects.toMatchObject({ code: 'CURRENCY_INACTIVE' });
    expect(m.exchangeRate.findFirst).not.toHaveBeenCalled();
  });
});

describe('roundAmount', () => {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const bob = { rounding_precision: '0.01', rounding_method: 'NEAREST' };

  it.each([168.865, 38.97, 1299, 0.005, 12.344, 12.345])('BOB NEAREST equals the tax engine round2 for %p', (v) => {
    expect(roundAmount(v, bob).toNumber()).toBe(round2(v));
  });

  it('rounds up and down away from / toward zero', () => {
    expect(roundAmount('12.341', { rounding_precision: '0.01', rounding_method: 'UP' }).toString()).toBe('12.35');
    expect(roundAmount('12.349', { rounding_precision: '0.01', rounding_method: 'DOWN' }).toString()).toBe('12.34');
    expect(roundAmount('-12.341', { rounding_precision: '0.01', rounding_method: 'UP' }).toString()).toBe('-12.35');
  });

  it('supports a zero-decimal currency and coarser cash rounding', () => {
    expect(roundAmount('1234.5', { rounding_precision: precisionForMinorUnit(0), rounding_method: 'NEAREST' }).toString()).toBe('1235');
    expect(roundAmount('10.12', { rounding_precision: '0.05', rounding_method: 'NEAREST' }).toString()).toBe('10.1');
  });
});

describe('ledger currencies', () => {
  it('refuses a tenant without a ledger rather than defaulting to a country', async () => {
    m.financeParameters.findFirst.mockResolvedValue(null);
    await expect(getLedgerCurrencies('t1')).rejects.toMatchObject({ code: 'LEDGER_CURRENCY_NOT_CONFIGURED' });
  });

  it('falls back from the reporting rate type to the accounting one', async () => {
    m.financeParameters.findFirst.mockResolvedValue(ledgerRow('TRY'));
    const ledger = await getLedgerCurrencies('t1');
    expect(ledger).toMatchObject({ accountingCurrency: 'TRY', reportingCurrency: 'TRY', reportingRateTypeId: 'rt-acc' });
  });

  const input = (code: string, reporting = code) => ({
    accounting_currency_code: code, reporting_currency_code: reporting, accounting_rate_type_id: 'rt-acc',
  });

  it('refuses the document-date basis (no behaviour yet)', async () => {
    await expect(setLedgerCurrencies('t1', { ...input('BOB'), exchange_rate_date_basis: 'DOCUMENT_DATE' }))
      .rejects.toMatchObject({ code: 'EXCHANGE_RATE_DATE_BASIS_UNSUPPORTED' });
  });

  it('refuses a reporting currency different from accounting until vouchers carry reporting amounts', async () => {
    await expect(setLedgerCurrencies('t1', input('BOB', 'USD'))).rejects.toMatchObject({ code: 'REPORTING_CURRENCY_UNSUPPORTED' });
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it('locks the currencies once anything has posted, under an advisory lock', async () => {
    m.tenantCurrency.findFirst.mockResolvedValue({ is_active: true, rounding_precision: '0.01' });
    m.exchangeRateType.findFirst.mockResolvedValue({ is_active: true });
    m.financeParameters.findFirst.mockResolvedValueOnce({ id: 'fp1', accounting_currency_code: 'BOB', reporting_currency_code: 'BOB' });
    m.journalEntry.count.mockResolvedValue(5);

    await expect(setLedgerCurrencies('t1', input('TRY'))).rejects.toMatchObject({ code: 'CURRENCY_LOCKED', statusCode: 409 });
    expect(m.$queryRaw).toHaveBeenCalled();
    expect(m.journalEntry.count).toHaveBeenCalledWith({ where: { tenant_id: 't1', status: 'POSTED' } });
    expect(m.financeParameters.update).not.toHaveBeenCalled();
    expect(m.tenant.update).not.toHaveBeenCalled();
  });

  it('treats re-sending the current currencies as a no-op, even after posting', async () => {
    m.tenantCurrency.findFirst.mockResolvedValue({ is_active: true, rounding_precision: '0.01' });
    m.exchangeRateType.findFirst.mockResolvedValue({ is_active: true });
    m.financeParameters.findFirst
      .mockResolvedValueOnce({ id: 'fp1', accounting_currency_code: 'BOB', reporting_currency_code: 'BOB' })
      .mockResolvedValueOnce(ledgerRow('BOB'));

    const ledger = await setLedgerCurrencies('t1', input('BOB'));
    expect(ledger.accountingCurrency).toBe('BOB');
    expect(m.journalEntry.count).not.toHaveBeenCalled();
    // WORK-025 dropped the tenant mirror: the ledger is the only place the
    // currency lives, so nothing is written to `tenants` any more.
    expect(m.tenant.update).not.toHaveBeenCalled();
  });

  it('locks on cost layers even when no voucher has posted (receipt posting off)', async () => {
    m.tenantCurrency.findFirst.mockResolvedValue({ is_active: true, rounding_precision: '0.01' });
    m.exchangeRateType.findFirst.mockResolvedValue({ is_active: true });
    m.financeParameters.findFirst.mockResolvedValueOnce({ id: 'fp1', accounting_currency_code: 'BOB', reporting_currency_code: 'BOB' });
    m.journalEntry.count.mockResolvedValue(0);
    m.inventoryCostLayer.count.mockResolvedValue(3);

    await expect(setLedgerCurrencies('t1', input('TRY'))).rejects.toMatchObject({ code: 'CURRENCY_LOCKED' });
    expect(m.inventoryCostLayer.count).toHaveBeenCalledWith({ where: { tenant_id: 't1' } });
    expect(m.financeParameters.update).not.toHaveBeenCalled();
  });

  it('refuses a currency the tenant has not activated', async () => {
    m.tenantCurrency.findFirst.mockResolvedValue(null);
    await expect(setLedgerCurrencies('t1', input('EUR'))).rejects.toMatchObject({ code: 'CURRENCY_INACTIVE' });
    expect(m.financeParameters.update).not.toHaveBeenCalled();
  });
});

describe('rate maintenance', () => {
  const add = (valid_from: string, canBackdate: boolean) => addExchangeRate('t1', 'u1', {
    rate_type_id: 'rt', from_currency_code: 'USD', to_currency_code: 'BOB', valid_from, rate: 6.97,
  }, { canBackdate });

  beforeEach(() => {
    m.$queryRaw.mockResolvedValue([{ id: 'rt', is_active: true }]);
    m.tenantCurrency.findMany.mockResolvedValue([{ currency_code: 'USD' }, { currency_code: 'BOB' }]);
    m.exchangeRateCurrencyPair.findFirst.mockResolvedValue({ id: 'p1', conversion_factor: D(1) });
    m.exchangeRate.create.mockResolvedValue({ id: 'new' });
  });

  it('refuses an operational back-dated rate: it would change the rate later dates resolve to', async () => {
    m.exchangeRate.findFirst.mockResolvedValueOnce({ valid_from: new Date('2026-09-11T00:00:00.000Z') });
    await expect(add('2026-09-01', false)).rejects.toMatchObject({ code: 'EXCHANGE_RATE_BACKDATED', statusCode: 409 });
    expect(m.exchangeRate.create).not.toHaveBeenCalled();
  });

  it('accepts a newer operational rate', async () => {
    m.exchangeRate.findFirst
      .mockResolvedValueOnce({ valid_from: new Date('2026-09-11T00:00:00.000Z') }) // latest
      .mockResolvedValueOnce(null);                                              // no duplicate
    await expect(add('2026-09-12', false)).resolves.toMatchObject({ id: 'new' });
  });

  it('lets accounting setup back-date', async () => {
    m.exchangeRate.findFirst.mockResolvedValueOnce(null); // no duplicate; latest is not consulted
    await expect(add('2026-09-01', true)).resolves.toMatchObject({ id: 'new' });
  });

  it('refuses an impossible date instead of rolling it into the next month', async () => {
    await expect(add('2026-02-30', true)).rejects.toMatchObject({ code: 'INVALID_DATE' });
  });

  it('audits the before and after value of a correction in the same transaction', async () => {
    m.exchangeRate.findFirst.mockResolvedValueOnce({
      id: 'r1', rate: D('6.96'), valid_from: new Date('2026-09-11T00:00:00.000Z'),
      pair: { from_currency_code: 'USD', to_currency_code: 'BOB' },
    });
    m.exchangeRate.update.mockResolvedValue({ id: 'r1' });
    await updateExchangeRate('t1', 'u1', 'r1', { rate: 7 });
    expect(m.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: 't1', user_id: 'u1',
        body: expect.objectContaining({ action: 'EXCHANGE_RATE_CORRECTED', before: '6.96', after: '7' }),
      }),
    });
  });
});

describe('document currency', () => {
  const opts = { errorCode: 'X_FX_NOT_IMPLEMENTED', capability: 'Things' };

  it.each(['BOB', 'TRY', 'EUR', 'USD'])('accepts a %s document in a %s ledger (no literal)', async (code) => {
    m.financeParameters.findFirst.mockResolvedValue(ledgerRow(code));
    await expect(assertDocumentCurrencySupported('t1', code, opts)).resolves.toMatchObject({ accountingCurrency: code });
  });

  it('refuses a foreign-currency document with the caller\'s error code', async () => {
    m.financeParameters.findFirst.mockResolvedValue(ledgerRow('TRY'));
    await expect(assertDocumentCurrencySupported('t1', 'USD', opts))
      .rejects.toMatchObject({ code: 'X_FX_NOT_IMPLEMENTED', statusCode: 409 });
  });

  it('defaults a new document to the ledger currency and refuses an inactive one', async () => {
    m.financeParameters.findFirst.mockResolvedValue(ledgerRow('TRY'));
    m.tenantCurrency.findFirst.mockResolvedValueOnce({ id: 'tc' }).mockResolvedValueOnce(null);
    await expect(resolveDocumentCurrency('t1', undefined)).resolves.toBe('TRY');
    await expect(resolveDocumentCurrency('t1', 'usd')).rejects.toMatchObject({ code: 'CURRENCY_INACTIVE' });
  });
});
