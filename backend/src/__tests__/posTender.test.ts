/**
 * POS TENDERS AND SHIFT DECLARATIONS (WORK-047)
 *
 *   - tenders must add up to the sale; only cash gives change; customer account is
 *     refused; the older single payment_method maps to the matching tenant method;
 *   - a sale debits each tender's account, never accounts receivable;
 *   - closing expects cash = float + cash tenders only (card is not cash), requires a
 *     count for COUNT methods, refuses a difference above tolerance without the
 *     permission, and posts the difference against the cash difference account.
 */

jest.mock('../shared/services/journal.service', () => ({ postJournal: jest.fn() }));
jest.mock('../shared/services/posting.service', () => ({ resolvePostingAccounts_orExplain: jest.fn() }));

import { postJournal } from '../shared/services/journal.service';
import { resolvePostingAccounts_orExplain } from '../shared/services/posting.service';
import { planTenders, tenderDebitLines, closeSessionDeclarations } from '../modules/pos/posTender.service';

const CASH = { id: 'm-cash', code: 'CASH', name: 'Cash', tender_type: 'CASH', account_id: 'acc-cash', allow_change: true, declaration_policy: 'COUNT', max_difference_amount: 5 };
const CARD = { id: 'm-card', code: 'CARD', name: 'Card', tender_type: 'CARD', account_id: 'acc-bank', allow_change: false, declaration_policy: 'NONE', max_difference_amount: null };
const QR = { id: 'm-qr', code: 'QR', name: 'QR', tender_type: 'QR', account_id: 'acc-bank', allow_change: false, declaration_policy: 'NONE', max_difference_amount: null };
const ACCT = { id: 'm-acct', code: 'ACCT', name: 'On account', tender_type: 'CUSTOMER_ACCOUNT', account_id: 'acc-ar', allow_change: false, declaration_policy: 'NONE', max_difference_amount: null };

function tx(methods: any[], tenders: any[] = []) {
  return {
    salesPaymentMethod: {
      findMany: jest.fn(async (args: any) => {
        const ids: string[] | undefined = args.where?.id?.in;
        return ids ? methods.filter((m) => ids.includes(m.id)) : methods;
      }),
      findFirst: jest.fn(async (args: any) => methods.find((m) => m.tender_type === args.where.tender_type) ?? null),
    },
    posTender: { findMany: jest.fn().mockResolvedValue(tenders) },
    registerSessionDeclaration: { create: jest.fn().mockResolvedValue({}) },
  } as any;
}

beforeEach(() => jest.clearAllMocks());

describe('planTenders()', () => {
  it('splits a sale across cash and QR and gives change from cash only', async () => {
    const t = await planTenders(tx([CASH, QR]), 't1', 1299, {
      tenders: [{ payment_method_id: 'm-cash', amount: 299, tendered: 300 }, { payment_method_id: 'm-qr', amount: 1000 }],
    });
    expect(t.map((x) => [x.method.code, x.amount, x.change])).toEqual([['CASH', 299, 1], ['QR', 1000, null]]);
    expect(tenderDebitLines(t, 'SO-1')).toEqual([
      { accountId: 'acc-cash', debit: 299, description: 'CASH — SO-1' },
      { accountId: 'acc-bank', debit: 1000, description: 'QR — SO-1' },
    ]);
  });

  it('refuses tenders that do not add up to the sale', async () => {
    await expect(planTenders(tx([CASH]), 't1', 100, { tenders: [{ payment_method_id: 'm-cash', amount: 90 }] }))
      .rejects.toMatchObject({ code: 'TENDER_TOTAL_MISMATCH' });
  });

  it('refuses change from a card', async () => {
    await expect(planTenders(tx([CARD]), 't1', 100, { tenders: [{ payment_method_id: 'm-card', amount: 100, tendered: 120 }] }))
      .rejects.toMatchObject({ code: 'TENDER_NO_CHANGE' });
  });

  it('refuses cash received below what it pays', async () => {
    await expect(planTenders(tx([CASH]), 't1', 100, { tenders: [{ payment_method_id: 'm-cash', amount: 100, tendered: 80 }] }))
      .rejects.toMatchObject({ code: 'TENDER_SHORT' });
  });

  it('refuses selling on customer account until receivables are itemised', async () => {
    await expect(planTenders(tx([ACCT]), 't1', 100, { tenders: [{ payment_method_id: 'm-acct', amount: 100 }] }))
      .rejects.toMatchObject({ code: 'TENDER_NOT_IMPLEMENTED' });
  });

  it('refuses a gift voucher until voucher balances are tracked', async () => {
    const VOUCHER = { ...ACCT, id: 'm-vch', code: 'VCH', tender_type: 'VOUCHER' };
    await expect(planTenders(tx([VOUCHER]), 't1', 100, { tenders: [{ payment_method_id: 'm-vch', amount: 100 }] }))
      .rejects.toMatchObject({ code: 'TENDER_NOT_IMPLEMENTED' });
  });

  it('maps the older single payment_method to the matching tenant method', async () => {
    const t = await planTenders(tx([CASH, CARD]), 't1', 565, { payment_method: 'CASH', cash_tendered: 600 });
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ amount: 565, tendered: 600, change: 35 });
  });

  it('says so when no method of the older type is set up', async () => {
    await expect(planTenders(tx([CASH]), 't1', 10, { payment_method: 'CARD' })).rejects.toMatchObject({ code: 'PAYMENT_METHOD_NOT_CONFIGURED' });
  });
});

describe('closeSessionDeclarations()', () => {
  const session = { id: 's1', terminal_name: 'LPZ-1', opening_float: 500, site_id: 'site', warehouse_id: 'wh' };
  const tenders = [
    { payment_method_id: 'm-cash', amount: 1130 },
    { payment_method_id: 'm-card', amount: 790 },
  ];

  it('expects cash = float + cash tenders, not card, and accepts an exact count', async () => {
    const r = await closeSessionDeclarations(tx([CASH, CARD], tenders), {
      tenantId: 't1', session, declarations: [{ payment_method_id: 'm-cash', counted: 1630 }], userRole: 'cashier', userId: 'u1',
    });
    const cash = r.rows.find((x) => x.code === 'CASH')!;
    const card = r.rows.find((x) => x.code === 'CARD')!;
    expect([cash.expected, cash.counted, cash.difference]).toEqual([1630, 1630, 0]);
    expect([card.expected, card.difference]).toEqual([790, 0]);
    expect(postJournal).not.toHaveBeenCalled();
  });

  it('requires a count for a COUNT method', async () => {
    await expect(closeSessionDeclarations(tx([CASH, CARD], tenders), {
      tenantId: 't1', session, declarations: [], userRole: 'cashier', userId: 'u1',
    })).rejects.toMatchObject({ code: 'DECLARATION_REQUIRED' });
  });

  it('refuses a difference above tolerance to a cashier', async () => {
    await expect(closeSessionDeclarations(tx([CASH, CARD], tenders), {
      tenantId: 't1', session, declarations: [{ payment_method_id: 'm-cash', counted: 1600 }], userRole: 'cashier', userId: 'u1',
    })).rejects.toMatchObject({ code: 'DECLARATION_DIFFERENCE_TOO_LARGE' });
  });

  it('treats a blank tolerance as none: a cashier may not close even 1 short', async () => {
    const strict = { ...CASH, max_difference_amount: null };
    await expect(closeSessionDeclarations(tx([strict, CARD], tenders), {
      tenantId: 't1', session, declarations: [{ payment_method_id: 'm-cash', counted: 1629 }], userRole: 'cashier', userId: 'u1',
    })).rejects.toMatchObject({ code: 'DECLARATION_DIFFERENCE_TOO_LARGE' });
  });

  it('lets a store manager close short and posts the difference', async () => {
    (resolvePostingAccounts_orExplain as jest.Mock).mockResolvedValue({ CASH_DIFFERENCE: 'acc-diff' });
    (postJournal as jest.Mock).mockResolvedValue({ id: 'je-diff' });
    const t = tx([CASH, CARD], tenders);
    const r = await closeSessionDeclarations(t, {
      tenantId: 't1', session, declarations: [{ payment_method_id: 'm-cash', counted: 1600 }], userRole: 'store_manager', userId: 'u1',
    });
    expect(r.rows.find((x) => x.code === 'CASH')!.difference).toBe(-30);
    expect((postJournal as jest.Mock).mock.calls[0][0].lines).toEqual([
      { accountId: 'acc-diff', debit: 30, description: 'Short CASH — LPZ-1' },
      { accountId: 'acc-cash', credit: 30, description: 'Short CASH — LPZ-1' },
    ]);
    expect(t.registerSessionDeclaration.create).toHaveBeenCalledTimes(2);
  });

  it('reads the older closing_float as the cash declaration', async () => {
    const r = await closeSessionDeclarations(tx([CASH, CARD], tenders), {
      tenantId: 't1', session, declarations: [], closingFloat: 1630, userRole: 'cashier', userId: 'u1',
    });
    expect(r.cashCounted).toBe(1630);
  });
});
