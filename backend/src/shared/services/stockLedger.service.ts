import { Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError';
import { physicalStatusFor } from './inventoryTransactionStatus';
import { resolveItemPolicies } from './itemPolicy.service';
import { availabilityLocationFilter, resolveWarehouseParameters } from './warehouseParameters.service';
import { getLedgerCurrencies } from './currency/ledgerCurrency.service';

/**
 * The one place stock quantity and stock cost move (WORK-043/044).
 *
 * Every path that used to deduct, reserve or restore stock on its own — ERP
 * shipment, storefront checkout, POS sale and void, customer return, transfer and
 * warehouse work — now calls these primitives inside the caller's transaction.
 *
 *   reserve          holds stock rows for a source document (InventoryReservation)
 *   release          frees exactly that document's holds
 *   issueReserved    ships what a document reserved, where it reserved it
 *   issueAvailable   issues unreserved stock from a warehouse (the till)
 *   restoreIssues    puts issued stock back, on the same layers or as a new layer
 *   moveStock        moves stock, its layers and any holds between two locations
 *
 * **Costing.** Perpetual FIFO with issue-to-layer settlement, the item-application
 * model: learn.microsoft.com/dynamics365/business-central/design-details-costing-methods.
 * Layers are consumed at the ISSUING LOCATION, oldest first. Layers follow the
 * goods (receipt, putaway, transfer and work moves all carry them), so the layers
 * at a location are exactly the cost of the stock at that location. COGS is the
 * sum of the settlements an issue wrote — never `Product.cost_price`.
 *
 * **Concurrency.** Stock rows and layers are locked `FOR UPDATE` before they are
 * read for a decision, and the database refuses a negative quantity or a hold
 * larger than the stock (migration 037), so two tills cannot sell the last pair.
 */

type Tx = Prisma.TransactionClient;

export type ReservationSource = 'SALES_ORDER' | 'TRANSFER' | 'WORK';

export interface StockLineRef {
  product_id: string;
  variant_id: string | null;
  quantity: number;
  line_id?: string | null;
}

export interface IssueMeta {
  tenantId: string;
  transactionType: 'OUTBOUND' | 'TRANSFER_OUT' | 'PURCHASE_RETURN' | 'ADJUSTMENT';
  referenceType: string;
  referenceId: string | null;
  referenceNumber: string | null;
  notes: string;
  userId: string | null;
}

export interface IssueResult {
  /** Total cost consumed, rounded to cents. */
  costAmount: number;
  /** Cost consumed per product, for COGS by item group. */
  costByProduct: Map<string, number>;
  transactionIds: string[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

async function lockStockRows(tx: Tx, ids: string[]) {
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM inventory_stock WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
}

async function lockLayers(tx: Tx, ids: string[]) {
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM inventory_cost_layers WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
}

function productLabel(line: { product_id: string }, names: Map<string, string>) {
  return names.get(line.product_id) ?? line.product_id;
}

async function productNames(tx: Tx, tenantId: string, ids: string[]) {
  const rows = await tx.product.findMany({
    where: { tenant_id: tenantId, id: { in: [...new Set(ids)] } },
    select: { id: true, name: true, sku: true },
  });
  return new Map(rows.map((p) => [p.id, `${p.name} (${p.sku})`]));
}

/**
 * The stock rows availability counts for every line of a document, in one warehouse.
 *
 * All candidate rows of all lines are locked in ONE statement, sorted by id, before
 * anything is planned. Locking line by line let two documents with the same
 * products in a different order ([X, Y] and [Y, X]) take the locks in opposite
 * orders and deadlock.
 */
async function countableRowsForLines(
  tx: Tx,
  tenantId: string,
  warehouseId: string,
  lines: Array<{ product_id: string; variant_id: string | null }>,
) {
  const params = await resolveWarehouseParameters(warehouseId, tx);
  const location = { zone: { warehouse_id: warehouseId }, ...(availabilityLocationFilter(params) ?? {}) };
  const pairs = [...new Map(lines.map((l) => [`${l.product_id}|${l.variant_id ?? ''}`, l])).values()];
  const candidates = await tx.inventoryStock.findMany({
    where: {
      tenant_id: tenantId,
      location,
      OR: pairs.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id })),
    },
    select: { id: true },
  });
  const ids = candidates.map((r) => r.id).sort();
  await lockStockRows(tx, ids);
  const rows = await tx.inventoryStock.findMany({
    where: { id: { in: ids } },
    orderBy: [{ quantity: 'desc' }, { id: 'asc' }],
  });
  return (productId: string, variantId: string | null) =>
    rows.filter((r) => r.product_id === productId && (r.variant_id ?? null) === (variantId ?? null));
}

async function stockedLines<T extends { product_id: string }>(tx: Tx, tenantId: string, lines: T[]) {
  const policies = await resolveItemPolicies(tenantId, lines.map((l) => l.product_id), tx);
  return lines.filter((l) => policies.get(l.product_id)?.stocked !== false);
}

// ── Reservations ──────────────────────────────────────────────────────────────

/**
 * Hold stock for every stocked line of a source document in one warehouse.
 * Refuses the whole document with 409 STOCK_INSUFFICIENT when any line cannot be
 * covered, before anything is held.
 */
export async function reserve(
  tx: Tx,
  opts: { tenantId: string; sourceType: ReservationSource; sourceId: string; warehouseId: string; lines: StockLineRef[] },
): Promise<void> {
  const lines = await stockedLines(tx, opts.tenantId, opts.lines);
  const plan: Array<{ line: StockLineRef; stockId: string; locationId: string; quantity: number }> = [];
  const shortages: string[] = [];
  const names = await productNames(tx, opts.tenantId, lines.map((l) => l.product_id));

  // Merge repeated product/variant lines so one row is never planned twice.
  const taken = new Map<string, number>();
  const rowsFor = await countableRowsForLines(tx, opts.tenantId, opts.warehouseId, lines);
  for (const line of lines) {
    const rows = rowsFor(line.product_id, line.variant_id);
    let remaining = line.quantity;
    for (const row of rows) {
      const free = row.quantity - row.reserved_qty - (taken.get(row.id) ?? 0);
      if (free <= 0) continue;
      const hold = Math.min(free, remaining);
      plan.push({ line, stockId: row.id, locationId: row.location_id, quantity: hold });
      taken.set(row.id, (taken.get(row.id) ?? 0) + hold);
      remaining -= hold;
      if (remaining === 0) break;
    }
    if (remaining > 0) {
      shortages.push(`${productLabel(line, names)}: available ${line.quantity - remaining}, required ${line.quantity}`);
    }
  }

  if (shortages.length) {
    throw new AppError(`Insufficient stock in the order's warehouse — ${shortages.join('; ')}`, 409, 'STOCK_INSUFFICIENT');
  }

  for (const p of plan) {
    await tx.inventoryStock.update({ where: { id: p.stockId }, data: { reserved_qty: { increment: p.quantity } } });
    await tx.inventoryReservation.create({
      data: {
        tenant_id: opts.tenantId,
        source_type: opts.sourceType,
        source_id: opts.sourceId,
        source_line_id: p.line.line_id ?? null,
        stock_id: p.stockId,
        product_id: p.line.product_id,
        variant_id: p.line.variant_id,
        location_id: p.locationId,
        quantity: p.quantity,
      },
    });
  }
}

/** Free every ACTIVE hold of one source document — and nothing else. Returns the quantity freed. */
export async function release(
  tx: Tx,
  opts: { tenantId: string; sourceType: ReservationSource; sourceId: string },
): Promise<number> {
  const holds = await tx.inventoryReservation.findMany({
    where: { tenant_id: opts.tenantId, source_type: opts.sourceType, source_id: opts.sourceId, status: 'ACTIVE' },
  });
  await lockStockRows(tx, holds.map((h) => h.stock_id));
  let freed = 0;
  for (const h of holds) {
    await tx.inventoryStock.update({ where: { id: h.stock_id }, data: { reserved_qty: { decrement: h.quantity } } });
    await tx.inventoryReservation.update({ where: { id: h.id }, data: { status: 'RELEASED', released_at: new Date() } });
    freed += h.quantity;
  }
  return freed;
}

// ── Issues ────────────────────────────────────────────────────────────────────

/**
 * Issue `quantity` from one stock row, consuming its location's layers oldest
 * first and writing one settlement per layer. The caller has locked the row.
 */
async function issueFromRow(
  tx: Tx,
  row: { id: string; location_id: string; product_id: string; variant_id: string | null },
  quantity: number,
  opts: { fromHold: boolean; meta: IssueMeta; currency: string; policy: string },
): Promise<{ transactionId: string; costAmount: number }> {
  const { meta } = opts;

  await tx.inventoryStock.update({
    where: { id: row.id },
    data: {
      quantity: { decrement: quantity },
      ...(opts.fromHold ? { reserved_qty: { decrement: quantity } } : {}),
    },
  });

  const layerIds = (await tx.inventoryCostLayer.findMany({
    where: {
      tenant_id: meta.tenantId,
      product_id: row.product_id,
      variant_id: row.variant_id,
      location_id: row.location_id,
      quantity: { gt: 0 },
    },
    select: { id: true },
  })).map((l) => l.id);
  await lockLayers(tx, layerIds);
  const layers = await tx.inventoryCostLayer.findMany({
    where: { id: { in: layerIds } },
    orderBy: [{ received_at: 'asc' }, { id: 'asc' }],
  });

  const consumed: Array<{ layerId: string | null; quantity: number; unitCost: number; source: 'LAYER' | 'ESTIMATED' }> = [];
  let remaining = quantity;
  for (const layer of layers) {
    if (remaining === 0) break;
    const take = Math.min(layer.quantity, remaining);
    await tx.inventoryCostLayer.update({ where: { id: layer.id }, data: { quantity: { decrement: take } } });
    consumed.push({ layerId: layer.id, quantity: take, unitCost: Number(layer.unit_cost), source: 'LAYER' });
    remaining -= take;
  }

  if (remaining > 0) {
    if (opts.policy !== 'ITEM_COST_PRICE_FLAGGED') {
      throw new AppError(
        `Cannot issue ${quantity} of product ${row.product_id}: only ${quantity - remaining} is covered by cost layers ` +
          `at that location, so its cost is unknown. Post the missing stock through a receipt or an inventory ` +
          `journal, or set Inventory parameters → uncosted issues to use the item cost price.`,
        409,
        'COST_LAYER_INSUFFICIENT',
      );
    }
    const product = await tx.product.findFirst({ where: { id: row.product_id }, select: { cost_price: true } });
    consumed.push({ layerId: null, quantity: remaining, unitCost: Number(product?.cost_price ?? 0), source: 'ESTIMATED' });
  }

  // The issue's cost is the sum of its settlements AS WRITTEN (each rounded to the
  // cent), so COGS, the movement and any later reversal of those settlements are
  // the same figure to the cent.
  const costAmount = round2(consumed.reduce((s, c) => s + round2(c.quantity * c.unitCost), 0));
  const txn = await tx.inventoryTransaction.create({
    data: {
      tenant_id: meta.tenantId,
      transaction_type: meta.transactionType,
      // An adjustment's direction is not in its type; this is always an issue.
      ...physicalStatusFor(meta.transactionType, { delta: -quantity }),
      reference_type: meta.referenceType,
      reference_id: meta.referenceId,
      reference_number: meta.referenceNumber,
      product_id: row.product_id,
      variant_id: row.variant_id,
      from_location_id: row.location_id,
      quantity,
      unit_cost: round4(costAmount / quantity),
      cost_amount: costAmount,
      cost_layer_id: consumed.length === 1 ? consumed[0].layerId : null,
      notes: meta.notes,
      performed_by: meta.userId,
    },
    select: { id: true },
  });

  for (const c of consumed) {
    await tx.inventoryCostSettlement.create({
      data: {
        tenant_id: meta.tenantId,
        inventory_transaction_id: txn.id,
        cost_layer_id: c.layerId,
        quantity: c.quantity,
        unit_cost: c.unitCost,
        cost_amount: round2(c.quantity * c.unitCost),
        cost_currency_code: opts.currency,
        cost_source: c.source,
      },
    });
  }

  return { transactionId: txn.id, costAmount };
}

async function issueContext(tx: Tx, tenantId: string) {
  const [ledger, params] = await Promise.all([
    getLedgerCurrencies(tenantId, null, tx),
    tx.inventoryParameters.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: null },
      select: { uncosted_issue_policy: true },
    }),
  ]);
  return { currency: ledger.accountingCurrency, policy: params?.uncosted_issue_policy ?? 'REFUSE' };
}

function addCost(result: IssueResult, productId: string, r: { transactionId: string; costAmount: number }) {
  result.transactionIds.push(r.transactionId);
  result.costAmount = round2(result.costAmount + r.costAmount);
  result.costByProduct.set(productId, round2((result.costByProduct.get(productId) ?? 0) + r.costAmount));
}

/**
 * Ship everything a source document holds, from the rows it holds. Refuses with
 * 409 STOCK_NOT_RESERVED when a stocked line is not fully held — shipping never
 * reaches for stock the order did not reserve.
 */
export async function issueReserved(
  tx: Tx,
  opts: { sourceType: ReservationSource; sourceId: string; lines: StockLineRef[]; meta: IssueMeta },
): Promise<IssueResult> {
  const { meta } = opts;
  const result: IssueResult = { costAmount: 0, costByProduct: new Map(), transactionIds: [] };
  const lines = await stockedLines(tx, meta.tenantId, opts.lines);
  if (lines.length === 0) return result;

  const holds = await tx.inventoryReservation.findMany({
    where: { tenant_id: meta.tenantId, source_type: opts.sourceType, source_id: opts.sourceId, status: 'ACTIVE' },
    orderBy: { created_at: 'asc' },
  });

  const key = (p: string, v: string | null) => `${p}|${v ?? ''}`;
  const held = new Map<string, number>();
  for (const h of holds) held.set(key(h.product_id, h.variant_id), (held.get(key(h.product_id, h.variant_id)) ?? 0) + h.quantity);
  const wanted = new Map<string, number>();
  for (const l of lines) wanted.set(key(l.product_id, l.variant_id), (wanted.get(key(l.product_id, l.variant_id)) ?? 0) + l.quantity);
  const keys = new Set([...wanted.keys(), ...held.keys()]);
  const missing = [...keys].filter((k) => (held.get(k) ?? 0) !== (wanted.get(k) ?? 0));
  if (missing.length) {
    throw new AppError(
      `${meta.referenceNumber ?? 'The order'} does not hold exactly the stock it ships ` +
        `(${missing.length} line(s) differ). Confirm the order again so its stock is reserved.`,
      409,
      'STOCK_NOT_RESERVED',
    );
  }

  const ctx = await issueContext(tx, meta.tenantId);
  await lockStockRows(tx, holds.map((h) => h.stock_id));
  for (const h of holds) {
    const row = await tx.inventoryStock.findUniqueOrThrow({ where: { id: h.stock_id } });
    const r = await issueFromRow(tx, row, h.quantity, { fromHold: true, meta, ...ctx });
    addCost(result, h.product_id, r);
    await tx.inventoryReservation.update({ where: { id: h.id }, data: { status: 'CONSUMED', released_at: new Date() } });
  }
  return result;
}

/**
 * Issue unreserved stock of each line from a warehouse — the register's own store.
 * Refuses the whole sale with 409 STOCK_INSUFFICIENT before anything is written
 * when a line cannot be covered by stock nobody else holds.
 */
export async function issueAvailable(
  tx: Tx,
  opts: { warehouseId: string; lines: StockLineRef[]; meta: IssueMeta },
): Promise<IssueResult> {
  const { meta } = opts;
  const result: IssueResult = { costAmount: 0, costByProduct: new Map(), transactionIds: [] };
  const lines = await stockedLines(tx, meta.tenantId, opts.lines);
  if (lines.length === 0) return result;

  const ctx = await issueContext(tx, meta.tenantId);
  const names = await productNames(tx, meta.tenantId, lines.map((l) => l.product_id));

  const plan: Array<{ row: any; quantity: number; productId: string }> = [];
  const taken = new Map<string, number>();
  const shortages: string[] = [];
  const rowsFor = await countableRowsForLines(tx, meta.tenantId, opts.warehouseId, lines);
  for (const line of lines) {
    const rows = rowsFor(line.product_id, line.variant_id);
    let remaining = line.quantity;
    for (const row of rows) {
      const free = row.quantity - row.reserved_qty - (taken.get(row.id) ?? 0);
      if (free <= 0) continue;
      const take = Math.min(free, remaining);
      plan.push({ row, quantity: take, productId: line.product_id });
      taken.set(row.id, (taken.get(row.id) ?? 0) + take);
      remaining -= take;
      if (remaining === 0) break;
    }
    if (remaining > 0) {
      shortages.push(`${productLabel(line, names)}: available ${line.quantity - remaining}, requested ${line.quantity}`);
    }
  }
  if (shortages.length) {
    throw new AppError(`Insufficient stock in this warehouse — ${shortages.join('; ')}`, 409, 'STOCK_INSUFFICIENT');
  }

  for (const p of plan) {
    addCost(result, p.productId, await issueFromRow(tx, p.row, p.quantity, { fromHold: false, meta, ...ctx }));
  }
  return result;
}

/**
 * Issue unreserved stock of one product/variant from one location — a negative
 * inventory journal line. Refuses with 409 STOCK_INSUFFICIENT when the location
 * does not have that much stock nobody else holds.
 */
export async function issueFromLocation(
  tx: Tx,
  opts: { locationId: string; productId: string; variantId: string | null; quantity: number; meta: IssueMeta },
): Promise<{ transactionId: string; costAmount: number }> {
  const { meta } = opts;
  const ref = await tx.inventoryStock.findFirst({
    where: { tenant_id: meta.tenantId, product_id: opts.productId, variant_id: opts.variantId, location_id: opts.locationId },
    select: { id: true },
  });
  if (ref) await lockStockRows(tx, [ref.id]);
  const row = ref ? await tx.inventoryStock.findUniqueOrThrow({ where: { id: ref.id } }) : null;
  const free = row ? row.quantity - row.reserved_qty : 0;
  if (!row || free < opts.quantity) {
    throw new AppError(
      `Cannot remove ${opts.quantity} of product ${opts.productId} at that location: only ${free} is on hand and not held by an order.`,
      409,
      'STOCK_INSUFFICIENT',
    );
  }
  const ctx = await issueContext(tx, meta.tenantId);
  return issueFromRow(tx, row, opts.quantity, { fromHold: false, meta, ...ctx });
}

/**
 * Receive stock into one location at a stated unit cost, creating its cost layer
 * and the inbound movement — a positive inventory journal line, or an opening
 * balance.
 */
export async function receiveIntoLocation(
  tx: Tx,
  opts: {
    tenantId: string;
    locationId: string;
    productId: string;
    variantId: string | null;
    quantity: number;
    unitCost: number;
    layerSource: 'ADJUSTMENT' | 'COUNT' | 'OPENING';
    referenceType: string;
    referenceId: string | null;
    referenceNumber: string | null;
    notes: string;
    userId: string | null;
  },
): Promise<{ transactionId: string; costAmount: number }> {
  if (!Number.isInteger(opts.quantity) || opts.quantity <= 0) {
    throw new AppError('A receipt needs a positive whole quantity.', 400, 'RECEIPT_QUANTITY_INVALID');
  }
  const ledger = await getLedgerCurrencies(opts.tenantId, null, tx);

  const ref = await tx.inventoryStock.findFirst({
    where: { tenant_id: opts.tenantId, product_id: opts.productId, variant_id: opts.variantId, location_id: opts.locationId },
    select: { id: true },
  });
  if (ref) {
    await lockStockRows(tx, [ref.id]);
    await tx.inventoryStock.update({ where: { id: ref.id }, data: { quantity: { increment: opts.quantity } } });
  } else {
    await tx.inventoryStock.create({
      data: {
        tenant_id: opts.tenantId, product_id: opts.productId, variant_id: opts.variantId,
        location_id: opts.locationId, quantity: opts.quantity, reserved_qty: 0,
      },
    });
  }

  const costAmount = round2(opts.quantity * opts.unitCost);
  const layer = await tx.inventoryCostLayer.create({
    data: {
      tenant_id: opts.tenantId, product_id: opts.productId, variant_id: opts.variantId, location_id: opts.locationId,
      quantity: opts.quantity, original_quantity: opts.quantity, unit_cost: opts.unitCost,
      cost_currency_code: ledger.accountingCurrency, source_type: opts.layerSource,
      po_number: opts.referenceNumber, received_at: new Date(),
    },
    select: { id: true },
  });
  const txn = await tx.inventoryTransaction.create({
    data: {
      tenant_id: opts.tenantId,
      transaction_type: 'ADJUSTMENT',
      ...physicalStatusFor('ADJUSTMENT', { delta: opts.quantity }),
      reference_type: opts.referenceType,
      reference_id: opts.referenceId,
      reference_number: opts.referenceNumber,
      product_id: opts.productId,
      variant_id: opts.variantId,
      to_location_id: opts.locationId,
      quantity: opts.quantity,
      unit_cost: opts.unitCost,
      cost_amount: costAmount,
      cost_layer_id: layer.id,
      notes: opts.notes,
      performed_by: opts.userId,
    },
    select: { id: true },
  });
  return { transactionId: txn.id, costAmount };
}

// ── Restoring issued stock ────────────────────────────────────────────────────

/**
 * Put issued stock back where it was issued from.
 *
 *   SAME_LAYERS  a void or a cancelled issue: quantity returns to the very layers
 *                it was taken from, so the FIFO age is as if it never left.
 *   NEW_LAYER    a customer return: a new layer at the cost the goods were issued
 *                at (exact cost reversing), received today.
 *
 * Only settlements not yet reversed are restored, so a second void or return of
 * the same issue restores nothing and is reported by the caller.
 */
export async function restoreIssues(
  tx: Tx,
  opts: {
    tenantId: string;
    issueTransactionIds: string[];
    mode: 'SAME_LAYERS' | 'NEW_LAYER';
    transactionType: 'VOID_RETURN' | 'RETURN' | 'TRANSFER_IN';
    referenceType: string;
    referenceId: string | null;
    referenceNumber: string | null;
    notes: string;
    userId: string | null;
  },
): Promise<IssueResult> {
  const result: IssueResult = { costAmount: 0, costByProduct: new Map(), transactionIds: [] };
  const issues = await tx.inventoryTransaction.findMany({
    where: { tenant_id: opts.tenantId, id: { in: opts.issueTransactionIds } },
    include: { settlements: { where: { reversed_by_id: null } } },
  });

  for (const issue of issues) {
    if (issue.settlements.length === 0 || !issue.from_location_id) continue;
    const quantity = issue.settlements.reduce((s, x) => s + x.quantity, 0);
    const costAmount = round2(issue.settlements.reduce((s, x) => s + Number(x.cost_amount), 0));

    const existing = await tx.inventoryStock.findFirst({
      where: { tenant_id: opts.tenantId, product_id: issue.product_id, variant_id: issue.variant_id, location_id: issue.from_location_id },
      select: { id: true },
    });
    if (existing) {
      await lockStockRows(tx, [existing.id]);
      await tx.inventoryStock.update({ where: { id: existing.id }, data: { quantity: { increment: quantity } } });
    } else {
      await tx.inventoryStock.create({
        data: {
          tenant_id: opts.tenantId, product_id: issue.product_id, variant_id: issue.variant_id,
          location_id: issue.from_location_id, quantity, reserved_qty: 0,
        },
      });
    }

    const back = await tx.inventoryTransaction.create({
      data: {
        tenant_id: opts.tenantId,
        transaction_type: opts.transactionType,
        ...physicalStatusFor(opts.transactionType),
        reference_type: opts.referenceType,
        reference_id: opts.referenceId,
        reference_number: opts.referenceNumber,
        product_id: issue.product_id,
        variant_id: issue.variant_id,
        to_location_id: issue.from_location_id,
        quantity,
        unit_cost: round4(costAmount / quantity),
        cost_amount: costAmount,
        notes: opts.notes,
        performed_by: opts.userId,
      },
      select: { id: true },
    });

    for (const s of issue.settlements) {
      if (opts.mode === 'SAME_LAYERS' && s.cost_layer_id) {
        await lockLayers(tx, [s.cost_layer_id]);
        await tx.inventoryCostLayer.update({ where: { id: s.cost_layer_id }, data: { quantity: { increment: s.quantity } } });
      } else {
        await tx.inventoryCostLayer.create({
          data: {
            tenant_id: opts.tenantId,
            product_id: issue.product_id,
            variant_id: issue.variant_id,
            location_id: issue.from_location_id,
            quantity: s.quantity,
            original_quantity: s.quantity,
            unit_cost: s.unit_cost,
            cost_currency_code: s.cost_currency_code,
            // A return re-layers as SALES_RETURN; a void of stock that had no layer
            // (an ESTIMATED settlement) gets its layer back as an ADJUSTMENT.
            source_type: opts.mode === 'NEW_LAYER' ? 'SALES_RETURN' : 'ADJUSTMENT',
            origin_settlement_id: s.id,
            po_number: opts.referenceNumber,
            received_at: new Date(),
          },
        });
      }
      // Claimed only while still unreversed, so two concurrent voids or returns of
      // the same issue cannot both restore it: the second finds nothing to claim.
      const claimed = await tx.inventoryCostSettlement.updateMany({
        where: { id: s.id, reversed_by_id: null },
        data: { reversed_by_id: back.id },
      });
      if (claimed.count !== 1) {
        throw new AppError('This stock has already been put back by another transaction.', 409, 'SETTLEMENT_ALREADY_REVERSED');
      }
    }

    result.transactionIds.push(back.id);
    result.costAmount = round2(result.costAmount + costAmount);
    result.costByProduct.set(issue.product_id, round2((result.costByProduct.get(issue.product_id) ?? 0) + costAmount));
  }
  return result;
}

// ── Moves ─────────────────────────────────────────────────────────────────────

/**
 * Move stock from one location to another, carrying its cost layers (keeping
 * their FIFO age) and, when `holdSource` names a document, that document's holds.
 *
 * Without `holdSource` only unreserved stock may move. With it, the move takes
 * the document's own holds at the source first and re-creates them at the
 * destination, so a pick for a fully reserved order can complete and the order
 * still holds its goods at the shipping dock.
 */
export async function moveStock(
  tx: Tx,
  m: {
    tenantId: string;
    productId: string;
    variantId: string | null;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    userId: string | null;
    referenceType: string;
    referenceId?: string | null;
    referenceNumber: string | null;
    notes: string | null;
    holdSource?: { sourceType: ReservationSource; sourceId: string };
  },
): Promise<void> {
  if (m.fromLocationId === m.toLocationId) {
    throw new AppError('The source and destination locations are the same.', 400, 'MOVE_SAME_LOCATION');
  }
  if (!Number.isInteger(m.quantity) || m.quantity <= 0) {
    throw new AppError('A move needs a positive whole quantity.', 400, 'MOVE_QUANTITY_INVALID');
  }

  // Source and destination rows are locked together, sorted by id: locking the
  // source first let an A→B and a B→A move of the same product deadlock.
  const [fromRef, destRef] = await Promise.all([m.fromLocationId, m.toLocationId].map((locationId) =>
    tx.inventoryStock.findFirst({
      where: { tenant_id: m.tenantId, product_id: m.productId, variant_id: m.variantId, location_id: locationId },
      select: { id: true },
    })));
  await lockStockRows(tx, [fromRef?.id, destRef?.id].filter((v): v is string => !!v).sort());
  const from = fromRef ? await tx.inventoryStock.findUniqueOrThrow({ where: { id: fromRef.id } }) : null;

  const holds = m.holdSource && from
    ? await tx.inventoryReservation.findMany({
        where: {
          tenant_id: m.tenantId, stock_id: from.id, status: 'ACTIVE',
          source_type: m.holdSource.sourceType, source_id: m.holdSource.sourceId,
        },
        orderBy: { created_at: 'asc' },
      })
    : [];
  const ownHeld = holds.reduce((s, h) => s + h.quantity, 0);
  const movable = from ? from.quantity - from.reserved_qty + ownHeld : 0;
  if (movable < m.quantity) {
    throw new AppError(
      `Cannot move ${m.quantity}: only ${movable} is available at the source location.`,
      409,
      'MOVE_SOURCE_STOCK_INSUFFICIENT',
    );
  }

  // Holds that travel with the goods.
  let holdMoving = Math.min(ownHeld, m.quantity);
  const movedHolds: Array<{ source_line_id: string | null; quantity: number; sourceType: string; sourceId: string }> = [];
  for (const h of holds) {
    if (holdMoving === 0) break;
    const q = Math.min(h.quantity, holdMoving);
    if (q === h.quantity) {
      await tx.inventoryReservation.update({ where: { id: h.id }, data: { status: 'RELEASED', released_at: new Date() } });
    } else {
      await tx.inventoryReservation.update({ where: { id: h.id }, data: { quantity: { decrement: q } } });
    }
    movedHolds.push({ source_line_id: h.source_line_id, quantity: q, sourceType: h.source_type, sourceId: h.source_id });
    holdMoving -= q;
  }
  const movedHeld = movedHolds.reduce((s, h) => s + h.quantity, 0);

  await tx.inventoryStock.update({
    where: { id: from!.id },
    data: { quantity: { decrement: m.quantity }, reserved_qty: { decrement: movedHeld } },
  });

  let destId: string;
  if (destRef) {
    await tx.inventoryStock.update({
      where: { id: destRef.id },
      data: { quantity: { increment: m.quantity }, reserved_qty: { increment: movedHeld } },
    });
    destId = destRef.id;
  } else {
    destId = (await tx.inventoryStock.create({
      data: {
        tenant_id: m.tenantId, product_id: m.productId, variant_id: m.variantId,
        location_id: m.toLocationId, quantity: m.quantity, reserved_qty: movedHeld,
      },
      select: { id: true },
    })).id;
  }
  for (const h of movedHolds) {
    await tx.inventoryReservation.create({
      data: {
        tenant_id: m.tenantId, source_type: h.sourceType, source_id: h.sourceId, source_line_id: h.source_line_id,
        stock_id: destId, product_id: m.productId, variant_id: m.variantId, location_id: m.toLocationId, quantity: h.quantity,
      },
    });
  }

  // The layers move with the goods, oldest first, keeping their received date.
  const layerIds = (await tx.inventoryCostLayer.findMany({
    where: { tenant_id: m.tenantId, product_id: m.productId, variant_id: m.variantId, location_id: m.fromLocationId, quantity: { gt: 0 } },
    select: { id: true },
  })).map((l) => l.id);
  await lockLayers(tx, layerIds);
  const layers = await tx.inventoryCostLayer.findMany({ where: { id: { in: layerIds } }, orderBy: [{ received_at: 'asc' }, { id: 'asc' }] });
  let remaining = m.quantity;
  for (const layer of layers) {
    if (remaining === 0) break;
    const take = Math.min(remaining, layer.quantity);
    await tx.inventoryCostLayer.update({ where: { id: layer.id }, data: { quantity: { decrement: take } } });
    await tx.inventoryCostLayer.create({
      data: {
        tenant_id: m.tenantId, product_id: m.productId, variant_id: m.variantId, location_id: m.toLocationId,
        source_po_id: layer.source_po_id, po_number: layer.po_number, quantity: take, original_quantity: take,
        unit_cost: layer.unit_cost, cost_currency_code: layer.cost_currency_code, received_at: layer.received_at,
        source_type: layer.source_type, origin_settlement_id: layer.origin_settlement_id,
      },
    });
    remaining -= take;
  }

  for (const type of ['TRANSFER_OUT', 'TRANSFER_IN'] as const) {
    await tx.inventoryTransaction.create({
      data: {
        tenant_id: m.tenantId,
        transaction_type: type,
        ...physicalStatusFor(type),
        reference_type: m.referenceType,
        reference_id: m.referenceId ?? null,
        reference_number: m.referenceNumber,
        product_id: m.productId,
        variant_id: m.variantId,
        from_location_id: m.fromLocationId,
        to_location_id: m.toLocationId,
        quantity: m.quantity,
        notes: m.notes,
        performed_by: m.userId,
      },
    });
  }
}
