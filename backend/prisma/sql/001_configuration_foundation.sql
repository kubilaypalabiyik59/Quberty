-- =============================================================================
-- 001 — Configuration foundation
-- Design: docs/architecture/PARAMETERS_AND_CONFIG.md
--
-- Generated with:
--   prisma migrate diff --from-url "$DIRECT_URL" \
--     --to-schema-datamodel prisma/schema.prisma --script
-- then hand-edited to add NULLS NOT DISTINCT (see the index section below).
--
-- ADDITIVE ONLY. Verified: 6 CREATE TABLE, indexes, and one foreign key on a new
-- table. No DROP, no TRUNCATE, no DELETE, and no ALTER against any pre-existing
-- table. Safe to apply to the live database without data movement.
--
-- Applying it does NOT change any posting behaviour on its own — the tables are
-- empty until the provisioning script runs, and no route reads them yet.
-- =============================================================================

-- CreateTable
CREATE TABLE "posting_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "posting_type" TEXT NOT NULL,
    "scope_kind" TEXT NOT NULL DEFAULT 'ALL',
    "scope_id" UUID,
    "account_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posting_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "continuous" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT NOT NULL DEFAULT 'LEGAL_ENTITY',
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "current_year" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_parameters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "require_balanced_posting" BOOLEAN NOT NULL DEFAULT true,
    "allow_posting_to_closed_period" BOOLEAN NOT NULL DEFAULT false,
    "functional_currency" TEXT NOT NULL DEFAULT 'BOB',
    "rounding_tolerance" DECIMAL(14,2) NOT NULL DEFAULT 0.02,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_parameters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "vat_rate" DECIMAL(6,4) NOT NULL DEFAULT 0.13,
    "vat_inclusive" BOOLEAN NOT NULL DEFAULT true,
    "vat_label" TEXT NOT NULL DEFAULT 'IVA',
    "turnover_tax_rate" DECIMAL(6,4) NOT NULL DEFAULT 0.03,
    "turnover_tax_label" TEXT NOT NULL DEFAULT 'IT',
    "invoice_label" TEXT NOT NULL DEFAULT 'Factura',
    "allow_negative_inventory_sale" BOOLEAN NOT NULL DEFAULT false,
    "require_customer_tax_id" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_parameters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "line_matching_policy" TEXT NOT NULL DEFAULT 'NONE',
    "price_tolerance_pct" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "vat_input_recognition" TEXT NOT NULL DEFAULT 'RECEIPT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_parameters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "costing_method" TEXT NOT NULL DEFAULT 'FIFO',
    "allow_negative_inventory" BOOLEAN NOT NULL DEFAULT false,
    "capitalise_landed_cost" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "posting_profiles_tenant_id_posting_type_scope_kind_idx" ON "posting_profiles"("tenant_id", "posting_type", "scope_kind");

-- -----------------------------------------------------------------------------
-- Unique indexes — NULLS NOT DISTINCT
--
-- Every table here has a nullable `legal_entity_id` (and posting_profiles also has
-- a nullable `scope_id`). Postgres treats NULLs as DISTINCT in a unique index by
-- default, so the constraint Prisma generates would NOT stop duplicates on exactly
-- the rows that matter most: the tenant-wide defaults, where legal_entity_id IS
-- NULL. Two rival "ALL scope, tenant default" revenue accounts is precisely the
-- D-1 condition we are here to eliminate.
--
-- NULLS NOT DISTINCT requires Postgres 15+. Verified: Supabase is on 17.6.
-- Prisma's schema language cannot express this, so these six indexes are written
-- by hand and the @@unique attributes in schema.prisma carry a comment saying so.
-- Keep them in sync if the schema changes.
-- -----------------------------------------------------------------------------

-- CreateIndex
CREATE UNIQUE INDEX "posting_profiles_tenant_id_legal_entity_id_posting_type_sco_key" ON "posting_profiles"("tenant_id", "legal_entity_id", "posting_type", "scope_kind", "scope_id", "valid_from") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_tenant_id_legal_entity_id_reference_key" ON "number_sequences"("tenant_id", "legal_entity_id", "reference") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "finance_parameters_tenant_id_legal_entity_id_key" ON "finance_parameters"("tenant_id", "legal_entity_id") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_parameters_tenant_id_legal_entity_id_key" ON "sales_parameters"("tenant_id", "legal_entity_id") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "purchase_parameters_tenant_id_legal_entity_id_key" ON "purchase_parameters"("tenant_id", "legal_entity_id") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "inventory_parameters_tenant_id_legal_entity_id_key" ON "inventory_parameters"("tenant_id", "legal_entity_id") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "posting_profiles" ADD CONSTRAINT "posting_profiles_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

