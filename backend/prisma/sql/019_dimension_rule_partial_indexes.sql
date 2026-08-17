-- 019 — Fix the uniqueness on `dimension_rules`
--
-- Migration 018 got this wrong and running it found the bug on the first real
-- write. Recorded here rather than quietly amended, because the reasoning is the
-- interesting part.
--
-- ── What was wrong ──────────────────────────────────────────────────────────
-- 018 created both indexes with NULLS NOT DISTINCT:
--
--   (tenant_id, legal_entity_id, attribute_id, account_category)  NULLS NOT DISTINCT
--   (tenant_id, legal_entity_id, attribute_id, account_id)        NULLS NOT DISTINCT
--
-- NULLS NOT DISTINCT is right for `legal_entity_id`, where NULL is a real value
-- meaning "the tenant default" — that is exactly why migration 001 had to hand-add
-- it, and copying the pattern here was reflex rather than thought.
--
-- It is WRONG for `account_category` and `account_id`. There, NULL does not mean a
-- default; it means *this rule is not of that kind*. A rule keyed on a category
-- necessarily has `account_id IS NULL`, so under NULLS NOT DISTINCT the SECOND
-- category rule collided with the first on the account index:
--
--   STORE REQUIRED on REVENUE   → account_id NULL   ← inserted
--   STORE REQUIRED on COGS      → account_id NULL   ← unique violation
--
-- One tenant can therefore have exactly one category rule in total. The CHECK
-- `num_nonnulls(account_category, account_id) = 1` guarantees one of the two is
-- always NULL, so the two indexes were guaranteed to fight each other.
--
-- ── The fix ─────────────────────────────────────────────────────────────────
-- Each index becomes PARTIAL, covering only the rows it is actually about, while
-- keeping NULLS NOT DISTINCT for the legal_entity_id column that genuinely needs it.
--
-- Prisma cannot express a partial index, so `@@unique` is removed from the
-- `DimensionRule` model and the constraint lives here only. **This means
-- `prisma db push` would drop these two indexes.** The repo applies reviewed SQL by
-- hand and does not use db push against this database; the model carries the same
-- warning next to the removed attribute.

DROP INDEX IF EXISTS "dimension_rules_category_key";
DROP INDEX IF EXISTS "dimension_rules_account_key";

CREATE UNIQUE INDEX "dimension_rules_category_key"
    ON "dimension_rules" ("tenant_id", "legal_entity_id", "attribute_id", "account_category")
    NULLS NOT DISTINCT
    WHERE "account_category" IS NOT NULL;

CREATE UNIQUE INDEX "dimension_rules_account_key"
    ON "dimension_rules" ("tenant_id", "legal_entity_id", "attribute_id", "account_id")
    NULLS NOT DISTINCT
    WHERE "account_id" IS NOT NULL;

-- The lookup `assertRequiredDimensions` actually makes on every posting.
CREATE INDEX IF NOT EXISTS "dimension_rules_tenant_id_attribute_id_idx"
    ON "dimension_rules" ("tenant_id", "attribute_id");
