import { Hono }    from 'hono';
import { WarehouseService } from './warehouse.service';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { ok, created } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();
const warehouseService = new WarehouseService();

// ── Sites ─────────────────────────────────────────────────────────────────────

app.get('/sites', async (c) => {
  const sites = await db.site.findMany({ where: { tenant_id: c.get('tenantId') }, orderBy: { name: 'asc' } });
  return ok(c, sites);
});

app.post('/sites', requireRole('admin'), async (c) => {
  const body = await c.req.json();
  const site = await db.site.create({ data: { ...body, tenant_id: c.get('tenantId') } });
  return created(c, site);
});

// ── Warehouses ────────────────────────────────────────────────────────────────

app.get('/warehouses', async (c) => {
  const warehouses = await db.warehouse.findMany({
    where: { tenant_id: c.get('tenantId') },
    include: {
      site: { select: { name: true, city: true } },
      zones: { include: { _count: { select: { locations: true } } } },
    },
  });
  return ok(c, warehouses);
});

app.post('/warehouses', requireRole('admin', 'store_manager'), async (c) => {
  const { code, name, type, site_id, site_name, site_city, site_country } = await c.req.json();
  if (!code || !name) throw new AppError('code and name are required');

  let resolvedSiteId = site_id;

  // Auto-create site if not provided
  if (!resolvedSiteId) {
    const siteCode = `SITE-${code}`;
    const existingSite = await db.site.findFirst({ where: { tenant_id: c.get('tenantId'), code: siteCode } });
    if (existingSite) {
      resolvedSiteId = existingSite.id;
    } else {
      const site = await db.site.create({
        data: {
          tenant_id: c.get('tenantId'),
          code:      siteCode,
          name:      site_name || name,
          city:      site_city || 'La Paz',
          country:   site_country || 'BO',
        },
      });
      resolvedSiteId = site.id;
    }
  }

  const warehouse = await db.warehouse.create({
    data: {
      tenant_id: c.get('tenantId'),
      site_id:   resolvedSiteId,
      code,
      name,
      type:      type ?? 'standard',
    },
    include: { site: { select: { name: true, city: true } } },
  });
  return created(c, warehouse);
});

// ── Zones ─────────────────────────────────────────────────────────────────────

app.get('/zones', async (c) => {
  const { warehouse_id } = c.req.query();
  const where: any = { tenant_id: c.get('tenantId') };
  if (warehouse_id) where.warehouse_id = warehouse_id;
  const zones = await db.warehouseZone.findMany({
    where,
    include: { _count: { select: { locations: true } } },
    orderBy: { name: 'asc' },
  });
  return ok(c, zones);
});

app.post('/zones', requireRole('admin', 'store_manager'), async (c) => {
  const { warehouse_id, code, name, zone_type } = await c.req.json();
  if (!warehouse_id || !code || !name) throw new AppError('warehouse_id, code and name are required');
  const zone = await db.warehouseZone.create({
    data: { tenant_id: c.get('tenantId'), warehouse_id, code, name, zone_type: zone_type ?? 'storage' },
  });
  return created(c, zone);
});

// ── Locations ─────────────────────────────────────────────────────────────────

app.get('/locations', async (c) => {
  const { zone_id, warehouse_id } = c.req.query();
  const where: any = { tenant_id: c.get('tenantId') };
  if (zone_id) where.zone_id = zone_id;
  if (warehouse_id) where.zone = { warehouse_id };

  const locations = await db.warehouseLocation.findMany({
    where,
    include: { zone: { select: { name: true, zone_type: true } } },
    orderBy: { code: 'asc' },
  });
  return ok(c, locations);
});

app.post('/locations', requireRole('admin', 'store_manager'), async (c) => {
  const { zone_id, code, aisle, rack, shelf, bin, location_type, is_pick_location, is_receive_location } = await c.req.json();
  if (!zone_id || !code) throw new AppError('zone_id and code are required');
  const location = await db.warehouseLocation.create({
    data: {
      tenant_id:           c.get('tenantId'),
      zone_id,
      code,
      aisle:               aisle || null,
      rack:                rack || null,
      shelf:               shelf || null,
      bin:                 bin || null,
      location_type:       location_type ?? 'bulk',
      is_pick_location:    !!is_pick_location,
      is_receive_location: !!is_receive_location,
    },
    include: { zone: { include: { warehouse: { select: { name: true } } } } },
  });
  return created(c, location);
});

// ── Work ──────────────────────────────────────────────────────────────────────

app.get('/work', async (c) => {
  const { status, warehouse_id, assigned_to } = c.req.query();
  const where: any = { tenant_id: c.get('tenantId') };
  if (status) where.status = { in: status.split(',') };
  if (warehouse_id) where.warehouse_id = warehouse_id;
  if (assigned_to) where.assigned_to = assigned_to;

  const work = await db.warehouseWork.findMany({
    where,
    include: {
      lines: {
        include: {
          product:       { select: { name: true, sku: true } },
          from_location: { select: { code: true } },
          to_location:   { select: { code: true } },
        },
        orderBy: { sequence: 'asc' },
      },
    },
    orderBy: [{ priority: 'asc' }, { created_at: 'asc' }],
  });
  return ok(c, work);
});

app.post('/work/:id/start', async (c) => {
  const work = await db.warehouseWork.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId'), status: 'OPEN' },
    data: { status: 'IN_PROGRESS', assigned_to: c.get('user').id, started_at: new Date() },
  });
  return ok(c, work);
});

app.post('/work/:id/lines/:lineId/complete', async (c) => {
  const { quantity_done } = await c.req.json();
  await warehouseService.completeWorkLine(
    c.get('tenantId'),
    c.req.param('id'),
    c.req.param('lineId'),
    quantity_done,
    c.get('user').id
  );
  return ok(c, null);
});

app.post('/work/:id/complete', async (c) => {
  await db.warehouseWork.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data: { status: 'COMPLETED', completed_at: new Date() },
  });
  return ok(c, null);
});

// ── Waves ─────────────────────────────────────────────────────────────────────

app.get('/waves', async (c) => {
  const waves = await db.wave.findMany({
    where: { tenant_id: c.get('tenantId') },
    include: { _count: { select: { work: true } } },
    orderBy: { created_at: 'desc' },
  });
  return ok(c, waves);
});

app.post('/waves/:id/release', requireRole('admin', 'store_manager'), async (c) => {
  const wave = await warehouseService.releaseWave(c.get('tenantId'), c.req.param('id'));
  return ok(c, wave);
});

// ── Arrival Journals ──────────────────────────────────────────────────────────

app.get('/arrival-journals', async (c) => {
  const journals = await db.arrivalJournal.findMany({
    where: { tenant_id: c.get('tenantId') },
    include: { lines: true },
    orderBy: { created_at: 'desc' },
  });
  return ok(c, journals);
});

app.post('/arrival-journals', requireRole('admin', 'store_manager'), async (c) => {
  const body = await c.req.json();
  const count = await db.arrivalJournal.count({ where: { tenant_id: c.get('tenantId') } });
  const journal = await db.arrivalJournal.create({
    data: {
      ...body,
      tenant_id:      c.get('tenantId'),
      journal_number: `ARJ-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`,
      created_by:     c.get('user').id,
    },
  });
  return created(c, journal);
});

app.post('/arrival-journals/:id/post', requireRole('admin', 'store_manager'), async (c) => {
  await warehouseService.postArrivalJournal(c.get('tenantId'), c.req.param('id'), c.get('user').id);
  return ok(c, null);
});

// ── Location Directives ───────────────────────────────────────────────────────

app.get('/location-directives', requireRole('admin'), async (c) => {
  const directives = await db.locationDirective.findMany({
    where: { tenant_id: c.get('tenantId') },
    include: { lines: true },
    orderBy: { sequence: 'asc' },
  });
  return ok(c, directives);
});

app.post('/location-directives', requireRole('admin'), async (c) => {
  const body = await c.req.json();
  const directive = await db.locationDirective.create({
    data: { ...body, tenant_id: c.get('tenantId') },
  });
  return created(c, directive);
});

export default app;
