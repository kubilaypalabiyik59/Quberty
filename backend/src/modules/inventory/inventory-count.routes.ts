import { Hono }    from 'hono';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { ok, created } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

// List counts
app.get('/', async (c) => {
  const counts = await db.inventoryCount.findMany({
    where: { tenant_id: c.get('tenantId') },
    include: { lines: { select: { id: true } } },
    orderBy: { created_at: 'desc' },
  });
  return ok(c, counts);
});

// Get single count with lines
app.get('/:id', async (c) => {
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

// Create new count - auto-populates lines from current stock
app.post('/', requireRole('admin', 'store_manager'), async (c) => {
  const { notes, location_id } = await c.req.json();

  // Generate reference
  const countNum = await db.inventoryCount.count({ where: { tenant_id: c.get('tenantId') } });
  const reference = `CNT-${new Date().getFullYear()}-${String(countNum + 1).padStart(4, '0')}`;

  // Pull current stock as baseline
  const stockWhere: any = { tenant_id: c.get('tenantId') };
  if (location_id) stockWhere.location_id = location_id;

  const currentStock = await db.inventoryStock.findMany({ where: stockWhere });

  const count = await db.inventoryCount.create({
    data: {
      tenant_id:  c.get('tenantId'),
      reference,
      notes,
      status:     'IN_PROGRESS',
      counted_by: c.get('user').id,
      lines: {
        create: currentStock.map(s => ({
          product_id:  s.product_id,
          variant_id:  s.variant_id,
          location_id: s.location_id,
          system_qty:  s.quantity,
          counted_qty: null,
        })),
      },
    },
    include: { lines: true },
  });

  return created(c, count);
});

// Update a single count line (set counted_qty)
app.put('/:id/lines/:lineId', async (c) => {
  const { counted_qty } = await c.req.json();
  await db.inventoryCountLine.updateMany({
    where: { id: c.req.param('lineId'), count: { tenant_id: c.get('tenantId') } },
    data: { counted_qty: Number(counted_qty) },
  });
  return ok(c, null);
});

// Finalize count - creates adjustment transactions and updates stock
app.post('/:id/finalize', requireRole('admin', 'store_manager'), async (c) => {
  const count = await db.inventoryCount.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId'), status: 'IN_PROGRESS' },
    include: { lines: true },
  });
  if (!count) throw new AppError('Count not found or already finalized', 404);

  // For each line that has a counted_qty, adjust stock and create transaction
  for (const line of count.lines) {
    if (line.counted_qty === null || line.counted_qty === undefined) continue;
    const diff = line.counted_qty - line.system_qty;
    if (diff === 0) continue;

    // Upsert stock
    await db.inventoryStock.upsert({
      where: {
        tenant_id_product_id_variant_id_location_id: {
          tenant_id:   c.get('tenantId'),
          product_id:  line.product_id,
          variant_id:  line.variant_id ?? null as any,
          location_id: line.location_id,
        },
      },
      update: { quantity: line.counted_qty },
      create: {
        tenant_id:   c.get('tenantId'),
        product_id:  line.product_id,
        variant_id:  line.variant_id,
        location_id: line.location_id,
        quantity:    line.counted_qty,
      },
    });

    // Create adjustment transaction
    await db.inventoryTransaction.create({
      data: {
        tenant_id:        c.get('tenantId'),
        transaction_type: 'ADJUSTMENT',
        reference_type:   'INVENTORY_COUNT',
        reference_id:     count.id,
        product_id:       line.product_id,
        variant_id:       line.variant_id,
        to_location_id:   diff > 0 ? line.location_id : null,
        from_location_id: diff < 0 ? line.location_id : null,
        quantity:         Math.abs(diff),
        notes:            `Count ${count.reference}: system ${line.system_qty} → counted ${line.counted_qty}`,
        performed_by:     c.get('user').id,
      },
    });
  }

  await db.inventoryCount.update({
    where: { id: count.id },
    data: { status: 'FINALIZED', finalized_at: new Date() },
  });

  return ok(c, null);
});

export default app;
