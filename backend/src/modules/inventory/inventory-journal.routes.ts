import { Hono } from 'hono';
import type { z } from 'zod';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { hasPermission, routeGuard, type RouteGuards } from '../../shared/middleware/permissions';
import { validate } from '../../shared/middleware/validate';
import { ok, created } from '../../shared/response';
import {
  CreateInventoryJournalSchema,
  UpdateInventoryJournalSchema,
  InventoryReasonCodeSchema,
  UpdateInventoryReasonCodeSchema,
} from '../../shared/schemas';
import type { AppEnv } from '../../shared/context';
import {
  cancelInventoryJournal,
  createInventoryJournal,
  journalLineData,
  postInventoryJournal,
  validateJournalInput,
  assertMayEnterCost,
  type CreateJournalInput,
  type JournalLineInput,
} from './inventoryJournal.service';

const app = new Hono<AppEnv>();

/**
 * Inventory journals and reason codes (WORK-045). Reading follows the movement
 * history; entering and posting a correction is the adjustment duty; an opening
 * balance is the admin's, because it creates equity; reason codes are inventory
 * setup.
 */
export const INVENTORY_JOURNAL_ROUTE_PERMISSIONS = Object.freeze({
  'GET /reason-codes': ['inventory.transaction.read'],
  'POST /reason-codes': ['inventory.setup.maintain'],
  'PUT /reason-codes/:id': ['inventory.setup.maintain'],
  'GET /': ['inventory.transaction.read'],
  'GET /:id': ['inventory.transaction.read'],
  'POST /': ['inventory.adjustment.post'],
  'PUT /:id': ['inventory.adjustment.post'],
  'POST /:id/post': ['inventory.adjustment.post'],
  'POST /:id/cancel': ['inventory.adjustment.post'],
} satisfies RouteGuards);

const guard = routeGuard(INVENTORY_JOURNAL_ROUTE_PERMISSIONS);

function assertMayOpen(c: any, type: string) {
  if (type === 'OPENING' && !hasPermission(c.get('user').role, 'inventory.journal.opening')) {
    throw new AppError('Permission denied: inventory.journal.opening', 403);
  }
}


// ── Reason codes ──────────────────────────────────────────────────────────────

app.get('/reason-codes', guard('GET /reason-codes'), async (c) => {
  const codes = await db.inventoryReasonCode.findMany({
    where: { tenant_id: c.get('tenantId') },
    orderBy: [{ is_active: 'desc' }, { code: 'asc' }],
  });
  return ok(c, codes);
});

app.post('/reason-codes', guard('POST /reason-codes'), validate(InventoryReasonCodeSchema), async (c) => {
  const body = c.get('body') as z.infer<typeof InventoryReasonCodeSchema>;
  const code = await db.inventoryReasonCode.create({
    data: { tenant_id: c.get('tenantId'), code: body.code!, name: body.name!, direction: body.direction ?? 'BOTH', is_active: body.is_active ?? true },
  });
  return created(c, code);
});

app.put('/reason-codes/:id', guard('PUT /reason-codes/:id'), validate(UpdateInventoryReasonCodeSchema), async (c) => {
  const body = c.get('body') as z.infer<typeof UpdateInventoryReasonCodeSchema>;
  const res = await db.inventoryReasonCode.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data: body,
  });
  if (res.count === 0) throw new AppError('Reason code not found', 404);
  return ok(c, await db.inventoryReasonCode.findFirst({ where: { id: c.req.param('id') } }));
});

// ── Journals ──────────────────────────────────────────────────────────────────

app.get('/', guard('GET /'), async (c) => {
  const { status, type, warehouse_id } = c.req.query();
  const journals = await db.inventoryJournal.findMany({
    where: {
      tenant_id: c.get('tenantId'),
      ...(status ? { status } : {}),
      ...(type ? { journal_type: type } : {}),
      ...(warehouse_id ? { warehouse_id } : {}),
    },
    include: { lines: { select: { id: true, quantity: true, cost_amount: true } } },
    orderBy: { created_at: 'desc' },
    take: 200,
  });
  return ok(c, journals);
});

app.get('/:id', guard('GET /:id'), async (c) => {
  const journal = await db.inventoryJournal.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: { lines: true },
  });
  if (!journal) throw new AppError('Inventory journal not found', 404);

  // Names for the screen, resolved in bulk rather than per line.
  const [products, variants, locations] = await Promise.all([
    db.product.findMany({ where: { id: { in: journal.lines.map((l) => l.product_id) } }, select: { id: true, name: true, sku: true } }),
    db.productVariant.findMany({ where: { id: { in: journal.lines.map((l) => l.variant_id).filter((v): v is string => !!v) } }, select: { id: true, sku_variant: true } }),
    db.warehouseLocation.findMany({ where: { id: { in: journal.lines.map((l) => l.location_id) } }, select: { id: true, code: true } }),
  ]);
  const p = new Map(products.map((x) => [x.id, x]));
  const v = new Map(variants.map((x) => [x.id, x]));
  const loc = new Map(locations.map((x) => [x.id, x]));
  return ok(c, {
    ...journal,
    lines: journal.lines.map((l) => ({
      ...l,
      product: p.get(l.product_id) ?? null,
      variant: l.variant_id ? v.get(l.variant_id) ?? null : null,
      location: loc.get(l.location_id) ?? null,
    })),
  });
});

app.post('/', guard('POST /'), validate(CreateInventoryJournalSchema), async (c) => {
  const body = c.get('body') as z.infer<typeof CreateInventoryJournalSchema>;
  assertMayOpen(c, body.journal_type);
  assertMayEnterCost(c.get('user').role, body.journal_type, body.lines as any);
  const journal = await createInventoryJournal(c.get('tenantId'), c.get('user').id, body as CreateJournalInput);
  return created(c, journal);
});

app.put('/:id', guard('PUT /:id'), validate(UpdateInventoryJournalSchema), async (c) => {
  const body = c.get('body') as z.infer<typeof UpdateInventoryJournalSchema>;
  const tenantId = c.get('tenantId');
  const existing = await db.inventoryJournal.findFirst({ where: { id: c.req.param('id'), tenant_id: tenantId } });
  if (!existing) throw new AppError('Inventory journal not found', 404);
  assertMayOpen(c, existing.journal_type);
  if (existing.status !== 'DRAFT' || existing.journal_type === 'COUNT') {
    throw new AppError('Only a DRAFT adjustment or opening journal can be edited', 409, 'JOURNAL_NOT_EDITABLE');
  }
  assertMayEnterCost(c.get('user').role, existing.journal_type, body.lines as any);
  const input = {
    journal_type: existing.journal_type as 'ADJUSTMENT' | 'OPENING',
    warehouse_id: existing.warehouse_id,
    // A key sent as null clears it; a key left out keeps the stored value.
    description: body.description !== undefined ? body.description : existing.description,
    reason_code_id: body.reason_code_id !== undefined ? body.reason_code_id : existing.reason_code_id,
    lines: body.lines as JournalLineInput[],
  };
  const updated = await db.$transaction(async (tx) => {
    await validateJournalInput(tx, tenantId, input);
    const still = await tx.inventoryJournal.updateMany({
      where: { id: existing.id, status: 'DRAFT' },
      data: { description: input.description, reason_code_id: input.reason_code_id },
    });
    if (still.count === 0) throw new AppError('The journal was posted or cancelled meanwhile', 409, 'JOURNAL_NOT_EDITABLE');
    await tx.inventoryJournalLine.deleteMany({ where: { journal_id: existing.id } });
    await tx.inventoryJournalLine.createMany({ data: input.lines.map((l) => ({ journal_id: existing.id, ...journalLineData(l) })) });
    return tx.inventoryJournal.findUniqueOrThrow({ where: { id: existing.id }, include: { lines: true } });
  });
  return ok(c, updated);
});

app.post('/:id/post', guard('POST /:id/post'), async (c) => {
  const tenantId = c.get('tenantId');
  const journal = await db.inventoryJournal.findFirst({ where: { id: c.req.param('id'), tenant_id: tenantId }, select: { journal_type: true } });
  if (!journal) throw new AppError('Inventory journal not found', 404);
  assertMayOpen(c, journal.journal_type);
  if (journal.journal_type === 'COUNT') {
    throw new AppError('A count journal is posted by finalising its count', 409, 'JOURNAL_POSTED_BY_COUNT');
  }
  return ok(c, await postInventoryJournal(tenantId, c.req.param('id'), c.get('user').id));
});

app.post('/:id/cancel', guard('POST /:id/cancel'), async (c) => {
  const journal = await db.inventoryJournal.findFirst({ where: { id: c.req.param('id'), tenant_id: c.get('tenantId') }, select: { journal_type: true } });
  if (!journal) throw new AppError('Inventory journal not found', 404);
  assertMayOpen(c, journal.journal_type);
  await cancelInventoryJournal(c.get('tenantId'), c.req.param('id'));
  return ok(c, null);
});

export default app;
