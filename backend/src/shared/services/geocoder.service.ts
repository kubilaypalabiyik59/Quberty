import { db } from '../../infrastructure/database/client';
import { logger } from '../logger';

/**
 * Turning addresses into coordinates, so work can be put on a map.
 *
 * ## The usage policy is enforced here, not documented here
 *
 * Nominatim is OpenStreetMap's free geocoder and its policy is a condition of
 * use, not a suggestion — violating it gets the IP blocked:
 *
 *   - at most one request per second  → the queue below guarantees it
 *   - a distinctive User-Agent with a real contact  → NOMINATIM_USER_AGENT
 *   - results cached permanently  → the `geo_points` table
 *   - no bulk geocoding  → failures are cached too, so an address that cannot
 *     resolve is asked about once, not on every page load
 *
 * Swapping to Azure Maps later is a change of `lookup()`, nothing else. That is
 * the reason this file exposes a resolver rather than a client.
 *
 * ## Precedence, and why a guess is kept separable from a fact
 *
 *     site.latitude/longitude   →  a human placed it. Always wins.
 *     geo_points source=manual  →  a human corrected it. Beats the geocoder.
 *     geo_points source=nominatim → a guess.
 *     geo_points source=none    →  asked, and it could not be resolved.
 *
 * A geocoder answer written straight onto Site would be indistinguishable from
 * a fact, and the next re-run would silently overwrite a human's correction.
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1100;

export interface Coords {
  lat: number;
  lng: number;
  source: 'site' | 'manual' | 'nominatim' | 'none';
  confidence?: number | null;
}

export interface AddressQuery {
  city?: string | null;
  region?: string | null;
  country?: string | null;
}

/** Lower-cased, comma-joined. The cache key and the query in one shape. */
export function addressKey(a: AddressQuery): string {
  return [a.city, a.region, a.country]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ')
    .toLowerCase();
}

// ── rate limiter ────────────────────────────────────────────────────────────
let lastCallAt = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Serialises every call, leaving at least MIN_INTERVAL_MS between them. */
function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fn();
  };
  const p = queue.then(run, run);
  // Keep the chain alive so one failure does not wedge the queue.
  queue = p.then(() => undefined, () => undefined);
  return p;
}

/**
 * Nominatim wants ISO alpha-2 for `countrycodes`.
 *
 * This column's format varies — alpha-2 here, alpha-3 in D365 demo data, and
 * occasionally something bespoke. Rather than carry a 250-row conversion table,
 * pass it as a filter only when it is two letters and omit it otherwise. City
 * plus country name in the free-text query is discriminating enough, and
 * anything landing in the wrong country is fixed with a manual override.
 */
function countryFilter(code?: string | null): string | null {
  const c = (code ?? '').trim();
  return /^[A-Za-z]{2}$/.test(c) ? c.toLowerCase() : null;
}

async function lookup(text: string, country?: string | null): Promise<Omit<Coords, 'source'> & { display?: string } | null> {
  const ua = process.env.NOMINATIM_USER_AGENT
    ?? 'QubertyERP/0.1 (set NOMINATIM_USER_AGENT to a contact address)';

  const url = new URL(ENDPOINT);
  url.searchParams.set('q', text);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  const cc = countryFilter(country);
  if (cc) url.searchParams.set('countrycodes', cc);

  return schedule(async () => {
    const res = await fetch(url, { headers: { 'User-Agent': ua, 'Accept-Language': 'en' } });
    if (!res.ok) {
      logger.warn({ status: res.status, text }, 'Nominatim returned a non-OK status');
      return null;
    }
    const hits = (await res.json()) as any[];
    if (!hits?.length) return null;
    return {
      lat: Number(hits[0].lat),
      lng: Number(hits[0].lon),
      confidence: hits[0].importance ?? null,
      display: hits[0].display_name,
    };
  });
}

/**
 * Resolve one address, cache-first.
 *
 * `allowNetwork = false` returns only what is already cached. The panel uses
 * that on the read path so a dashboard load never waits on a rate-limited
 * external service; a background job warms the cache instead.
 */
export async function resolveAddress(
  tenantId: string,
  a: AddressQuery,
  allowNetwork = false,
): Promise<Coords | null> {
  const key = addressKey(a);
  if (!key) return null;

  const cached = await db.geoPoint.findFirst({ where: { tenant_id: tenantId, query_key: key } });
  if (cached) {
    if (cached.source === 'none') return null;
    if (cached.latitude != null && cached.longitude != null) {
      return {
        lat: cached.latitude,
        lng: cached.longitude,
        source: cached.source === 'manual' ? 'manual' : 'nominatim',
        confidence: cached.confidence,
      };
    }
  }

  if (!allowNetwork) return null;

  const hit = await lookup(key, a.country);

  // Cache the miss as well. Without this an unresolvable address is re-queried
  // forever, which is the bulk geocoding the policy forbids.
  await db.geoPoint.upsert({
    where: { tenant_id_query_key: { tenant_id: tenantId, query_key: key } },
    create: {
      tenant_id: tenantId,
      query_key: key,
      query_text: key,
      latitude: hit?.lat ?? null,
      longitude: hit?.lng ?? null,
      source: hit ? 'nominatim' : 'none',
      confidence: hit?.confidence ?? null,
      display_name: hit?.display ?? null,
      resolved_at: new Date(),
    },
    update: {
      latitude: hit?.lat ?? null,
      longitude: hit?.lng ?? null,
      source: hit ? 'nominatim' : 'none',
      confidence: hit?.confidence ?? null,
      display_name: hit?.display ?? null,
      resolved_at: new Date(),
    },
  });

  return hit ? { lat: hit.lat, lng: hit.lng, source: 'nominatim', confidence: hit.confidence } : null;
}

/** A site's coordinates: manual column first, then the cache. */
export async function resolveSite(
  tenantId: string,
  site: { latitude?: number | null; longitude?: number | null; city?: string | null; country?: string | null },
  allowNetwork = false,
): Promise<Coords | null> {
  if (site.latitude != null && site.longitude != null) {
    return { lat: site.latitude, lng: site.longitude, source: 'site' };
  }
  return resolveAddress(tenantId, { city: site.city, country: site.country }, allowNetwork);
}

/** Record a human's correction. Never overwritten by a geocoder re-run. */
export async function setManualPoint(
  tenantId: string,
  a: AddressQuery,
  lat: number,
  lng: number,
): Promise<void> {
  const key = addressKey(a);
  await db.geoPoint.upsert({
    where: { tenant_id_query_key: { tenant_id: tenantId, query_key: key } },
    create: {
      tenant_id: tenantId, query_key: key, query_text: key,
      latitude: lat, longitude: lng, source: 'manual', resolved_at: new Date(),
    },
    update: { latitude: lat, longitude: lng, source: 'manual', resolved_at: new Date() },
  });
}
