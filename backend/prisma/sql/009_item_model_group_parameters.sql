-- =============================================================================
-- 009 — The item model group's real parameter set
--
-- WHY: the first cut modelled this entity from an overview page and shipped two
-- seeded groups, FIFO (stocked) and SERVICE (standard cost, not stocked). That
-- made the setup screen imply "choosing STANDARD costing means it is a service",
-- which is false. Kubi caught it. The documentation says the opposite twice:
--
--   "Yes, you can use different costing models for each item. It's common for
--    manufacturers to use a periodic costing model for raw materials and
--    standard cost for semi-finished and finished goods."
--
--   "enable the Accrue liability on product receipt option for all item model
--    groups, regardless of whether you have a stocked product or a not-stocked
--    product."
--
--   learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-costing-faq
--
-- A tangible, inventory-tracked item can be valued at standard cost; a service
-- item must be STOCKED if it appears on a BOM. The axes are independent.
--
-- This migration adds the settings that were missing, so the group is a real
-- parameter screen rather than a stub:
--
--   accrue_liability_on_receipt         GAAP accrual at product receipt
--   post_deferred_revenue_on_delivery   revenue at packing slip, not invoice
--   registration_requirements           no receipt without arrival registration
--   receiving_requirements              no vendor invoice without a receipt
--   picking_requirements                no packing slip without a picking list
--   deduction_requirements              no sales invoice without a packing slip
--   description                         so a group can explain itself
--
-- ADDITIVE ONLY: 7 columns, all defaulted. Existing rows keep today's behaviour;
-- the four process gates default false, which is exactly what the system does
-- now. `accrue_liability_on_receipt` defaults true because Microsoft recommends
-- it for all groups — nothing reads it yet, so the default is documentation
-- rather than behaviour.
-- =============================================================================

-- AlterTable
ALTER TABLE "item_model_groups" ADD COLUMN     "accrue_liability_on_receipt" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "deduction_requirements" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "picking_requirements" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "post_deferred_revenue_on_delivery" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "receiving_requirements" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registration_requirements" BOOLEAN NOT NULL DEFAULT false;

