/**
 * ORDER COUNTER FORMAT TESTS
 * Tests the number-to-string formatting logic without hitting the DB.
 *
 * The production code issues TWO different Prisma calls, and the mock has to
 * carry both or nothing runs:
 *
 *   maxDocSuffix()  -> db.$queryRawUnsafe(sql, tenantId)  -> [{ max }]
 *                      (an interpolated table/column name, so it cannot be a
 *                       tagged template) — used ONLY by the sales and purchase
 *                       numbers, to let the counter self-heal past documents
 *                       created before the counter row existed.
 *   nextCounter()   -> db.$queryRaw`...`                  -> [{ last_number }]
 *                      (tagged template, the atomic UPSERT) — used by every
 *                       document type.
 *
 * The earlier version of this file mocked only $queryRaw, so every code path
 * that goes through maxDocSuffix threw
 * "client_1.db.$queryRawUnsafe is not a function". No database connection is
 * attempted here, then or now.
 */

// Mock the entire db client before any imports
jest.mock('../infrastructure/database/client', () => ({
  db: {
    $queryRaw:       jest.fn(),
    $queryRawUnsafe: jest.fn(),
  },
}));

import { db } from '../infrastructure/database/client';
import {
  nextSalesOrderNumber,
  nextPurchaseOrderNumber,
  nextInventoryAdjNumber,
  nextTransferNumber,
} from '../shared/utils/orderCounter';

const mockQueryRaw       = db.$queryRaw as jest.Mock;
const mockQueryRawUnsafe = db.$queryRawUnsafe as jest.Mock;
const TENANT = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const YEAR   = new Date().getFullYear();

/** The counter the atomic UPSERT hands back. */
function counterReturns(lastNumber: number) {
  mockQueryRaw.mockResolvedValue([{ last_number: lastNumber }]);
}

/** The highest suffix already present in the documents table. */
function maxSuffixReturns(max: number) {
  mockQueryRawUnsafe.mockResolvedValue([{ max }]);
}

beforeEach(() => {
  mockQueryRaw.mockReset();
  mockQueryRawUnsafe.mockReset();
  // A default for the tests that are about formatting rather than the max query.
  maxSuffixReturns(0);
});

// ── Sales Order Numbers ───────────────────────────────────────────────────────

describe('nextSalesOrderNumber()', () => {
  it('formats first order correctly', async () => {
    counterReturns(1);
    const result = await nextSalesOrderNumber(TENANT);
    expect(result).toBe(`SO-${YEAR}-00001`);
  });

  it('pads number to 5 digits', async () => {
    counterReturns(42);
    const result = await nextSalesOrderNumber(TENANT);
    expect(result).toBe(`SO-${YEAR}-00042`);
  });

  it('handles large numbers without padding', async () => {
    counterReturns(100000);
    const result = await nextSalesOrderNumber(TENANT);
    expect(result).toBe(`SO-${YEAR}-100000`);
  });

  it('prefixes with SO', async () => {
    counterReturns(5);
    const result = await nextSalesOrderNumber(TENANT);
    expect(result).toMatch(/^SO-/);
  });

  it('includes current year', async () => {
    counterReturns(1);
    const result = await nextSalesOrderNumber(TENANT);
    expect(result).toContain(String(YEAR));
  });
});

// ── Purchase Order Numbers ────────────────────────────────────────────────────

describe('nextPurchaseOrderNumber()', () => {
  it('formats correctly', async () => {
    counterReturns(7);
    const result = await nextPurchaseOrderNumber(TENANT);
    expect(result).toBe(`PO-${YEAR}-00007`);
  });

  it('prefixes with PO', async () => {
    counterReturns(1);
    const result = await nextPurchaseOrderNumber(TENANT);
    expect(result).toMatch(/^PO-/);
  });
});

// ── Inventory Adjustment Numbers ──────────────────────────────────────────────

describe('nextInventoryAdjNumber()', () => {
  it('formats correctly', async () => {
    counterReturns(3);
    const result = await nextInventoryAdjNumber(TENANT);
    expect(result).toBe(`ADJ-${YEAR}-00003`);
  });
});

// ── Transfer Numbers ──────────────────────────────────────────────────────────

describe('nextTransferNumber()', () => {
  it('formats correctly', async () => {
    counterReturns(12);
    const result = await nextTransferNumber(TENANT);
    expect(result).toBe(`TRF-${YEAR}-00012`);
  });
});

// ── DB call verification ──────────────────────────────────────────────────────

describe('DB interaction', () => {
  it('reads the current maximum suffix, then advances the counter', async () => {
    counterReturns(1);
    await nextSalesOrderNumber(TENANT);

    // Two queries, one of each kind — not one, as this suite used to assert
    // before maxDocSuffix existed.
    expect(mockQueryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('scopes the maximum-suffix query to the tenant, table and column', async () => {
    counterReturns(1);
    await nextSalesOrderNumber(TENANT);

    const [sql, tenantId] = mockQueryRawUnsafe.mock.calls[0] as [string, string];
    // Asserted by content, not by layout: the SQL is a formatted template and
    // its whitespace is not part of the contract.
    expect(sql).toContain('sales_orders');
    expect(sql).toContain('order_number');
    expect(tenantId).toBe(TENANT);
  });

  it('scopes the maximum-suffix query to the purchase table and column', async () => {
    counterReturns(1);
    await nextPurchaseOrderNumber(TENANT);

    const [sql, tenantId] = mockQueryRawUnsafe.mock.calls[0] as [string, string];
    expect(sql).toContain('purchase_orders');
    expect(sql).toContain('po_number');
    expect(tenantId).toBe(TENANT);
  });

  it('advances the counter against the order_counters table', async () => {
    counterReturns(1);
    await nextSalesOrderNumber(TENANT);

    // $queryRaw is a tagged template — the first argument is the string array.
    const call     = mockQueryRaw.mock.calls[0];
    const sqlParts = call[0] as string[];
    expect(sqlParts.join('')).toContain('order_counters');
    // The tenant and the document type travel as interpolated values.
    expect(call).toContain(TENANT);
    expect(call).toContain('SO');
  });

  it('does not read a maximum suffix for document types that have no table to scan', async () => {
    counterReturns(3);
    await nextInventoryAdjNumber(TENANT);

    // Adjustments and transfers go straight to the atomic counter.
    expect(mockQueryRawUnsafe).not.toHaveBeenCalled();
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });
});
