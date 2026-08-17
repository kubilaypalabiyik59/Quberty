-- 015 — `inventory_batches` → `inventory_cost_layers`
--
-- Rationale: docs/architecture/MODULE_FIT_ANALYSIS.md §3.
--
-- The table has never held a batch. It holds `unit_cost`, `received_at`,
-- `source_po_id` and a remaining `quantity` — that is a FIFO cost layer. It has
-- no batch number, no expiry date and no customer-facing identity, which are the
-- three things a tracking batch exists for.
--
-- **[OFFICIAL]** a batch is a TRACKING DIMENSION, sitting in the reservation
-- hierarchy alongside serial number:
-- learn.microsoft.com/dynamics365/supply-chain/warehousing/flexible-warehouse-level-dimension-reservation
--
-- Kubi's stated requirement is to sell batch and license-plate tracking as an
-- option later. If that arrives under the obvious name, this codebase ends up with
-- two unrelated concepts called "batch" — one financial, one physical — joined to
-- the same tables. Nobody will reliably remember which is which.
--
-- Doing it now costs a table rename and eleven call sites. Doing it after batch
-- tracking ships means renaming two meanings at once, which nobody attempts.
--
-- Pure rename. No column added, dropped or retyped; no row touched.

ALTER TABLE "inventory_batches" RENAME TO "inventory_cost_layers";

-- Renaming the index that backs a primary key also renames the constraint in
-- PostgreSQL, so the pkey stops claiming to belong to a table that no longer
-- exists. IF EXISTS because these names are Prisma-generated and a mismatch here
-- must not fail an otherwise-correct migration.
ALTER INDEX IF EXISTS "inventory_batches_pkey"
    RENAME TO "inventory_cost_layers_pkey";

ALTER INDEX IF EXISTS "inventory_batches_tenant_id_product_id_variant_id_received_at_idx"
    RENAME TO "inventory_cost_layers_tenant_id_product_id_variant_id_received_idx";

-- NOTE: foreign-key constraint names (…_product_id_fkey, …_variant_id_fkey,
-- …_location_id_fkey) keep the old prefix. `ALTER TABLE … RENAME CONSTRAINT` has
-- no IF EXISTS, so renaming them on a guessed name would risk failing the
-- migration for a cosmetic gain. They are internal identifiers; the table name is
-- the one people read.
