import { Hono }    from 'hono';
import { routeGuard, type RouteGuards } from '../../shared/middleware/permissions';
import { InventoryService } from './inventory.service';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { ok } from '../../shared/response';
import type { AppEnv } from '../../shared/context';
import { assertTenantReferences } from '../../shared/services/tenantReference.service';
import { validate } from '../../shared/middleware/validate';
import { StockAdjustmentSchema } from '../../shared/schemas';
import { createInventoryJournal, postInventoryJournal, assertMayEnterCost, type JournalLineInput } from './inventoryJournal.service';
import type { z } from 'zod';

const app = new Hono<AppEnv>();

/** Stock reads, the movement history, transfers and adjustments (WORK-030b). */
export const INVENTORY_ROUTE_PERMISSIONS = Object.freeze({
  'GET /stock': ['inventory.stock.read'],
  'GET /transactions': ['inventory.transaction.read'],
  'GET /low-stock': ['inventory.stock.read'],
  'POST /transfers': ['inventory.transfer.post'],
  'POST /adjust': ['inventory.adjustment.post'],
} satisfies RouteGuards);

const guard = routeGuard(INVENTORY_ROUTE_PERMISSIONS);
const inventoryService = new InventoryService();

app.get('/stock', guard('GET /stock'), async (c) => {
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

app.get('/transactions', guard('GET /transactions'), async (c) => {
  const data = await inventoryService.getTransactions(c.get('tenantId'), c.req.query() as any);
  return ok(c, data);
});

// GET /inventory/low-stock — products whose available qty is at/below their reorder point.
// Only products with reorder_point > 0 are monitored. ?scope=all returns every
// monitored product with `below` set, so the rules can be maintained on one screen.
//
// The threshold is company-wide (Product.reorder_point). **[OFFICIAL]** D365 keeps
// it on item coverage per item and coverage dimension (site, warehouse) with
// Minimum, Reorder point and Maximum, and a Min/Max coverage code lets master
// planning propose the order:
//   learn.microsoft.com/dynamics365/supply-chain/master-planning/coverage-settings
// Schema hook for that, not built (no master planning here): a per-warehouse
// coverage row (product, variant?, warehouse, min_qty, max_qty?, coverage_code?)
// that this route reads first, falling back to reorder_point.
app.get('/low-stock', guard('GET /low-stock'), async (c) => {
  const tenantId = c.get('tenantId');
  const all = c.req.query('scope') === 'all';

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
        below: available <= p.reorder_point,
      };
    })
    .filter((p) => all || p.below)
    .sort((a, b) => Number(b.below) - Number(a.below) || b.shortfall - a.shortfall || a.name.localeCompare(b.name));

  return ok(c, lowStock);
});

app.post('/transfers', guard('POST /transfers'), async (c) => {
  const body = await c.req.json();
  // D-18: every id must be this tenant's before anything moves.
  await assertTenantReferences(c.get('tenantId'), {
    lines: [{ product_id: body.product_id, variant_id: body.variant_id ?? null }],
    locations: { from_location_id: body.from_location_id, to_location_id: body.to_location_id },
  });
  await inventoryService.transferStock(c.get('tenantId'), body, c.get('user').id);
  return ok(c, null);
});

// Manual stock adjustment — a one-line ADJUSTMENT journal, created and posted in
// one transaction (WORK-045). It moves value as well as quantity: a positive
// quantity receives a cost layer, a negative one issues FIFO layers, and the
// voucher hits inventory against inventory profit or loss.
app.post('/adjust', guard('POST /adjust'), validate(StockAdjustmentSchema), async (c) => {
  const body = c.get('body') as z.infer<typeof StockAdjustmentSchema>;
  const tenantId = c.get('tenantId');

  assertMayEnterCost(c.get('user').role, 'ADJUSTMENT', [body as any]);

  const location = await db.warehouseLocation.findFirst({
    where: { id: body.location_id, tenant_id: tenantId },
    select: { zone: { select: { warehouse_id: true } } },
  });
  if (!location) throw new AppError('Unknown reference for this tenant: location_id', 422, 'FOREIGN_REFERENCE');

  const journal = await db.$transaction(async (tx) => {
    const draft = await createInventoryJournal(tenantId, c.get('user').id, {
      journal_type: 'ADJUSTMENT',
      warehouse_id: location.zone.warehouse_id,
      description: body.notes ?? 'Manual adjustment',
      reason_code_id: body.reason_code_id ?? null,
      lines: [{ ...body, notes: body.notes ?? null } as JournalLineInput],
    }, tx);
    return postInventoryJournal(tenantId, draft.id, c.get('user').id, tx);
  }, { timeout: 30_000 });

  return ok(c, journal);
});

export default app;
