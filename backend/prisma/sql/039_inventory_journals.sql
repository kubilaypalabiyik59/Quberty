-- =============================================================================
-- 039  Inventory journals: adjustments, counts and opening balances post value
--
-- A manual adjustment overwrote or incremented a stock row and wrote a movement
-- with no cost and no voucher; a count overwrote on-hand with the counted quantity
-- against a snapshot that could be stale. Neither touched a cost layer or the
-- ledger, so the inventory subledger and the general ledger drifted apart with
-- every correction.
--
-- **[OFFICIAL]** an inventory adjustment journal posts receipts or issues, changes
-- inventory value and creates ledger transactions through the item group's
-- posting profile; posting a counting journal changes level AND value:
--   learn.microsoft.com/dynamics365/supply-chain/inventory/inventory-journals
--   learn.microsoft.com/dynamics365/supply-chain/inventory/tasks/count-inventory-warehouse
--
-- inventory_journals       one document per correction, DRAFT → POSTED | CANCELLED,
--                          numbered from INVENTORY_ADJUSTMENT. Types: ADJUSTMENT,
--                          COUNT (created by finalising a count), OPENING.
-- inventory_journal_lines  a signed quantity per product, variant and location;
--                          for a count also the snapshot and the counted quantity.
-- inventory_reason_codes   why stock changed (damaged, theft, found, ...), per tenant.
-- inventory_parameters.count_snapshot_policy
--                          REFUSE_IF_CHANGED (default): finalising refuses when
--                          on-hand moved after the count was created. APPLY_DELTA:
--                          apply counted − snapshot to today's quantity.
-- inventory_counts gains warehouse_id and journal_id so a count names its scope
-- and the journal that posted it.
--
-- Design reference: docs/process/REMEDIATION_PLAN_WORK-042_054.md §2.2, WORK-045,
-- DEF-010 and DEF-011.
-- =============================================================================

CREATE TABLE "inventory_reason_codes" (
    "id"         UUID NOT NULL,
    "tenant_id"  UUID NOT NULL,
    "code"       TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "direction"  TEXT NOT NULL DEFAULT 'BOTH',
    "is_active"  BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_reason_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_reason_codes_direction_check" CHECK ("direction" IN ('INCREASE', 'DECREASE', 'BOTH'))
);
CREATE UNIQUE INDEX "inventory_reason_codes_tenant_id_code_key" ON "inventory_reason_codes"("tenant_id", "code");

CREATE TABLE "inventory_journals" (
    "id"               UUID NOT NULL,
    "tenant_id"        UUID NOT NULL,
    "journal_number"   TEXT NOT NULL,
    "journal_type"     TEXT NOT NULL,
    "warehouse_id"     UUID NOT NULL,
    "status"           TEXT NOT NULL DEFAULT 'DRAFT',
    "description"      TEXT,
    "reason_code_id"   UUID,
    "source_count_id"  UUID,
    "journal_entry_id" UUID,
    "created_by"       UUID,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_by"        UUID,
    "posted_at"        TIMESTAMP(3),
    CONSTRAINT "inventory_journals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_journals_journal_type_check" CHECK ("journal_type" IN ('ADJUSTMENT', 'COUNT', 'OPENING')),
    CONSTRAINT "inventory_journals_status_check" CHECK ("status" IN ('DRAFT', 'POSTED', 'CANCELLED'))
);
CREATE UNIQUE INDEX "inventory_journals_tenant_id_journal_number_key" ON "inventory_journals"("tenant_id", "journal_number");
CREATE INDEX "inventory_journals_tenant_id_status_created_at_idx" ON "inventory_journals"("tenant_id", "status", "created_at");

CREATE TABLE "inventory_journal_lines" (
    "id"             UUID NOT NULL,
    "journal_id"     UUID NOT NULL,
    "product_id"     UUID NOT NULL,
    "variant_id"     UUID,
    "location_id"    UUID NOT NULL,
    "quantity"       INTEGER NOT NULL,
    "snapshot_qty"   INTEGER,
    "counted_qty"    INTEGER,
    "unit_cost"      DECIMAL(14,4),
    "cost_amount"    DECIMAL(14,2),
    "reason_code_id" UUID,
    "notes"          TEXT,
    CONSTRAINT "inventory_journal_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_journal_lines_quantity_check" CHECK ("quantity" <> 0),
    CONSTRAINT "inventory_journal_lines_unit_cost_check" CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0)
);
CREATE INDEX "inventory_journal_lines_journal_id_idx" ON "inventory_journal_lines"("journal_id");

ALTER TABLE "inventory_journal_lines" ADD CONSTRAINT "inventory_journal_lines_journal_id_fkey"
  FOREIGN KEY ("journal_id") REFERENCES "inventory_journals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_parameters"
  ADD COLUMN "count_snapshot_policy" TEXT NOT NULL DEFAULT 'REFUSE_IF_CHANGED';
ALTER TABLE "inventory_parameters"
  ADD CONSTRAINT "inventory_parameters_count_snapshot_policy_check"
    CHECK ("count_snapshot_policy" IN ('REFUSE_IF_CHANGED', 'APPLY_DELTA'));

ALTER TABLE "inventory_counts"
  ADD COLUMN "warehouse_id" UUID,
  ADD COLUMN "journal_id"   UUID;
