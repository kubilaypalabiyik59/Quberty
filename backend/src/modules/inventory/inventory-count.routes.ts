import { Hono }    from 'hono';
import { routeGuard, type RouteGuards } from '../../shared/middleware/permissions';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { validate } from '../../shared/middleware/validate';
import { UpdateCountLineSchema, CreateInventoryCountSchema } from '../../shared/schemas';
import type { z } from 'zod';
import { allocateNumber } from '../../shared/services/numberSequence.service';
import { createInventoryJournal, postInventoryJournal } from './inventoryJournal.service';
import { ok, created } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

/**
 * Counting (WORK-030b). Recording a counted quantity and posting the count are
 * separate duties (S-2): a warehouse worker records, the store manager posts.
 */
export const INVENTORY_COUNT_ROUTE_PERMISSIONS = Object.freeze({
  'GET /': ['inventory.count.read'],
  'GET /:id': ['inventory.count.read'],
  'POST /': ['inventory.count.create'],
  'PUT /:id/lines/:lineId': ['inventory.count.record'],
  'POST /:id/finalize': ['inventory.count.post'],
} satisfies RouteGuards);

const guard = routeGuard(INVENTORY_COUNT_ROUTE_PERMISSIONS);

// List counts
app.get('/', guard('GET /'), async (c) => {
  const counts = await db.inventoryCount.findMany({
    where: { tenant_id: c.get('tenantId') },
    include: { lines: { select: { id: true } } },
    orderBy: { created_at: 'desc' },
  });
  return ok(c, counts);
});

// Get single count with lines
app.get('/:id', guard('GET /:id'), async (c) => {
  const count = await db.inventoryCount.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: {
      lines: {
        include: {
          product: { select: { name: true, sku: true } },
          variant: { select: { sku_variant: true, attributes: true } },
          location: { select: { code: true, aisle: true, rack: true, shelf: true, zone: { select: { name: true, warehouse: { select: { name: true } } } } } },
        },
      },
    },
  });
  if (!count) throw new AppError('Count not found', 404);
  return ok(c, count);
});

// Create a count for one warehouse (optionally one location). Lines are the stock
// rows as they stand now; `system_qty` is the snapshot finalising compares against.
app.post('/', guard('POST /'), validate(CreateInventoryCountSchema), async (c) => {
  const body = c.get('body') as z.infer<typeof CreateInventoryCountSchema>;
  const tenantId = c.get('tenantId');

  const warehouse = await db.warehouse.findFirst({ where: { id: body.warehouse_id, tenant_id: tenantId }, select: { id: true } });
  if (!warehouse) throw new AppError('Unknown reference for this tenant: warehouse_id', 422, 'FOREIGN_REFERENCE');
  if (body.location_id) {
    const inWarehouse = await db.warehouseLocation.findFirst({
      where: { id: body.location_id, tenant_id: tenantId, zone: { warehouse_id: body.warehouse_id } },
      select: { id: true },
    });
    if (!inWarehouse) throw new AppError('The location is not in the chosen warehouse', 422, 'LOCATION_OUTSIDE_WAREHOUSE');
  }

  const count = await db.$transaction(async (tx) => {
    const reference = await allocateNumber({ tenantId, reference: 'INVENTORY_COUNT', tx });
    const currentStock = await tx.inventoryStock.findMany({
      where: {
        tenant_id: tenantId,
        location: { zone: { warehouse_id: body.warehouse_id } },
        ...(body.location_id ? { location_id: body.location_id } : {}),
      },
    });
    return tx.inventoryCount.create({
      data: {
        tenant_id:    tenantId,
        reference,
        notes:        body.notes ?? null,
        status:       'IN_PROGRESS',
        counted_by:   c.get('user').id,
        warehouse_id: body.warehouse_id,
        lines: {
          create: currentStock.map((row) => ({
            product_id:  row.product_id,
            variant_id:  row.variant_id,
            location_id: row.location_id,
            system_qty:  row.quantity,
            counted_qty: null,
          })),
        },
      },
      include: { lines: true },
    });
  });

  return created(c, count);
});

// Update a single count line (set counted_qty). A counting journal is edited
// while open and frozen once posted, so a FINALIZED count refuses edits; the
// line must belong to the count in the path and to the caller's tenant.
app.put('/:id/lines/:lineId', guard('PUT /:id/lines/:lineId'), validate(UpdateCountLineSchema), async (c) => {
  const tenantId = c.get('tenantId');
  const countId = c.req.param('id');
  const lineId = c.req.param('lineId');
  const { counted_qty } = c.get('body') as { counted_qty: number };
  const res = await db.inventoryCountLine.updateMany({
    where: { id: lineId, count_id: countId, count: { tenant_id: tenantId, status: 'IN_PROGRESS' } },
    data: { counted_qty },
  });
  if (res.count === 0) {
    const line = await db.inventoryCountLine.findFirst({
      where: { id: lineId, count_id: countId, count: { tenant_id: tenantId } },
      select: { id: true },
    });
    if (!line) throw new AppError('Count line not found', 404, 'COUNT_LINE_NOT_FOUND');
    throw new AppError('This count is finalized and can no longer be edited', 409, 'COUNT_NOT_EDITABLE');
  }
  return ok(c, null);
});

// Finalise a count: the differences become a COUNT inventory journal, posted in the
// same transaction — quantity AND value (WORK-045). On-hand is never overwritten.
//
// **[OFFICIAL]** keep the originally calculated lines and do not recalculate,
// because expected inventory may change while counting:
// learn.microsoft.com/dynamics365/business-central/inventory-how-count-adjust-reclassify
// So the difference is counted − snapshot. Under REFUSE_IF_CHANGED (default) a line
// whose stock moved after the snapshot refuses the whole finalisation; under
// APPLY_DELTA the difference is applied to today's quantity.
app.post('/:id/finalize', guard('POST /:id/finalize'), async (c) => {
  const tenantId = c.get('tenantId');
  const userId = c.get('user').id;

  const result = await db.$transaction(async (tx) => {
    // Claim first, then read the lines: a counted quantity saved before the claim
    // is included, and none can be saved after it (the line PUT requires IN_PROGRESS).
    const exists = await tx.inventoryCount.findFirst({ where: { id: c.req.param('id'), tenant_id: tenantId }, select: { id: true } });
    if (!exists) throw new AppError('Count not found', 404);
    const claimed = await tx.inventoryCount.updateMany({
      where: { id: exists.id, status: 'IN_PROGRESS' },
      data: { status: 'FINALIZED', finalized_at: new Date() },
    });
    if (claimed.count === 0) throw new AppError('This count is already finalized', 409, 'COUNT_NOT_EDITABLE');
    const count = await tx.inventoryCount.findUniqueOrThrow({ where: { id: exists.id }, include: { lines: true } });

    const params = await tx.inventoryParameters.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: null },
      select: { count_snapshot_policy: true },
    });
    const policy = params?.count_snapshot_policy ?? 'REFUSE_IF_CHANGED';

    // Every counted line is checked against today's stock — also one counted equal to
    // its snapshot: if stock moved since, "counted = expected" is itself stale.
    const counted = count.lines.filter((l) => l.counted_qty !== null);

    // All stock rows the counted lines refer to, read once and locked sorted, so a
    // sale cannot slip in between this comparison and the posting below.
    const key = (p: string, v: string | null, l: string) => `${p}|${v ?? ''}|${l}`;
    const rows = counted.length === 0 ? [] : await tx.inventoryStock.findMany({
      where: {
        tenant_id: tenantId,
        location_id: { in: [...new Set(counted.map((l) => l.location_id))] },
        product_id: { in: [...new Set(counted.map((l) => l.product_id))] },
      },
      select: { id: true, product_id: true, variant_id: true, location_id: true },
    });
    const ids = rows.map((r) => r.id).sort();
    if (ids.length) await tx.$queryRaw`SELECT id FROM inventory_stock WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
    const current = new Map(
      (ids.length ? await tx.inventoryStock.findMany({ where: { id: { in: ids } }, select: { product_id: true, variant_id: true, location_id: true, quantity: true } }) : [])
        .map((r) => [key(r.product_id, r.variant_id, r.location_id), r.quantity]),
    );

    const changed: string[] = [];
    const journalLines = [];
    for (const line of counted) {
      const now = current.get(key(line.product_id, line.variant_id, line.location_id)) ?? 0;
      if (now !== line.system_qty && policy === 'REFUSE_IF_CHANGED') {
        changed.push(line.id);
        continue;
      }
      if (line.counted_qty === line.system_qty) continue;
      journalLines.push({
        product_id: line.product_id,
        variant_id: line.variant_id,
        location_id: line.location_id,
        quantity: line.counted_qty! - line.system_qty,
        snapshot_qty: line.system_qty,
        counted_qty: line.counted_qty,
        notes: `Count ${count.reference}: counted ${line.counted_qty}, expected ${line.system_qty}`,
      });
    }
    if (changed.length) {
      throw new AppError(
        `Stock moved on ${changed.length} counted line(s) after this count was created, so the counted quantities ` +
          `no longer describe the same stock. Recount those lines in a new count, or switch Inventory parameters → ` +
          `count snapshot policy to apply the difference instead.`,
        409,
        'COUNT_STOCK_CHANGED',
      );
    }

    if (journalLines.length === 0) return { count_id: count.id, journal: null };
    const warehouseId = count.warehouse_id
      ?? (await tx.warehouseLocation.findFirst({ where: { id: journalLines[0].location_id }, select: { zone: { select: { warehouse_id: true } } } }))?.zone.warehouse_id;
    if (!warehouseId) throw new AppError('The count has no warehouse', 422, 'COUNT_WAREHOUSE_REQUIRED');

    const draft = await createInventoryJournal(tenantId, userId, {
      journal_type: 'COUNT',
      warehouse_id: warehouseId,
      description: `Count ${count.reference}`,
      source_count_id: count.id,
      lines: journalLines,
    }, tx);
    const posted = await postInventoryJournal(tenantId, draft.id, userId, tx);
    await tx.inventoryCount.update({ where: { id: count.id }, data: { journal_id: posted.id } });
    return { count_id: count.id, journal: { id: posted.id, journal_number: posted.journal_number } };
  }, { timeout: 120_000 });

  return ok(c, result);
});

export default app;
