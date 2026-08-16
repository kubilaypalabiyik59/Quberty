-- =============================================================================
-- 010 — Vendor invoice, product receipt, and three-way matching
--
-- WHY: the purchase receipt used to do the physical AND the financial update in
-- one voucher — inventory, recoverable input tax and accounts payable together.
-- That collapse made four things impossible:
--
--   1. Honouring post_physical_inventory / post_financial_inventory on the
--      purchase side. There was only one posting event to switch.
--   2. Recognising input VAT against the supplier's invoice. Bolivia's IVA
--      credito fiscal is claimed against the factura, not against the arrival of
--      goods (BOLIVIA_TAX_BASIS.md, P2P_REFERENCE.md §7).
--   3. Several deliveries against one order, or knowing which delivery brought
--      what. "Received" was a status and a timestamp on the order header.
--   4. Three-way matching, which is not a comparison of two numbers but a
--      question about specific receipt lines: [OFFICIAL] "if there are multiple
--      product receipts for a single invoice line, you need to run the process
--      multiple times to achieve the full quantity match."
--
-- The official model, and every claim this migration implements:
--   learn.microsoft.com/dynamics365/finance/general-ledger/purchase-order-posting
--   learn.microsoft.com/dynamics365/finance/accounts-payable/accounts-payable-invoice-matching
--   learn.microsoft.com/dynamics365/finance/accounts-payable/vendor-invoices-overview
--   learn.microsoft.com/dynamics365/supply-chain/procurement/product-receipt-against-purchase-orders
--   Design: docs/process/VENDOR_INVOICE.md
--
-- ── ADDITIVE ONLY, AND DELIBERATELY INERT ────────────────────────────────────
-- Seven new tables, two columns on purchase_order_lines, twelve on
-- purchase_parameters. Every new parameter defaults to the behaviour that shipped
-- before it: post_product_receipt_in_ledger = false and line_matching_policy
-- stays NONE, so no tenant's books change until someone turns them on.
--
-- NOTHING IS BACKFILLED. Existing purchase orders are RECEIVED with a single
-- posted voucher; synthesising product receipts and vendor invoices for them
-- would be inventing documents that never existed. They keep their history. The
-- new documents apply to orders received after a tenant switches over.
--
-- ── TWO-AXIS SCOPES ──────────────────────────────────────────────────────────
-- matching_policies and price_tolerances are resolved on TWO axes (item x party),
-- unlike posting_profiles, which is a single axis with flat precedence.
-- [OFFICIAL] the matching hierarchy's most specific level is "Item and vendor",
-- and the tolerance search order is spelled out as nine cells: Table/Table,
-- Table/Group, Table/All, Group/Table, Group/Group, Group/All, All/Table,
-- All/Group, All/All. A single axis cannot express any of that. The asymmetry
-- with posting_profiles is a recorded decision — VENDOR_INVOICE.md §5.
--
-- Generated with:
--   prisma migrate diff --from-schema-datasource prisma/schema.prisma \
--     --to-schema-datamodel prisma/schema.prisma --script
-- then hand-edited to add NULLS NOT DISTINCT to the two two-axis unique indexes.
-- Postgres treats NULLs as distinct, so without it a tenant could hold several
-- rival All/All rows — the same defect NULLS NOT DISTINCT fixes for
-- posting_profiles in migration 001. Requires Postgres 15+; Supabase runs 17.6.
-- =============================================================================

-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN     "invoiced_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "matching_policy" TEXT;

-- AlterTable
ALTER TABLE "purchase_parameters" ADD COLUMN     "allow_matching_policy_override" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "default_invoice_quantity" TEXT NOT NULL DEFAULT 'PRODUCT_RECEIPT',
ADD COLUMN     "flag_negative_price_variance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "invoice_totals_tolerance_pct" DECIMAL(6,4) NOT NULL DEFAULT 0,
ADD COLUMN     "match_invoice_totals" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "match_price_totals" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "post_invoice_with_discrepancies" TEXT NOT NULL DEFAULT 'ALLOW_WITH_WARNING',
ADD COLUMN     "post_product_receipt_in_ledger" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "price_total_tolerance_amount" DECIMAL(14,2),
ADD COLUMN     "price_total_tolerance_pct" DECIMAL(6,4) NOT NULL DEFAULT 0,
ADD COLUMN     "receipt_invoice_flow" TEXT NOT NULL DEFAULT 'EITHER';

-- CreateTable
CREATE TABLE "product_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "receipt_number" TEXT NOT NULL,
    "packing_slip" TEXT NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "receipt_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "journal_entry_id" UUID,
    "corrects_receipt_id" UUID,
    "notes" TEXT,
    "created_by" UUID,
    "posted_at" TIMESTAMP(3),
    "posted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_receipt_lines" (
    "id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "po_line_id" UUID,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_cost" DECIMAL(12,4) NOT NULL,
    "net_unit_cost" DECIMAL(12,4) NOT NULL,
    "line_net_amount" DECIMAL(14,2) NOT NULL,
    "matched_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "location_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "invoice_number" TEXT NOT NULL,
    "internal_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "purchase_order_id" UUID,
    "invoice_date" DATE NOT NULL,
    "posting_date" DATE NOT NULL,
    "due_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "supplier_tax_id" TEXT,
    "fiscal_authorization_code" TEXT,
    "fiscal_control_code" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "non_recoverable_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "header_match_status" TEXT NOT NULL DEFAULT 'PENDING',
    "totals_match_status" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "last_matched_at" TIMESTAMP(3),
    "discrepancy_approved" BOOLEAN NOT NULL DEFAULT false,
    "discrepancy_approved_by" UUID,
    "discrepancy_approved_at" TIMESTAMP(3),
    "journal_entry_id" UUID,
    "notes" TEXT,
    "created_by" UUID,
    "posted_at" TIMESTAMP(3),
    "posted_by" UUID,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "po_line_id" UUID,
    "product_id" UUID,
    "variant_id" UUID,
    "description" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_price" DECIMAL(12,4) NOT NULL,
    "charges_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_net_amount" DECIMAL(14,2) NOT NULL,
    "item_tax_group_id" UUID,
    "tax_amount" DECIMAL(14,2),
    "tax_base" DECIMAL(14,2),
    "matching_policy" TEXT NOT NULL DEFAULT 'NONE',
    "price_tolerance_pct" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "matched_receipt_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "price_match_status" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "price_total_match_status" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "receipt_qty_match_status" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "price_variance_pct" DECIMAL(9,4),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "vendor_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_invoice_matches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_line_id" UUID NOT NULL,
    "receipt_line_id" UUID NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "vendor_invoice_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matching_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "item_scope" TEXT NOT NULL DEFAULT 'ALL',
    "item_scope_id" UUID,
    "party_scope" TEXT NOT NULL DEFAULT 'ALL',
    "party_scope_id" UUID,
    "policy" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matching_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_tolerances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "item_scope" TEXT NOT NULL DEFAULT 'ALL',
    "item_scope_id" UUID,
    "party_scope" TEXT NOT NULL DEFAULT 'ALL',
    "party_scope_id" UUID,
    "tolerance_pct" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_tolerances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_receipts_tenant_id_purchase_order_id_idx" ON "product_receipts"("tenant_id", "purchase_order_id");

-- CreateIndex
CREATE INDEX "product_receipts_tenant_id_supplier_id_status_idx" ON "product_receipts"("tenant_id", "supplier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_receipts_tenant_id_receipt_number_key" ON "product_receipts"("tenant_id", "receipt_number");

-- CreateIndex
CREATE INDEX "product_receipt_lines_receipt_id_idx" ON "product_receipt_lines"("receipt_id");

-- CreateIndex
CREATE INDEX "product_receipt_lines_po_line_id_idx" ON "product_receipt_lines"("po_line_id");

-- CreateIndex
CREATE INDEX "vendor_invoices_tenant_id_status_invoice_date_idx" ON "vendor_invoices"("tenant_id", "status", "invoice_date");

-- CreateIndex
CREATE INDEX "vendor_invoices_tenant_id_purchase_order_id_idx" ON "vendor_invoices"("tenant_id", "purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_invoices_tenant_id_supplier_id_invoice_number_key" ON "vendor_invoices"("tenant_id", "supplier_id", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_invoices_tenant_id_internal_number_key" ON "vendor_invoices"("tenant_id", "internal_number");

-- CreateIndex
CREATE INDEX "vendor_invoice_lines_invoice_id_idx" ON "vendor_invoice_lines"("invoice_id");

-- CreateIndex
CREATE INDEX "vendor_invoice_lines_po_line_id_idx" ON "vendor_invoice_lines"("po_line_id");

-- CreateIndex
CREATE INDEX "vendor_invoice_matches_tenant_id_receipt_line_id_idx" ON "vendor_invoice_matches"("tenant_id", "receipt_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_invoice_matches_tenant_id_invoice_line_id_receipt_li_key" ON "vendor_invoice_matches"("tenant_id", "invoice_line_id", "receipt_line_id");

-- CreateIndex
CREATE INDEX "matching_policies_tenant_id_item_scope_party_scope_idx" ON "matching_policies"("tenant_id", "item_scope", "party_scope");

-- CreateIndex
CREATE UNIQUE INDEX "matching_policies_tenant_id_legal_entity_id_item_scope_item_key" ON "matching_policies"("tenant_id", "legal_entity_id", "item_scope", "item_scope_id", "party_scope", "party_scope_id") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "price_tolerances_tenant_id_item_scope_party_scope_idx" ON "price_tolerances"("tenant_id", "item_scope", "party_scope");

-- CreateIndex
CREATE UNIQUE INDEX "price_tolerances_tenant_id_legal_entity_id_item_scope_item__key" ON "price_tolerances"("tenant_id", "legal_entity_id", "item_scope", "item_scope_id", "party_scope", "party_scope_id") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "product_receipts" ADD CONSTRAINT "product_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_receipts" ADD CONSTRAINT "product_receipts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_receipts" ADD CONSTRAINT "product_receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_receipts" ADD CONSTRAINT "product_receipts_corrects_receipt_id_fkey" FOREIGN KEY ("corrects_receipt_id") REFERENCES "product_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_receipt_lines" ADD CONSTRAINT "product_receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "product_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_receipt_lines" ADD CONSTRAINT "product_receipt_lines_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_receipt_lines" ADD CONSTRAINT "product_receipt_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoice_lines" ADD CONSTRAINT "vendor_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "vendor_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoice_lines" ADD CONSTRAINT "vendor_invoice_lines_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoice_lines" ADD CONSTRAINT "vendor_invoice_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoice_matches" ADD CONSTRAINT "vendor_invoice_matches_invoice_line_id_fkey" FOREIGN KEY ("invoice_line_id") REFERENCES "vendor_invoice_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoice_matches" ADD CONSTRAINT "vendor_invoice_matches_receipt_line_id_fkey" FOREIGN KEY ("receipt_line_id") REFERENCES "product_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

