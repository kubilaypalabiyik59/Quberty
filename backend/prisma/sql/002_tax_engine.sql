-- =============================================================================
-- 002 — Tax engine (multi-jurisdiction)
-- Design: docs/architecture/PARAMETERS_AND_CONFIG.md §8
--
-- Replaces the single-rate tax columns introduced in 001 with the D365 model:
-- tax code (rate + rules) resolved by tax group (party) ∩ item tax group (product).
-- A rate column could not express Turkish tevkifat, German reverse charge, or
-- multi-rate VAT. Bolivia stays the default; it becomes a configured jurisdiction.
--
-- SAFETY NOTE ON THE 5 DROP COLUMN STATEMENTS BELOW
-- They drop vat_rate, vat_inclusive, vat_label, turnover_tax_rate and
-- turnover_tax_label from `sales_parameters` — a table created by migration 001
-- earlier the same day and verified to contain ZERO rows before this ran. No data
-- is lost. Everything else here is additive: 5 new tables and 4 nullable columns
-- on customers / suppliers / products.
--
-- Nothing reads these tables yet. Applying this changes no runtime behaviour.
-- =============================================================================

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "tax_group_id" UUID,
ADD COLUMN     "tax_id" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "item_tax_group_id" UUID;

-- AlterTable
ALTER TABLE "sales_parameters" DROP COLUMN "turnover_tax_label",
DROP COLUMN "turnover_tax_rate",
DROP COLUMN "vat_inclusive",
DROP COLUMN "vat_label",
DROP COLUMN "vat_rate",
ADD COLUMN     "default_item_tax_group_id" UUID,
ADD COLUMN     "default_tax_group_id" UUID;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "tax_group_id" UUID;

-- CreateTable
CREATE TABLE "tax_codes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_type" TEXT NOT NULL DEFAULT 'VAT',
    "rate" DECIMAL(9,6) NOT NULL,
    "is_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "is_recoverable" BOOLEAN NOT NULL DEFAULT true,
    "region_type" TEXT NOT NULL DEFAULT 'DOMESTIC',
    "reverse_charge" BOOLEAN NOT NULL DEFAULT false,
    "is_exempt" BOOLEAN NOT NULL DEFAULT false,
    "exempt_reason" TEXT,
    "withholding_share" DECIMAL(9,6),
    "withholding_threshold" DECIMAL(14,2),
    "posting_type_payable" TEXT NOT NULL DEFAULT 'VAT_OUTPUT',
    "posting_type_receivable" TEXT DEFAULT 'VAT_INPUT',
    "settlement_period_id" UUID,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_groups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_tax_groups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_tax_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_group_codes" (
    "tax_group_id" UUID NOT NULL,
    "tax_code_id" UUID NOT NULL,

    CONSTRAINT "tax_group_codes_pkey" PRIMARY KEY ("tax_group_id","tax_code_id")
);

-- CreateTable
CREATE TABLE "item_tax_group_codes" (
    "item_tax_group_id" UUID NOT NULL,
    "tax_code_id" UUID NOT NULL,

    CONSTRAINT "item_tax_group_codes_pkey" PRIMARY KEY ("item_tax_group_id","tax_code_id")
);

-- CreateIndex
CREATE INDEX "tax_codes_tenant_id_is_active_idx" ON "tax_codes"("tenant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "tax_codes_tenant_id_legal_entity_id_code_valid_from_key" ON "tax_codes"("tenant_id", "legal_entity_id", "code", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "tax_groups_tenant_id_legal_entity_id_code_key" ON "tax_groups"("tenant_id", "legal_entity_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "item_tax_groups_tenant_id_legal_entity_id_code_key" ON "item_tax_groups"("tenant_id", "legal_entity_id", "code");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_item_tax_group_id_fkey" FOREIGN KEY ("item_tax_group_id") REFERENCES "item_tax_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_parameters" ADD CONSTRAINT "sales_parameters_default_tax_group_id_fkey" FOREIGN KEY ("default_tax_group_id") REFERENCES "tax_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_parameters" ADD CONSTRAINT "sales_parameters_default_item_tax_group_id_fkey" FOREIGN KEY ("default_item_tax_group_id") REFERENCES "item_tax_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_group_codes" ADD CONSTRAINT "tax_group_codes_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_group_codes" ADD CONSTRAINT "tax_group_codes_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_tax_group_codes" ADD CONSTRAINT "item_tax_group_codes_item_tax_group_id_fkey" FOREIGN KEY ("item_tax_group_id") REFERENCES "item_tax_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_tax_group_codes" ADD CONSTRAINT "item_tax_group_codes_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

