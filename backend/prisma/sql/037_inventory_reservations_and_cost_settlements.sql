-- =============================================================================
-- 037  Stock reservations, issue-to-layer cost settlements, stock constraints
--
-- Four defects shared one root cause: there was no record of WHICH stock an order
-- held and no record of WHICH cost layer an issue consumed, so every path
-- invented its own deduction.
--
--   * A storefront order deducted stock at checkout and again when shipped.
--   * Cancelling an order released reservations by product, so it could free
--     another order's stock in another warehouse.
--   * Shipping consumed FIFO layers from any warehouse — a La Paz shipment could
--     drain El Alto's layers while La Paz kept its units.
--   * COGS was quantity x Product.cost_price; the layers were never the cost.
--
-- inventory_reservations  one row per stock row an order (or other source) holds.
--   `inventory_stock.reserved_qty` stays as the cached sum the availability
--   queries read; the rows are what release and issue act on.
-- inventory_cost_settlements  one row per cost layer an issue consumed, with the
--   unit cost it consumed at. COGS is the sum of these. A void puts quantity back
--   on the same layers; a return re-layers at the issued cost.
--
-- Stock rows get the invariants the code assumed but nothing enforced:
-- quantity >= 0 and 0 <= reserved_qty <= quantity. The existing unique index is
-- rebuilt NULLS NOT DISTINCT under the same name, so a product without variants
-- can no longer end up with two stock rows at one location.
--
-- Parameters (owner: Inventory):
--   uncosted_issue_policy  REFUSE (default) | ITEM_COST_PRICE_FLAGGED — what an
--                          issue does when the location holds stock without cost
--                          layers. REFUSE fails before any write.
--   cost_level             LEGAL_ENTITY | SITE | WAREHOUSE (default). A hook for
--                          average-cost methods; FIFO ignores it and consumes the
--                          layers at the issuing location.
-- Hooks: sales_parameters.storefront_warehouse_id (the warehouse storefront orders
-- ship from, never client-chosen) and sales_orders.register_session_id (the POS
-- session a sale belongs to, used by void in WORK-047).
--
-- Step 0 on TEST, 2026-09-14: Kubi authorised wiping TEST. Before this migration
-- scripts/resetTestTransactions.ts emptied 45 transactional tables (among them
-- inventory_stock 17 rows, inventory_cost_layers 24, inventory_transactions 74,
-- journal_entries 139, facturas 29, sales_orders 54) and kept master data, so the
-- constraints below are added to empty stock tables.
--
-- Design reference: docs/process/REMEDIATION_PLAN_WORK-042_054.md, WORK-043 and
-- WORK-044 (implemented together), DEF-001..009, 012, 013.
-- =============================================================================

-- ── Reservations ──────────────────────────────────────────────────────────────

CREATE TABLE "inventory_reservations" (
    "id"             UUID NOT NULL,
    "tenant_id"      UUID NOT NULL,
    "source_type"    TEXT NOT NULL,
    "source_id"      UUID NOT NULL,
    "source_line_id" UUID,
    "stock_id"       UUID NOT NULL,
    "product_id"     UUID NOT NULL,
    "variant_id"     UUID,
    "location_id"    UUID NOT NULL,
    "quantity"       INTEGER NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'ACTIVE',
    "expires_at"     TIMESTAMP(3),
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at"    TIMESTAMP(3),
    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_reservations_source_type_check"
      CHECK ("source_type" IN ('SALES_ORDER', 'TRANSFER', 'WORK')),
    CONSTRAINT "inventory_reservations_status_check"
      CHECK ("status" IN ('ACTIVE', 'CONSUMED', 'RELEASED')),
    CONSTRAINT "inventory_reservations_quantity_check" CHECK ("quantity" > 0)
);

CREATE INDEX "inventory_reservations_tenant_id_source_type_source_id_stat_idx"
  ON "inventory_reservations"("tenant_id", "source_type", "source_id", "status");
CREATE INDEX "inventory_reservations_stock_id_status_idx"
  ON "inventory_reservations"("stock_id", "status");

ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_stock_id_fkey"
  FOREIGN KEY ("stock_id") REFERENCES "inventory_stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Cost layers ───────────────────────────────────────────────────────────────

ALTER TABLE "inventory_cost_layers"
  ADD COLUMN "original_quantity"    INTEGER,
  ADD COLUMN "source_type"          TEXT NOT NULL DEFAULT 'PURCHASE_RECEIPT',
  ADD COLUMN "origin_settlement_id" UUID;

UPDATE "inventory_cost_layers" SET "original_quantity" = "quantity" WHERE "original_quantity" IS NULL;

ALTER TABLE "inventory_cost_layers"
  ADD CONSTRAINT "inventory_cost_layers_source_type_check"
    CHECK ("source_type" IN ('PURCHASE_RECEIPT', 'TRANSFER', 'SALES_RETURN', 'ADJUSTMENT', 'COUNT', 'OPENING')),
  ADD CONSTRAINT "inventory_cost_layers_quantity_check" CHECK ("quantity" >= 0);

CREATE INDEX "inventory_cost_layers_tenant_id_location_id_product_id_rece_idx"
  ON "inventory_cost_layers"("tenant_id", "location_id", "product_id", "received_at");

-- ── Inventory transactions carry the cost they consumed ───────────────────────

ALTER TABLE "inventory_transactions"
  ADD COLUMN "cost_layer_id" UUID,
  ADD COLUMN "cost_amount"   DECIMAL(14,2);

-- ── Settlements ───────────────────────────────────────────────────────────────

CREATE TABLE "inventory_cost_settlements" (
    "id"                       UUID NOT NULL,
    "tenant_id"                UUID NOT NULL,
    "inventory_transaction_id" UUID NOT NULL,
    "cost_layer_id"            UUID,
    "quantity"                 INTEGER NOT NULL,
    "unit_cost"                DECIMAL(14,4) NOT NULL,
    "cost_amount"              DECIMAL(14,2) NOT NULL,
    "cost_currency_code"       TEXT NOT NULL,
    "cost_source"              TEXT NOT NULL DEFAULT 'LAYER',
    "reversed_by_id"           UUID,
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_cost_settlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_cost_settlements_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "inventory_cost_settlements_cost_source_check" CHECK ("cost_source" IN ('LAYER', 'ESTIMATED')),
    -- An ESTIMATED settlement has no layer; a LAYER settlement always has one.
    CONSTRAINT "inventory_cost_settlements_layer_check"
      CHECK (("cost_source" = 'LAYER') = ("cost_layer_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "inventory_cost_settlements_reversed_by_id_key"
  ON "inventory_cost_settlements"("reversed_by_id");
CREATE INDEX "inventory_cost_settlements_inventory_transaction_id_idx"
  ON "inventory_cost_settlements"("inventory_transaction_id");
CREATE INDEX "inventory_cost_settlements_cost_layer_id_idx"
  ON "inventory_cost_settlements"("cost_layer_id");

ALTER TABLE "inventory_cost_settlements" ADD CONSTRAINT "inventory_cost_settlements_inventory_transaction_id_fkey"
  FOREIGN KEY ("inventory_transaction_id") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_cost_settlements" ADD CONSTRAINT "inventory_cost_settlements_cost_layer_id_fkey"
  FOREIGN KEY ("cost_layer_id") REFERENCES "inventory_cost_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Stock rows ────────────────────────────────────────────────────────────────

ALTER TABLE "inventory_stock"
  ADD CONSTRAINT "inventory_stock_quantity_check" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "inventory_stock_reserved_qty_check" CHECK ("reserved_qty" >= 0 AND "reserved_qty" <= "quantity");

DROP INDEX "inventory_stock_tenant_id_product_id_variant_id_location_id_key";
CREATE UNIQUE INDEX "inventory_stock_tenant_id_product_id_variant_id_location_id_key"
  ON "inventory_stock"("tenant_id", "product_id", "variant_id", "location_id") NULLS NOT DISTINCT;

-- ── Parameters and hooks ──────────────────────────────────────────────────────

ALTER TABLE "inventory_parameters"
  ADD COLUMN "uncosted_issue_policy" TEXT NOT NULL DEFAULT 'REFUSE',
  ADD COLUMN "cost_level"            TEXT NOT NULL DEFAULT 'WAREHOUSE';
ALTER TABLE "inventory_parameters"
  ADD CONSTRAINT "inventory_parameters_uncosted_issue_policy_check"
    CHECK ("uncosted_issue_policy" IN ('REFUSE', 'ITEM_COST_PRICE_FLAGGED')),
  ADD CONSTRAINT "inventory_parameters_cost_level_check"
    CHECK ("cost_level" IN ('LEGAL_ENTITY', 'SITE', 'WAREHOUSE'));

ALTER TABLE "sales_parameters" ADD COLUMN "storefront_warehouse_id" UUID;
ALTER TABLE "sales_orders"     ADD COLUMN "register_session_id"     UUID;
