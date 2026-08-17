-- 014 — Product Information Management: setup module
--
-- Design: docs/architecture/MODULE_FIT_ANALYSIS.md §2 and
--         docs/architecture/MODULE_SETUP_AND_PARAMETERS.md §4
--
-- WHAT THIS REPLACES, AND WHY IT IS NOT COSMETIC
--
-- Verified on the live test database before writing this:
--   * 150 product variants exist
--   * `product_variants.size`  IS NULL on ALL 150
--   * `product_variants.color` IS NULL on ALL 150
--   * all 150 carry their dimension in `attributes` as `{"Sizes": "42"}`
--
-- So the variant's identity lives in a free-form JSON key. Nothing stops the next
-- writer using "Size", or "Beden", or storing 42 as a number. Sizes sort as text,
-- so "10" sorts before "9". And the typed columns are a trap: the first person to
-- write to them puts half the catalogue in one place and half in the other.
--
-- [OFFICIAL] D365 models this as three separate things, and the separation is the
-- point:
--   * a product DIMENSION      (the axis: colour, size, style, configuration)
--   * a dimension VALUE        (42, Black) — max 30 chars, no COA delimiter
--   * a product DIMENSION GROUP (which axes THIS product varies by)
-- learn.microsoft.com/dynamics365/supply-chain/pim/product-dimensions
--
-- Without the group, "this shoe varies by size" and "this shoe varies by size and
-- colour" are indistinguishable, so no variant matrix and no completeness check
-- are possible. That is the gap this migration closes.
--
-- Additive: 6 new tables, 2 new columns, 2 new foreign keys on existing columns.
-- No column is dropped. `product_variants.size` / `.color` are LEFT IN PLACE and
-- marked deprecated in schema.prisma — they are empty, so nothing is lost, and
-- dropping columns is a separate decision.
--
-- The two FKs are safe: verified 0 orphan rows in sales_order_lines and
-- purchase_order_lines before writing this.

-- ── The axis ────────────────────────────────────────────────────────────────
-- [OFFICIAL] D365 has five: colour, configuration, size, style, version. Seeded
-- per tenant rather than hardcoded as an enum, so a tenant that sells by "width"
-- (real in footwear) adds a row instead of waiting for a release.
CREATE TABLE IF NOT EXISTS "product_dimensions" (
    "id"              UUID PRIMARY KEY,
    "tenant_id"       UUID NOT NULL,
    "legal_entity_id" UUID,
    "code"            TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "sort_order"      INTEGER NOT NULL DEFAULT 0,
    "is_active"       BOOLEAN NOT NULL DEFAULT true,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_dimensions_tenant_code_key"
    ON "product_dimensions" ("tenant_id", "legal_entity_id", "code") NULLS NOT DISTINCT;

-- ── The values on that axis ─────────────────────────────────────────────────
-- `sort_order` exists because sizes are not text. Without it EU 10 sorts before
-- EU 9, on every screen, forever.
CREATE TABLE IF NOT EXISTS "product_dimension_values" (
    "id"           UUID PRIMARY KEY,
    "tenant_id"    UUID NOT NULL,
    "dimension_id" UUID NOT NULL REFERENCES "product_dimensions"("id") ON DELETE RESTRICT,
    "value"        TEXT NOT NULL,
    "name"         TEXT,
    "sort_order"   INTEGER NOT NULL DEFAULT 0,
    "is_active"    BOOLEAN NOT NULL DEFAULT true,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_dimension_values_key"
    ON "product_dimension_values" ("tenant_id", "dimension_id", "value");

-- ── A named collection of values — D365's size / colour / style groups ──────
-- [OFFICIAL] these exist so a new shoe inherits EU 36-46 instead of somebody
-- retyping it. For a shoe retailer this is the single largest daily-labour item
-- in product setup.
CREATE TABLE IF NOT EXISTS "product_dimension_value_groups" (
    "id"           UUID PRIMARY KEY,
    "tenant_id"    UUID NOT NULL,
    "dimension_id" UUID NOT NULL REFERENCES "product_dimensions"("id") ON DELETE RESTRICT,
    "code"         TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_dimension_value_groups_key"
    ON "product_dimension_value_groups" ("tenant_id", "code");

CREATE TABLE IF NOT EXISTS "product_dimension_value_group_members" (
    "group_id" UUID NOT NULL REFERENCES "product_dimension_value_groups"("id") ON DELETE CASCADE,
    "value_id" UUID NOT NULL REFERENCES "product_dimension_values"("id") ON DELETE CASCADE,
    PRIMARY KEY ("group_id", "value_id")
);

-- ── Which axes a given product varies by ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "product_dimension_groups" (
    "id"              UUID PRIMARY KEY,
    "tenant_id"       UUID NOT NULL,
    "legal_entity_id" UUID,
    "code"            TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "is_active"       BOOLEAN NOT NULL DEFAULT true,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_dimension_groups_key"
    ON "product_dimension_groups" ("tenant_id", "legal_entity_id", "code") NULLS NOT DISTINCT;

CREATE TABLE IF NOT EXISTS "product_dimension_group_lines" (
    "id"           UUID PRIMARY KEY,
    "group_id"     UUID NOT NULL REFERENCES "product_dimension_groups"("id") ON DELETE CASCADE,
    "dimension_id" UUID NOT NULL REFERENCES "product_dimensions"("id") ON DELETE RESTRICT,
    "sequence"     INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_dimension_group_lines_key"
    ON "product_dimension_group_lines" ("group_id", "dimension_id");

-- ── The variant's value on each axis — this replaces the JSON ───────────────
CREATE TABLE IF NOT EXISTS "product_variant_values" (
    "variant_id"   UUID NOT NULL REFERENCES "product_variants"("id") ON DELETE CASCADE,
    "dimension_id" UUID NOT NULL REFERENCES "product_dimensions"("id") ON DELETE RESTRICT,
    "value_id"     UUID NOT NULL REFERENCES "product_dimension_values"("id") ON DELETE RESTRICT,
    PRIMARY KEY ("variant_id", "dimension_id")
);

CREATE INDEX IF NOT EXISTS "product_variant_values_value_idx"
    ON "product_variant_values" ("value_id");

-- ── Module parameters — PIM had none ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "product_parameters" (
    "id"                        UUID PRIMARY KEY,
    "tenant_id"                 UUID NOT NULL,
    "legal_entity_id"           UUID,
    "default_dimension_group_id" UUID REFERENCES "product_dimension_groups"("id"),
    -- [OFFICIAL] variant number nomenclature is assembled from segments. Stored as
    -- a format string rather than a segment table: one tenant, one convention, and
    -- the richer version is a table this column later points at.
    "variant_number_format"     TEXT NOT NULL DEFAULT '{SKU}-{VALUES}',
    -- Refuse to create a variant that leaves an axis of its group unset. Default
    -- false so nothing existing breaks; a tenant turns it on once its data is clean.
    "require_complete_variants" BOOLEAN NOT NULL DEFAULT false,
    "created_at"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_parameters_key"
    ON "product_parameters" ("tenant_id", "legal_entity_id") NULLS NOT DISTINCT;

-- ── Columns on product ──────────────────────────────────────────────────────
ALTER TABLE "products"
    ADD COLUMN IF NOT EXISTS "dimension_group_id" UUID REFERENCES "product_dimension_groups"("id"),
    -- The honest hook for "sell batch/serial tracking as an option later".
    -- Only NONE is implemented. [OFFICIAL] the tracking dimension group is the
    -- D365 equivalent; a full group is a table this column later points at.
    -- The service layer must refuse to change this once transactions exist, the
    -- same guard as item group and costing method.
    ADD COLUMN IF NOT EXISTS "tracking_policy" TEXT NOT NULL DEFAULT 'NONE';

ALTER TABLE "products"
    ADD CONSTRAINT "products_tracking_policy_check"
    CHECK ("tracking_policy" IN ('NONE', 'BATCH', 'SERIAL'));

-- ── The referential integrity that was missing ──────────────────────────────
-- Both columns were bare UUIDs with no FK, stated as a known defect in
-- schema.prisma itself. The variant is the stocking unit for this business, so
-- the one dimension that must be sound was the one that was not.
-- Verified 0 orphan rows on both before adding these.
ALTER TABLE "sales_order_lines"
    ADD CONSTRAINT "sales_order_lines_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT;

ALTER TABLE "purchase_order_lines"
    ADD CONSTRAINT "purchase_order_lines_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT;

-- ══ BACKFILL ═══════════════════════════════════════════════════════════════
-- Moves the existing `attributes -> 'Sizes'` values into the real structure.
-- Every statement is idempotent-ish via NOT EXISTS guards so a partial run can be
-- repeated. Nothing is deleted: `attributes` is left untouched so the old and new
-- representations can be compared before anything relies on the new one.

-- 1. A SIZE dimension for every tenant that has variants carrying a size.
INSERT INTO "product_dimensions" ("id", "tenant_id", "legal_entity_id", "code", "name", "sort_order")
SELECT gen_random_uuid(), t.tenant_id, NULL, 'SIZE', 'Size', 1
FROM (
    SELECT DISTINCT pv.tenant_id
    FROM "product_variants" pv
    WHERE pv.attributes ? 'Sizes'
) t
WHERE NOT EXISTS (
    SELECT 1 FROM "product_dimensions" d
    WHERE d.tenant_id = t.tenant_id AND d.legal_entity_id IS NULL AND d.code = 'SIZE'
);

-- 2. The distinct values, sorted numerically where they are numeric.
INSERT INTO "product_dimension_values" ("id", "tenant_id", "dimension_id", "value", "name", "sort_order")
SELECT gen_random_uuid(), s.tenant_id, d.id, s.value, s.value,
       CASE WHEN s.value ~ '^[0-9]+$' THEN s.value::int ELSE 9999 END
FROM (
    SELECT DISTINCT pv.tenant_id, pv.attributes ->> 'Sizes' AS value
    FROM "product_variants" pv
    WHERE pv.attributes ? 'Sizes' AND NULLIF(TRIM(pv.attributes ->> 'Sizes'), '') IS NOT NULL
) s
JOIN "product_dimensions" d
  ON d.tenant_id = s.tenant_id AND d.legal_entity_id IS NULL AND d.code = 'SIZE'
WHERE NOT EXISTS (
    SELECT 1 FROM "product_dimension_values" v
    WHERE v.tenant_id = s.tenant_id AND v.dimension_id = d.id AND v.value = s.value
);

-- 3. A dimension group meaning "varies by size only".
INSERT INTO "product_dimension_groups" ("id", "tenant_id", "legal_entity_id", "code", "name")
SELECT gen_random_uuid(), d.tenant_id, NULL, 'SIZE', 'Size only'
FROM "product_dimensions" d
WHERE d.code = 'SIZE' AND d.legal_entity_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "product_dimension_groups" g
    WHERE g.tenant_id = d.tenant_id AND g.legal_entity_id IS NULL AND g.code = 'SIZE'
);

INSERT INTO "product_dimension_group_lines" ("id", "group_id", "dimension_id", "sequence")
SELECT gen_random_uuid(), g.id, d.id, 1
FROM "product_dimension_groups" g
JOIN "product_dimensions" d
  ON d.tenant_id = g.tenant_id AND d.legal_entity_id IS NULL AND d.code = 'SIZE'
WHERE g.code = 'SIZE' AND g.legal_entity_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "product_dimension_group_lines" l
    WHERE l.group_id = g.id AND l.dimension_id = d.id
);

-- 4. Assign that group to every product that actually has size-carrying variants.
--    Products with NO variants are deliberately left NULL — a product that does
--    not vary should not claim a dimension group.
UPDATE "products" p
SET "dimension_group_id" = g.id
FROM "product_dimension_groups" g
WHERE g.tenant_id = p.tenant_id AND g.legal_entity_id IS NULL AND g.code = 'SIZE'
  AND p.dimension_group_id IS NULL
  AND EXISTS (
    SELECT 1 FROM "product_variants" pv
    WHERE pv.product_id = p.id AND pv.attributes ? 'Sizes'
  );

-- 5. Link each variant to its value.
INSERT INTO "product_variant_values" ("variant_id", "dimension_id", "value_id")
SELECT pv.id, d.id, v.id
FROM "product_variants" pv
JOIN "product_dimensions" d
  ON d.tenant_id = pv.tenant_id AND d.legal_entity_id IS NULL AND d.code = 'SIZE'
JOIN "product_dimension_values" v
  ON v.tenant_id = pv.tenant_id AND v.dimension_id = d.id AND v.value = pv.attributes ->> 'Sizes'
WHERE pv.attributes ? 'Sizes'
  AND NOT EXISTS (
    SELECT 1 FROM "product_variant_values" x
    WHERE x.variant_id = pv.id AND x.dimension_id = d.id
);

-- 6. A size group holding every size in use, so the next shoe inherits it.
INSERT INTO "product_dimension_value_groups" ("id", "tenant_id", "dimension_id", "code", "name")
SELECT gen_random_uuid(), d.tenant_id, d.id, 'SIZE-ALL', 'All sizes in use'
FROM "product_dimensions" d
WHERE d.code = 'SIZE' AND d.legal_entity_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "product_dimension_value_groups" g
    WHERE g.tenant_id = d.tenant_id AND g.code = 'SIZE-ALL'
  );

INSERT INTO "product_dimension_value_group_members" ("group_id", "value_id")
SELECT g.id, v.id
FROM "product_dimension_value_groups" g
JOIN "product_dimension_values" v ON v.dimension_id = g.dimension_id AND v.tenant_id = g.tenant_id
WHERE g.code = 'SIZE-ALL'
  AND NOT EXISTS (
    SELECT 1 FROM "product_dimension_value_group_members" m
    WHERE m.group_id = g.id AND m.value_id = v.id
);

-- 7. One product_parameters row per tenant that has products.
INSERT INTO "product_parameters" ("id", "tenant_id", "legal_entity_id")
SELECT gen_random_uuid(), t.tenant_id, NULL
FROM (SELECT DISTINCT tenant_id FROM "products") t
WHERE NOT EXISTS (
    SELECT 1 FROM "product_parameters" pp
    WHERE pp.tenant_id = t.tenant_id AND pp.legal_entity_id IS NULL
);
