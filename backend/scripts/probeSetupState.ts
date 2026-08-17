import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

/**
 * Read-only survey of everything the 2026-08-17 setup session needs to decide:
 * department master, WH-MAIN putaway setup, default warehouse, IT on purchases.
 * Writes nothing.
 */
(async () => {
  const tenants = await db.tenant.findMany({ select: { id: true, name: true } });
  console.log('TENANTS');
  for (const t of tenants) console.log(`  ${t.id}  ${t.name}`);

  console.log('\nEMPLOYEE.department (free text today)');
  const emps = await db.employee.groupBy({
    by: ['department'],
    _count: { _all: true },
  });
  if (emps.length === 0) console.log('  (no employees)');
  for (const e of emps) console.log(`  ${JSON.stringify(e.department)} × ${e._count._all}`);

  console.log('\nEMPLOYEE.position (free text today)');
  const pos = await db.employee.groupBy({ by: ['position'], _count: { _all: true } });
  for (const p of pos) console.log(`  ${JSON.stringify(p.position)} × ${p._count._all}`);

  console.log('\nWAREHOUSES · zones · locations');
  const whs = await db.warehouse.findMany({
    include: {
      site: { select: { code: true, name: true, city: true, country: true } },
      parameters: true,
      zones: { include: { locations: true } },
      location_directives: { include: { lines: true } },
      _count: { select: { sales_orders: true, purchase_orders: true } },
    },
    orderBy: { code: 'asc' },
  });
  for (const w of whs) {
    console.log(
      `\n  ${w.code}  ${w.name}   site=${w.site.code} (${w.site.city}/${w.site.country})` +
        `  SO=${w._count.sales_orders} PO=${w._count.purchase_orders} active=${w.is_active}`,
    );
    const p = w.parameters;
    console.log(
      `    params: putaway=${p?.require_putaway ?? '—'} pickwork=${p?.require_pick_work ?? '—'} ` +
        `availability=${p?.availability_counts ?? '—'} receiveLoc=${p?.default_receive_location_id ?? 'null'}`,
    );
    for (const z of w.zones) {
      console.log(`    zone ${z.code} [${z.zone_type}] — ${z.locations.length} location(s)`);
      for (const l of z.locations) {
        console.log(
          `      ${l.code.padEnd(12)} type=${l.location_type.padEnd(10)} ` +
            `pick=${l.is_pick_location} receive=${l.is_receive_location} active=${l.is_active}`,
        );
      }
    }
    if (w.zones.length === 0) console.log('    (no zones)');
    console.log(`    location directives: ${w.location_directives.length}`);
    for (const d of w.location_directives) {
      console.log(
        `      ${d.name} work=${d.work_type} order=${d.sequence_number} lines=${d.lines.length}`,
      );
    }
  }

  console.log('\nON-HAND by warehouse/location');
  const stock = await db.$queryRawUnsafe<any[]>(`
    SELECT w.code AS wh, wl.code AS loc, wl.is_pick_location, wl.is_receive_location,
           SUM(s.quantity)::int AS qty, COUNT(*)::int AS rows
    FROM inventory_stock s
    JOIN warehouse_locations wl ON wl.id = s.location_id
    JOIN warehouse_zones wz ON wz.id = wl.zone_id
    JOIN warehouses w ON w.id = wz.warehouse_id
    GROUP BY 1,2,3,4 ORDER BY 1,2
  `);
  for (const r of stock) {
    console.log(
      `  ${String(r.wh).padEnd(12)} ${String(r.loc).padEnd(12)} pick=${r.is_pick_location} ` +
        `recv=${r.is_receive_location} qty=${r.qty} rows=${r.rows}`,
    );
  }

  console.log('\nSALES PARAMETERS');
  const sp = await db.salesParameters.findMany({
    select: {
      tenant_id: true,
      default_warehouse_id: true,
      require_warehouse_on_sales_order: true,
    },
  });
  for (const s of sp) {
    const wh = s.default_warehouse_id
      ? await db.warehouse.findUnique({ where: { id: s.default_warehouse_id }, select: { code: true } })
      : null;
    console.log(
      `  tenant=${s.tenant_id} defaultWarehouse=${wh?.code ?? 'NULL'} ` +
        `requireWarehouse=${s.require_warehouse_on_sales_order}`,
    );
  }

  console.log('\nTAX CODES');
  const tc = await db.taxCode.findMany({
    select: { code: true, name: true, rate: true, base_kind: true, is_recoverable: true, tax_type: true },
    orderBy: { code: 'asc' },
  });
  for (const t of tc) {
    console.log(
      `  ${t.code.padEnd(10)} ${String(t.name).padEnd(28)} rate=${t.rate} base=${t.base_kind} ` +
        `recoverable=${t.is_recoverable} type=${t.tax_type}`,
    );
  }

  console.log('\nJOURNAL LINES total');
  const jl = await db.journalLine.count();
  const je = await db.journalEntry.count();
  console.log(`  ${je} entries · ${jl} lines`);

  await db.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
