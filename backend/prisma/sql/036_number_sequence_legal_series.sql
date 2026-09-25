-- =============================================================================
-- 036  Legal number series are gapless by declaration, not by convention
--
-- The FACTURA series was continuous on TEST only because migration 023 set it,
-- while the provisioning script still created it `continuous = false` for every
-- new tenant. An administrator could also switch it to non-continuous or jump
-- `next_number` forward from the Setup screen. Either leaves a gap in a series
-- that must stay sequential.
--
-- `legal_series` names the requirement on the row itself, so the numbering rules
-- enforce it for any series that carries it rather than for a hard-coded
-- reference. NONE is every internal series; GAPLESS is a series whose
-- continuity is a legal obligation. It is an enum-shaped text column so a later
-- jurisdiction rule (for example a yearly-restart legal series) attaches as a new
-- value without a migration of existing rows.
--
-- Step 0 on TEST, 2026-09-14: one FACTURA row, continuous = true.
--
-- Design reference: docs/process/REMEDIATION_PLAN_WORK-042_054.md, WORK-042,
-- DEF-040 and DEF-041.
--
-- Manual rollback (for reference only; not executed):
--   ALTER TABLE number_sequences DROP COLUMN legal_series;
-- =============================================================================

ALTER TABLE "number_sequences"
  ADD COLUMN "legal_series" TEXT NOT NULL DEFAULT 'NONE';

ALTER TABLE "number_sequences"
  ADD CONSTRAINT "number_sequences_legal_series_check"
  CHECK ("legal_series" IN ('NONE', 'GAPLESS'));

UPDATE "number_sequences"
   SET "legal_series" = 'GAPLESS',
       "continuous"   = true
 WHERE "reference" = 'FACTURA';

-- A gapless series that is not continuous is a contradiction the application
-- refuses; the database refuses it too, so a script cannot write one either.
ALTER TABLE "number_sequences"
  ADD CONSTRAINT "number_sequences_gapless_is_continuous_check"
  CHECK ("legal_series" <> 'GAPLESS' OR "continuous" = true);
