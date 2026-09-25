-- WORK-015 deterministic baseline for the custom SQL migration chain.
-- Source datamodel: backend/prisma/schema.prisma at 8ff696884b841bc92da6e77ee75553c094b86ac2.
-- Generator: Prisma CLI 5.22.0 migrate diff from empty to the historical datamodel.
-- Generated-body SHA-256 before this provenance header: d20208a585d0b1bc362e437967708aacc248a898eeb0412a62bba232d6409ddd.
-- Do not edit after ledger adoption; migration checksums cover raw file bytes.

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "modules" JSONB NOT NULL,
    "branding" JSONB,
    "language" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency_code" TEXT NOT NULL DEFAULT 'USD',
    "tax_config" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'employee',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'TR',
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'standard',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_zones" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone_type" TEXT NOT NULL DEFAULT 'storage',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_locations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "aisle" TEXT,
    "rack" TEXT,
    "shelf" TEXT,
    "bin" TEXT,
    "location_type" TEXT NOT NULL DEFAULT 'bulk',
    "is_pick_location" BOOLEAN NOT NULL DEFAULT false,
    "is_receive_location" BOOLEAN NOT NULL DEFAULT false,
    "max_weight" DECIMAL(10,2),
    "max_volume" DECIMAL(10,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category_id" UUID,
    "brand" TEXT,
    "attributes" JSONB,
    "uom_id" UUID,
    "product_type" TEXT NOT NULL DEFAULT 'physical',
    "cost_price" DECIMAL(12,2),
    "selling_price" DECIMAL(12,2) NOT NULL,
    "sale_price" DECIMAL(12,2),
    "weight_kg" DECIMAL(8,3),
    "reorder_point" INTEGER NOT NULL DEFAULT 0,
    "images" TEXT[],
    "video_urls" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku_variant" TEXT NOT NULL,
    "attributes" JSONB,
    "size" TEXT,
    "color" TEXT,
    "barcode" TEXT,
    "additional_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_stock" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "location_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "reference_type" TEXT,
    "reference_id" UUID,
    "reference_number" TEXT,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "from_location_id" UUID,
    "to_location_id" UUID,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(12,4),
    "notes" TEXT,
    "performed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "location_id" UUID NOT NULL,
    "source_po_id" UUID,
    "po_number" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "work_type" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_template_lines" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "work_type" TEXT NOT NULL,
    "location_type" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "work_template_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_directives" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "directive_type" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "work_type" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_directives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_directive_lines" (
    "id" UUID NOT NULL,
    "directive_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "from_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "to_qty" DECIMAL(12,2),
    "strategy" TEXT NOT NULL DEFAULT 'CONSOLIDATE',
    "zone_id" UUID,
    "location_id" UUID,

    CONSTRAINT "location_directive_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wave_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "wave_type" TEXT NOT NULL DEFAULT 'SHIPPING',
    "auto_process" BOOLEAN NOT NULL DEFAULT false,
    "auto_release" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wave_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waves" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "template_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "waves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_work" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "work_id_code" TEXT NOT NULL,
    "work_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "wave_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "assigned_to" UUID,
    "reference_type" TEXT,
    "reference_id" UUID,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_work_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_work_lines" (
    "id" UUID NOT NULL,
    "work_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "line_type" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "quantity" DECIMAL(12,2) NOT NULL,
    "quantity_done" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "from_location_id" UUID,
    "to_location_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "warehouse_work_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arrival_journals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "journal_number" TEXT NOT NULL,
    "purchase_order_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "arrival_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_by" UUID,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arrival_journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arrival_journal_lines" (
    "id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "expected_qty" DECIMAL(12,2),
    "received_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "receive_location_id" UUID,

    CONSTRAINT "arrival_journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "payment_terms" INTEGER DEFAULT 30,
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "po_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "order_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_date" DATE,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by" UUID,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "receive_location_id" UUID,
    "received_at" TIMESTAMP(3),
    "received_by" UUID,
    "packing_slip_url" TEXT,
    "paid_at" TIMESTAMP(3),
    "paid_by" UUID,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "quantity" DECIMAL(12,2) NOT NULL,
    "received_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(12,4) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "date_of_birth" DATE,
    "segment" TEXT NOT NULL DEFAULT 'regular',
    "tags" TEXT[],
    "notes" TEXT,
    "lifetime_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" UUID,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "site_id" UUID,
    "warehouse_id" UUID,
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shipping_address" JSONB,
    "notes" TEXT,
    "wave_id" UUID,
    "invoice_id" UUID,
    "paid_at" TIMESTAMP(3),
    "paid_by" UUID,
    "returned_at" TIMESTAMP(3),
    "created_by" UUID,
    "confirmed_at" TIMESTAMP(3),
    "shipped_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,4) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(14,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "shipment_number" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "carrier" TEXT,
    "tracking_number" TEXT,
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "from_warehouse_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "employee_code" TEXT NOT NULL,
    "department" TEXT,
    "position" TEXT,
    "hire_date" DATE,
    "salary" DECIMAL(12,2),
    "assigned_site_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "pos_device_id" TEXT,
    "pos_pin_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "import_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "column_mapping" JSONB,
    "total_rows" INTEGER,
    "valid_rows" INTEGER,
    "error_rows" INTEGER,
    "errors" JSONB,
    "created_by" UUID,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "values" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variant_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_counts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "counted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMP(3),

    CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_lines" (
    "id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "location_id" UUID NOT NULL,
    "system_qty" INTEGER NOT NULL DEFAULT 0,
    "counted_qty" INTEGER,

    CONSTRAINT "inventory_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "normal_balance" TEXT NOT NULL DEFAULT 'DEBIT',
    "parent_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entry_number" TEXT NOT NULL,
    "entry_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "source_module" TEXT,
    "source_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "debit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facturas" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "factura_number" INTEGER NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "customer_name" TEXT NOT NULL,
    "customer_nit" TEXT,
    "invoice_date" DATE NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "iva_amount" DECIMAL(14,2) NOT NULL,
    "it_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "notes" TEXT,
    "invoice_metadata" JSONB,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factura_counters" (
    "tenant_id" UUID NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factura_counters_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "register_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "terminal_name" TEXT NOT NULL,
    "opened_by" UUID NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by" UUID,
    "closed_at" TIMESTAMP(3),
    "opening_float" DECIMAL(12,2) NOT NULL,
    "closing_float" DECIMAL(12,2),
    "total_sales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "transaction_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "site_id" UUID,
    "warehouse_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "register_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "user_email" TEXT,
    "user_role" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "body" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_counters" (
    "tenant_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_counters_pkey" PRIMARY KEY ("tenant_id","doc_type")
);

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "sites_tenant_id_code_key" ON "sites"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenant_id_code_key" ON "warehouses"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_zones_warehouse_id_code_key" ON "warehouse_zones"("warehouse_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_locations_zone_id_code_key" ON "warehouse_locations"("zone_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_tenant_id_code_key" ON "product_categories"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "products"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenant_id_sku_variant_key" ON "product_variants"("tenant_id", "sku_variant");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_stock_tenant_id_product_id_variant_id_location_id_key" ON "inventory_stock"("tenant_id", "product_id", "variant_id", "location_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_tenant_id_product_id_idx" ON "inventory_transactions"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_tenant_id_created_at_idx" ON "inventory_transactions"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "inventory_batches_tenant_id_product_id_variant_id_received__idx" ON "inventory_batches"("tenant_id", "product_id", "variant_id", "received_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "work_templates_tenant_id_code_key" ON "work_templates"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "location_directives_tenant_id_code_key" ON "location_directives"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "wave_templates_tenant_id_code_key" ON "wave_templates"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_work_work_id_code_key" ON "warehouse_work"("work_id_code");

-- CreateIndex
CREATE INDEX "warehouse_work_tenant_id_status_idx" ON "warehouse_work"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "arrival_journals_journal_number_key" ON "arrival_journals"("journal_number");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_code_key" ON "suppliers"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_po_number_key" ON "purchase_orders"("po_number");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_code_key" ON "customers"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_order_number_key" ON "sales_orders"("order_number");

-- CreateIndex
CREATE INDEX "sales_orders_tenant_id_status_idx" ON "sales_orders"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "sales_orders_tenant_id_created_at_idx" ON "sales_orders"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "shipments_shipment_number_key" ON "shipments"("shipment_number");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_employee_code_key" ON "employees"("tenant_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "variant_types_tenant_id_name_key" ON "variant_types"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_counts_reference_key" ON "inventory_counts"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenant_id_code_key" ON "accounts"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_entry_number_key" ON "journal_entries"("entry_number");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_entry_date_idx" ON "journal_entries"("tenant_id", "entry_date" DESC);

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_source_module_source_id_idx" ON "journal_entries"("tenant_id", "source_module", "source_id");

-- CreateIndex
CREATE INDEX "facturas_tenant_id_invoice_date_idx" ON "facturas"("tenant_id", "invoice_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "facturas_tenant_id_factura_number_key" ON "facturas"("tenant_id", "factura_number");

-- CreateIndex
CREATE INDEX "register_sessions_tenant_id_status_idx" ON "register_sessions"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_tenant_id_year_month_key" ON "accounting_periods"("tenant_id", "year", "month");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_tenant_id_code_key" ON "units_of_measure"("tenant_id", "code");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_zones" ADD CONSTRAINT "warehouse_zones_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "warehouse_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_templates" ADD CONSTRAINT "work_templates_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_template_lines" ADD CONSTRAINT "work_template_lines_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "work_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_directives" ADD CONSTRAINT "location_directives_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_directive_lines" ADD CONSTRAINT "location_directive_lines_directive_id_fkey" FOREIGN KEY ("directive_id") REFERENCES "location_directives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_directive_lines" ADD CONSTRAINT "location_directive_lines_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "warehouse_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_directive_lines" ADD CONSTRAINT "location_directive_lines_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wave_templates" ADD CONSTRAINT "wave_templates_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waves" ADD CONSTRAINT "waves_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_work" ADD CONSTRAINT "warehouse_work_wave_id_fkey" FOREIGN KEY ("wave_id") REFERENCES "waves"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_work" ADD CONSTRAINT "warehouse_work_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_work_lines" ADD CONSTRAINT "warehouse_work_lines_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "warehouse_work"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_work_lines" ADD CONSTRAINT "warehouse_work_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_work_lines" ADD CONSTRAINT "warehouse_work_lines_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_work_lines" ADD CONSTRAINT "warehouse_work_lines_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arrival_journals" ADD CONSTRAINT "arrival_journals_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arrival_journals" ADD CONSTRAINT "arrival_journals_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arrival_journal_lines" ADD CONSTRAINT "arrival_journal_lines_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "arrival_journals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_wave_id_fkey" FOREIGN KEY ("wave_id") REFERENCES "waves"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_assigned_site_id_fkey" FOREIGN KEY ("assigned_site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "inventory_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
