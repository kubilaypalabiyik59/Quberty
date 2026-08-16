-- =============================================================================
-- 006 — Opportunity.originating_lead_id
--
-- WHY THIS IS A SEPARATE MIGRATION RATHER THAN PART OF 005
--
-- 005 modelled an opportunity's party as "customer OR lead, exactly one". That
-- is correct for the party. It is wrong as the only link to the lead, and the
-- end-to-end verification script caught it within minutes of first running:
--
--   qualifying a lead creates a customer and re-points the opportunity's party
--   at that customer, so `lead_id` MUST become null to satisfy the CHECK — and
--   the origin of the deal is destroyed at exactly the moment it becomes
--   interesting.
--
-- "Which lead sources actually convert" is the single question lead tracking
-- exists to answer, and 005 made it unanswerable. WHO a deal is with and WHERE
-- it came from are two different facts and need two columns. D365 makes the same
-- separation: an opportunity carries a customer and an `originatingleadid`.
--
-- Additive: one nullable column, one index, one FK. No existing row is touched;
-- there are no opportunities yet in any case.
-- =============================================================================

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "originating_lead_id" UUID;

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_originating_lead_id_idx" ON "opportunities"("tenant_id", "originating_lead_id");

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_originating_lead_id_fkey" FOREIGN KEY ("originating_lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
