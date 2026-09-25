-- =============================================================================
-- 040  POS tenders, shift declarations and factura annulment
--
-- A POS sale debited accounts receivable whatever the customer paid with and
-- dropped the payment method and the cash tendered, so nothing ever reached cash
-- or the card clearing account and AR grew with every till sale. The Z report
-- expected cash equal to the opening float plus ALL sales, card included. A void
-- left its factura ISSUED and did not reverse the turnover tax.
--
-- **[OFFICIAL]** the statement calculates per payment method and compares the
-- counted amounts from tender declarations; a shift compares expected with
-- counted and the Z report shows the over or short amount:
--   learn.microsoft.com/dynamics365/commerce/retail-statements
--   learn.microsoft.com/dynamics365/commerce/shift-drawer-management
--
-- sales_payment_methods          how a customer pays: tender type, the ledger account
--                                a tender of it debits, whether the drawer counts it
--                                at close, whether it gives change, the tolerated
--                                difference. warehouse_id is a hook for a per-store
--                                override (nothing reads it yet).
-- pos_tenders                    one row per payment of a sale, with the method and the
--                                account snapshotted; reversed_at marks a voided sale.
-- register_session_declarations  what was counted per method at close, what was
--                                expected, the difference and its voucher.
-- facturas.cancelled_*           an annulled factura keeps its number; who, when, why,
--                                and the voucher that reversed it.
-- sales_parameters.pos_void_mode ANNUL_IN_SESSION (default): a sale is voided — its
--                                factura annulled and every voucher reversed — only
--                                while the session it was rung in is open.
--                                CREDIT_NOTE_ONLY | DISABLED: no void; use a return.
--                                Bolivian SIN annulment rules stay a validation item.
--
-- Design reference: docs/process/REMEDIATION_PLAN_WORK-042_054.md §2.3, §2.4,
-- WORK-047, DEF-030…036.
-- =============================================================================

CREATE TABLE "sales_payment_methods" (
    "id"                    UUID NOT NULL,
    "tenant_id"             UUID NOT NULL,
    "legal_entity_id"       UUID,
    "warehouse_id"          UUID,
    "code"                  TEXT NOT NULL,
    "name"                  TEXT NOT NULL,
    "tender_type"           TEXT NOT NULL,
    "account_id"            UUID NOT NULL,
    "declaration_policy"    TEXT NOT NULL DEFAULT 'NONE',
    "allow_change"          BOOLEAN NOT NULL DEFAULT false,
    "max_difference_amount" DECIMAL(14,2),
    "is_active"             BOOLEAN NOT NULL DEFAULT true,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_payment_methods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_payment_methods_tender_type_check"
      CHECK ("tender_type" IN ('CASH', 'CARD', 'TRANSFER', 'QR', 'CUSTOMER_ACCOUNT', 'VOUCHER')),
    CONSTRAINT "sales_payment_methods_declaration_policy_check" CHECK ("declaration_policy" IN ('NONE', 'COUNT')),
    CONSTRAINT "sales_payment_methods_change_check" CHECK (NOT "allow_change" OR "tender_type" = 'CASH'),
    CONSTRAINT "sales_payment_methods_max_difference_check" CHECK ("max_difference_amount" IS NULL OR "max_difference_amount" >= 0)
);
CREATE UNIQUE INDEX "sales_payment_methods_scope_code_key"
  ON "sales_payment_methods"("tenant_id", "legal_entity_id", "warehouse_id", "code") NULLS NOT DISTINCT;
ALTER TABLE "sales_payment_methods" ADD CONSTRAINT "sales_payment_methods_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "pos_tenders" (
    "id"                       UUID NOT NULL,
    "tenant_id"                UUID NOT NULL,
    "sales_order_id"           UUID NOT NULL,
    "register_session_id"      UUID NOT NULL,
    "payment_method_id"        UUID NOT NULL,
    "tender_type"              TEXT NOT NULL,
    "account_id"               UUID NOT NULL,
    "amount"                   DECIMAL(14,2) NOT NULL,
    "tendered"                 DECIMAL(14,2),
    "change"                   DECIMAL(14,2),
    "reversed_at"              TIMESTAMP(3),
    "settled_journal_entry_id" UUID,
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pos_tenders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pos_tenders_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "pos_tenders_change_check" CHECK ("change" IS NULL OR "change" >= 0)
);
CREATE INDEX "pos_tenders_register_session_id_idx" ON "pos_tenders"("register_session_id");
CREATE INDEX "pos_tenders_sales_order_id_idx" ON "pos_tenders"("sales_order_id");
ALTER TABLE "pos_tenders" ADD CONSTRAINT "pos_tenders_payment_method_id_fkey"
  FOREIGN KEY ("payment_method_id") REFERENCES "sales_payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "register_session_declarations" (
    "id"                  UUID NOT NULL,
    "tenant_id"           UUID NOT NULL,
    "register_session_id" UUID NOT NULL,
    "payment_method_id"   UUID NOT NULL,
    "expected"            DECIMAL(14,2) NOT NULL,
    "counted"             DECIMAL(14,2) NOT NULL,
    "difference"          DECIMAL(14,2) NOT NULL,
    "journal_entry_id"    UUID,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "register_session_declarations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "register_session_declarations_session_method_key"
  ON "register_session_declarations"("register_session_id", "payment_method_id");
ALTER TABLE "register_session_declarations" ADD CONSTRAINT "register_session_declarations_payment_method_id_fkey"
  FOREIGN KEY ("payment_method_id") REFERENCES "sales_payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "facturas"
  ADD COLUMN "cancelled_at"              TIMESTAMP(3),
  ADD COLUMN "cancelled_by"              UUID,
  ADD COLUMN "cancellation_reason"       TEXT,
  ADD COLUMN "reversal_journal_entry_id" UUID;

ALTER TABLE "sales_parameters"
  ADD COLUMN "pos_void_mode" TEXT NOT NULL DEFAULT 'ANNUL_IN_SESSION';
ALTER TABLE "sales_parameters"
  ADD CONSTRAINT "sales_parameters_pos_void_mode_check"
    CHECK ("pos_void_mode" IN ('ANNUL_IN_SESSION', 'CREDIT_NOTE_ONLY', 'DISABLED'));
