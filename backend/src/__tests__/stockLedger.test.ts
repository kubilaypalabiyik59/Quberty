/**
 * STOCK LEDGER (WORK-043/044)
 *
 * The primitives every stock movement goes through, against a scripted
 * transaction client:
 *   - a reservation that cannot be covered refuses the whole document before
 *     anything is held;
 *   - an issue only looks in the given warehouse, consumes FIFO layers at the
 *     issuing location, and its cost is the layers consumed — never a price;
 *   - an issue that layers cannot cover is refused under the REFUSE policy;
 *   - shipping refuses when the order does not hold exactly what it ships;
 *   - a void puts quantity back on the same layers; a return creates a new layer
 *     at the issued cost; a reversed settlement is never restored twice;
 *   - a move to the same location is refused.
 *
 * The database behaviour these rely on (row locks, CHECK constraints) is proven on
 * TEST by `verify:stock-ledger`.
 */

import {
  reserve,
  issueAvailable,
  issueReserved,
  restoreIssues,
  moveStock,
} from '../shared/services/stockLedger.service';

const TENANT = 't1';
const WH = 'wh-1';
const P = 'prod-1';
const LOC = 'loc-1';

function fakeTx(opts: {
  stock?: Array<{ id: string; quantity: number; reserved_qty: number; location_id: string }>;
  layers?: Array<{ id: string; quantity: number; unit_cost: number; received_at: Date }>;
  policy?: string;
  holds?: any[];
  issues?: any[];
}) {
  const stock = opts.stock ?? [];
  const layers = opts.layers ?? [];
  let txnSeq = 0;
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    product: {
      findMany: jest.fn().mockResolvedValue([{ id: P, name: 'Boot', sku: 'B-1', item_group: null, item_model_group: null }]),
      findFirst: jest.fn().mockResolvedValue({ cost_price: 999 }),
    },
    inventoryParameters: {
      findFirst: jest.fn().mockResolvedValue({ costing_method: 'FIFO', uncosted_issue_policy: opts.policy ?? 'REFUSE' }),
    },
    financeParameters: {
      findFirst: jest.fn().mockResolvedValue({
        legal_entity_id: null, accounting_currency_code: 'BOB', reporting_currency_code: 'BOB',
        accounting_rate_type_id: 'rt', reporting_rate_type_id: null, exchange_rate_date_basis: 'POSTING_DATE',
      }),
    },
    warehouseParameters: { findUnique: jest.fn().mockResolvedValue(null) },
    inventoryStock: {
      findMany: jest.fn(async (args: any) =>
        args.select ? stock.map((r) => ({ id: r.id })) : stock.map((r) => ({ ...r, product_id: P, variant_id: null }))),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => ({ ...stock.find((r) => r.id === where.id), product_id: P, variant_id: null })),
      findFirst: jest.fn().mockResolvedValue(stock[0] ? { id: stock[0].id } : null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 'new-stock' }),
    },
    inventoryReservation: {
      findMany: jest.fn().mockResolvedValue(opts.holds ?? []),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    inventoryCostLayer: {
      findMany: jest.fn(async (args: any) => (args.select ? layers.map((l) => ({ id: l.id })) : layers)),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    inventoryTransaction: {
      create: jest.fn(async () => ({ id: `itx-${++txnSeq}` })),
      findMany: jest.fn().mockResolvedValue(opts.issues ?? []),
    },
    inventoryCostSettlement: { create: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  return tx;
}

const meta = {
  tenantId: TENANT, transactionType: 'OUTBOUND' as const, referenceType: 'POS_SALE',
  referenceId: null, referenceNumber: 'SO-1', notes: 'sale', userId: 'u1',
};

describe('reserve()', () => {
  it('refuses the whole document when a line cannot be covered, holding nothing', async () => {
    const tx = fakeTx({ stock: [{ id: 's1', quantity: 3, reserved_qty: 2, location_id: LOC }] });
    await expect(reserve(tx, {
      tenantId: TENANT, sourceType: 'SALES_ORDER', sourceId: 'so-1', warehouseId: WH,
      lines: [{ product_id: P, variant_id: null, quantity: 2 }],
    })).rejects.toMatchObject({ statusCode: 409, code: 'STOCK_INSUFFICIENT' });
    expect(tx.inventoryStock.update).not.toHaveBeenCalled();
    expect(tx.inventoryReservation.create).not.toHaveBeenCalled();
  });

  it('holds free stock row by row and records each hold', async () => {
    const tx = fakeTx({ stock: [{ id: 's1', quantity: 5, reserved_qty: 1, location_id: LOC }] });
    await reserve(tx, {
      tenantId: TENANT, sourceType: 'SALES_ORDER', sourceId: 'so-1', warehouseId: WH,
      lines: [{ product_id: P, variant_id: null, quantity: 4 }],
    });
    expect(tx.inventoryStock.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { reserved_qty: { increment: 4 } } });
    expect(tx.inventoryReservation.create.mock.calls[0][0].data).toMatchObject({
      source_type: 'SALES_ORDER', source_id: 'so-1', stock_id: 's1', location_id: LOC, quantity: 4,
    });
  });
});

describe('issueAvailable()', () => {
  it('looks only in the given warehouse, for exactly the variant, and costs the issue from FIFO layers', async () => {
    const tx = fakeTx({
      stock: [{ id: 's1', quantity: 10, reserved_qty: 0, location_id: LOC }],
      layers: [
        { id: 'L-old', quantity: 1, unit_cost: 100, received_at: new Date('2026-01-01') },
        { id: 'L-new', quantity: 5, unit_cost: 120, received_at: new Date('2026-02-01') },
      ],
    });
    const r = await issueAvailable(tx, { warehouseId: WH, lines: [{ product_id: P, variant_id: null, quantity: 3 }], meta });

    const stockWhere = tx.inventoryStock.findMany.mock.calls[0][0].where;
    expect(stockWhere).toMatchObject({ tenant_id: TENANT, location: { zone: { warehouse_id: WH } }, OR: [{ product_id: P, variant_id: null }] });
    const layerWhere = tx.inventoryCostLayer.findMany.mock.calls[0][0].where;
    expect(layerWhere).toMatchObject({ location_id: LOC, product_id: P, variant_id: null });

    expect(r.costAmount).toBe(340); // 1 × 100 + 2 × 120 — not the 999 cost price
    expect(r.costByProduct.get(P)).toBe(340);
    expect(tx.inventoryCostSettlement.create).toHaveBeenCalledTimes(2);
    const txn = tx.inventoryTransaction.create.mock.calls[0][0].data;
    expect(txn).toMatchObject({ quantity: 3, cost_amount: 340, from_location_id: LOC });
    expect(txn.unit_cost).toBeCloseTo(113.3333, 4);
  });

  it('never takes stock someone else holds', async () => {
    const tx = fakeTx({ stock: [{ id: 's1', quantity: 4, reserved_qty: 3, location_id: LOC }] });
    await expect(issueAvailable(tx, { warehouseId: WH, lines: [{ product_id: P, variant_id: null, quantity: 2 }], meta }))
      .rejects.toMatchObject({ code: 'STOCK_INSUFFICIENT' });
    expect(tx.inventoryStock.update).not.toHaveBeenCalled();
  });

  it('refuses stock no cost layer covers under the REFUSE policy', async () => {
    const tx = fakeTx({
      stock: [{ id: 's1', quantity: 5, reserved_qty: 0, location_id: LOC }],
      layers: [{ id: 'L1', quantity: 1, unit_cost: 100, received_at: new Date() }],
    });
    await expect(issueAvailable(tx, { warehouseId: WH, lines: [{ product_id: P, variant_id: null, quantity: 2 }], meta }))
      .rejects.toMatchObject({ statusCode: 409, code: 'COST_LAYER_INSUFFICIENT' });
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('values the uncovered part at the item cost price, flagged, when the tenant allows it', async () => {
    const tx = fakeTx({
      stock: [{ id: 's1', quantity: 5, reserved_qty: 0, location_id: LOC }],
      layers: [{ id: 'L1', quantity: 1, unit_cost: 100, received_at: new Date() }],
      policy: 'ITEM_COST_PRICE_FLAGGED',
    });
    const r = await issueAvailable(tx, { warehouseId: WH, lines: [{ product_id: P, variant_id: null, quantity: 2 }], meta });
    expect(r.costAmount).toBe(1099);
    const sources = tx.inventoryCostSettlement.create.mock.calls.map((c: any) => c[0].data.cost_source);
    expect(sources).toEqual(['LAYER', 'ESTIMATED']);
  });
});

describe('issueReserved()', () => {
  it('refuses to ship when the order does not hold exactly what it ships', async () => {
    const tx = fakeTx({ holds: [{ id: 'h1', stock_id: 's1', product_id: P, variant_id: null, quantity: 1 }] });
    await expect(issueReserved(tx, {
      sourceType: 'SALES_ORDER', sourceId: 'so-1',
      lines: [{ product_id: P, variant_id: null, quantity: 2 }],
      meta: { ...meta, referenceType: 'SALES_ORDER', referenceId: 'so-1' },
    })).rejects.toMatchObject({ statusCode: 409, code: 'STOCK_NOT_RESERVED' });
    expect(tx.inventoryStock.update).not.toHaveBeenCalled();
  });

  it('issues the held rows, consuming the hold and the layers, and marks the hold consumed', async () => {
    const tx = fakeTx({
      stock: [{ id: 's1', quantity: 5, reserved_qty: 2, location_id: LOC }],
      layers: [{ id: 'L1', quantity: 5, unit_cost: 50, received_at: new Date() }],
      holds: [{ id: 'h1', stock_id: 's1', product_id: P, variant_id: null, quantity: 2 }],
    });
    const r = await issueReserved(tx, {
      sourceType: 'SALES_ORDER', sourceId: 'so-1',
      lines: [{ product_id: P, variant_id: null, quantity: 2 }],
      meta: { ...meta, referenceType: 'SALES_ORDER', referenceId: 'so-1' },
    });
    expect(tx.inventoryStock.update).toHaveBeenCalledWith({
      where: { id: 's1' }, data: { quantity: { decrement: 2 }, reserved_qty: { decrement: 2 } },
    });
    expect(tx.inventoryReservation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'h1' }, data: expect.objectContaining({ status: 'CONSUMED' }),
    }));
    expect(r.costAmount).toBe(100);
  });
});

describe('restoreIssues()', () => {
  const issue = {
    id: 'out-1', product_id: P, variant_id: null, from_location_id: LOC,
    settlements: [{ id: 'set-1', cost_layer_id: 'L1', quantity: 2, unit_cost: 80, cost_amount: 160, cost_currency_code: 'BOB' }],
  };
  const base = {
    tenantId: TENANT, issueTransactionIds: ['out-1'], referenceType: 'X', referenceId: 'so-1',
    referenceNumber: 'SO-1', notes: 'back', userId: 'u1',
  };

  it('puts a void back on the same layer at the location it left', async () => {
    const tx = fakeTx({ stock: [{ id: 's1', quantity: 0, reserved_qty: 0, location_id: LOC }], issues: [issue] });
    const r = await restoreIssues(tx, { ...base, mode: 'SAME_LAYERS', transactionType: 'VOID_RETURN' });
    expect(tx.inventoryCostLayer.update).toHaveBeenCalledWith({ where: { id: 'L1' }, data: { quantity: { increment: 2 } } });
    expect(tx.inventoryCostLayer.create).not.toHaveBeenCalled();
    expect(tx.inventoryCostSettlement.updateMany).toHaveBeenCalledWith({ where: { id: 'set-1', reversed_by_id: null }, data: { reversed_by_id: 'itx-1' } });
    expect(r.costAmount).toBe(160);
  });

  it('re-layers a return at the issued cost', async () => {
    const tx = fakeTx({ stock: [{ id: 's1', quantity: 0, reserved_qty: 0, location_id: LOC }], issues: [issue] });
    await restoreIssues(tx, { ...base, mode: 'NEW_LAYER', transactionType: 'RETURN' });
    expect(tx.inventoryCostLayer.create.mock.calls[0][0].data).toMatchObject({
      location_id: LOC, quantity: 2, unit_cost: 80, source_type: 'SALES_RETURN', origin_settlement_id: 'set-1',
    });
  });

  it('restores nothing for an issue whose settlements were already reversed', async () => {
    const tx = fakeTx({ issues: [{ ...issue, settlements: [] }] });
    const r = await restoreIssues(tx, { ...base, mode: 'NEW_LAYER', transactionType: 'RETURN' });
    expect(r.transactionIds).toEqual([]);
    expect(tx.inventoryStock.update).not.toHaveBeenCalled();
  });
});

describe('review findings (WORK-043/044)', () => {
  it('refuses to ship when the order holds a product it no longer lists', async () => {
    const tx = fakeTx({
      holds: [
        { id: 'h1', stock_id: 's1', product_id: P, variant_id: null, quantity: 2 },
        { id: 'h2', stock_id: 's2', product_id: 'prod-2', variant_id: null, quantity: 1 },
      ],
    });
    await expect(issueReserved(tx, {
      sourceType: 'SALES_ORDER', sourceId: 'so-1',
      lines: [{ product_id: P, variant_id: null, quantity: 2 }],
      meta: { ...meta, referenceType: 'SALES_ORDER', referenceId: 'so-1' },
    })).rejects.toMatchObject({ code: 'STOCK_NOT_RESERVED' });
    expect(tx.inventoryStock.update).not.toHaveBeenCalled();
  });

  it('costs an issue as the sum of its rounded settlements, so a reversal matches to the cent', async () => {
    const tx = fakeTx({
      stock: [{ id: 's1', quantity: 5, reserved_qty: 0, location_id: LOC }],
      layers: [
        { id: 'L1', quantity: 1, unit_cost: 88.4956, received_at: new Date('2026-01-01') },
        { id: 'L2', quantity: 1, unit_cost: 88.4956, received_at: new Date('2026-01-02') },
      ],
    });
    const r = await issueAvailable(tx, { warehouseId: WH, lines: [{ product_id: P, variant_id: null, quantity: 2 }], meta });
    const settled = tx.inventoryCostSettlement.create.mock.calls.reduce((s: number, c: any) => s + c[0].data.cost_amount, 0);
    expect(r.costAmount).toBe(177);
    expect(Math.round(settled * 100) / 100).toBe(177);
  });

  it('plans repeated lines of one product against the same rows without double-counting', async () => {
    const tx = fakeTx({ stock: [{ id: 's1', quantity: 3, reserved_qty: 0, location_id: LOC }] });
    await expect(reserve(tx, {
      tenantId: TENANT, sourceType: 'SALES_ORDER', sourceId: 'so-1', warehouseId: WH,
      lines: [{ product_id: P, variant_id: null, quantity: 2 }, { product_id: P, variant_id: null, quantity: 2 }],
    })).rejects.toMatchObject({ code: 'STOCK_INSUFFICIENT' });
    expect(tx.inventoryReservation.create).not.toHaveBeenCalled();
  });

  it('locks all candidate rows of all lines in one statement', async () => {
    const tx = fakeTx({ stock: [{ id: 's1', quantity: 5, reserved_qty: 0, location_id: LOC }] });
    await reserve(tx, {
      tenantId: TENANT, sourceType: 'SALES_ORDER', sourceId: 'so-1', warehouseId: WH,
      lines: [{ product_id: P, variant_id: null, quantity: 1 }, { product_id: P, variant_id: null, quantity: 1 }],
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('refuses to restore a settlement another transaction already reversed', async () => {
    const tx = fakeTx({
      stock: [{ id: 's1', quantity: 0, reserved_qty: 0, location_id: LOC }],
      issues: [{ id: 'out-1', product_id: P, variant_id: null, from_location_id: LOC,
        settlements: [{ id: 'set-1', cost_layer_id: 'L1', quantity: 1, unit_cost: 10, cost_amount: 10, cost_currency_code: 'BOB' }] }],
    });
    tx.inventoryCostSettlement.updateMany.mockResolvedValue({ count: 0 });
    await expect(restoreIssues(tx, {
      tenantId: TENANT, issueTransactionIds: ['out-1'], mode: 'SAME_LAYERS', transactionType: 'VOID_RETURN',
      referenceType: 'POS_VOID', referenceId: 'so-1', referenceNumber: 'SO-1', notes: 'void', userId: 'u1',
    })).rejects.toMatchObject({ code: 'SETTLEMENT_ALREADY_REVERSED' });
  });

  it('carries the holder with the goods when a pick moves reserved stock', async () => {
    const tx = fakeTx({
      stock: [{ id: 's1', quantity: 2, reserved_qty: 2, location_id: LOC }],
      holds: [{ id: 'h1', stock_id: 's1', product_id: P, variant_id: null, quantity: 2, source_line_id: null, source_type: 'SALES_ORDER', source_id: 'so-1' }],
    });
    tx.inventoryStock.findFirst = jest.fn()
      .mockResolvedValueOnce({ id: 's1' })   // source
      .mockResolvedValueOnce(null);          // no stock at the dock yet
    await moveStock(tx, {
      tenantId: TENANT, productId: P, variantId: null, fromLocationId: LOC, toLocationId: 'dock',
      quantity: 2, userId: 'u1', referenceType: 'WAREHOUSE_WORK', referenceNumber: 'W-1', notes: null,
      holdSource: { sourceType: 'SALES_ORDER', sourceId: 'so-1' },
    });
    expect(tx.inventoryStock.update).toHaveBeenCalledWith({
      where: { id: 's1' }, data: { quantity: { decrement: 2 }, reserved_qty: { decrement: 2 } },
    });
    expect(tx.inventoryStock.create.mock.calls[0][0].data).toMatchObject({ location_id: 'dock', quantity: 2, reserved_qty: 2 });
    expect(tx.inventoryReservation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'h1' }, data: expect.objectContaining({ status: 'RELEASED' }) }));
    expect(tx.inventoryReservation.create.mock.calls[0][0].data).toMatchObject({ location_id: 'dock', quantity: 2, source_id: 'so-1' });
  });
});

describe('moveStock()', () => {
  it('refuses a move to the same location', async () => {
    const tx = fakeTx({});
    await expect(moveStock(tx, {
      tenantId: TENANT, productId: P, variantId: null, fromLocationId: LOC, toLocationId: LOC,
      quantity: 1, userId: 'u1', referenceType: 'transfer', referenceNumber: null, notes: null,
    })).rejects.toMatchObject({ code: 'MOVE_SAME_LOCATION' });
  });

  it('only moves unreserved stock unless the move carries the holder', async () => {
    const tx = fakeTx({ stock: [{ id: 's1', quantity: 3, reserved_qty: 3, location_id: LOC }] });
    await expect(moveStock(tx, {
      tenantId: TENANT, productId: P, variantId: null, fromLocationId: LOC, toLocationId: 'loc-2',
      quantity: 1, userId: 'u1', referenceType: 'transfer', referenceNumber: null, notes: null,
    })).rejects.toMatchObject({ code: 'MOVE_SOURCE_STOCK_INSUFFICIENT' });
  });
});
