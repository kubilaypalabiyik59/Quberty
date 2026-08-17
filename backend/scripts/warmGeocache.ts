import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { resolveAddress, addressKey } from '../src/shared/services/geocoder.service';

/**
 * Fill the geocoding cache for every place this tenant actually references.
 *
 * Run deliberately, not on a page load. Nominatim's policy allows one request
 * per second and forbids bulk geocoding, so resolving 40 places takes 40 seconds
 * — which is fine for a job and unacceptable for a dashboard. The panel reads
 * cache-only.
 *
 *   npx tsx scripts/warmGeocache.ts            # every tenant
 *   npx tsx scripts/warmGeocache.ts --dry-run  # show what would be asked
 */
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } }, log: ['error'] });
const dryRun = process.argv.includes('--dry-run');

(async () => {
  const tenants = await prisma.$queryRawUnsafe<any[]>(
    `SELECT DISTINCT tenant_id::text AS id FROM sites`,
  );

  for (const t of tenants) {
    // Sites first — they are what documents resolve through. Customers and
    // suppliers are added here when the panel starts drawing them.
    const sites = await prisma.site.findMany({
      where: { tenant_id: t.id },
      select: { code: true, name: true, city: true, country: true, latitude: true, longitude: true },
    });

    console.log(`\n═══ tenant ${t.id} — ${sites.length} site(s) ═══`);

    for (const s of sites) {
      if (s.latitude != null && s.longitude != null) {
        console.log(`  ⏭ ${s.code} — manual coordinates on the site, geocoder not consulted`);
        continue;
      }
      const key = addressKey({ city: s.city, country: s.country });
      if (!key) {
        console.log(`  ✗ ${s.code} — no city or country to search on`);
        continue;
      }
      if (dryRun) {
        console.log(`  ? ${s.code} — would ask for "${key}"`);
        continue;
      }

      const hit = await resolveAddress(t.id, { city: s.city, country: s.country }, true);
      if (hit) {
        const flag = hit.confidence != null && hit.confidence < 0.4 ? '  ⚠ low confidence' : '';
        console.log(`  ✓ ${s.code.padEnd(12)} ${key.padEnd(24)} → ${hit.lat.toFixed(4)}, ${hit.lng.toFixed(4)} (${hit.source})${flag}`);
      } else {
        console.log(`  ✗ ${s.code.padEnd(12)} ${key.padEnd(24)} → not resolved (cached as a miss so it is not re-asked)`);
      }
    }

    // Counterparties: the far end of every route. Without them an agent has an
    // origin and nowhere to walk to, so it never appears on the map.
    const parties = await prisma.$queryRawUnsafe<any[]>(
      `SELECT DISTINCT city, country FROM (
         SELECT city, country FROM customers WHERE tenant_id::text = $1
         UNION SELECT city, country FROM suppliers WHERE tenant_id::text = $1
       ) x WHERE city IS NOT NULL AND btrim(city) <> ''`,
      t.id,
    );

    console.log(`  — ${parties.length} distinct customer/supplier place(s)`);

    for (const p of parties) {
      const key = addressKey({ city: p.city, country: p.country });
      if (dryRun) { console.log(`  ? would ask for "${key}"`); continue; }
      const hit = await resolveAddress(t.id, { city: p.city, country: p.country }, true);
      if (hit) {
        console.log(`  ✓ ${''.padEnd(12)} ${key.padEnd(24)} → ${hit.lat.toFixed(4)}, ${hit.lng.toFixed(4)}`);
      } else {
        // Worth reading rather than skimming: an unresolvable place is usually a
        // data defect (a country name in the country CODE column, a city that is
        // actually a country), not a gap in OpenStreetMap.
        console.log(`  ✗ ${''.padEnd(12)} ${key.padEnd(24)} → not resolved — check the record, this is usually bad data`);
      }
    }
  }

  const summary = await prisma.$queryRawUnsafe<any[]>(
    `SELECT source, COUNT(*)::int AS n FROM geo_points GROUP BY 1 ORDER BY 1`,
  );
  console.log('\ncache contents:');
  console.table(summary);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
