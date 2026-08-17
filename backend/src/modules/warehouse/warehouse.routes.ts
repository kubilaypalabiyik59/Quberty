import { Hono }    from 'hono';
import { WarehouseService } from './warehouse.service';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { ok, created } from '../../shared/response';
import { planLocations, segmentsOf, MAX_LOCATION_NAME, type Segment } from './locationFormat.service';
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

/**
 * Create a warehouse.
 *
 * ## Why this no longer invents a site
 *
 * It used to auto-create `SITE-<code>` whenever `site_id` was absent, defaulting
 * the city to 'La Paz' and the country to 'BO'. That is how the anchor tenant
 * ended up with one site per warehouse — which empties the site tier of meaning,
 * since a site exists precisely to be the operational unit ABOVE several
 * warehouses — and how one site came to have `city = 'Bolivia'`, a country in
 * the city column, which would put that store ~400 km from Santa Cruz on any map.
 *
 * A site is now either chosen or created deliberately. `create_site: true` with
 * real values is the explicit path; there are no hardcoded geographic defaults,
 * because a hardcoded city in a product sold in three countries is a defect.
 */
/**
 * Everything the warehouse setup screen needs, in one read.
 *
 * Deliberately includes the things that make a misconfiguration visible rather
 * than only the happy-path fields: which warehouse is the sales default, how
 * many locations each zone actually has, and whether stock is sitting in a
 * warehouse nobody sells from.
 */
app.get('/overview', async (c) => {
  const tenantId = c.get('tenantId');

  const [warehouses, params, stock] = await Promise.all([
    db.warehouse.findMany({
      where: { tenant_id: tenantId },
      include: {
        site: { select: { id: true, code: true, name: true, city: true, country: true } },
        zones: { include: { _count: { select: { locations: true } } } },
        _count: { select: { sales_orders: true, purchase_orders: true } },
      },
      orderBy: { code: 'asc' },
    }),
    db.salesParameters.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: null },
      select: { default_warehouse_id: true, require_warehouse_on_sales_order: true },
    }),
    db.$queryRaw<{ warehouse_id: string; on_hand: number; stock_rows: number }[]>`
      SELECT z.warehouse_id::text AS warehouse_id,
             COALESCE(SUM(st.quantity), 0)::float AS on_hand,
             COUNT(st.id)::int AS stock_rows
        FROM warehouse_zones z
        LEFT JOIN warehouse_locations l ON l.zone_id = z.id
        LEFT JOIN inventory_stock st ON st.location_id = l.id
       WHERE z.tenant_id = ${tenantId}::uuid
       GROUP BY 1
    `,
  ]);

  const stockBy = new Map(stock.map((s) => [s.warehouse_id, s]));

  return ok(c, {
    default_warehouse_id: params?.default_warehouse_id ?? null,
    warehouse_required: params?.require_warehouse_on_sales_order ?? false,
    warehouses: warehouses.map((w) => ({
      id: w.id,
      code: w.code,
      name: w.name,
      type: w.type,
      is_active: w.is_active,
      is_default: w.id === params?.default_warehouse_id,
      site: w.site,
      zone_count: w.zones.length,
      location_count: w.zones.reduce((n, z) => n + z._count.locations, 0),
      sales_orders: w._count.sales_orders,
      purchase_orders: w._count.purchase_orders,
      on_hand: stockBy.get(w.id)?.on_hand ?? 0,
      stock_rows: stockBy.get(w.id)?.stock_rows ?? 0,
    })),
  });
});

app.post('/warehouses', requireRole('admin', 'store_manager'), async (c) => {
  const { code, name, type, site_id, site_name, site_city, site_country, create_site } = await c.req.json();
  if (!code || !name) throw new AppError('code and name are required');

  let resolvedSiteId = site_id;

  if (!resolvedSiteId) {
    if (!create_site) {
      const sites = await db.site.findMany({
        where: { tenant_id: c.get('tenantId') },
        select: { id: true, code: true, name: true, city: true },
        orderBy: { name: 'asc' },
      });
      throw new AppError(
        'A warehouse must belong to a site. Pass site_id, or pass create_site with site_name, ' +
          'site_city and site_country. ' +
          (sites.length
            ? `Existing sites: ${sites.map((s) => `${s.code} (${s.name}, ${s.city})`).join(' · ')}`
            : 'No sites exist yet — create one.'),
        422,
      );
    }
    if (!site_name || !site_city || !site_country) {
      throw new AppError(
        'Creating a site needs site_name, site_city and site_country. These are not defaulted: ' +
          'a hardcoded city is wrong in every country but one.',
        422,
      );
    }
    const siteCode = `SITE-${code}`;
    const existingSite = await db.site.findFirst({ where: { tenant_id: c.get('tenantId'), code: siteCode } });
    resolvedSiteId = existingSite
      ? existingSite.id
      : (
          await db.site.create({
            data: {
              tenant_id: c.get('tenantId'),
              code:      siteCode,
              name:      site_name,
              city:      site_city,
              country:   site_country,
            },
          })
        ).id;
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

/**
 * Bulk location creation — our equivalent of D365's **Location setup wizard**.
 *
 * **[OFFICIAL]** "To quickly create the locations within a warehouse, use the
 * Location setup wizard. As part of this process, you can easily maintain the
 * format of the location names."
 * learn.microsoft.com/dynamics365/supply-chain/warehousing/warehouse-configuration
 *
 * `dry_run` (the default) returns the plan without writing. A range that looks
 * small often is not — four segments of 1–10 is ten thousand bins — and finding
 * that out by creating them is expensive to undo.
 *
 * Existing codes are skipped rather than erroring, so re-running after widening
 * a range does the obvious thing instead of failing on the first collision.
 */
app.post('/locations/bulk', requireRole('admin', 'store_manager'), async (c) => {
  const body = await c.req.json();
  const { zone_id, segments, location_type, is_pick_location, is_receive_location } = body;
  const dryRun = body.dry_run !== false;

  if (!zone_id) throw new AppError('zone_id is required');
  if (!Array.isArray(segments) || !segments.length) throw new AppError('segments must be a non-empty array');

  const zone = await db.warehouseZone.findFirst({
    where: { id: zone_id, tenant_id: c.get('tenantId') },
    include: { warehouse: { select: { code: true, name: true } } },
  });
  if (!zone) throw new AppError('Zone not found for this tenant', 404);

  const plan = planLocations(segments as Segment[]);

  const existing = await db.warehouseLocation.findMany({
    where: { zone_id, code: { in: plan.codes } },
    select: { code: true },
  });
  const already = new Set(existing.map((e) => e.code));
  const toCreate = plan.codes.filter((code) => !already.has(code));

  if (dryRun) {
    return ok(c, {
      dry_run: true,
      zone: { id: zone.id, code: zone.code, name: zone.name, warehouse: zone.warehouse.name },
      name_length: plan.nameLength,
      max_name_length: MAX_LOCATION_NAME,
      total: plan.total,
      already_exist: already.size,
      will_create: toCreate.length,
      sample: plan.sample,
    });
  }

  if (!toCreate.length) {
    return ok(c, { created: 0, already_exist: already.size, message: 'Every location in this range already exists.' });
  }

  await db.warehouseLocation.createMany({
    data: toCreate.map((code) => {
      const parts = segmentsOf(code, segments as Segment[]);
      return {
        tenant_id:           c.get('tenantId'),
        zone_id,
        code,
        aisle:               parts.aisle ?? null,
        rack:                parts.rack ?? null,
        shelf:               parts.shelf ?? null,
        bin:                 parts.bin ?? null,
        location_type:       location_type ?? 'bulk',
        is_pick_location:    !!is_pick_location,
        is_receive_location: !!is_receive_location,
      };
    }),
  });

  return created(c, {
    created: toCreate.length,
    already_exist: already.size,
    zone: zone.name,
    sample: toCreate.slice(0, 5),
  });
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

// ── Warehouse Quick-Setup ─────────────────────────────────────────────────────
// Creates a full warehouse structure in one call:
// Site → Warehouse → 3 Zones (Receiving / Storage / Shipping) → 5 locations each

app.post('/setup', requireRole('admin', 'store_manager'), async (c) => {
  const { name = 'Main Warehouse', city = '', country = '', type = 'standard' } = await c.req.json();
  const tenantId = c.get('tenantId');

  const site = await db.site.create({
    data: { tenant_id: tenantId, code: 'SITE-MAIN', name: `${name} Site`, city: city || 'Main City', country: country || 'XX' },
  });

  const warehouse = await db.warehouse.create({
    data: { tenant_id: tenantId, site_id: site.id, code: 'WH-MAIN', name, type },
  });

  const zoneDefinitions = [
    { code: 'RCV', name: 'Receiving',  zone_type: 'receiving' },
    { code: 'STG', name: 'Storage',    zone_type: 'storage'  },
    { code: 'SHP', name: 'Shipping',   zone_type: 'shipping' },
  ];

  for (const zd of zoneDefinitions) {
    const zone = await db.warehouseZone.create({
      data: { tenant_id: tenantId, warehouse_id: warehouse.id, ...zd },
    });
    for (let i = 1; i <= 5; i++) {
      await db.warehouseLocation.create({
        data: {
          tenant_id:           tenantId,
          zone_id:             zone.id,
          code:                `${zd.code}-${String(i).padStart(3, '0')}`,
          aisle:               zd.code,
          rack:                '01',
          shelf:               String(i).padStart(2, '0'),
          location_type:       'bulk',
          is_receive_location: zd.zone_type === 'receiving',
          is_pick_location:    zd.zone_type === 'storage',
        },
      });
    }
  }

  return created(c, { warehouse, zones: zoneDefinitions.length, locations: zoneDefinitions.length * 5 });
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

// ── Warehouse parameters — per warehouse, not per tenant ─────────────────────
//
// **[OFFICIAL]** D365 sets warehouse behaviour on the individual warehouse, which
// is also what a three-store retailer needs: "receive it and it is sellable" in the
// shops and directed putaway in the distribution warehouse, at the same time.
//
// Migration 017 created the table and switched nothing on. This is where a person
// switches it on, instead of running a script from the repo.

app.get('/parameters', requireRole('admin', 'store_manager'), async (c) => {
  const warehouses = await db.warehouse.findMany({
    where: { tenant_id: c.get('tenantId') },
    include: {
      site: { select: { code: true, name: true } },
      parameters: { include: { default_receive_location: { select: { id: true, code: true } } } },
      zones: {
        select: {
          id: true, code: true, name: true,
          locations: {
            select: { id: true, code: true, is_pick_location: true, is_receive_location: true, is_active: true },
            orderBy: { code: 'asc' },
          },
        },
        orderBy: { code: 'asc' },
      },
      location_directives: {
        where: { is_active: true },
        select: { id: true, code: true, name: true, directive_type: true, work_type: true },
      },
    },
    orderBy: { code: 'asc' },
  });

  // Everything the screen needs to warn BEFORE a switch is flipped, computed here
  // rather than left for the UI to infer. Enabling PICK_LOCATIONS_ONLY on a
  // warehouse with no pick location makes all of its stock unsellable — that is a
  // fact about the data, so the server states it.
  const rows = await Promise.all(warehouses.map(async (w) => {
    const pickLocations = w.zones.flatMap(z => z.locations).filter(l => l.is_pick_location && l.is_active);
    const stranded = await db.inventoryStock.aggregate({
      where: {
        tenant_id: c.get('tenantId'),
        quantity: { gt: 0 },
        location: { zone: { warehouse_id: w.id }, is_pick_location: false },
      },
      _sum: { quantity: true },
    });

    return {
      ...w,
      readiness: {
        pick_location_count: pickLocations.length,
        putaway_directive_count: w.location_directives.filter(d => d.directive_type === 'PUTAWAY').length,
        units_outside_pick_locations: Number(stranded._sum.quantity ?? 0),
        can_enable_putaway: pickLocations.length > 0
          && w.location_directives.some(d => d.directive_type === 'PUTAWAY'),
      },
    };
  }));

  return ok(c, rows);
});

app.put('/parameters/:warehouseId', requireRole('admin', 'store_manager'), async (c) => {
  const warehouseId = c.req.param('warehouseId');
  const wh = await db.warehouse.findFirst({
    where: { id: warehouseId, tenant_id: c.get('tenantId') },
    include: {
      zones: { select: { locations: { select: { is_pick_location: true, is_active: true } } } },
      location_directives: { where: { is_active: true, directive_type: 'PUTAWAY' }, select: { id: true } },
    },
  });
  if (!wh) throw new AppError('Warehouse not found', 404);

  const b = await c.req.json();
  const wantPutaway = b.require_putaway ?? undefined;
  const wantAvailability = b.availability_counts ?? undefined;

  const pickCount = wh.zones.flatMap(z => z.locations).filter(l => l.is_pick_location && l.is_active).length;

  // Refused, not warned. Turning these on without somewhere to put goods does not
  // degrade gracefully — it makes stock invisible to sales with no way to move it,
  // which reads as inventory evaporating.
  if (wantPutaway === true && wh.location_directives.length === 0) {
    throw new AppError(
      `${wh.code} has no active putaway location directive, so putaway work would have no destination ` +
        `and no work would be created. Add a directive first.`,
      400,
      'PUTAWAY_NO_DIRECTIVE',
    );
  }
  if (wantAvailability === 'PICK_LOCATIONS_ONLY' && pickCount === 0) {
    throw new AppError(
      `${wh.code} has no pick location, so counting only pick locations would make ALL of its stock ` +
        `unsellable. Flag at least one location as a pick location first.`,
      400,
      'NO_PICK_LOCATION',
    );
  }

  const row = await db.warehouseParameters.upsert({
    where: { warehouse_id: warehouseId },
    create: {
      tenant_id: c.get('tenantId'),
      warehouse_id: warehouseId,
      require_putaway: b.require_putaway ?? false,
      require_pick_work: b.require_pick_work ?? false,
      availability_counts: b.availability_counts ?? 'ALL_LOCATIONS',
      default_receive_location_id: b.default_receive_location_id ?? null,
    },
    update: {
      ...(b.require_putaway !== undefined && { require_putaway: !!b.require_putaway }),
      ...(b.require_pick_work !== undefined && { require_pick_work: !!b.require_pick_work }),
      ...(b.availability_counts !== undefined && { availability_counts: b.availability_counts }),
      ...(b.default_receive_location_id !== undefined && {
        default_receive_location_id: b.default_receive_location_id || null,
      }),
    },
  });

  return ok(c, row);
});

// Directives get a full editor, including lines — the two-action sequence
// **[OFFICIAL]** Microsoft prescribes (Consolidate, then Empty location with no
// incoming work) is not something a person should have to write SQL for.
app.post('/location-directives/:id/lines', requireRole('admin', 'store_manager'), async (c) => {
  const directive = await db.locationDirective.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
  });
  if (!directive) throw new AppError('Location directive not found', 404);

  const b = await c.req.json();
  if (!['CONSOLIDATE', 'EMPTY_LOCATION'].includes(b.strategy)) {
    throw new AppError('strategy must be CONSOLIDATE or EMPTY_LOCATION', 400);
  }
  if (!b.zone_id && !b.location_id) {
    throw new AppError('A directive line must name a zone or a specific location.', 400);
  }

  const line = await db.locationDirectiveLine.create({
    data: {
      directive_id: directive.id,
      sequence: b.sequence ?? 1,
      from_qty: b.from_qty ?? 0,
      to_qty: b.to_qty ?? null,
      strategy: b.strategy,
      zone_id: b.zone_id ?? null,
      location_id: b.location_id ?? null,
    },
  });
  return created(c, line);
});

app.delete('/location-directives/:id', requireRole('admin', 'store_manager'), async (c) => {
  const d = await db.locationDirective.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
  });
  if (!d) throw new AppError('Location directive not found', 404);
  await db.locationDirective.delete({ where: { id: d.id } });
  return ok(c, null);
});

export default app;
