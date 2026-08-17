import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

/**
 * Set up directed putaway for one warehouse, and optionally switch it on.
 *
 *   npx tsx scripts/setupWarehousePutaway.ts --warehouse WH-MAIN
 *   npx tsx scripts/setupWarehousePutaway.ts --warehouse WH-MAIN --receive RCV-001 --pick-zone STG --apply
 *   npx tsx scripts/setupWarehousePutaway.ts --warehouse WH-MAIN --apply --enable
 *
 * Migration 017 built the machinery and deliberately switched nothing on. This is
 * the setup that makes it real for a named warehouse. Dry run by default.
 *
 * ── The directive shape, and why it is two lines ────────────────────────────
 * **[OFFICIAL]** for exactly our scenario — "a purchase order process where the
 * location directive must find free capacity within a warehouse for inventory items
 * that you just registered at the receiving dock" — Microsoft prescribes two
 * actions:
 *
 *   "The first action in the sequence must use the Consolidate strategy, and the
 *    second should use the Empty location with no incoming work strategy."
 *   learn.microsoft.com/dynamics365/supply-chain/warehousing/create-location-directive
 *
 * **[OFFICIAL]** and the work type is not a choice: "For directive with work order
 * type Purchase order, Put is the only supported value."
 *   learn.microsoft.com/dynamics365/supply-chain/warehousing/tasks/set-up-location-directive-purchase-order-put-away
 *
 * ── What happens when nothing resolves ──────────────────────────────────────
 * **[OFFICIAL]** D365 makes this a setting ("Stop work on location directive
 * failure"). We do not have that setting; `productReceipt.service.ts` logs at WARN
 * and creates no work, so the goods stay on the dock and are visibly not put away.
 * That is the safer of the two documented outcomes and it is stated here so the
 * choice is visible rather than accidental.
 */

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const APPLY = process.argv.includes('--apply');
const ENABLE = process.argv.includes('--enable');
const WAREHOUSE = arg('warehouse');
const RECEIVE = arg('receive');
const PICK_ZONE = arg('pick-zone');

if (!WAREHOUSE) {
  console.error('usage: tsx scripts/setupWarehousePutaway.ts --warehouse <CODE> [--receive <LOC>] [--pick-zone <ZONE>] [--apply] [--enable]');
  process.exit(1);
}

let planned = 0;
const plan = (what: string) => {
  planned++;
  console.log(`  ${APPLY ? 'APPLY ' : 'WOULD '} ${what}`);
};

(async () => {
  const wh = await db.warehouse.findFirst({
    where: { code: WAREHOUSE },
    include: {
      site: { select: { code: true, city: true, country: true } },
      parameters: true,
      zones: { include: { locations: { orderBy: { code: 'asc' } } }, orderBy: { code: 'asc' } },
      location_directives: { include: { lines: true } },
    },
  });
  if (!wh) throw new Error(`No warehouse with code ${WAREHOUSE}.`);

  console.log(`\n${wh.code} — ${wh.name}   site ${wh.site.code} (${wh.site.city}/${wh.site.country})`);
  const tenantId = wh.tenant_id;

  const allLocations = wh.zones.flatMap(z => z.locations.map(l => ({ ...l, zone: z })));
  const receiveLocations = allLocations.filter(l => l.is_receive_location && l.is_active);
  const pickLocations = allLocations.filter(l => l.is_pick_location && l.is_active);

  console.log(`  ${allLocations.length} location(s): ${receiveLocations.length} receive · ${pickLocations.length} pick`);

  if (pickLocations.length === 0) {
    console.log(
      '\n  STOP  This warehouse has no pick location. Directed putaway would have nowhere to put\n' +
        '        anything, and switching PICK_LOCATIONS_ONLY on would make all its stock unsellable.\n' +
        '        Create pick locations first.',
    );
    await db.$disconnect();
    process.exit(1);
  }

  // ── 1. The receive location ────────────────────────────────────────────────
  console.log('\n── Default receive location');
  let receiveId = wh.parameters?.default_receive_location_id ?? null;

  if (receiveId) {
    const current = allLocations.find(l => l.id === receiveId);
    console.log(`  OK       already ${current?.code ?? receiveId}`);
  } else if (RECEIVE) {
    const chosen = receiveLocations.find(l => l.code === RECEIVE);
    if (!chosen) throw new Error(`${RECEIVE} is not an active receive location in ${wh.code}.`);
    plan(`set default receive location = ${chosen.code}`);
    receiveId = chosen.id;
  } else if (receiveLocations.length === 1) {
    plan(`set default receive location = ${receiveLocations[0].code} (the only one)`);
    receiveId = receiveLocations[0].id;
  } else {
    // Migration 017 left this NULL for exactly this reason and it was right to.
    console.log(
      `  REFUSE   ${receiveLocations.length} receive locations (${receiveLocations.map(l => l.code).join(', ')}).\n` +
        `           Pass --receive <CODE>. Guessing sends every receipt to the wrong dock.`,
    );
  }

  // ── 2. The putaway directive ───────────────────────────────────────────────
  console.log('\n── Putaway location directive');
  const existing = wh.location_directives.find(d => d.directive_type === 'PUTAWAY' && d.is_active);

  if (existing) {
    console.log(`  OK       ${existing.code} "${existing.name}" already exists with ${existing.lines.length} line(s)`);
  } else {
    // Which zone the goods go INTO. Not the receive zone — that is where they are.
    const pickZones = wh.zones.filter(z => z.locations.some(l => l.is_pick_location && l.is_active));
    const zone = PICK_ZONE
      ? pickZones.find(z => z.code === PICK_ZONE)
      : pickZones.length === 1
        ? pickZones[0]
        : undefined;

    if (!zone) {
      console.log(
        `  REFUSE   ${pickZones.length} zone(s) contain pick locations ` +
          `(${pickZones.map(z => z.code).join(', ')}). Pass --pick-zone <CODE>.`,
      );
    } else {
      plan(`create directive PUTAWAY-${wh.code} → zone ${zone.code}, 2 lines (CONSOLIDATE then EMPTY_LOCATION)`);
      if (APPLY) {
        await db.locationDirective.create({
          data: {
            tenant_id: tenantId,
            code: `PUTAWAY-${wh.code}`,
            name: `Putaway — ${wh.name}`,
            directive_type: 'PUTAWAY',
            warehouse_id: wh.id,
            // **[OFFICIAL]** Put is the only supported work type for a purchase-order
            // directive.
            work_type: 'PUT',
            sequence: 1,
            lines: {
              create: [
                {
                  sequence: 1,
                  from_qty: 0,
                  to_qty: null,
                  strategy: 'CONSOLIDATE',
                  zone_id: zone.id,
                },
                {
                  sequence: 2,
                  from_qty: 0,
                  to_qty: null,
                  strategy: 'EMPTY_LOCATION',
                  zone_id: zone.id,
                },
              ],
            },
          },
        });
      }
    }
  }

  // ── 3. Write the parameters ────────────────────────────────────────────────
  console.log('\n── Warehouse parameters');
  const params = wh.parameters;
  const wantPutaway = ENABLE ? true : (params?.require_putaway ?? false);
  const wantAvailability = ENABLE ? 'PICK_LOCATIONS_ONLY' : (params?.availability_counts ?? 'ALL_LOCATIONS');

  if (ENABLE) {
    // What switching on actually costs, quantified before it is done.
    const stranded = await db.$queryRawUnsafe<any[]>(
      `
      SELECT wl.code, SUM(s.quantity)::int AS qty
      FROM inventory_stock s
      JOIN warehouse_locations wl ON wl.id = s.location_id
      JOIN warehouse_zones wz ON wz.id = wl.zone_id
      WHERE wz.warehouse_id = $1::uuid AND wl.is_pick_location = false AND s.quantity > 0
      GROUP BY 1 ORDER BY 1
    `,
      wh.id,
    );
    if (stranded.length > 0) {
      const total = stranded.reduce((s, r) => s + r.qty, 0);
      console.log(
        `  ⚠ ${total} unit(s) sit outside a pick location and STOP counting as available:\n` +
          stranded.map(r => `      ${r.code}  ${r.qty}`).join('\n') +
          `\n    That is the point of the setting, not a side effect — the goods are on the dock,\n` +
          `    not on a shelf. Put them away and they count again.`,
      );
    }
  }

  const changes: string[] = [];
  if (receiveId !== (params?.default_receive_location_id ?? null)) changes.push('default_receive_location_id');
  if (wantPutaway !== (params?.require_putaway ?? false)) changes.push(`require_putaway=${wantPutaway}`);
  if (wantAvailability !== (params?.availability_counts ?? 'ALL_LOCATIONS')) changes.push(`availability_counts=${wantAvailability}`);

  if (changes.length === 0) {
    console.log('  OK       parameters already as requested');
  } else {
    plan(`update parameters: ${changes.join(', ')}`);
    if (APPLY) {
      await db.warehouseParameters.upsert({
        where: { warehouse_id: wh.id },
        create: {
          tenant_id: tenantId,
          warehouse_id: wh.id,
          default_receive_location_id: receiveId,
          require_putaway: wantPutaway,
          availability_counts: wantAvailability,
        },
        update: {
          default_receive_location_id: receiveId,
          require_putaway: wantPutaway,
          availability_counts: wantAvailability,
        },
      });
    }
  }

  // ── 4. The stock already sitting on the dock ───────────────────────────────
  //
  // Without this the switch is a trap. Stock received BEFORE putaway existed has no
  // work attached to it, so turning PICK_LOCATIONS_ONLY on makes it invisible to
  // sales with no action anywhere in the product that would move it. It would look
  // like inventory had evaporated.
  console.log('\n── Stock already on non-pick locations');
  const onDock = await db.inventoryStock.findMany({
    where: {
      tenant_id: tenantId,
      quantity: { gt: 0 },
      location: { zone: { warehouse_id: wh.id }, is_pick_location: false },
    },
    include: { location: { select: { id: true, code: true } } },
  });

  if (onDock.length === 0) {
    console.log('  none — nothing is stranded by switching PICK_LOCATIONS_ONLY on');
  } else {
    const { WarehouseService } = await import('../src/modules/warehouse/warehouse.service');
    const service = new WarehouseService();

    for (const s of onDock) {
      const already = await db.warehouseWorkLine.findFirst({
        where: {
          from_location_id: s.location_id,
          product_id: s.product_id,
          work: { status: { in: ['OPEN', 'IN_PROGRESS'] }, work_type: 'PUTAWAY' },
        },
        select: { id: true },
      });
      if (already) {
        console.log(`  OK       ${s.location.code} ${s.quantity} — putaway work already open`);
        continue;
      }

      const destination = APPLY
        ? await service.resolvePutawayLocation(tenantId, wh.id, s.product_id, Number(s.quantity))
        : null;

      if (!APPLY) {
        plan(`create putaway work for ${s.quantity} from ${s.location.code} (destination resolves on apply)`);
        continue;
      }
      if (!destination || destination === s.location_id) {
        console.log(
          `  WARN     ${s.location.code} ${s.quantity} — no directive resolved a destination. ` +
            `Left where it is; it will NOT count as available once PICK_LOCATIONS_ONLY is on.`,
        );
        continue;
      }

      plan(`create putaway work: ${s.quantity} from ${s.location.code}`);
      await db.warehouseWork.create({
        data: {
          tenant_id: tenantId,
          work_id_code: `WRK-PA-BACKLOG-${wh.code}-${s.id.slice(0, 8)}`,
          work_type: 'PUTAWAY',
          status: 'OPEN',
          warehouse_id: wh.id,
          reference_type: 'BACKLOG',
          reference_id: s.id,
          priority: 3,
          lines: {
            create: [
              {
                sequence: 1,
                line_type: 'PUT',
                product_id: s.product_id,
                variant_id: s.variant_id,
                quantity: s.quantity,
                from_location_id: s.location_id,
                to_location_id: destination,
                status: 'PENDING',
              },
            ],
          },
        },
      });
    }
  }

  console.log(
    `\n${APPLY ? 'Applied' : 'Planned'} ${planned} change(s).` +
      (APPLY ? '' : '  Re-run with --apply.') +
      (APPLY && !ENABLE ? '  Add --enable to switch putaway on.' : ''),
  );
  await db.$disconnect();
})().catch(async (e) => {
  console.error(e.message ?? e);
  await db.$disconnect();
  process.exit(1);
});
