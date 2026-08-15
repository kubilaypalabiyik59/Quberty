-- =============================================================================
-- 003 — Account category (country-independent classification)
-- Design: docs/architecture/PARAMETERS_AND_CONFIG.md §9
--
-- Account NUMBERS are jurisdiction-specific and locally mandated:
--   ACCOUNTS_RECEIVABLE = 1103 Bolivia PCG · 120 Alıcılar Turkey · 1200 SKR04
-- Code that resolves an account by NUMBER is a customisation per country.
-- Code that resolves it by CATEGORY ports without modification.
--
-- Additive: one nullable column. Existing rows are backfilled by the provisioning
-- script from the country template, never guessed.
-- =============================================================================

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "category" TEXT;

