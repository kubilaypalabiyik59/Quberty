/**
 * Location containment guard for product receipts – WORK-051A / DEF-088.
 *
 * All tests exercise createAndPostReceipt with fully mocked DB and services;
 * no real DB connection or environment secrets are loaded.
 *
 * Acceptance cases:
 *   1. Bad explicit header location (not found)
 *   2. Bad PO default location (not found)
 *   3. Valid header + per-line location in wrong warehouse
 *   4. Inactive location
 *   5. Zone belonging to foreign tenant
 *   6. Valid same-warehouse locations – guard passes, allocateNumber called
 *   7. Location tenant_id foreign to caller
 *   8. Warehouse tenant_id foreign to caller
 *   9. Valid distinct header and per-line locations both pass
 *  10. Duplicate location IDs collapsed to single DB row
 */

import { createAndPostReceipt } from '../modules/purchase/productReceipt.service';
import { db } from '../infrastructure/database/client';

// ── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('../infrastructure/database/client', () => ({
  db: { $transaction: jest.fn() },
}));

jest.mock('../shared/services/numberSequence.service', () => ({
  allocateNumber: jest.fn().mockResolvedValue('PR-2026-00001'),
}));

jest.mock('../shared/services/journal.service', () => ({
  postJournal: jest.fn().mockResolvedValue({ id: 'je-1', entry_number: 'JE-001' }),
}));

jest.mock('../shared/services/itemPolicy.service', () => ({
  resolveItemPolicies: jest.fn().mockResolvedValue(new Map()),
  groupByItemGroup: jest.fn().mockReturnValue([]),
}));

jest.mock('../shared/services/posting.service', () => ({
  resolvePostingAccounts_orExplain: jest.fn().mockResolvedValue(null),
}));

jest.mock('../shared/services/documentTax.service', () => ({
  computePurchaseMoney: jest.fn().mockResolvedValue({ net: 500 }),
}));

jest.mock('../shared/services/warehouseParameters.service', () => ({
  resolveWarehouseParameters: jest.fn().mockResolvedValue({ requirePutaway: false }),
}));

jest.mock('../modules/warehouse/warehouse.service', () => ({
  WarehouseService: jest.fn().mockImplementation(() => ({
    resolvePutawayLocation: jest.fn().mockResolvedValue(null),
  })),
}));

jest.mock('../shared/services/currency/documentCurrency', () => ({
  assertDocumentCurrencySupported: jest
    .fn()
    .mockResolvedValue({ accountingCurrency: 'BOB' }),
}));

jest.mock('../shared/services/dimension.service', () => ({
  contextForPurchaseOrder: jest.fn().mockResolvedValue({}),
}));

jest.mock('../shared/services/inventoryTransactionStatus', () => ({
  physicalStatusFor: jest.fn().mockReturnValue({}),
}));

const { allocateNumber } = require('../shared/services/numberSequence.service');

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT = 'tenant-1';
const WAREHOUSE = 'wh-1';
const USER = 'user-1';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeValidPO(overrides: Record<string, any> = {}) {
  return {
    id: 'po-1',
    tenant_id: TENANT,
    po_number: 'PO-001',
    status: 'CONFIRMED',
    currency: 'BOB',
    supplier_id: 'sup-1',
    warehouse_id: WAREHOUSE,
    receive_location_id: null,
    received_at: null,
    lines: [
      {
        id: 'pol-1',
        product_id: 'prod-1',
        variant_id: null,
        quantity: '10',
        cancelled_qty: '0',
        received_qty: '0',
        unit_cost: '100',
      },
    ],
    ...overrides,
  };
}

function makeLocation(
  id: string,
  warehouseId = WAREHOUSE,
  opts: { is_active?: boolean; zoneTenant?: string; warehouseTenant?: string; locTenant?: string } = {},
) {
  return {
    id,
    tenant_id: opts.locTenant ?? TENANT,
    is_active: opts.is_active ?? true,
    zone: {
      tenant_id: opts.zoneTenant ?? TENANT,
      warehouse_id: warehouseId,
      warehouse: { tenant_id: opts.warehouseTenant ?? TENANT },
    },
  };
}

function makeTx(overrides: Record<string, any> = {}) {
  return {
    purchaseOrder: {
      findFirst: jest.fn().mockResolvedValue(makeValidPO()),
      update: jest.fn().mockResolvedValue({}),
    },
    purchaseParameters: {
      findFirst: jest.fn().mockResolvedValue({ post_product_receipt_in_ledger: false }),
    },
    arrivalJournal: {
      count: jest.fn().mockResolvedValue(0),
    },
    warehouseLocation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    productReceipt: {
      create: jest.fn().mockResolvedValue({ id: 'pr-1', receipt_number: 'PR-2026-00001', packing_slip: 'PS-001' }),
      update: jest.fn().mockResolvedValue({}),
    },
    productReceiptLine: { create: jest.fn().mockResolvedValue({}) },
    purchaseOrderLine: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([
        { quantity: '10', cancelled_qty: '0', received_qty: '10' },
      ]),
    },
    inventoryStock: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    inventoryTransaction: { create: jest.fn().mockResolvedValue({}) },
    inventoryCostLayer: { create: jest.fn().mockResolvedValue({}) },
    warehouseWork: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

const BASE_INPUT = {
  purchase_order_id: 'po-1',
  packing_slip: 'PS-001',
  location_id: 'loc-header' as string | null,
  lines: [{ po_line_id: 'pol-1', quantity: 5 }],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('productReceiptLocation – location containment guard (WORK-051A)', () => {
  beforeEach(() => jest.clearAllMocks());

  function withTx(tx: ReturnType<typeof makeTx>) {
    (db.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));
  }

  it('refuses bad explicit header location not found in DB', async () => {
    const tx = makeTx();
    tx.warehouseLocation.findMany.mockResolvedValue([]);
    withTx(tx);

    await expect(createAndPostReceipt(TENANT, USER, BASE_INPUT)).rejects.toMatchObject({
      code: 'RECEIVE_LOCATION_INVALID',
      statusCode: 422,
    });

    expect(tx.warehouseLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: expect.arrayContaining(['loc-header']) }, tenant_id: TENANT },
      }),
    );
    expect(allocateNumber).not.toHaveBeenCalled();
    expect(tx.productReceipt.create).not.toHaveBeenCalled();
    expect(tx.inventoryStock.create).not.toHaveBeenCalled();
  });

  it('refuses bad PO default location (no explicit header, PO default not found)', async () => {
    const tx = makeTx();
    tx.purchaseOrder.findFirst.mockResolvedValue(
      makeValidPO({ receive_location_id: 'loc-po-default' }),
    );
    tx.warehouseLocation.findMany.mockResolvedValue([]);
    withTx(tx);

    await expect(
      createAndPostReceipt(TENANT, USER, { ...BASE_INPUT, location_id: null }),
    ).rejects.toMatchObject({ code: 'RECEIVE_LOCATION_INVALID', statusCode: 422 });

    expect(tx.warehouseLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: expect.arrayContaining(['loc-po-default']) }, tenant_id: TENANT },
      }),
    );
    expect(allocateNumber).not.toHaveBeenCalled();
    expect(tx.productReceipt.create).not.toHaveBeenCalled();
  });

  it('refuses when a per-line location belongs to a different warehouse', async () => {
    const tx = makeTx();
    tx.warehouseLocation.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        (where.id.in as string[])
          .map(id => {
            if (id === 'loc-header') return makeLocation('loc-header', WAREHOUSE);
            if (id === 'loc-wrong-wh') return makeLocation('loc-wrong-wh', 'wh-other');
            return undefined;
          })
          .filter(Boolean),
      ),
    );
    withTx(tx);

    await expect(
      createAndPostReceipt(TENANT, USER, {
        ...BASE_INPUT,
        lines: [{ po_line_id: 'pol-1', quantity: 5, location_id: 'loc-wrong-wh' }],
      }),
    ).rejects.toMatchObject({ code: 'RECEIVE_LOCATION_INVALID', statusCode: 422 });

    expect(allocateNumber).not.toHaveBeenCalled();
    expect(tx.inventoryStock.create).not.toHaveBeenCalled();
  });

  it('refuses an inactive location', async () => {
    const tx = makeTx();
    tx.warehouseLocation.findMany.mockResolvedValue([
      makeLocation('loc-header', WAREHOUSE, { is_active: false }),
    ]);
    withTx(tx);

    await expect(createAndPostReceipt(TENANT, USER, BASE_INPUT)).rejects.toMatchObject({
      code: 'RECEIVE_LOCATION_INVALID',
      statusCode: 422,
    });

    expect(allocateNumber).not.toHaveBeenCalled();
    expect(tx.productReceipt.create).not.toHaveBeenCalled();
  });

  it('refuses a location whose zone belongs to a foreign tenant', async () => {
    const tx = makeTx();
    tx.warehouseLocation.findMany.mockResolvedValue([
      makeLocation('loc-header', WAREHOUSE, { zoneTenant: 'tenant-other' }),
    ]);
    withTx(tx);

    await expect(createAndPostReceipt(TENANT, USER, BASE_INPUT)).rejects.toMatchObject({
      code: 'RECEIVE_LOCATION_INVALID',
      statusCode: 422,
    });

    expect(allocateNumber).not.toHaveBeenCalled();
    expect(tx.productReceipt.create).not.toHaveBeenCalled();
  });

  it('passes the guard for valid same-warehouse locations and proceeds to allocateNumber', async () => {
    const tx = makeTx();
    tx.warehouseLocation.findMany.mockResolvedValue([
      makeLocation('loc-header', WAREHOUSE),
    ]);
    withTx(tx);

    await expect(createAndPostReceipt(TENANT, USER, BASE_INPUT)).resolves.toMatchObject({
      receipt_number: 'PR-2026-00001',
    });

    expect(allocateNumber).toHaveBeenCalledTimes(1);
    expect(tx.productReceipt.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a location whose tenant_id is foreign to the caller', async () => {
    const tx = makeTx();
    tx.warehouseLocation.findMany.mockResolvedValue([
      makeLocation('loc-header', WAREHOUSE, { locTenant: 'tenant-other' }),
    ]);
    withTx(tx);

    await expect(createAndPostReceipt(TENANT, USER, BASE_INPUT)).rejects.toMatchObject({
      code: 'RECEIVE_LOCATION_INVALID',
      statusCode: 422,
    });

    expect(allocateNumber).not.toHaveBeenCalled();
    expect(tx.productReceipt.create).not.toHaveBeenCalled();
    expect(tx.inventoryStock.create).not.toHaveBeenCalled();
    expect(tx.inventoryCostLayer.create).not.toHaveBeenCalled();
  });

  it('refuses a location whose zone warehouse belongs to a foreign tenant', async () => {
    const tx = makeTx();
    tx.warehouseLocation.findMany.mockResolvedValue([
      makeLocation('loc-header', WAREHOUSE, { warehouseTenant: 'tenant-other' }),
    ]);
    withTx(tx);

    await expect(createAndPostReceipt(TENANT, USER, BASE_INPUT)).rejects.toMatchObject({
      code: 'RECEIVE_LOCATION_INVALID',
      statusCode: 422,
    });

    expect(allocateNumber).not.toHaveBeenCalled();
    expect(tx.productReceipt.create).not.toHaveBeenCalled();
    expect(tx.inventoryStock.create).not.toHaveBeenCalled();
    expect(tx.inventoryCostLayer.create).not.toHaveBeenCalled();
  });

  it('passes the guard when header and per-line use distinct valid locations in the same warehouse', async () => {
    const po = makeValidPO({
      lines: [
        { id: 'pol-1', product_id: 'prod-1', variant_id: null, quantity: '10', cancelled_qty: '0', received_qty: '0', unit_cost: '100' },
        { id: 'pol-2', product_id: 'prod-2', variant_id: null, quantity: '5',  cancelled_qty: '0', received_qty: '0', unit_cost: '50'  },
      ],
    });
    const tx = makeTx();
    tx.purchaseOrder.findFirst.mockResolvedValue(po);
    tx.warehouseLocation.findMany.mockResolvedValue([
      makeLocation('loc-header', WAREHOUSE),
      makeLocation('loc-line', WAREHOUSE),
    ]);
    tx.purchaseOrderLine.findMany.mockResolvedValue([
      { quantity: '10', cancelled_qty: '0', received_qty: '10' },
      { quantity: '5',  cancelled_qty: '0', received_qty: '5'  },
    ]);
    withTx(tx);

    await expect(
      createAndPostReceipt(TENANT, USER, {
        ...BASE_INPUT,
        lines: [
          { po_line_id: 'pol-1', quantity: 5 },
          { po_line_id: 'pol-2', quantity: 3, location_id: 'loc-line' },
        ],
      }),
    ).resolves.toMatchObject({ receipt_number: 'PR-2026-00001' });

    expect(allocateNumber).toHaveBeenCalledTimes(1);
    expect(tx.warehouseLocation.findMany).toHaveBeenCalledTimes(1);
  });

  it('issues a single DB lookup when all lines share the header location (deduplication)', async () => {
    const tx = makeTx();
    tx.warehouseLocation.findMany.mockResolvedValue([makeLocation('loc-header', WAREHOUSE)]);
    withTx(tx);

    await createAndPostReceipt(TENANT, USER, BASE_INPUT);

    const call = tx.warehouseLocation.findMany.mock.calls[0][0];
    expect(call.where.id.in).toHaveLength(1);
    expect(call.where.id.in[0]).toBe('loc-header');
    expect(tx.warehouseLocation.findMany).toHaveBeenCalledTimes(1);
  });
});
