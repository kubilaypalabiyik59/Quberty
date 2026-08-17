import { Hono }    from 'hono';
import { InventoryService } from './inventory.service';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { ok } from '../../shared/response';
import type { AppEnv } from '../../shared/context';
import { physicalStatusFor } from '../../shared/services/inventoryTransactionStatus';

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

// GET /inventory/low-stock — products whose available qty is at/below their reorder point.
// Only products with reorder_point > 0 are monitored.
app.get('/low-stock', async (c) => {
  const tenantId = c.get('tenantId');

  const products = await db.product.findMany({
    where: { tenant_id: tenantId, is_active: true, reorder_point: { gt: 0 } },
    select: { id: true, name: true, sku: true, reorder_point: true },
    orderBy: { name: 'asc' },
  });
  if (products.length === 0) return ok(c, []);

  const stockAgg = await db.inventoryStock.groupBy({
    by: ['product_id'],
    where: { tenant_id: tenantId, product_id: { in: products.map((p) => p.id) } },
    _sum: { quantity: true, reserved_qty: true },
  });
  const availableByProduct = new Map(
    stockAgg.map((s: any) => [s.product_id, Math.max(0, (s._sum.quantity ?? 0) - (s._sum.reserved_qty ?? 0))])
  );

  const lowStock = products
    .map((p) => {
      const available = availableByProduct.get(p.id) ?? 0;
      return {
        id: p.id, name: p.name, sku: p.sku,
        reorder_point: p.reorder_point,
        available,
        shortfall: Math.max(0, p.reorder_point - available),
      };
    })
    .filter((p) => p.available <= p.reorder_point)
    .sort((a, b) => b.shortfall - a.shortfall);

  return ok(c, lowStock);
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
      // `qty` is signed here even though the stored quantity is not, so the
      // direction IS known at this point. **[OFFICIAL]** a counting/adjustment
      // journal is physically and financially updated in one posting, so this
      // lands on PURCHASED or SOLD directly rather than on RECEIVED/DEDUCTED.
      ...physicalStatusFor('ADJUSTMENT', { delta: qty }),
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
