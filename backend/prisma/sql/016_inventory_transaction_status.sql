-- 016 — Inventory transaction status
--
-- Rationale: docs/architecture/MODULE_FIT_ANALYSIS.md §3.
--
-- `inventory_transactions` had a `transaction_type` but no STATUS, so the states
-- between "ordered" and "invoiced" were not representable in the subledger. We
-- reconstructed them from document status instead — which works while there is one
-- path per document, and stops working the moment putaway, waves and picking sit
-- between receipt and stock. That is the next thing being built, so this comes
-- first.
--
-- It is also what finally gives `post_physical_inventory` / `post_financial_inventory`
-- from migration 009 something to mean: physical and financial are two different
-- updates landing at two different times, and until now the subledger could not
-- tell them apart.
--
-- ── [OFFICIAL] the two ladders ──────────────────────────────────────────────
-- learn.microsoft.com/dynamics365/finance/general-ledger/inventory-posting-profiles
--
--   Receipt:  Ordered → Registered → Received → Purchased
--   Issue:    On order → Reserved ordered → Reserved physical → Picked → Deducted → Sold
--
-- Quoted definitions that decide the boundaries:
--   Registered — "a two-step receiving process … or when item arrival is used to
--                 indicate that product has arrived"
--   Received   — "when the transaction is physically updated. For a purchase
--                 order, this is when the product receipt is posted"
--   Purchased  — "when the transaction is financially updated … when the invoice
--                 is generated"
--   Picked     — "the inventory has been picked from the warehouse. The inventory
--                 is still physically in the warehouse … but isn't available for
--                 other orders"
--   Deducted   — physically updated; for a sales order, the packing slip
--   Sold       — financially updated; the invoice
--
-- And the structural rule, quoted: "Each inventory transaction has a status that's
-- displayed in EITHER the Receipt OR the Issue field." Hence two nullable columns
-- and a CHECK that forbids both, rather than one column mixing two ladders.
--
-- Also added: the two dates D365 keeps on the transaction — physical (goods moved)
-- and financial (cost hit the ledger). They are what make "received but not
-- invoiced" answerable from the subledger instead of by joining documents.
--
-- Additive. Four nullable columns, three checks, two indexes. No row is deleted.

ALTER TABLE "inventory_transactions"
    ADD COLUMN IF NOT EXISTS "receipt_status"  TEXT,
    ADD COLUMN IF NOT EXISTS "issue_status"    TEXT,
    ADD COLUMN IF NOT EXISTS "physical_date"   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "financial_date"  TIMESTAMPTZ;

ALTER TABLE "inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_receipt_status_check"
    CHECK ("receipt_status" IS NULL OR "receipt_status" IN
        ('ORDERED', 'REGISTERED', 'RECEIVED', 'PURCHASED'));

ALTER TABLE "inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_issue_status_check"
    CHECK ("issue_status" IS NULL OR "issue_status" IN
        ('ON_ORDER', 'RESERVED_ORDERED', 'RESERVED_PHYSICAL', 'PICKED', 'DEDUCTED', 'SOLD'));

-- A transaction is a receipt or an issue. Never both. NULL/NULL is permitted only
-- because historical rows exist whose direction cannot be recovered — see below.
ALTER TABLE "inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_one_ladder_check"
    CHECK (NOT ("receipt_status" IS NOT NULL AND "issue_status" IS NOT NULL));

CREATE INDEX IF NOT EXISTS "inventory_transactions_receipt_status_idx"
    ON "inventory_transactions" ("tenant_id", "receipt_status")
    WHERE "receipt_status" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "inventory_transactions_issue_status_idx"
    ON "inventory_transactions" ("tenant_id", "issue_status")
    WHERE "issue_status" IS NOT NULL;

-- ══ BACKFILL ═══════════════════════════════════════════════════════════════
-- Only where the mapping is unambiguous. Verified distribution before writing:
--
--   OUTBOUND          / SALES_ORDER, POS_SALE, sales_order   32 rows
--   PURCHASE_RECEIPT  / PURCHASE_ORDER, PRODUCT_RECEIPT      23 rows
--   RETURN            / SALES_ORDER                           5 rows
--   ADJUSTMENT        / (null)                                1 row
--
-- Goods physically arrived. **[OFFICIAL]** *Received* is exactly "when the product
-- receipt is posted". Whether the vendor invoice later posted — which would make
-- it *Purchased* — is not recoverable per transaction, so it is NOT guessed.
UPDATE "inventory_transactions"
SET "receipt_status" = 'RECEIVED', "physical_date" = "created_at"
WHERE "transaction_type" = 'PURCHASE_RECEIPT' AND "receipt_status" IS NULL;

-- A customer return is a receipt into inventory, physically updated on arrival.
UPDATE "inventory_transactions"
SET "receipt_status" = 'RECEIVED', "physical_date" = "created_at"
WHERE "transaction_type" = 'RETURN' AND "receipt_status" IS NULL;

-- Goods physically left. **[OFFICIAL]** *Deducted* is the physical issue; *Sold*
-- is the financial one and belongs to the invoice, which is a separate event we
-- cannot attribute to an individual transaction retrospectively.
UPDATE "inventory_transactions"
SET "issue_status" = 'DEDUCTED', "physical_date" = "created_at"
WHERE "transaction_type" = 'OUTBOUND' AND "issue_status" IS NULL;

-- ADJUSTMENT is deliberately LEFT NULL. Quantities are stored unsigned here, so a
-- stock adjustment's direction is not recoverable from the row — and **[OFFICIAL]**
-- a positive counting journal is a receipt (*Purchased*) while a negative one is an
-- issue (*Sold*). One row is affected. Inventing a direction to make a column look
-- complete would put a guess in the subledger, which is the opposite of the point.
