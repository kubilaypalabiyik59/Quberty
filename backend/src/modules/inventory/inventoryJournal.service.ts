import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { allocateNumber } from '../../shared/services/numberSequence.service';
import { postJournal } from '../../shared/services/journal.service';
import { resolvePostingAccounts_orExplain } from '../../shared/services/posting.service';
import { groupByItemGroup, resolveItemPolicies } from '../../shared/services/itemPolicy.service';
import { assertTenantReferences } from '../../shared/services/tenantReference.service';
import { issueFromLocation, receiveIntoLocation } from '../../shared/services/stockLedger.service';
import { hasPermission } from '../../shared/middleware/permissions';

/**
 * Inventory journals (WORK-045): adjustments, counts and opening balances that
 * post quantity AND value.
 *
 * **[OFFICIAL]** an inventory adjustment journal posts receipts or issues, changes
 * inventory value and creates ledger transactions through the item group's
 * posting profile; posting a counting journal changes both level and value.
 *   learn.microsoft.com/dynamics365/supply-chain/inventory/inventory-journals
 *
 * A positive line receives a new cost layer at its unit cost (Dr Inventory,
 * Cr Inventory profit — or Opening balance equity for an OPENING journal). A
 * negative line issues FIFO layers at its location (Dr Inventory loss,
 * Cr Inventory). Everything posts in one transaction or not at all.
 */

type Tx = Prisma.TransactionClient;

export type JournalType = 'ADJUSTMENT' | 'COUNT' | 'OPENING';

export interface JournalLineInput {
  product_id: string;
  variant_id?: string | null;
  location_id: string;
  quantity: number;
  unit_cost?: number | null;
  reason_code_id?: string | null;
  notes?: string | null;
  snapshot_qty?: number | null;
  counted_qty?: number | null;
}

export interface CreateJournalInput {
  journal_type: JournalType;
  warehouse_id: string;
  description?: string | null;
  reason_code_id?: string | null;
  source_count_id?: string | null;
  lines: JournalLineInput[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function assertWarehouseLocations(tx: Tx, tenantId: string, warehouseId: string, lines: JournalLineInput[]) {
  const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, tenant_id: tenantId }, select: { id: true } });
  if (!warehouse) throw new AppError('Warehouse not found for this tenant', 422, 'FOREIGN_REFERENCE');

  const locations: Record<string, string> = {};
  lines.forEach((l, i) => { locations[`lines[${i}].location_id`] = l.location_id; });
  await assertTenantReferences(tenantId, {
    lines: lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id ?? null })),
    locations,
  }, tx);

  const inWarehouse = await tx.warehouseLocation.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.location_id))] }, zone: { warehouse_id: warehouseId } },
    select: { id: true },
  });
  const ok = new Set(inWarehouse.map((l) => l.id));
  const outside = lines.map((l, i) => (ok.has(l.location_id) ? null : `lines[${i}].location_id`)).filter(Boolean);
  if (outside.length) {
    throw new AppError(`These locations are not in the journal's warehouse: ${outside.join(', ')}`, 422, 'LOCATION_OUTSIDE_WAREHOUSE');
  }
}

async function assertReasonCodes(tx: Tx, tenantId: string, input: CreateJournalInput) {
  const ids = [input.reason_code_id, ...input.lines.map((l) => l.reason_code_id)].filter((v): v is string => !!v);
  if (ids.length === 0) return;
  const codes = await tx.inventoryReasonCode.findMany({
    where: { tenant_id: tenantId, id: { in: [...new Set(ids)] }, is_active: true },
    select: { id: true, direction: true, code: true },
  });
  const byId = new Map(codes.map((c) => [c.id, c]));
  for (const id of ids) {
    if (!byId.has(id)) throw new AppError('Unknown or inactive reason code for this tenant', 422, 'FOREIGN_REFERENCE');
  }
  input.lines.forEach((l, i) => {
    const code = byId.get(l.reason_code_id ?? input.reason_code_id ?? '');
    if (!code) return;
    if ((code.direction === 'INCREASE' && l.quantity < 0) || (code.direction === 'DECREASE' && l.quantity > 0)) {
      throw new AppError(`Reason ${code.code} cannot be used for lines[${i}], which moves stock the other way.`, 422, 'REASON_DIRECTION_MISMATCH');
    }
  });
}

/** Everything a journal's lines must satisfy, checked before anything is written. */
export async function validateJournalInput(tx: Tx, tenantId: string, input: CreateJournalInput) {
  if (input.lines.length === 0) throw new AppError('A journal needs at least one line', 400, 'JOURNAL_LINES_REQUIRED');
  input.lines.forEach((l, i) => {
    if (!Number.isInteger(l.quantity) || l.quantity === 0) {
      throw new AppError(`lines[${i}].quantity must be a non-zero whole number`, 400, 'JOURNAL_LINE_QUANTITY_INVALID');
    }
    if (input.journal_type === 'OPENING' && l.quantity < 0) {
      throw new AppError('An opening balance only adds stock', 400, 'OPENING_LINE_NEGATIVE');
    }
    if (l.unit_cost !== undefined && l.unit_cost !== null && !(l.unit_cost >= 0)) {
      throw new AppError(`lines[${i}].unit_cost must be zero or more`, 400, 'JOURNAL_LINE_COST_INVALID');
    }
  });

  await assertWarehouseLocations(tx, tenantId, input.warehouse_id, input.lines);
  await assertReasonCodes(tx, tenantId, input);
}

export function journalLineData(l: JournalLineInput) {
  return {
    product_id: l.product_id,
    variant_id: l.variant_id ?? null,
    location_id: l.location_id,
    quantity: l.quantity,
    unit_cost: l.unit_cost ?? null,
    reason_code_id: l.reason_code_id ?? null,
    notes: l.notes ?? null,
    snapshot_qty: l.snapshot_qty ?? null,
    counted_qty: l.counted_qty ?? null,
  };
}

/** Create a DRAFT journal. Refuses foreign or out-of-warehouse references before a number is drawn. */
export async function createInventoryJournal(
  tenantId: string,
  userId: string | null,
  input: CreateJournalInput,
  client?: Tx,
) {
  const run = async (tx: Tx) => {
    await validateJournalInput(tx, tenantId, input);
    const number = await allocateNumber({ tenantId, reference: 'INVENTORY_ADJUSTMENT', tx });
    return tx.inventoryJournal.create({
      data: {
        tenant_id: tenantId,
        journal_number: number,
        journal_type: input.journal_type,
        warehouse_id: input.warehouse_id,
        description: input.description ?? null,
        reason_code_id: input.reason_code_id ?? null,
        source_count_id: input.source_count_id ?? null,
        created_by: userId,
        lines: { create: input.lines.map(journalLineData) },
      },
      include: { lines: true },
    });
  };
  return client ? run(client) : db.$transaction(run);
}

/**
 * The cost a positive line receives when none was entered (plan §2.2): the newest
 * OPEN cost layer of that product and variant in the journal's warehouse, else the
 * item's cost price. Null when neither is known — the line then needs a cost, which
 * only a holder of inventory.journal.cost_override may enter.
 */
async function defaultUnitCost(tx: Tx, tenantId: string, warehouseId: string, productId: string, variantId: string | null) {
  const inWarehouse = await tx.inventoryCostLayer.findFirst({
    where: {
      tenant_id: tenantId, product_id: productId, variant_id: variantId, quantity: { gt: 0 },
      location: { zone: { warehouse_id: warehouseId } },
    },
    orderBy: [{ received_at: 'desc' }, { id: 'desc' }],
    select: { unit_cost: true },
  });
  if (inWarehouse) return Number(inWarehouse.unit_cost);
  const product = await tx.product.findFirst({ where: { id: productId, tenant_id: tenantId }, select: { cost_price: true } });
  const price = Number(product?.cost_price ?? 0);
  return price > 0 ? price : null;
}

/**
 * Post a DRAFT journal: stock, layers and one voucher, in one transaction.
 * `client` lets a count finalise and post its journal atomically.
 */
export async function postInventoryJournal(tenantId: string, journalId: string, userId: string | null, client?: Tx) {
  const run = async (tx: Tx) => {
    const claimed = await tx.inventoryJournal.updateMany({
      where: { id: journalId, tenant_id: tenantId, status: 'DRAFT' },
      data: { status: 'POSTED', posted_at: new Date(), posted_by: userId },
    });
    if (claimed.count === 0) {
      const exists = await tx.inventoryJournal.findFirst({ where: { id: journalId, tenant_id: tenantId }, select: { status: true } });
      if (!exists) throw new AppError('Inventory journal not found', 404);
      throw new AppError(`This journal is ${exists.status} and cannot be posted again.`, 409, 'JOURNAL_NOT_DRAFT');
    }
    const journal = await tx.inventoryJournal.findUniqueOrThrow({ where: { id: journalId }, include: { lines: true } });

    const policies = await resolveItemPolicies(tenantId, journal.lines.map((l) => l.product_id), tx);
    const nonStocked = journal.lines.filter((l) => policies.get(l.product_id)?.stocked === false);
    if (nonStocked.length) {
      throw new AppError('Items that are not stocked have no inventory to adjust.', 422, 'ITEM_NOT_STOCKED');
    }

    const gains = new Map<string, number>();
    const losses = new Map<string, number>();
    const reference = { referenceType: 'INVENTORY_JOURNAL', referenceId: journal.id, referenceNumber: journal.journal_number };
    const layerSource = journal.journal_type === 'OPENING' ? 'OPENING' : journal.journal_type === 'COUNT' ? 'COUNT' : 'ADJUSTMENT';

    for (const line of journal.lines) {
      const notes = line.notes ?? journal.description ?? `${journal.journal_type} ${journal.journal_number}`;
      if (line.quantity > 0) {
        const unitCost = line.unit_cost !== null
          ? Number(line.unit_cost)
          : await defaultUnitCost(tx, tenantId, journal.warehouse_id, line.product_id, line.variant_id);
        if (unitCost === null) {
          throw new AppError(
            `A unit cost is needed for product ${line.product_id}: it has no cost history and no item cost price.`,
            422,
            'UNIT_COST_REQUIRED',
          );
        }
        const r = await receiveIntoLocation(tx, {
          tenantId, locationId: line.location_id, productId: line.product_id, variantId: line.variant_id,
          quantity: line.quantity, unitCost, layerSource, ...reference, notes, userId,
        });
        await tx.inventoryJournalLine.update({ where: { id: line.id }, data: { unit_cost: unitCost, cost_amount: r.costAmount } });
        gains.set(line.product_id, round2((gains.get(line.product_id) ?? 0) + r.costAmount));
      } else {
        const r = await issueFromLocation(tx, {
          locationId: line.location_id, productId: line.product_id, variantId: line.variant_id, quantity: -line.quantity,
          meta: { tenantId, transactionType: 'ADJUSTMENT', ...reference, notes, userId },
        });
        await tx.inventoryJournalLine.update({
          where: { id: line.id },
          data: { unit_cost: Math.round((r.costAmount / -line.quantity) * 10000) / 10000, cost_amount: -r.costAmount },
        });
        losses.set(line.product_id, round2((losses.get(line.product_id) ?? 0) + r.costAmount));
      }
    }

    const entry = await postValue(tx, tenantId, journal, { gains, losses, userId });
    if (entry) {
      await tx.inventoryJournal.update({ where: { id: journal.id }, data: { journal_entry_id: entry.id } });
    }
    return tx.inventoryJournal.findUniqueOrThrow({ where: { id: journal.id }, include: { lines: true } });
  };
  return client ? run(client) : db.$transaction(run, { timeout: 30_000 });
}

async function postValue(
  tx: Tx,
  tenantId: string,
  journal: { id: string; journal_number: string; journal_type: string; warehouse_id: string },
  opts: { gains: Map<string, number>; losses: Map<string, number>; userId: string | null },
) {
  const counterGain = journal.journal_type === 'OPENING' ? 'INVENTORY_OPENING_BALANCE' : 'INVENTORY_PROFIT';
  const productIds = [...new Set([...opts.gains.keys(), ...opts.losses.keys()])];
  if (productIds.length === 0) return null;
  const policies = await resolveItemPolicies(tenantId, productIds, tx);

  const lines: Array<{ accountId: string; debit?: number; credit?: number; description: string }> = [];
  const add = async (amounts: Map<string, number>, direction: 'GAIN' | 'LOSS') => {
    const ids = [...amounts.keys()];
    const buckets = groupByItemGroup(ids, policies, (id) => id, (id) => amounts.get(id) ?? 0).filter((b) => b.amount > 0);
    for (const b of buckets) {
      const types = direction === 'GAIN' ? (['INVENTORY', counterGain] as const) : (['INVENTORY_LOSS', 'INVENTORY'] as const);
      const acc = await resolvePostingAccounts_orExplain(tenantId, types as any, {
        document: `Inventory journal ${journal.journal_number}${b.itemGroupCode ? ` (${b.itemGroupCode})` : ''}`,
        itemGroupId: b.itemGroupId ?? undefined,
        client: tx,
      }) as Record<string, string> | null;
      if (!acc) continue;
      const label = b.itemGroupCode ? ` [${b.itemGroupCode}]` : '';
      if (direction === 'GAIN') {
        lines.push({ accountId: acc.INVENTORY, debit: b.amount, description: `Inventory in${label} — ${journal.journal_number}` });
        lines.push({ accountId: acc[counterGain], credit: b.amount, description: `${journal.journal_type === 'OPENING' ? 'Opening balance' : 'Inventory profit'}${label} — ${journal.journal_number}` });
      } else {
        lines.push({ accountId: acc.INVENTORY_LOSS, debit: b.amount, description: `Inventory loss${label} — ${journal.journal_number}` });
        lines.push({ accountId: acc.INVENTORY, credit: b.amount, description: `Inventory out${label} — ${journal.journal_number}` });
      }
    }
  };
  await add(opts.gains, 'GAIN');
  await add(opts.losses, 'LOSS');
  if (lines.length === 0) return null;

  const warehouse = await tx.warehouse.findFirst({ where: { id: journal.warehouse_id }, select: { site_id: true } });
  return postJournal({
    tenantId,
    tx,
    description: `${journal.journal_type === 'OPENING' ? 'Opening inventory' : journal.journal_type === 'COUNT' ? 'Inventory count' : 'Inventory adjustment'}: ${journal.journal_number}`,
    source: { module: 'INVENTORY_JOURNAL', id: journal.id },
    userId: opts.userId,
    dimensions: { siteId: warehouse?.site_id ?? null, warehouseId: journal.warehouse_id },
    lines,
  });
}

/** Cancel a DRAFT journal. Nothing was posted, so nothing is reversed. */
export async function cancelInventoryJournal(tenantId: string, journalId: string) {
  const res = await db.inventoryJournal.updateMany({
    where: { id: journalId, tenant_id: tenantId, status: 'DRAFT' },
    data: { status: 'CANCELLED' },
  });
  if (res.count === 0) throw new AppError('Only a DRAFT journal can be cancelled', 409, 'JOURNAL_NOT_DRAFT');
}

/**
 * An entered unit cost on an adjustment line needs its own permission; without it
 * a positive line takes the warehouse's newest open layer cost (plan §2.2). An
 * opening balance states its costs by nature and is already the admin's.
 */
export function assertMayEnterCost(role: string, type: string, lines: Array<{ quantity: number; unit_cost?: number | null }>) {
  if (type === 'OPENING') return;
  const entered = lines.some((l) => l.quantity > 0 && l.unit_cost !== undefined && l.unit_cost !== null);
  if (entered && !hasPermission(role, 'inventory.journal.cost_override')) {
    throw new AppError('Permission denied: inventory.journal.cost_override', 403);
  }
}
