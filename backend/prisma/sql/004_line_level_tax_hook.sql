-- =============================================================================
-- 004 — Line-level tax hook
-- Additive: 6 nullable columns. Nothing writes them yet.
--
-- Tax is computed on the document TOTAL today, which is correct for Bolivia
-- (one rate) but cannot represent Turkey (KDV 20/10/1) or Germany (USt 19/7),
-- where one order can hold products at different rates. These columns exist now
-- so that refactor is a service change rather than a migration against live
-- orders. Required before selling into any multi-rate market.
-- =============================================================================

-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN     "item_tax_group_id" UUID,
ADD COLUMN     "tax_amount" DECIMAL(14,2),
ADD COLUMN     "tax_base" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "sales_order_lines" ADD COLUMN     "item_tax_group_id" UUID,
ADD COLUMN     "tax_amount" DECIMAL(14,2),
ADD COLUMN     "tax_base" DECIMAL(14,2);

