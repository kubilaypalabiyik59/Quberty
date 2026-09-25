/**
 * VOUCHER AMOUNT TRIPLE (WORK-024b)
 *
 * Every line carries what it was transacted in, what it is accounted in, and what
 * it is reported in. These tests pin the rules that make that safe:
 *
 *   - a voucher with no currency is the ledger's accounting currency, costs no rate
 *     lookup, and writes three identical amount sets at rate 1 — which is what all
 *     existing callers do, so their vouchers cannot have changed;
 *   - **[OFFICIAL]** each line is translated from the TRANSACTION amount and
 *     rounded, then the lines are summed; a penny difference inside the tolerance
 *     goes to the rounding account, and the accounting and reporting currencies
 *     have separate tolerances;
 *   - a reversal copies the amounts, the rates and the original's rate date, so a
 *     rate move between posting and reversal still nets to zero;
 *   - the ROUNDING account is resolved only when a penny line is actually needed.
 */

import { Prisma } from '@prisma/client';
import { db } from '../infrastructure/database/client';
import { postJournal, reverseJournal } from '../shared/services/journal.service';
import { resolvePostingAccount } from '../shared/services/postingProfile.service';

jest.mock('../infrastructure/database/client', () => {
  const m: any = {
    financeParameters:        { findFirst: jest.fn() },
    accountingPeriod:         { findFirst: jest.fn() },
    tenantCurrency:           { findFirst: jest.fn(), findMany: jest.fn() },
    exchangeRateCurrencyPair: { findFirst: jest.fn() },
    exchangeRate:             { findFirst: jest.fn() },
    journalEntry:             { findFirst: jest.fn(), create: jest.fn() },
  };
  return { db: m };
});
jest.mock('../shared/services/numberSequence.service', () => ({
  nextJournalVoucher: jest.fn().mockResolvedValue('JE-2026-00001'),
}));
jest.mock('../shared/services/postingProfile.service', () => ({
  resolvePostingAccount: jest.fn().mockResolvedValue('acc-rounding'),
}));
jest.mock('../shared/services/dimension.service', () => ({
  EMPTY_SLOTS: { dimension_1_id: null, dimension_2_id: null, dimension_3_id: null, dimension_4_id: null },
  resolveDimensions: jest.fn().mockResolvedValue({ dimension_1_id: 'dim-store', dimension_2_id: null, dimension_3_id: null, dimension_4_id: null }),
  assertRequiredDimensions: jest.fn().mockResolvedValue(undefined),
}));

const m = db as any;
const D = (v: string | number) => new Prisma.Decimal(v);
const DATE = new Date('2026-09-12T00:00:00.000Z');

const ledger = (accounting: string, reporting = accounting, tolerances = { rt: '0.02', rrt: '0.02' }) => ({
  legal_entity_id: null,
  accounting_currency_code: accounting,
  reporting_currency_code: reporting,
  accounting_rate_type_id: 'rt-acc',
  reporting_rate_type_id: null,
  exchange_rate_date_basis: 'POSTING_DATE',
  allow_posting_to_closed_period: false,
  rounding_tolerance: tolerances.rt,
  reporting_rounding_tolerance: tolerances.rrt,
  correction_method: 'REVERSE',
});

/** The written payload of the single journalEntry.create call. */
const written = () => m.journalEntry.create.mock.calls[0][0].data;
const writtenLines = () => written().lines.create as any[];

beforeEach(() => {
  jest.clearAllMocks();
  m.accountingPeriod.findFirst.mockResolvedValue(null);
  m.tenantCurrency.findFirst.mockResolvedValue({ rounding_precision: '0.01', rounding_method: 'NEAREST' });
  m.tenantCurrency.findMany.mockResolvedValue([{ currency_code: 'BOB' }, { currency_code: 'EUR' }, { currency_code: 'USD' }]);
  m.journalEntry.create.mockImplementation(async ({ data }: any) => ({ id: 'je-1', ...data, lines: data.lines.create }));
});

const post = (opts: any = {}) => postJournal({
  tenantId: 't1',
  date: DATE,
  description: 'Test voucher',
  source: { module: 'TEST' },
  lines: [
    { accountId: 'acc-a', debit: 100, description: 'debit' },
    { accountId: 'acc-b', credit: 100, description: 'credit' },
  ],
  ...opts,
});

describe('a voucher in the ledger currency', () => {
  it('writes three identical amount sets at rate 1 without looking up a rate', async () => {
    m.financeParameters.findFirst.mockResolvedValue(ledger('BOB'));
    await post();

    const entry = written();
    expect(entry.accounting_currency_code).toBe('BOB');
    expect(entry.reporting_currency_code).toBe('BOB');
    expect(entry.exchange_rate_date).toBe(DATE);
    // Nothing was quoted, so no rate type is claimed.
    expect(entry.accounting_rate_type_id).toBeNull();
    expect(entry.reporting_rate_type_id).toBeNull();

    for (const line of writtenLines()) {
      expect(line.transaction_currency_code).toBe('BOB');
      expect(line.transaction_debit_amount).toBe(line.debit_amount);
      expect(line.reporting_debit_amount).toBe(line.debit_amount);
      expect(line.transaction_credit_amount).toBe(line.credit_amount);
      expect(line.reporting_credit_amount).toBe(line.credit_amount);
      expect(line.accounting_exchange_rate.toString()).toBe('1');
      expect(line.reporting_exchange_rate.toString()).toBe('1');
    }
    expect(m.exchangeRateCurrencyPair.findFirst).not.toHaveBeenCalled();
    expect(m.exchangeRate.findFirst).not.toHaveBeenCalled();
    expect(resolvePostingAccount).not.toHaveBeenCalled();
  });

  it('treats an explicit accounting currency exactly the same', async () => {
    m.financeParameters.findFirst.mockResolvedValue(ledger('TRY'));
    await post({ currency: { code: 'TRY' } });
    expect(m.exchangeRate.findFirst).not.toHaveBeenCalled();
    expect(writtenLines()[0].transaction_currency_code).toBe('TRY');
  });

  it('keeps the Bolivian figures byte-identical across all three sets', async () => {
    m.financeParameters.findFirst.mockResolvedValue(ledger('BOB'));
    await post({
      lines: [
        { accountId: 'acc-cash', debit: 1299 },
        { accountId: 'acc-revenue', credit: 1091.16 },
        { accountId: 'acc-iva', credit: 168.87 },
        { accountId: 'acc-it', credit: 38.97 },
      ],
    });
    for (const line of writtenLines()) {
      expect(line.transaction_debit_amount).toBe(line.debit_amount);
      expect(line.transaction_credit_amount).toBe(line.credit_amount);
      expect(line.reporting_debit_amount).toBe(line.debit_amount);
      expect(line.reporting_credit_amount).toBe(line.credit_amount);
    }
    const credits = writtenLines().map((l) => l.credit_amount).filter(Boolean);
    expect(credits).toEqual([1091.16, 168.87, 38.97]);
  });
});

describe('a voucher in a foreign transaction currency', () => {
  const withRate = (rate: string) => {
    m.exchangeRateCurrencyPair.findFirst.mockResolvedValue({ id: 'pair-1', conversion_factor: D(1) });
    m.exchangeRate.findFirst.mockResolvedValue({ id: 'rate-1', rate: D(rate), valid_from: DATE });
  };

  it("translates each line and absorbs Microsoft's own penny example", async () => {
    // [OFFICIAL] EUR 3.33 / 3.33 / 3.34 against 10.00 at 1.5 rounds to 15.01 vs 15.00.
    m.financeParameters.findFirst.mockResolvedValue(ledger('BOB'));
    withRate('1.5');

    await post({
      currency: { code: 'EUR' },
      // A voucher-level context, so the rounding line's coding can be asserted:
      // an uncoded rounding line would sit in every P&L by store's "(unassigned)".
      dimensions: { siteId: 'site-1' },
      lines: [
        { accountId: 'acc-a', debit: 3.33 },
        { accountId: 'acc-b', debit: 3.33 },
        { accountId: 'acc-c', debit: 3.34 },
        { accountId: 'acc-d', credit: 10 },
      ],
    });

    const lines = writtenLines();
    expect(lines).toHaveLength(5); // four plus the rounding line
    expect(lines.slice(0, 3).map((l) => l.debit_amount)).toEqual([5, 5, 5.01]);
    expect(lines[3].credit_amount).toBe(15);

    const rounding = lines[4];
    expect(resolvePostingAccount).toHaveBeenCalledWith('ROUNDING', expect.anything(), expect.anything());
    expect(rounding.credit_amount).toBe(0.01);
    // The penny exists only in the accounting currency; nothing was transacted.
    expect(rounding.transaction_debit_amount).toBe(0);
    expect(rounding.transaction_credit_amount).toBe(0);
    // …and it is dimension-coded like every other line.
    expect(rounding.dimension_1_id).toBe('dim-store');

    expect(written().accounting_rate_type_id).toBe('rt-acc');
    expect(lines[0].accounting_exchange_rate.toString()).toBe('1.5');
  });

  it('refuses an accounting imbalance beyond the tolerance without resolving ROUNDING', async () => {
    m.financeParameters.findFirst.mockResolvedValue(ledger('BOB', 'BOB', { rt: '0', rrt: '0.02' }));
    withRate('1.5');
    await expect(post({
      currency: { code: 'EUR' },
      lines: [
        { accountId: 'acc-a', debit: 3.33 },
        { accountId: 'acc-b', debit: 3.33 },
        { accountId: 'acc-c', debit: 3.34 },
        { accountId: 'acc-d', credit: 10 },
      ],
    })).rejects.toMatchObject({ code: 'JOURNAL_UNBALANCED_ACCOUNTING' });
    expect(resolvePostingAccount).not.toHaveBeenCalled();
    expect(m.journalEntry.create).not.toHaveBeenCalled();
  });

  it('uses the reporting tolerance for a reporting-only penny difference', async () => {
    // Accounting is an identity (BOB), reporting is USD at 0.5: 0.01 + 0.01 rounds
    // to 0.01 + 0.01 against a 0.01 credit. Only the reporting side is out, and the
    // accounting tolerance is zero — so passing proves the reporting one was used.
    m.financeParameters.findFirst.mockResolvedValue(ledger('BOB', 'USD', { rt: '0', rrt: '0.02' }));
    withRate('0.5');

    await post({
      lines: [
        { accountId: 'acc-a', debit: 0.01 },
        { accountId: 'acc-b', debit: 0.01 },
        { accountId: 'acc-c', credit: 0.02 },
      ],
    });

    const lines = writtenLines();
    expect(lines).toHaveLength(4);
    const rounding = lines[3];
    expect(rounding.reporting_credit_amount).toBe(0.01);
    expect(rounding.debit_amount).toBe(0);
    expect(rounding.credit_amount).toBe(0);
    expect(written().reporting_rate_type_id).toBe('rt-acc'); // falls back to the accounting type
  });

  it('fails closed when no rate is valid on the voucher date', async () => {
    m.financeParameters.findFirst.mockResolvedValue(ledger('BOB'));
    m.exchangeRateCurrencyPair.findFirst.mockResolvedValue(null);
    await expect(post({ currency: { code: 'EUR' } })).rejects.toMatchObject({ code: 'EXCHANGE_RATE_MISSING' });
    expect(m.journalEntry.create).not.toHaveBeenCalled();
  });

  it('refuses a currency the tenant has not activated', async () => {
    m.financeParameters.findFirst.mockResolvedValue(ledger('BOB'));
    m.tenantCurrency.findFirst.mockResolvedValue(null);
    await expect(post({ currency: { code: 'EUR' } })).rejects.toMatchObject({ code: 'CURRENCY_INACTIVE' });
    expect(m.journalEntry.create).not.toHaveBeenCalled();
  });
});

describe('reversal', () => {
  const originalLine = (over: Record<string, unknown> = {}) => ({
    account_id: 'acc-a',
    description: 'original',
    debit_amount: D(150),
    credit_amount: D(0),
    transaction_currency_code: 'EUR',
    transaction_debit_amount: D(100),
    transaction_credit_amount: D(0),
    reporting_debit_amount: D(150),
    reporting_credit_amount: D(0),
    accounting_exchange_rate: D('1.5'),
    reporting_exchange_rate: D('1.5'),
    dimension_1_id: 'dim-store', dimension_2_id: null, dimension_3_id: null, dimension_4_id: null,
    ...over,
  });

  const original = (method: 'REVERSE' | 'STORNO') => {
    m.financeParameters.findFirst.mockResolvedValue({ ...ledger('BOB'), correction_method: method });
    m.journalEntry.findFirst
      .mockResolvedValueOnce({
        id: 'je-original', entry_number: 'JE-2026-00007', description: 'Original', status: 'POSTED',
        is_correction: false, source_module: 'TEST', source_id: null,
        accounting_currency_code: 'BOB', reporting_currency_code: 'BOB',
        exchange_rate_date: new Date('2026-08-01T00:00:00.000Z'),
        accounting_rate_type_id: 'rt-acc', reporting_rate_type_id: null,
        lines: [
          originalLine(),
          originalLine({ account_id: 'acc-b', debit_amount: D(0), credit_amount: D(150), transaction_debit_amount: D(0), transaction_credit_amount: D(100), reporting_debit_amount: D(0), reporting_credit_amount: D(150) }),
        ],
      })
      .mockResolvedValueOnce(null); // not already reversed
  };

  it('mirrors all three amount sets and keeps the original rates and rate date', async () => {
    original('REVERSE');
    // A rate move since the original must not matter: no rate is looked up at all.
    await reverseJournal({ tenantId: 't1', entryId: 'je-original', reason: 'test', date: DATE });

    const entry = written();
    expect(entry.exchange_rate_date).toEqual(new Date('2026-08-01T00:00:00.000Z'));
    expect(entry.entry_date).toBe(DATE); // posts today, never into the original period
    expect(entry.accounting_rate_type_id).toBe('rt-acc');
    expect(m.exchangeRate.findFirst).not.toHaveBeenCalled();

    const lines = writtenLines();
    expect(lines[0]).toMatchObject({ debit_amount: 0, credit_amount: 150, transaction_credit_amount: 100, reporting_credit_amount: 150 });
    expect(lines[1]).toMatchObject({ debit_amount: 150, credit_amount: 0, transaction_debit_amount: 100, reporting_debit_amount: 150 });
    expect(lines[0].accounting_exchange_rate.toString()).toBe('1.5');
    expect(lines[0].dimension_1_id).toBe('dim-store');

    // Nets to zero in all three currencies against the original.
    const sum = (key: string) => lines.reduce((s: number, l: any) => s + l[key], 0);
    expect(sum('debit_amount') - sum('credit_amount')).toBe(0);
    expect(sum('transaction_debit_amount') - sum('transaction_credit_amount')).toBe(0);
    expect(sum('reporting_debit_amount') - sum('reporting_credit_amount')).toBe(0);
  });

  it('negates all six amounts under STORNO and never the rates', async () => {
    original('STORNO');
    await reverseJournal({ tenantId: 't1', entryId: 'je-original', reason: 'test', date: DATE });

    const lines = writtenLines();
    expect(lines[0]).toMatchObject({ debit_amount: -150, transaction_debit_amount: -100, reporting_debit_amount: -150 });
    expect(lines[1]).toMatchObject({ credit_amount: -150, transaction_credit_amount: -100, reporting_credit_amount: -150 });
    for (const line of lines) {
      expect(line.accounting_exchange_rate.gt(0)).toBe(true);
      expect(line.reporting_exchange_rate.gt(0)).toBe(true);
      expect(line.is_correction).toBe(true);
    }
  });

  it('refuses derived lines that do not net to zero', async () => {
    m.financeParameters.findFirst.mockResolvedValue(ledger('BOB'));
    await expect(postJournal({
      tenantId: 't1', date: DATE, description: 'bad derivation', source: { module: 'TEST' },
      rawHeader: {
        accountingCurrencyCode: 'BOB', reportingCurrencyCode: 'BOB', exchangeRateDate: DATE,
        accountingRateTypeId: null, reportingRateTypeId: null,
      },
      lines: [{
        accountId: 'acc-a',
        rawAmounts: {
          transactionCurrencyCode: 'BOB',
          transactionDebit: 10, transactionCredit: 0,
          accountingDebit: 10, accountingCredit: 0,
          reportingDebit: 10, reportingCredit: 0,
          accountingRate: 1, reportingRate: 1,
        },
      }],
    })).rejects.toMatchObject({ code: 'JOURNAL_REVERSAL_IMBALANCE' });
    expect(m.journalEntry.create).not.toHaveBeenCalled();
  });

  it('refuses derived lines carrying two transaction currencies', async () => {
    m.financeParameters.findFirst.mockResolvedValue(ledger('BOB'));
    const raw = (code: string, debit: number, credit: number) => ({
      transactionCurrencyCode: code,
      transactionDebit: debit, transactionCredit: credit,
      accountingDebit: debit, accountingCredit: credit,
      reportingDebit: debit, reportingCredit: credit,
      accountingRate: 1, reportingRate: 1,
    });
    await expect(postJournal({
      tenantId: 't1', date: DATE, description: 'two currencies', source: { module: 'TEST' },
      rawHeader: {
        accountingCurrencyCode: 'BOB', reportingCurrencyCode: 'BOB', exchangeRateDate: DATE,
        accountingRateTypeId: null, reportingRateTypeId: null,
      },
      lines: [
        { accountId: 'acc-a', rawAmounts: raw('BOB', 10, 0) },
        { accountId: 'acc-b', rawAmounts: raw('EUR', 0, 10) },
      ],
    })).rejects.toMatchObject({ code: 'JOURNAL_MULTI_CURRENCY_UNSUPPORTED' });
    expect(m.journalEntry.create).not.toHaveBeenCalled();
  });
});
