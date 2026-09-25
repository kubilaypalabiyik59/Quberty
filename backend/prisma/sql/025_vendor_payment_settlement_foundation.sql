-- WORK-017: vendor payment and AP settlement schema foundation.
--
-- Additive only. Existing VendorInvoice rows deliberately retain NULL FX snapshots;
-- no historical exchange rate is inferred. Runtime posting, open-balance locking,
-- settlement enforcement, and legacy invoice backfill are separate bounded items.

ALTER TABLE "vendor_invoices"
  ADD COLUMN "exchange_rate" DECIMAL(18,8),
  ADD COLUMN "amount_functional" DECIMAL(14,2);

CREATE TABLE "purchase_payment_methods" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "legal_entity_id" UUID,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "account_type" TEXT NOT NULL,
  "offset_account_id" UUID NOT NULL,
  "allowed_currency" TEXT,
  "bank_account_reference" TEXT,
  "reconciliation_reference" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "purchase_payment_methods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_payment_methods_account_type_check"
    CHECK ("account_type" IN ('BANK', 'CASH', 'LEDGER'))
);

CREATE TABLE "vendor_payments" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "legal_entity_id" UUID,
  "payment_number" TEXT NOT NULL,
  "supplier_id" UUID NOT NULL,
  "payment_date" DATE NOT NULL,
  "posting_date" DATE NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BOB',
  "amount" DECIMAL(14,2) NOT NULL,
  "exchange_rate" DECIMAL(18,8) NOT NULL,
  "amount_functional" DECIMAL(14,2) NOT NULL,
  "payment_method_id" UUID NOT NULL,
  "offset_account_id" UUID NOT NULL,
  "journal_entry_id" UUID,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "approval_status" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
  -- Direction is always new reversal row -> original payment.
  "reverses_payment_id" UUID,
  "created_by" UUID,
  "posted_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_at" TIMESTAMP(3),
  "notes" TEXT,
  CONSTRAINT "vendor_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vendor_payments_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "vendor_payments_exchange_rate_check" CHECK ("exchange_rate" > 0),
  CONSTRAINT "vendor_payments_functional_amount_check" CHECK ("amount_functional" > 0),
  CONSTRAINT "vendor_payments_status_check" CHECK ("status" IN ('DRAFT', 'POSTED')),
  CONSTRAINT "vendor_payments_approval_status_check"
    CHECK ("approval_status" IN ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT "vendor_payments_not_self_reversal_check"
    CHECK ("reverses_payment_id" IS NULL OR "reverses_payment_id" <> "id")
);

CREATE TABLE "vendor_open_transactions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "legal_entity_id" UUID,
  "supplier_id" UUID NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" UUID NOT NULL,
  -- Direction is always new reversal row -> original AP transaction.
  "reverses_transaction_id" UUID,
  "direction" TEXT NOT NULL,
  "transaction_date" DATE NOT NULL,
  "posting_date" DATE NOT NULL,
  "currency" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "exchange_rate" DECIMAL(18,8) NOT NULL,
  "amount_functional" DECIMAL(14,2) NOT NULL,
  "journal_entry_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendor_open_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vendor_open_transactions_source_type_check"
    CHECK ("source_type" IN ('INVOICE', 'PAYMENT', 'SUPPLIER_CREDIT', 'PAYMENT_REVERSAL')),
  CONSTRAINT "vendor_open_transactions_direction_check" CHECK ("direction" IN ('DEBIT', 'CREDIT')),
  CONSTRAINT "vendor_open_transactions_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "vendor_open_transactions_exchange_rate_check" CHECK ("exchange_rate" > 0),
  CONSTRAINT "vendor_open_transactions_functional_amount_check" CHECK ("amount_functional" > 0),
  CONSTRAINT "vendor_open_transactions_not_self_reversal_check"
    CHECK ("reverses_transaction_id" IS NULL OR "reverses_transaction_id" <> "id")
);

CREATE TABLE "vendor_settlements" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "legal_entity_id" UUID,
  "supplier_id" UUID NOT NULL,
  "debit_transaction_id" UUID NOT NULL,
  "credit_transaction_id" UUID NOT NULL,
  "currency" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "exchange_rate" DECIMAL(18,8) NOT NULL,
  "amount_functional" DECIMAL(14,2) NOT NULL,
  "settlement_date" DATE NOT NULL,
  "journal_entry_id" UUID,
  -- Direction is always new negating row -> original settlement.
  "reverses_settlement_id" UUID,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendor_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vendor_settlements_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "vendor_settlements_exchange_rate_check" CHECK ("exchange_rate" > 0),
  CONSTRAINT "vendor_settlements_functional_amount_check" CHECK ("amount_functional" > 0),
  CONSTRAINT "vendor_settlements_opposite_transactions_check"
    CHECK ("debit_transaction_id" <> "credit_transaction_id"),
  CONSTRAINT "vendor_settlements_not_self_reversal_check"
    CHECK ("reverses_settlement_id" IS NULL OR "reverses_settlement_id" <> "id")
);

ALTER TABLE "purchase_parameters"
  ADD COLUMN "default_payment_method_id" UUID,
  ADD COLUMN "settlement_mode" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "overpayment_policy" TEXT NOT NULL DEFAULT 'REJECT',
  ADD COLUMN "overpayment_tolerance" DECIMAL(14,2),
  ADD COLUMN "underpayment_tolerance" DECIMAL(14,2),
  ADD COLUMN "writeoff_posting_type" TEXT,
  ADD COLUMN "reversal_approval_policy" TEXT NOT NULL DEFAULT 'NONE',
  ADD CONSTRAINT "purchase_parameters_settlement_mode_check"
    CHECK ("settlement_mode" IN ('MANUAL', 'SELECTED_INVOICES')),
  ADD CONSTRAINT "purchase_parameters_overpayment_policy_check"
    CHECK ("overpayment_policy" IN ('REJECT', 'WRITE_OFF_WITHIN_TOLERANCE')),
  ADD CONSTRAINT "purchase_parameters_overpayment_tolerance_check"
    CHECK ("overpayment_tolerance" IS NULL OR "overpayment_tolerance" >= 0),
  ADD CONSTRAINT "purchase_parameters_underpayment_tolerance_check"
    CHECK ("underpayment_tolerance" IS NULL OR "underpayment_tolerance" >= 0),
  ADD CONSTRAINT "purchase_parameters_reversal_approval_policy_check"
    CHECK ("reversal_approval_policy" IN ('NONE', 'REQUIRED'));

-- NULL legal_entity_id is a real shared scope. PostgreSQL 15+ NULLS NOT DISTINCT
-- prevents duplicate codes/numbers/source identities inside that shared scope.
CREATE UNIQUE INDEX "purchase_payment_methods_tenant_id_legal_entity_id_code_key"
  ON "purchase_payment_methods" ("tenant_id", "legal_entity_id", "code") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "vendor_payments_tenant_id_legal_entity_id_payment_number_key"
  ON "vendor_payments" ("tenant_id", "legal_entity_id", "payment_number") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "vendor_open_transactions_source_key"
  ON "vendor_open_transactions" ("tenant_id", "legal_entity_id", "source_type", "source_id") NULLS NOT DISTINCT;

CREATE UNIQUE INDEX "vendor_payments_journal_entry_id_key" ON "vendor_payments" ("journal_entry_id");
CREATE UNIQUE INDEX "vendor_payments_reverses_payment_id_key" ON "vendor_payments" ("reverses_payment_id");
CREATE UNIQUE INDEX "vendor_open_transactions_reverses_transaction_id_key" ON "vendor_open_transactions" ("reverses_transaction_id");
CREATE UNIQUE INDEX "vendor_open_transactions_journal_entry_id_key" ON "vendor_open_transactions" ("journal_entry_id");
CREATE UNIQUE INDEX "vendor_settlements_reverses_settlement_id_key" ON "vendor_settlements" ("reverses_settlement_id");

CREATE INDEX "purchase_payment_methods_scope_active_idx"
  ON "purchase_payment_methods" ("tenant_id", "legal_entity_id", "is_active");
CREATE INDEX "vendor_payments_tenant_id_supplier_id_payment_date_idx"
  ON "vendor_payments" ("tenant_id", "supplier_id", "payment_date");
CREATE INDEX "vendor_payments_tenant_id_legal_entity_id_status_idx"
  ON "vendor_payments" ("tenant_id", "legal_entity_id", "status");
CREATE INDEX "vendor_open_transactions_tenant_id_supplier_id_posting_date_idx"
  ON "vendor_open_transactions" ("tenant_id", "supplier_id", "posting_date");
CREATE INDEX "vendor_open_transactions_scope_direction_idx"
  ON "vendor_open_transactions" ("tenant_id", "legal_entity_id", "direction");
CREATE INDEX "vendor_settlements_tenant_id_supplier_id_settlement_date_idx"
  ON "vendor_settlements" ("tenant_id", "supplier_id", "settlement_date");
CREATE INDEX "vendor_settlements_debit_transaction_id_idx" ON "vendor_settlements" ("debit_transaction_id");
CREATE INDEX "vendor_settlements_credit_transaction_id_idx" ON "vendor_settlements" ("credit_transaction_id");
CREATE INDEX "purchase_parameters_default_payment_method_id_idx" ON "purchase_parameters" ("default_payment_method_id");

ALTER TABLE "purchase_payment_methods"
  ADD CONSTRAINT "purchase_payment_methods_offset_account_id_fkey"
  FOREIGN KEY ("offset_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vendor_payments"
  ADD CONSTRAINT "vendor_payments_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vendor_payments_payment_method_id_fkey"
  FOREIGN KEY ("payment_method_id") REFERENCES "purchase_payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vendor_payments_offset_account_id_fkey"
  FOREIGN KEY ("offset_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vendor_payments_journal_entry_id_fkey"
  FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "vendor_payments_reverses_payment_id_fkey"
  FOREIGN KEY ("reverses_payment_id") REFERENCES "vendor_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vendor_open_transactions"
  ADD CONSTRAINT "vendor_open_transactions_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vendor_open_transactions_journal_entry_id_fkey"
  FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vendor_open_transactions_reverses_transaction_id_fkey"
  FOREIGN KEY ("reverses_transaction_id") REFERENCES "vendor_open_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vendor_settlements"
  ADD CONSTRAINT "vendor_settlements_debit_transaction_id_fkey"
  FOREIGN KEY ("debit_transaction_id") REFERENCES "vendor_open_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vendor_settlements_credit_transaction_id_fkey"
  FOREIGN KEY ("credit_transaction_id") REFERENCES "vendor_open_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vendor_settlements_journal_entry_id_fkey"
  FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "vendor_settlements_reverses_settlement_id_fkey"
  FOREIGN KEY ("reverses_settlement_id") REFERENCES "vendor_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_parameters"
  ADD CONSTRAINT "purchase_parameters_default_payment_method_id_fkey"
  FOREIGN KEY ("default_payment_method_id") REFERENCES "purchase_payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
