-- =============================================================================
-- 008 — Item group and item model group on the released product
-- Design: docs/architecture/ERP_SETUP_CHECKLIST.md
--
-- [OFFICIAL] a D365 released product requires, in order: product number, name,
-- ITEM MODEL GROUP, ITEM GROUP, storage dimension group, tracking dimension
-- group, inventory unit.
-- learn.microsoft.com/dynamics365/supply-chain/pim/tasks/create-released-product-single-company
--
-- Two of those are financial and neither existed here:
--
--   item model group  HOW the item is valued and controlled (costing method,
--                     stocked or not, whether physical/financial updates post)
--   item group        WHERE its money goes (the GL accounts, via the posting
--                     profile matrix)
--
-- WHY THIS UNBLOCKS SOMETHING THAT WAS ALREADY HALF-BUILT
--
-- `posting_profiles.scope_kind` has accepted 'ITEM_GROUP' since migration 001,
-- and postingProfile.service.ts resolves ctx.itemGroupId — but nothing could
-- ever supply one, because no item group table existed. The most useful axis of
-- the posting matrix has been unreachable this whole time. This makes it real.
--
-- Costing was likewise a single tenant-wide switch on
-- inventory_parameters.costing_method, which cannot say "footwear FIFO,
-- packaging weighted average". Microsoft is explicit that the choice is per
-- released product and that the item model group controls it.
--
-- ADDITIVE ONLY: 2 new tables, 2 nullable columns on products. Every existing
-- product keeps working unchanged — the posting resolver falls back to the
-- ALL-scope profile and costing falls back to InventoryParameters exactly as
-- before when these are null. Nothing is backfilled by this migration; seeding
-- default groups is a provisioning decision, not a schema one.
-- =============================================================================

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "item_group_id" UUID,
ADD COLUMN     "item_model_group_id" UUID;

-- CreateTable
CREATE TABLE "item_model_groups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "costing_method" TEXT NOT NULL DEFAULT 'FIFO',
    "stocked" BOOLEAN NOT NULL DEFAULT true,
    "post_physical_inventory" BOOLEAN NOT NULL DEFAULT true,
    "post_financial_inventory" BOOLEAN NOT NULL DEFAULT true,
    "include_physical_value" BOOLEAN NOT NULL DEFAULT false,
    "fixed_receipt_price" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_model_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_groups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_model_groups_tenant_id_legal_entity_id_code_key" ON "item_model_groups"("tenant_id", "legal_entity_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "item_groups_tenant_id_legal_entity_id_code_key" ON "item_groups"("tenant_id", "legal_entity_id", "code");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_item_model_group_id_fkey" FOREIGN KEY ("item_model_group_id") REFERENCES "item_model_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_item_group_id_fkey" FOREIGN KEY ("item_group_id") REFERENCES "item_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

