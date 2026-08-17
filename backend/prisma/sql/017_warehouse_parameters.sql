-- 017 — Warehouse management parameters
--
-- Design: docs/process/WAREHOUSE_ROADMAP.md §3 and §5 (Phase 1).
--
-- Warehouse management was the one module with no parameters record at all. Every
-- other module has had one since migration 001.
--
-- ── PER WAREHOUSE, not per tenant ───────────────────────────────────────────
-- **[OFFICIAL]** D365 sets warehouse behaviour on the individual warehouse — e.g.
-- *Default inventory status ID* is set on the **Warehouse** FastTab, not globally.
-- That is also the shape this business needs: a three-store retailer may want
-- "receive it and it is sellable" in the shops and directed putaway in the
-- distribution warehouse, at the same time.
--
-- ── AND NOT A ONE-WAY DOOR ──────────────────────────────────────────────────
-- **[OFFICIAL]** D365 gates advanced warehousing behind `Use warehouse management
-- processes` on the storage dimension group, which "you can no longer change …
-- after you save", forcing a NEW WAREHOUSE and a manual inventory move to adopt it
-- later. We deliberately do not reproduce that: `inventory_stock` is keyed on
-- `location_id` for every warehouse already, so depth is a behaviour setting and a
-- warehouse can be switched either way at any time.
--   learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-costing-faq#dimension-groups
--
-- ── Defaults preserve today's behaviour exactly ─────────────────────────────
-- `require_putaway` FALSE and `availability_counts` ALL_LOCATIONS mean applying
-- this migration changes nothing until a warehouse opts in. That is the rule every
-- migration in this repo has followed.
--
-- **[OFFICIAL]** modelling "no work at all" as a setting is D365's own shape too:
-- a work policy's **Work creation method** can be *Never*, which "prevents warehouse
-- work from being created for the selected work order type".
--   learn.microsoft.com/dynamics365/supply-chain/warehousing/warehouse-work-policies

CREATE TABLE IF NOT EXISTS "warehouse_parameters" (
    "id"           UUID PRIMARY KEY,
    "tenant_id"    UUID NOT NULL,
    "warehouse_id" UUID NOT NULL REFERENCES "warehouses"("id") ON DELETE CASCADE,

    -- Two-step receiving. **[OFFICIAL]** the difference between inbound method C
    -- and method D: "the receipt is posted first … The warehouse worker then
    -- registers the put-away to make the items available to pick."
    --   FALSE → the receipt lands where it lands and is immediately available
    --   TRUE  → the receipt lands in a receive location and putaway work is created
    "require_putaway" BOOLEAN NOT NULL DEFAULT false,

    -- Outbound equivalent. Not read yet — Phase 2/3 of the roadmap. Declared here
    -- rather than in a later migration only because it is the same screen and the
    -- same record; nothing branches on it, and that is stated in the service.
    "require_pick_work" BOOLEAN NOT NULL DEFAULT false,

    -- What counts as sellable.
    --   ALL_LOCATIONS       → today's behaviour: anything in the warehouse
    --   PICK_LOCATIONS_ONLY → only stock in a location flagged is_pick_location,
    --                         i.e. stock that has actually been put away
    "availability_counts" TEXT NOT NULL DEFAULT 'ALL_LOCATIONS',

    -- Where receipts land when the caller names no location, and where putaway
    -- takes them from. **[OFFICIAL]** "during purchase registration, the first pick
    -- is always from the location where the registration occurs" — so the FROM of
    -- putaway work is not resolved by a directive, only the TO is.
    "default_receive_location_id" UUID REFERENCES "warehouse_locations"("id"),

    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_parameters_warehouse_key"
    ON "warehouse_parameters" ("warehouse_id");

CREATE INDEX IF NOT EXISTS "warehouse_parameters_tenant_idx"
    ON "warehouse_parameters" ("tenant_id");

ALTER TABLE "warehouse_parameters"
    ADD CONSTRAINT "warehouse_parameters_availability_counts_check"
    CHECK ("availability_counts" IN ('ALL_LOCATIONS', 'PICK_LOCATIONS_ONLY'));

-- One row per existing warehouse, at the defaults. A warehouse with no row behaves
-- identically, but seeding them means the setup screen has something to show and
-- nobody has to guess whether "no row" means "not configured" or "configured off".
INSERT INTO "warehouse_parameters" ("id", "tenant_id", "warehouse_id")
SELECT gen_random_uuid(), w.tenant_id, w.id
FROM "warehouses" w
WHERE NOT EXISTS (
    SELECT 1 FROM "warehouse_parameters" p WHERE p.warehouse_id = w.id
);

-- Where a warehouse has exactly one location flagged as a receive location, adopt
-- it as the default. Where it has none or several, leave NULL — the same refusal to
-- guess as provisionSalesDimensions.ts, and for the same reason: a wrong default
-- here silently sends every receipt to the wrong place.
UPDATE "warehouse_parameters" p
SET "default_receive_location_id" = sole.location_id
FROM (
    SELECT wz.warehouse_id, MIN(wl.id::text)::uuid AS location_id, COUNT(*)::int AS n
    FROM "warehouse_locations" wl
    JOIN "warehouse_zones" wz ON wz.id = wl.zone_id
    WHERE wl.is_receive_location = true AND wl.is_active = true
    GROUP BY wz.warehouse_id
) sole
WHERE sole.warehouse_id = p.warehouse_id
  AND sole.n = 1
  AND p.default_receive_location_id IS NULL;
