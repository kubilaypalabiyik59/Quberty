/**
 * INVENTORY JOURNALS (WORK-045)
 *
 *   - posting values a journal per item group with the right posting types and
 *     signs: gains against inventory profit (or opening balance equity), losses
 *     against inventory loss;
 *   - an OPENING journal is the admin's on create, edit, post and cancel;
 *   - entering a unit cost on an adjustment needs inventory.journal.cost_override;
 *   - a DECREASE reason cannot move stock up, and an opening balance cannot remove.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';

jest.mock('../infrastructure/database/client', () => ({
  db: {
    inventoryJournal:  { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    warehouse:         { findFirst: jest.fn() },
    $transaction:      jest.fn(),
  },
}));
jest.mock('../shared/services/stockLedger.service', () => ({
  receiveIntoLocation: jest.fn(),
  issueFromLocation: jest.fn(),
}));
jest.mock('../shared/services/journal.service', () => ({ postJournal: jest.fn() }));
jest.mock('../shared/services/posting.service', () => ({ resolvePostingAccounts_orExplain: jest.fn() }));
jest.mock('../shared/services/itemPolicy.service', () => ({
  ...jest.requireActual('../shared/services/itemPolicy.service'),
  resolveItemPolicies: jest.fn(),
}));

import { db } from '../infrastructure/database/client';
import { receiveIntoLocation, issueFromLocation } from '../shared/services/stockLedger.service';
import { postJournal } from '../shared/services/journal.service';
import { resolvePostingAccounts_orExplain } from '../shared/services/posting.service';
import { resolveItemPolicies } from '../shared/services/itemPolicy.service';
import { assertMayEnterCost, postInventoryJournal, validateJournalInput } from '../modules/inventory/inventoryJournal.service';
import journalRoutes from '../modules/inventory/inventory-journal.routes';
import { errorHandler } from '../shared/middleware/errorHandler';
import type { AppEnv } from '../shared/context';

const mocked = db as any;
beforeEach(() => jest.clearAllMocks());

const J = '11111111-1111-4111-8111-111111111111';
const WH = '22222222-2222-4222-8222-222222222222';

function fakePostTx(journal: any) {
  return {
    inventoryJournal: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(journal),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    inventoryJournalLine: { update: jest.fn().mockResolvedValue({}) },
    inventoryCostLayer: { findFirst: jest.fn().mockResolvedValue(null) },
    product: { findFirst: jest.fn().mockResolvedValue({ cost_price: 0 }) },
    warehouse: { findFirst: jest.fn().mockResolvedValue({ site_id: 'site-1' }) },
  } as any;
}

describe('postInventoryJournal()', () => {
  it('posts one voucher split per item group with gains to profit and losses to loss', async () => {
    const journal = {
      id: J, journal_number: 'IJ-1', journal_type: 'ADJUSTMENT', warehouse_id: WH, description: null,
      lines: [
        { id: 'l1', product_id: 'shoe', variant_id: null, location_id: 'loc', quantity: 2, unit_cost: 50, notes: null },
        { id: 'l2', product_id: 'bag', variant_id: null, location_id: 'loc', quantity: -1, unit_cost: null, notes: null },
      ],
    };
    const tx = fakePostTx(journal);
    (resolveItemPolicies as jest.Mock).mockResolvedValue(new Map([
      ['shoe', { stocked: true, itemGroupId: 'g-shoes', itemGroupCode: 'SHOES' }],
      ['bag', { stocked: true, itemGroupId: 'g-bags', itemGroupCode: 'BAGS' }],
    ]));
    (receiveIntoLocation as jest.Mock).mockResolvedValue({ transactionId: 't1', costAmount: 100 });
    (issueFromLocation as jest.Mock).mockResolvedValue({ transactionId: 't2', costAmount: 30 });
    (resolvePostingAccounts_orExplain as jest.Mock).mockImplementation(async (_t: string, types: string[]) =>
      Object.fromEntries(types.map((t) => [t, `acc-${t}`])));
    (postJournal as jest.Mock).mockResolvedValue({ id: 'je-1' });

    await postInventoryJournal('t1', J, 'u1', tx);

    const lines = (postJournal as jest.Mock).mock.calls[0][0].lines;
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'acc-INVENTORY', debit: 100 }),
      expect.objectContaining({ accountId: 'acc-INVENTORY_PROFIT', credit: 100 }),
      expect.objectContaining({ accountId: 'acc-INVENTORY_LOSS', debit: 30 }),
      expect.objectContaining({ accountId: 'acc-INVENTORY', credit: 30 }),
    ]));
    const groups = (resolvePostingAccounts_orExplain as jest.Mock).mock.calls.map((c) => c[2].itemGroupId).sort();
    expect(groups).toEqual(['g-bags', 'g-shoes']);
    expect(tx.inventoryJournal.update).toHaveBeenCalledWith({ where: { id: J }, data: { journal_entry_id: 'je-1' } });
  });

  it('credits opening balance equity for an OPENING journal', async () => {
    const tx = fakePostTx({
      id: J, journal_number: 'IJ-2', journal_type: 'OPENING', warehouse_id: WH, description: null,
      lines: [{ id: 'l1', product_id: 'shoe', variant_id: null, location_id: 'loc', quantity: 3, unit_cost: 40, notes: null }],
    });
    (resolveItemPolicies as jest.Mock).mockResolvedValue(new Map([['shoe', { stocked: true, itemGroupId: null, itemGroupCode: null }]]));
    (receiveIntoLocation as jest.Mock).mockResolvedValue({ transactionId: 't1', costAmount: 120 });
    (resolvePostingAccounts_orExplain as jest.Mock).mockImplementation(async (_t: string, types: string[]) =>
      Object.fromEntries(types.map((t) => [t, `acc-${t}`])));
    (postJournal as jest.Mock).mockResolvedValue({ id: 'je-2' });

    await postInventoryJournal('t1', J, 'u1', tx);
    expect((receiveIntoLocation as jest.Mock).mock.calls[0][1]).toMatchObject({ layerSource: 'OPENING', unitCost: 40 });
    expect((postJournal as jest.Mock).mock.calls[0][0].lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'acc-INVENTORY_OPENING_BALANCE', credit: 120 }),
    ]));
  });

  it('refuses a positive line with no cost history and no item cost, before any stock moves', async () => {
    const tx = fakePostTx({
      id: J, journal_number: 'IJ-3', journal_type: 'ADJUSTMENT', warehouse_id: WH, description: null,
      lines: [{ id: 'l1', product_id: 'new', variant_id: null, location_id: 'loc', quantity: 1, unit_cost: null, notes: null }],
    });
    (resolveItemPolicies as jest.Mock).mockResolvedValue(new Map([['new', { stocked: true }]]));
    await expect(postInventoryJournal('t1', J, 'u1', tx)).rejects.toMatchObject({ code: 'UNIT_COST_REQUIRED' });
    expect(receiveIntoLocation).not.toHaveBeenCalled();
    // The default cost looks only at OPEN layers in the journal's warehouse.
    expect(tx.inventoryCostLayer.findFirst.mock.calls[0][0].where).toMatchObject({ quantity: { gt: 0 }, location: { zone: { warehouse_id: WH } } });
  });

  it('refuses to post a journal that is no longer a draft', async () => {
    const tx = fakePostTx({});
    tx.inventoryJournal.updateMany.mockResolvedValue({ count: 0 });
    tx.inventoryJournal.findFirst.mockResolvedValue({ status: 'POSTED' });
    await expect(postInventoryJournal('t1', J, 'u1', tx)).rejects.toMatchObject({ code: 'JOURNAL_NOT_DRAFT' });
  });
});

describe('journal input rules', () => {
  it('refuses an opening balance that removes stock', async () => {
    await expect(validateJournalInput({} as any, 't1', {
      journal_type: 'OPENING', warehouse_id: WH, lines: [{ product_id: 'p', location_id: 'l', quantity: -1 }],
    })).rejects.toMatchObject({ code: 'OPENING_LINE_NEGATIVE' });
  });

  it('needs the cost override permission to enter a cost on an adjustment, not on an opening', () => {
    expect(() => assertMayEnterCost('store_manager', 'ADJUSTMENT', [{ quantity: 1, unit_cost: 5 }])).toThrow('inventory.journal.cost_override');
    expect(() => assertMayEnterCost('store_manager', 'ADJUSTMENT', [{ quantity: 1, unit_cost: null }])).not.toThrow();
    expect(() => assertMayEnterCost('store_manager', 'ADJUSTMENT', [{ quantity: -1, unit_cost: 5 }])).not.toThrow();
    expect(() => assertMayEnterCost('admin', 'ADJUSTMENT', [{ quantity: 1, unit_cost: 5 }])).not.toThrow();
  });
});

describe('OPENING journals are the admin’s on every write', () => {
  function asManager() {
    const app = new Hono<AppEnv>();
    const identity: MiddlewareHandler<AppEnv> = async (c, next) => {
      c.set('user', { id: 'u2', email: 'm@m.com', role: 'store_manager', tenantId: 't1' });
      c.set('tenantId', 't1');
      await next();
    };
    app.use('*', identity);
    app.route('/', journalRoutes);
    app.onError(errorHandler);
    return app;
  }
  const opening = { id: J, tenant_id: 't1', journal_type: 'OPENING', status: 'DRAFT', warehouse_id: WH, description: null, reason_code_id: null };

  it.each([
    ['PUT', `/${J}`, { lines: [{ product_id: WH, location_id: WH, quantity: 1 }] }],
    ['POST', `/${J}/post`, undefined],
    ['POST', `/${J}/cancel`, undefined],
  ])('refuses a store manager %s %s on an opening draft', async (method, path, body) => {
    mocked.inventoryJournal.findFirst.mockResolvedValue(opening);
    const res = await asManager().request(path, {
      method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    expect(res.status).toBe(403);
    expect(mocked.$transaction).not.toHaveBeenCalled();
    expect(mocked.inventoryJournal.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a store manager creating an opening journal', async () => {
    const res = await asManager().request('/', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ journal_type: 'OPENING', warehouse_id: WH, lines: [{ product_id: WH, location_id: WH, quantity: 1, unit_cost: 5 }] }),
    });
    expect(res.status).toBe(403);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });
});
