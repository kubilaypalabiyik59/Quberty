-- =============================================================================
-- 029  Supplier returns and supplier credits
--
-- Adds the physical-return document (PurchaseReturn) and the AP-credit document
-- (SupplierCredit) together with their line tables.
--
-- Design reference: WORK-019, docs/architecture/SUPPLIER_RETURNS_AND_CREDITS.md
-- Accepted boundary: BOB-only, separate receipt-ledger mode only, no Bolivian
-- tax-book export, no cross-currency, no combined-mode historical reversal.
-- =============================================================================

-- ── Number sequences ─────────────────────────────────────────────────────────
-- Insert for every existing tenant so allocateNumber never races on first use.
-- The format tokens {YYYY} and {#####} are the only ones formatNumber() resolves.

INSERT INTO number_sequences (
  id, tenant_id, legal_entity_id, reference, name, format,
  continuous, manual, scope, next_number, is_active, created_at, updated_at
)
SELECT
  gen_random_uuid(), id, NULL, 'PURCHASE_RETURN', 'Purchase Return',
  'PR-{YYYY}-{#####}', false, false, 'LEGAL_ENTITY', 1, true, NOW(), NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM number_sequences ns
  WHERE ns.tenant_id = t.id AND ns.reference = 'PURCHASE_RETURN'
    AND ns.legal_entity_id IS NULL
);

INSERT INTO number_sequences (
  id, tenant_id, legal_entity_id, reference, name, format,
  continuous, manual, scope, next_number, is_active, created_at, updated_at
)
SELECT
  gen_random_uuid(), id, NULL, 'SUPPLIER_CREDIT', 'Supplier Credit',
  'SC-{YYYY}-{#####}', false, false, 'LEGAL_ENTITY', 1, true, NOW(), NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM number_sequences ns
  WHERE ns.tenant_id = t.id AND ns.reference = 'SUPPLIER_CREDIT'
    AND ns.legal_entity_id IS NULL
);

-- ── Purchase return (physical document) ──────────────────────────────────────

CREATE TABLE purchase_returns (
  id                  UUID        PRIMARY KEY,
  tenant_id           UUID        NOT NULL,
  legal_entity_id     UUID,
  return_number       TEXT        NOT NULL,
  supplier_id         UUID        NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  original_invoice_id UUID        NOT NULL REFERENCES vendor_invoices(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  warehouse_id        UUID        NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  status              TEXT        NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SHIPPED', 'CANCELLED')),
  reason              TEXT,
  requested_date      DATE        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  shipped_date        DATE,
  shipment_reference  TEXT,
  -- Ship voucher: Dr PURCHASE_ACCRUAL / Cr INVENTORY
  journal_entry_id    UUID        UNIQUE REFERENCES journal_entries(id) ON DELETE SET NULL ON UPDATE CASCADE,
  -- Self-referential reversal link; populated when a correction is raised
  reversal_return_id  UUID        UNIQUE REFERENCES purchase_returns(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  notes               TEXT,
  created_by          UUID,
  shipped_by          UUID,
  created_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX purchase_returns_tenant_id_return_number_key
  ON purchase_returns (tenant_id, return_number);
CREATE INDEX purchase_returns_tenant_id_supplier_id_status_idx
  ON purchase_returns (tenant_id, supplier_id, status);
CREATE INDEX purchase_returns_tenant_id_original_invoice_id_idx
  ON purchase_returns (tenant_id, original_invoice_id);

-- ── Purchase return line ──────────────────────────────────────────────────────

CREATE TABLE purchase_return_lines (
  id                        UUID        PRIMARY KEY,
  return_id                 UUID        NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE ON UPDATE CASCADE,
  original_invoice_line_id  UUID        NOT NULL REFERENCES vendor_invoice_lines(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  -- WORK-019 is deliberately physical-only; service credits are deferred.
  original_receipt_line_id  UUID        NOT NULL REFERENCES product_receipt_lines(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  product_id                UUID        NOT NULL REFERENCES products(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  variant_id                UUID        REFERENCES product_variants(id) ON DELETE SET NULL ON UPDATE CASCADE,
  source_location_id        UUID        NOT NULL REFERENCES warehouse_locations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Positive integer ("integer physical quantity" per design)
  quantity                  INTEGER     NOT NULL CHECK (quantity > 0),
  -- Frozen at return-creation time from the original invoice line
  frozen_gross_unit_cost    NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (frozen_gross_unit_cost >= 0),
  frozen_net_unit_cost      NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (frozen_net_unit_cost >= 0),
  gross_amount              NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (gross_amount >= 0),
  net_amount                NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (net_amount >= 0),
  tax_amount                NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  sort_order                INTEGER     NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX purchase_return_lines_return_id_original_invoice_line_id_or_key
  ON purchase_return_lines (return_id, original_invoice_line_id, original_receipt_line_id);

CREATE INDEX purchase_return_lines_return_id_idx       ON purchase_return_lines (return_id);
CREATE INDEX purchase_return_lines_original_invoice_line_id_idx ON purchase_return_lines (original_invoice_line_id);
CREATE INDEX purchase_return_lines_receipt_line_idx ON purchase_return_lines (original_receipt_line_id)
  WHERE original_receipt_line_id IS NOT NULL;

-- ── Supplier credit (AP document) ────────────────────────────────────────────

CREATE TABLE supplier_credits (
  id                     UUID        PRIMARY KEY,
  tenant_id              UUID        NOT NULL,
  legal_entity_id        UUID,
  credit_number          TEXT        NOT NULL,  -- internal, from SUPPLIER_CREDIT sequence
  external_credit_number TEXT,                  -- supplier's own fiscal credit-note ref
  supplier_id            UUID        NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  original_invoice_id    UUID        NOT NULL REFERENCES vendor_invoices(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  purchase_return_id     UUID        REFERENCES purchase_returns(id) ON DELETE SET NULL ON UPDATE CASCADE,
  credit_date            DATE        NOT NULL,
  posting_date           DATE        NOT NULL,
  status                 TEXT        NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
  currency               TEXT        NOT NULL DEFAULT 'BOB',
  exchange_rate          NUMERIC(18,8) NOT NULL DEFAULT 1,
  amount_functional      NUMERIC(14,2),
  net_amount             NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount             NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Credit voucher: Dr AP / Cr PURCHASE_ACCRUAL / Cr VAT_INPUT
  journal_entry_id       UUID        UNIQUE REFERENCES journal_entries(id) ON DELETE SET NULL ON UPDATE CASCADE,
  reversal_credit_id     UUID        UNIQUE REFERENCES supplier_credits(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  notes                  TEXT,
  created_by             UUID,
  posted_by              UUID,
  posted_at              TIMESTAMP(3),
  created_at             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP(3) NOT NULL
);

ALTER TABLE supplier_credits
  ADD CONSTRAINT supplier_credits_bob_exchange_rate_chk
    CHECK (currency <> 'BOB' OR exchange_rate = 1),
  ADD CONSTRAINT supplier_credits_amounts_chk
    CHECK (net_amount >= 0 AND tax_amount >= 0 AND total_amount > 0 AND total_amount = net_amount + tax_amount);

CREATE UNIQUE INDEX supplier_credits_tenant_id_credit_number_key
  ON supplier_credits (tenant_id, credit_number);
CREATE UNIQUE INDEX supplier_credits_tenant_id_supplier_id_external_credit_numb_key
  ON supplier_credits (tenant_id, supplier_id, external_credit_number);
CREATE INDEX supplier_credits_tenant_id_supplier_id_status_idx
  ON supplier_credits (tenant_id, supplier_id, status);
CREATE INDEX supplier_credits_tenant_id_original_invoice_id_idx
  ON supplier_credits (tenant_id, original_invoice_id);

-- ── Supplier credit line ──────────────────────────────────────────────────────

CREATE TABLE supplier_credit_lines (
  id                       UUID        PRIMARY KEY,
  credit_id                UUID        NOT NULL REFERENCES supplier_credits(id) ON DELETE CASCADE ON UPDATE CASCADE,
  original_invoice_line_id UUID        NOT NULL REFERENCES vendor_invoice_lines(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  return_line_id           UUID        REFERENCES purchase_return_lines(id) ON DELETE SET NULL ON UPDATE CASCADE,
  product_id               UUID        REFERENCES products(id) ON DELETE SET NULL ON UPDATE CASCADE,
  variant_id               UUID        REFERENCES product_variants(id) ON DELETE SET NULL ON UPDATE CASCADE,
  description              TEXT,
  quantity                 NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit_price               NUMERIC(12,4) NOT NULL DEFAULT 0,
  net_amount               NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount               NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_amount             NUMERIC(14,2) NOT NULL DEFAULT 0,
  sort_order               INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX supplier_credit_lines_credit_id_idx ON supplier_credit_lines (credit_id);
CREATE INDEX supplier_credit_lines_original_invoice_line_id_idx ON supplier_credit_lines (original_invoice_line_id);
