-- 013 — Corrections and reversals
--
-- Design: docs/architecture/CORRECTIONS.md
--
-- Purely additive. Six nullable/defaulted columns and two indexes. No DROP, no
-- TRUNCATE, no ALTER of an existing column's type or nullability, so it cannot
-- damage the 85 vouchers already posted.
--
-- What it buys:
--   * a correction knows what it corrects and why          (corrects_entry_id, correction_reason)
--   * a storno line is distinguishable from an ordinary
--     negative amount — D365's `Correction` field           (is_correction)
--   * the reverse-vs-storno choice is tenant configuration,
--     not a build-time decision                             (correction_method)
--
-- [OFFICIAL] the two methods and the fact that the choice is a parameter:
--   learn.microsoft.com/dynamics365/finance/localizations/europe/emea-storno
--   learn.microsoft.com/dynamics365/finance/localizations/poland/emea-pol-red-storno

-- No BEGIN/COMMIT here: scripts/applyMigration.ts wraps the whole file in one
-- transaction, and its statement splitter would treat them as statements.
-- The `ADD CONSTRAINT` statements are NOT idempotent — this migration is one-shot.

-- ── The correcting voucher points at what it corrects ────────────────────────
ALTER TABLE "journal_entries"
  ADD COLUMN IF NOT EXISTS "corrects_entry_id" UUID,
  ADD COLUMN IF NOT EXISTS "correction_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "is_correction"     BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_corrects_entry_id_fkey"
  FOREIGN KEY ("corrects_entry_id") REFERENCES "journal_entries"("id")
  ON DELETE RESTRICT;

-- [OFFICIAL] Business Central: "An entry can only be reversed one time."
-- A partial unique index expresses exactly that and still allows any number of
-- ordinary vouchers, which all carry NULL here.
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_corrects_entry_id_key"
  ON "journal_entries" ("corrects_entry_id")
  WHERE "corrects_entry_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "journal_entries_tenant_is_correction_idx"
  ON "journal_entries" ("tenant_id", "is_correction");

-- ── Line-level correction marker (D365's `Correction` field) ─────────────────
-- Needed because under STORNO a correction line is a negative amount in the
-- original column, which is otherwise indistinguishable from a legitimately
-- negative posting.
ALTER TABLE "journal_lines"
  ADD COLUMN IF NOT EXISTS "is_correction" BOOLEAN NOT NULL DEFAULT false;

-- ── The method is configuration ──────────────────────────────────────────────
-- REVERSE is the default deliberately: negative amounts break naive reports, and
-- a tenant should opt IN to storno because its jurisdiction expects it.
ALTER TABLE "finance_parameters"
  ADD COLUMN IF NOT EXISTS "correction_method" TEXT NOT NULL DEFAULT 'REVERSE';

ALTER TABLE "finance_parameters"
  ADD CONSTRAINT "finance_parameters_correction_method_check"
  CHECK ("correction_method" IN ('REVERSE', 'STORNO'));
