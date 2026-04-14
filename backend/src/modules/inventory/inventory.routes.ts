import { Hono }    from 'hono';
import { InventoryService } from './inventory.service';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { ok } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();
const inventoryService = new InventoryService();

app.get('/stock', async (c) => {
  const { warehouse_id, product_id } = c.req.query();
  const where: any = { tenant_id: c.get('tenantId') };
  if (warehouse_id) where.location = { zone: { warehouse_id } };
  if (product_id) where.product_id = product_id;

  const stock = await db.inventoryStock.findMany({
    where,
    include: {
      product: { select: { name: true, sku: true } },
      variant: { select: { sku_variant: true, size: true, color: true, attributes: true } },
      location: {
        include: { zone: { include: { warehouse: { select: { name: true, code: true } } } } },
      },
    },
    orderBy: [{ product: { name: 'asc' } }],
  });

  return ok(c, stock);
});

app.get('/transactions', async (c) => {
  const data = await inventoryService.getTransactions(c.get('tenantId'), c.req.query() as any);
  return ok(c, data);
});

app.post('/transfers', requireRole('admin', 'store_manager'), async (c) => {
  const body = await c.req.json();
  await inventoryService.transferStock(c.get('tenantId'), body, c.get('user').id);
  return ok(c, null);
});

// Manual stock adjustment
app.post('/adjust', requireRole('admin', 'store_manager'), async (c) => {
  const { product_id, variant_id, location_id, quantity, notes } = await c.req.json();
  if (!product_id || !location_id || quantity === undefined) {
    throw new AppError('product_id, location_id and quantity are required');
  }

  const qty = Number(quantity);
  if (qty === 0) throw new AppError('Quantity cannot be zero');

  // Upsert stock
  await db.inventoryStock.upsert({
    where: {
      tenant_id_product_id_variant_id_location_id: {
        tenant_id: c.get('tenantId'),
        product_id,
        variant_id: variant_id ?? null as any,
        location_id,
      },
    },
    update: { quantity: { increment: qty } },
    create: {
      tenant_id: c.get('tenantId'),
      product_id,
      variant_id: variant_id ?? null,
      location_id,
      quantity: Math.max(0, qty),
    },
  });

  // Transaction record
  await db.inventoryTransaction.create({
    data: {
      tenant_id:        c.get('tenantId'),
      transaction_type: 'ADJUSTMENT',
      product_id,
      variant_id:       variant_id ?? null,
      to_location_id:   qty > 0 ? location_id : null,
      from_location_id: qty < 0 ? location_id : null,
      quantity:         Math.abs(qty),
      notes:            notes || 'Manual adjustment',
      performed_by:     c.get('user').id,
    },
  });

  return ok(c, null);
});

export default app;
