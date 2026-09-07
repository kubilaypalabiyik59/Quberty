-- 023 — The factura series moves from `factura_counters` to the number sequence,
--       and a sequence learns to be manual
--
-- Two problems, one migration, because the fix for the first is what makes the
-- second expressible.
--
-- ═══ PROBLEM 1 — THREE ALLOCATORS FOR ONE LEGAL SERIES ════════════════════
--
-- `factura_counters` was reached through THREE hand-written copies of the same
-- raw INSERT … ON CONFLICT, and they did not agree:
--
--   backend/src/modules/sales/sales.routes.ts    seeds from MAX(factura_number)
--   backend/src/modules/finance/finance.routes.ts seeds from MAX(factura_number)
--   backend/src/modules/pos/pos.routes.ts         seeds from the literal 1
--
-- The POS copy is the dangerous one: on a tenant whose counter row does not
-- exist yet it starts the legal series at 1 regardless of what has already been
-- issued, and relies on the unique constraint to notice.
--
-- All three also allocated the number BEFORE opening the transaction that writes
-- the factura, so any rollback after allocation burned a number. That is the
-- behaviour the D365 guidance on continuous sequences exists to prevent:
--
--   "Continuous number sequences don't allow gaps between numbers. […] every
--    transaction that needs a new number demands interaction with the database."
--   — learn.microsoft.com/dynamics365/guidance/techtalks/
--     finance-operations-continuous-number-sequence-performance-improvements
--
-- `number_sequences` + `allocateNumber()` already implement that contract
-- properly, including the rule that a continuous series MUST be allocated on the
-- caller's transaction. The FACTURA row has existed since migration 005 —
-- provisionConfiguration.ts even logs "FACTURA sequence exists but is not yet
-- used". This migration finishes the job.
--
-- ═══ PROBLEM 2 — AUTOMATIC vs MANUAL IS NOT CONFIGURABLE ══════════════════
--
-- A tenant issuing pre-printed or authority-issued invoice stock types the number
-- from the paper; a tenant on a system-generated series must not be allowed to.
-- D365 makes this a property of the sequence, not of a module parameter:
--
--   "On the General FastTab, specify whether the number sequence is manual, and
--    continuous or non-continuous."
--   — learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/
--     organization-administration/tasks/set-up-number-sequences-individual-basis
--
--   "Manual – Set this option to No if you want the system to generate values."
--   — learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/data-entities/
--     dual-write/dual-write-numseq
--
-- Putting it on the sequence rather than on SalesParameters is what lets FACTURA
-- be manual while CREDIT_NOTE stays automatic, per legal entity.
--
-- ═══ WHAT THIS MIGRATION DOES NOT CLAIM ═══════════════════════════════════
--
-- **[OPEN — NOT VERIFIED]** whether Bolivian law requires the factura series to
-- be gapless, and whether the series is scoped per sucursal / punto de venta,
-- remains unanswered (HANDOVER §7). Answering it needs the SIN's own normativa;
-- the research scope here is Microsoft Learn plus this repository (CLAUDE.md §5).
--
-- What this migration DOES do is make the answer a setting instead of a rewrite:
-- `continuous` and `manual` are now both columns an administrator can flip, and
-- `format` can grow a branch segment without touching a legal column again.
--
-- FACTURA is switched to continuous = true below. That is the safe direction
-- under an unresolved legal question: if gaplessness is not required, being
-- gapless costs a row lock held for the length of the sale transaction — on a
-- three-store retailer, nothing. If it IS required, the alternative was
-- non-compliance. Flip it back from Setup → Number sequences if the normativa
-- says otherwise.
--
-- Note that D365's warning against switching non-continuous → continuous
-- ("the number sequence won't be truly continuous […] duplicate key violations")
-- is about ITS preallocation cache. `allocateNumber()` has no cache: it is one
-- `UPDATE … RETURNING`, so the switch is sound here.
--
-- ═══ REVERSIBILITY ════════════════════════════════════════════════════════
--
-- `factura_counters` is deliberately LEFT IN PLACE and is simply no longer
-- written to. Dropping it in the same migration that moves the series would
-- remove the only independent record of where the series stood if anything below
-- is wrong. A later migration drops it once the sequence has demonstrably owned
-- the series for a full period.

-- Transaction ownership belongs to scripts/applyMigration.ts, which wraps the
-- complete file atomically. Keep transaction-control statements out of SQL files.

-- ── 1. The manual flag ────────────────────────────────────────────────────
ALTER TABLE number_sequences
  ADD COLUMN IF NOT EXISTS manual boolean NOT NULL DEFAULT false;

-- ── 2. factura_number: integer → the rendered legal string ────────────────
--
-- The FACTURA format is already `{######}` (migration 005), and every client
-- rendered the number with `padStart(6, '0')`, so the string that was PRINTED on
-- an issued factura was always the six-digit padded form. Storing exactly that
-- keeps every issued number byte-identical — `1` becomes `000001`, which is what
-- the customer's copy says.
--
-- GREATEST guards lpad's truncation: `lpad('1234567', 6, '0')` silently returns
-- '123456'. On a legal column that is not an edge case worth risking, even
-- though no tenant is near seven digits today.
ALTER TABLE facturas
  ALTER COLUMN factura_number TYPE text
  USING lpad(factura_number::text, GREATEST(6, length(factura_number::text)), '0');

-- ── 3. Hand the series over ───────────────────────────────────────────────
--
-- The sequence must resume above BOTH prior sources of truth: the highest number
-- actually issued, and the counter row (which can be ahead of it, because the old
-- code allocated before the transaction and a rollback left the counter raised).
-- GREATEST over all three — including the sequence's own current value — means
-- re-running this statement can only ever move the series forward.
UPDATE number_sequences ns
   SET next_number = GREATEST(
         ns.next_number,
         COALESCE((SELECT MAX(f.factura_number::bigint) + 1
                     FROM facturas f
                    WHERE f.tenant_id = ns.tenant_id), 1),
         COALESCE((SELECT fc.last_number + 1
                     FROM factura_counters fc
                    WHERE fc.tenant_id = ns.tenant_id), 1)
       ),
       continuous = true,
       updated_at = NOW()
 WHERE ns.reference = 'FACTURA';
