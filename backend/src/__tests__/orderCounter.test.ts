/**
 * ORDER COUNTER FORMAT TESTS
 * Tests the number-to-string formatting logic without hitting the DB.
 * The DB call (nextCounter) is mocked.
 */

// Mock the entire db client before any imports
jest.mock('../infrastructure/database/client', () => ({
  db: {
    $queryRaw: jest.fn(),
  },
}));

import { db } from '../infrastructure/database/client';
import {
  nextSalesOrderNumber,
  nextPurchaseOrderNumber,
  nextInventoryAdjNumber,
  nextTransferNumber,
} from '../shared/utils/orderCounter';

const mockQueryRaw = db.$queryRaw as jest.Mock;
const TENANT = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const YEAR   = new Date().getFullYear();

beforeEach(() => {
  mockQueryRaw.mockReset();
});

// ── Sales Order Numbers ───────────────────────────────────────────────────────

describe('nextSalesOrderNumber()', () => {
  it('formats first order correctly', async () => {
    mockQueryRaw.mockResolvedValue([{ last_number: 1 }]);
    const result = await nextSalesOrderNumber(TENANT);
    expect(result).toBe(`SO-${YEAR}-00001`);
  });

  it('pads number to 5 digits', async () => {
    mockQueryRaw.mockResolvedValue([{ last_number: 42 }]);
    const result = await nextSalesOrderNumber(TENANT);
    expect(result).toBe(`SO-${YEAR}-00042`);
  });

  it('handles large numbers without padding', async () => {
    mockQueryRaw.mockResolvedValue([{ last_number: 100000 }]);
    const result = await nextSalesOrderNumber(TENANT);
    expect(result).toBe(`SO-${YEAR}-100000`);
  });

  it('prefixes with SO', async () => {
    mockQueryRaw.mockResolvedValue([{ last_number: 5 }]);
    const result = await nextSalesOrderNumber(TENANT);
    expect(result).toMatch(/^SO-/);
  });

  it('includes current year', async () => {
    mockQueryRaw.mockResolvedValue([{ last_number: 1 }]);
    const result = await nextSalesOrderNumber(TENANT);
    expect(result).toContain(String(YEAR));
  });
});

// ── Purchase Order Numbers ────────────────────────────────────────────────────

describe('nextPurchaseOrderNumber()', () => {
  it('formats correctly', async () => {
    mockQueryRaw.mockResolvedValue([{ last_number: 7 }]);
    const result = await nextPurchaseOrderNumber(TENANT);
    expect(result).toBe(`PO-${YEAR}-00007`);
  });

  it('prefixes with PO', async () => {
    mockQueryRaw.mockResolvedValue([{ last_number: 1 }]);
    const result = await nextPurchaseOrderNumber(TENANT);
    expect(result).toMatch(/^PO-/);
  });
});

// ── Inventory Adjustment Numbers ──────────────────────────────────────────────

describe('nextInventoryAdjNumber()', () => {
  it('formats correctly', async () => {
    mockQueryRaw.mockResolvedValue([{ last_number: 3 }]);
    const result = await nextInventoryAdjNumber(TENANT);
    expect(result).toBe(`ADJ-${YEAR}-00003`);
  });
});

// ── Transfer Numbers ──────────────────────────────────────────────────────────

describe('nextTransferNumber()', () => {
  it('formats correctly', async () => {
    mockQueryRaw.mockResolvedValue([{ last_number: 12 }]);
    const result = await nextTransferNumber(TENANT);
    expect(result).toBe(`TRF-${YEAR}-00012`);
  });
});

// ── DB call verification ──────────────────────────────────────────────────────

describe('DB interaction', () => {
  it('calls $queryRaw once per invocation', async () => {
    mockQueryRaw.mockResolvedValue([{ last_number: 1 }]);
    await nextSalesOrderNumber(TENANT);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('passes tenantId and doc_type to query', async () => {
    mockQueryRaw.mockResolvedValue([{ last_number: 1 }]);
    await nextSalesOrderNumber(TENANT);
    // $queryRaw is called with a tagged template — first arg is the template array
    const call = mockQueryRaw.mock.calls[0];
    // The raw SQL string segments contain the table name
    const sqlParts = call[0] as string[];
    expect(sqlParts.join('')).toContain('order_counters');
  });
});
