-- =============================================================================
-- 005 — Process front ends: the documents that come BEFORE the order
-- Design: docs/process/PROCESS_CHAIN.md
--
--   Prospect to Quote (85)  Lead -> Opportunity -> Quotation -> Sales Order
--   Source to Pay (75)      Requisition -> RFQ -> Purchase Order
--
-- ADDITIVE ONLY. Verified before applying:
--   * 11 CREATE TABLE, all new
--   * 8 ADD COLUMN on 6 existing tables; every NOT NULL one carries a DEFAULT,
--     so no existing row is rejected and no rewrite of a live table is required
--   * NO DROP, NO TRUNCATE, NO DELETE, NO ALTER COLUMN anywhere
--
-- Existing behaviour is unchanged by construction: every new column is either
-- nullable or defaulted, nothing reads the new tables unless a caller asks for
-- them, and none of the new documents post to the general ledger.
--
-- Hand-added below what Prisma can generate:
--   * NULLS NOT DISTINCT on the one unique index containing a nullable column.
--     Postgres treats NULLs as distinct, so without it two tenant-wide default
--     pipeline stages with the same code both slip through — the same condition
--     that produced D-1. Same treatment as migration 001.
--   * CHECK constraints for "exactly one party" and for percentage ranges.
--     Prisma cannot express CHECK at all, and the party rule is the one piece of
--     integrity that keeps a quotation from being addressed to nobody, or to a
--     customer and a lead at once.
-- =============================================================================

-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN     "agreement_line_id" UUID,
ADD COLUMN     "source_line_id" UUID;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "source_document_id" UUID,
ADD COLUMN     "source_document_type" TEXT NOT NULL DEFAULT 'DIRECT';

-- AlterTable
ALTER TABLE "purchase_parameters" ADD COLUMN     "require_requisition_for_po" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requisition_approval_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "requisition_approval_threshold" DECIMAL(14,2),
ADD COLUMN     "rfq_response_days" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "sales_order_lines" ADD COLUMN     "source_line_id" UUID;

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "source_document_id" UUID,
ADD COLUMN     "source_document_type" TEXT NOT NULL DEFAULT 'DIRECT';

-- AlterTable
ALTER TABLE "sales_parameters" ADD COLUMN     "auto_convert_lead_on_confirm" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "quotation_validity_days" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "require_opportunity_for_quotation" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "sales_pipeline_stages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "default_probability" INTEGER NOT NULL DEFAULT 50,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lead_number" TEXT NOT NULL,
    "company_name" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "country" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "rating" TEXT NOT NULL DEFAULT 'WARM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "disqualify_reason" TEXT,
    "owner_user_id" UUID,
    "estimated_amount" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "notes" TEXT,
    "converted_customer_id" UUID,
    "qualified_at" TIMESTAMP(3),
    "disqualified_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customer_id" UUID,
    "lead_id" UUID,
    "stage_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "probability" INTEGER NOT NULL DEFAULT 50,
    "estimated_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "expected_close_date" DATE,
    "owner_user_id" UUID,
    "outcome_reason" TEXT,
    "notes" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_quotations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quotation_number" TEXT NOT NULL,
    "customer_id" UUID,
    "lead_id" UUID,
    "opportunity_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "quotation_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" DATE,
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "site_id" UUID,
    "warehouse_id" UUID,
    "notes" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "revised_from_id" UUID,
    "converted_order_id" UUID,
    "outcome_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_quotation_lines" (
    "id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_price" DECIMAL(12,4) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(14,2) NOT NULL,
    "item_tax_group_id" UUID,
    "tax_amount" DECIMAL(14,2),
    "tax_base" DECIMAL(14,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "sales_quotation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requisition_number" TEXT NOT NULL,
    "requester_user_id" UUID,
    "site_id" UUID,
    "warehouse_id" UUID,
    "purpose" TEXT NOT NULL DEFAULT 'CONSUMPTION',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "required_date" DATE,
    "justification" TEXT,
    "estimated_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "approved_by" UUID,
    "rejected_at" TIMESTAMP(3),
    "rejected_by" UUID,
    "rejection_reason" TEXT,
    "closed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisition_lines" (
    "id" UUID NOT NULL,
    "requisition_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "quantity" DECIMAL(12,2) NOT NULL,
    "estimated_unit_cost" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "required_date" DATE,
    "preferred_supplier_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "fulfilled_by_type" TEXT,
    "fulfilled_by_line_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "purchase_requisition_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_cases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rfq_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "purchase_type" TEXT NOT NULL DEFAULT 'PURCHASE_ORDER',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "requisition_id" UUID,
    "warehouse_id" UUID,
    "bid_deadline" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "notes" TEXT,
    "sent_at" TIMESTAMP(3),
    "awarded_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfq_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_case_lines" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "quantity" DECIMAL(12,2) NOT NULL,
    "required_date" DATE,
    "requisition_line_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "rfq_case_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "sent_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "score" INTEGER,
    "reason_code" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lead_time_days" INTEGER,
    "notes" TEXT,
    "generated_po_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfq_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_request_lines" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "case_line_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_price" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "delivery_date" DATE,
    "lead_time_days" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rfq_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_pipeline_stages_tenant_id_sort_order_idx" ON "sales_pipeline_stages"("tenant_id", "sort_order");

-- CreateIndex
-- NULLS NOT DISTINCT: legal_entity_id is nullable and NULL means "tenant-wide
-- default". Without this, two tenant-wide stages with the same code are both
-- accepted. Prisma cannot emit this clause; it is hand-added, as in 001.
CREATE UNIQUE INDEX "sales_pipeline_stages_tenant_id_legal_entity_id_code_key" ON "sales_pipeline_stages"("tenant_id", "legal_entity_id", "code") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "leads_tenant_id_status_idx" ON "leads"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "leads_tenant_id_created_at_idx" ON "leads"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "leads_tenant_id_lead_number_key" ON "leads"("tenant_id", "lead_number");

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_status_idx" ON "opportunities"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_expected_close_date_idx" ON "opportunities"("tenant_id", "expected_close_date");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_tenant_id_opportunity_number_key" ON "opportunities"("tenant_id", "opportunity_number");

-- CreateIndex
CREATE INDEX "sales_quotations_tenant_id_status_idx" ON "sales_quotations"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "sales_quotations_tenant_id_quotation_date_idx" ON "sales_quotations"("tenant_id", "quotation_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sales_quotations_tenant_id_quotation_number_key" ON "sales_quotations"("tenant_id", "quotation_number");

-- CreateIndex
CREATE INDEX "sales_quotation_lines_quotation_id_idx" ON "sales_quotation_lines"("quotation_id");

-- CreateIndex
CREATE INDEX "purchase_requisitions_tenant_id_status_idx" ON "purchase_requisitions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "purchase_requisitions_tenant_id_created_at_idx" ON "purchase_requisitions"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisitions_tenant_id_requisition_number_key" ON "purchase_requisitions"("tenant_id", "requisition_number");

-- CreateIndex
CREATE INDEX "purchase_requisition_lines_requisition_id_idx" ON "purchase_requisition_lines"("requisition_id");

-- CreateIndex
CREATE INDEX "rfq_cases_tenant_id_status_idx" ON "rfq_cases"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_cases_tenant_id_rfq_number_key" ON "rfq_cases"("tenant_id", "rfq_number");

-- CreateIndex
CREATE INDEX "rfq_case_lines_case_id_idx" ON "rfq_case_lines"("case_id");

-- CreateIndex
CREATE INDEX "rfq_requests_tenant_id_status_idx" ON "rfq_requests"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_requests_tenant_id_case_id_supplier_id_key" ON "rfq_requests"("tenant_id", "case_id", "supplier_id");

-- CreateIndex
CREATE INDEX "rfq_request_lines_request_id_idx" ON "rfq_request_lines"("request_id");

-- CreateIndex
CREATE INDEX "rfq_request_lines_case_line_id_idx" ON "rfq_request_lines"("case_line_id");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_source_document_type_source_docum_idx" ON "purchase_orders"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "sales_orders_tenant_id_source_document_type_source_document_idx" ON "sales_orders"("tenant_id", "source_document_type", "source_document_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_customer_id_fkey" FOREIGN KEY ("converted_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "sales_pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_revised_from_id_fkey" FOREIGN KEY ("revised_from_id") REFERENCES "sales_quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_converted_order_id_fkey" FOREIGN KEY ("converted_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "sales_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_preferred_supplier_id_fkey" FOREIGN KEY ("preferred_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_cases" ADD CONSTRAINT "rfq_cases_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_cases" ADD CONSTRAINT "rfq_cases_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_case_lines" ADD CONSTRAINT "rfq_case_lines_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "rfq_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_case_lines" ADD CONSTRAINT "rfq_case_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_case_lines" ADD CONSTRAINT "rfq_case_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_case_lines" ADD CONSTRAINT "rfq_case_lines_requisition_line_id_fkey" FOREIGN KEY ("requisition_line_id") REFERENCES "purchase_requisition_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_requests" ADD CONSTRAINT "rfq_requests_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "rfq_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_requests" ADD CONSTRAINT "rfq_requests_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_request_lines" ADD CONSTRAINT "rfq_request_lines_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "rfq_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_request_lines" ADD CONSTRAINT "rfq_request_lines_case_line_id_fkey" FOREIGN KEY ("case_line_id") REFERENCES "rfq_case_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_request_lines" ADD CONSTRAINT "rfq_request_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_request_lines" ADD CONSTRAINT "rfq_request_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =============================================================================
-- CHECK constraints — Prisma cannot express these, so they are hand-added.
-- =============================================================================

-- Exactly one party. An opportunity or a quotation is addressed either to an
-- existing customer or to a lead that has not been converted yet, never to both
-- and never to neither. This is the integrity rule that makes the two-column
-- party design safe; without it, "which party is this quote for" becomes an
-- application-layer convention that the next developer will break.
ALTER TABLE "opportunities"
  ADD CONSTRAINT "opportunities_exactly_one_party"
  CHECK (num_nonnulls("customer_id", "lead_id") = 1);

ALTER TABLE "sales_quotations"
  ADD CONSTRAINT "sales_quotations_exactly_one_party"
  CHECK (num_nonnulls("customer_id", "lead_id") = 1);

-- Percentages are percentages.
ALTER TABLE "sales_pipeline_stages"
  ADD CONSTRAINT "sales_pipeline_stages_probability_range"
  CHECK ("default_probability" BETWEEN 0 AND 100);

ALTER TABLE "opportunities"
  ADD CONSTRAINT "opportunities_probability_range"
  CHECK ("probability" BETWEEN 0 AND 100);

-- Quantities are positive on every new document line. The existing order lines
-- have no such constraint; that is a pre-existing gap, not a reason to repeat it.
ALTER TABLE "sales_quotation_lines"
  ADD CONSTRAINT "sales_quotation_lines_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "purchase_requisition_lines"
  ADD CONSTRAINT "purchase_requisition_lines_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "rfq_case_lines"
  ADD CONSTRAINT "rfq_case_lines_quantity_positive" CHECK ("quantity" > 0);
