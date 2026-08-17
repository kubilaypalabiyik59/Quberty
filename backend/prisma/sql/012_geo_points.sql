-- =============================================================================
-- 012 — Coordinates: a geocoding cache, and manual overrides that always win
--
-- WHY
-- The operations panel puts work on a map. Nothing in this database has ever
-- held a latitude or a longitude: Site, Customer and Supplier carry
-- address / city / country and nothing else. So the panel had no floor 2.
--
-- SHAPE — two tables' worth of idea, one table
--
-- `geo_points` is a CACHE keyed by a normalised address string, not a column on
-- Site. Three reasons, and the third is the one that matters:
--
--   1. The same place appears under several rows (a site and a customer in the
--      same city). One cache entry serves all of them.
--   2. Geocoding is slow and rate-limited. A cache turns "resolve 40 places"
--      from 40 seconds into one query.
--   3. **A geocoder is a guess.** Putting its answer directly on Site would make
--      a guess indistinguishable from a fact. Keeping it in a cache with a
--      `source` column means a human correction is visibly a correction, and
--      re-running the geocoder can never overwrite one.
--
-- `source = 'manual'` always beats `source = 'nominatim'`. The reference panel
-- learned this the same way: hand-entered coordinates beat the geocoder, always.
--
-- No BEGIN/COMMIT and no DO$$ blocks — scripts/applyMigration.ts splits on `;`
-- and wraps the file in one transaction already. No semicolons inside COMMENT
-- strings for the same reason.
-- =============================================================================

CREATE TABLE IF NOT EXISTS geo_points (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,

  -- Lower-cased, comma-joined "city, region, country". The lookup key.
  query_key    TEXT NOT NULL,
  -- What was actually asked, kept for debugging a bad hit.
  query_text   TEXT NOT NULL,

  latitude     DOUBLE PRECISION,
  longitude    DOUBLE PRECISION,

  -- manual | nominatim | none
  -- `none` is a real outcome and is cached deliberately: without it, an
  -- unresolvable address is re-queried on every single page load, which is
  -- exactly the bulk geocoding the Nominatim usage policy forbids.
  source       TEXT NOT NULL DEFAULT 'nominatim',
  -- Nominatim importance, or null. Low confidence is worth showing rather than
  -- hiding, so a reader can tell a precise hit from a country centroid.
  confidence   DOUBLE PRECISION,
  display_name TEXT,

  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant-scoped uniqueness. A bare unique on query_key would let one tenant's
-- correction silently move another tenant's store.
CREATE UNIQUE INDEX IF NOT EXISTS geo_points_tenant_key_uidx
  ON geo_points (tenant_id, query_key);

CREATE INDEX IF NOT EXISTS geo_points_tenant_source_idx
  ON geo_points (tenant_id, source);

COMMENT ON TABLE geo_points IS
  'Geocoding cache. source=manual always wins over source=nominatim and is never overwritten by a re-run. source=none caches a failure so an unresolvable address is not re-queried forever.';

-- Direct overrides on the site itself, for the case where a human knows the
-- exact spot and the address text will never geocode to it — a warehouse on an
-- industrial estate with no street number, for instance. Checked before the
-- cache, so it beats everything.
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

COMMENT ON COLUMN sites.latitude IS
  'Manual override. Set it and the geocoder is never consulted for this site. Null means resolve from the address through geo_points.';

-- ── Verification (run separately) ────────────────────────────────────────────
-- SELECT source, COUNT(*) FROM geo_points GROUP BY 1;
-- SELECT code, name, city, country, latitude, longitude FROM sites;
