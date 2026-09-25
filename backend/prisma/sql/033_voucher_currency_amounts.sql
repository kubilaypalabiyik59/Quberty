-- =============================================================================
-- 033  Voucher transaction / accounting / reporting amounts
--
-- Every journal line now states what it was transacted in, what it is accounted
-- in, and what it is reported in, with the rate used for each. **[OFFICIAL]** both
-- the accounting and the reporting amount are translated FROM the transaction
-- amount, and a voucher must balance in all of them:
--   learn.microsoft.com/dynamics365/finance/general-ledger/dual-currency
--   learn.microsoft.com/troubleshoot/dynamics-365/finance/general-ledger/posting-fail-imbalance
--
-- `debit_amount` / `credit_amount` keep their name and their meaning: they are the
-- ACCOUNTING amounts, so every existing report is unaffected.
--
-- The AP subledger gets the same reporting basis. Settlements carry it too, even
-- though nothing computes realized FX yet: a settlement is where WORK-026 will,
-- and a later backfill would have to guess a rate that is knowable today.
--
-- No new column has a default. A rate defaulting to 1 is exactly the defect
-- WORK-024a removed from the vendor-invoice path; a writer that forgets a value
-- must fail rather than post at par.
--
-- The backfill is an identity: every tenant's reporting currency equals its
-- accounting currency (024a refuses anything else), and every existing subledger
-- row is already at rate 1. Nothing is translated and nothing is guessed.
--
-- Design reference: WORK-024b, docs/process/WORK-024_CURRENCY_FOUNDATION.md §12a.
--
-- Manual rollback (for reference only; not executed):
--   ALTER TABLE journal_lines
--     DROP CONSTRAINT journal_lines_transaction_currency_code_fkey,
--     DROP CONSTRAINT journal_lines_accounting_rate_positive_chk,
--     DROP CONSTRAINT journal_lines_reporting_rate_positive_chk,
--     DROP COLUMN transaction_currency_code, DROP COLUMN transaction_debit_amount,
--     DROP COLUMN transaction_credit_amount, DROP COLUMN reporting_debit_amount,
--     DROP COLUMN reporting_credit_amount, DROP COLUMN accounting_exchange_rate,
--     DROP COLUMN reporting_exchange_rate;
--   ALTER TABLE journal_entries
--     DROP CONSTRAINT journal_entries_tenant_id_accounting_currency_code_fkey,
--     DROP CONSTRAINT journal_entries_tenant_id_reporting_currency_code_fkey,
--     DROP CONSTRAINT journal_entries_tenant_id_accounting_rate_type_id_fkey,
--     DROP CONSTRAINT journal_entries_tenant_id_reporting_rate_type_id_fkey,
--     DROP COLUMN accounting_currency_code, DROP COLUMN reporting_currency_code,
--     DROP COLUMN exchange_rate_date, DROP COLUMN accounting_rate_type_id,
--     DROP COLUMN reporting_rate_type_id;
--   ALTER TABLE vendor_open_transactions
--     DROP CONSTRAINT vendor_open_transactions_reporting_rate_positive_chk,
--     DROP COLUMN amount_reporting, DROP COLUMN exchange_rate_reporting;
--   ALTER TABLE vendor_settlements
--     DROP CONSTRAINT vendor_settlements_reporting_rate_positive_chk,
--     DROP COLUMN amount_reporting, DROP COLUMN exchange_rate_reporting;
-- =============================================================================

-- ── Pre-checks: stop rather than guess ───────────────────────────────────────

DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(t.slug || ' (' || fp.accounting_currency_code || '/' || fp.reporting_currency_code || ')', ', ')
    INTO bad
    FROM finance_parameters fp
    JOIN tenants t ON t.id = fp.tenant_id
   WHERE fp.reporting_currency_code <> fp.accounting_currency_code;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '033: a ledger already reports in another currency (%). The identity backfill below would be wrong; translate that history deliberately first.', bad;
  END IF;

  SELECT string_agg(DISTINCT t.slug, ', ') INTO bad
    FROM journal_entries je
    JOIN tenants t ON t.id = je.tenant_id
   WHERE NOT EXISTS (
     SELECT 1 FROM finance_parameters fp
      WHERE fp.tenant_id = je.tenant_id AND fp.legal_entity_id IS NULL
   );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '033: tenants with vouchers but no tenant-level ledger: %. Provision them first.', bad;
  END IF;
END $$;

-- ── Columns (nullable first, so the backfill can fill them) ──────────────────

ALTER TABLE "journal_entries"
  ADD COLUMN "accounting_currency_code" TEXT,
  ADD COLUMN "reporting_currency_code" TEXT,
  ADD COLUMN "exchange_rate_date" DATE,
  ADD COLUMN "accounting_rate_type_id" UUID,
  ADD COLUMN "reporting_rate_type_id" UUID;

ALTER TABLE "journal_lines"
  ADD COLUMN "transaction_currency_code" TEXT,
  ADD COLUMN "transaction_debit_amount" DECIMAL(14,2),
  ADD COLUMN "transaction_credit_amount" DECIMAL(14,2),
  ADD COLUMN "reporting_debit_amount" DECIMAL(14,2),
  ADD COLUMN "reporting_credit_amount" DECIMAL(14,2),
  ADD COLUMN "accounting_exchange_rate" DECIMAL(18,8),
  ADD COLUMN "reporting_exchange_rate" DECIMAL(18,8);

ALTER TABLE "vendor_open_transactions"
  ADD COLUMN "amount_reporting" DECIMAL(14,2),
  ADD COLUMN "exchange_rate_reporting" DECIMAL(18,8);

ALTER TABLE "vendor_settlements"
  ADD COLUMN "amount_reporting" DECIMAL(14,2),
  ADD COLUMN "exchange_rate_reporting" DECIMAL(18,8);

-- ── Backfill: an identity, taken from the ledger and the rows themselves ─────
-- The rate types stay NULL on historical vouchers: nothing was ever quoted for
-- them, and naming one would be a fabrication.

UPDATE journal_entries je
   SET accounting_currency_code = fp.accounting_currency_code,
       reporting_currency_code  = fp.reporting_currency_code,
       exchange_rate_date       = je.entry_date
  FROM finance_parameters fp
 WHERE fp.tenant_id = je.tenant_id AND fp.legal_entity_id IS NULL;

UPDATE journal_lines jl
   SET transaction_currency_code = je.accounting_currency_code,
       transaction_debit_amount  = jl.debit_amount,
       transaction_credit_amount = jl.credit_amount,
       reporting_debit_amount    = jl.debit_amount,
       reporting_credit_amount   = jl.credit_amount,
       accounting_exchange_rate  = 1,
       reporting_exchange_rate   = 1
  FROM journal_entries je
 WHERE je.id = jl.journal_entry_id;

UPDATE vendor_open_transactions
   SET amount_reporting        = amount_functional,
       exchange_rate_reporting = exchange_rate;

UPDATE vendor_settlements
   SET amount_reporting        = amount_functional,
       exchange_rate_reporting = exchange_rate;

-- ── Post-check: a readable message instead of an opaque SET NOT NULL failure ─

DO $$
DECLARE
  entries bigint;
  lines   bigint;
  vot     bigint;
  vs      bigint;
BEGIN
  SELECT count(*) INTO entries FROM journal_entries WHERE accounting_currency_code IS NULL OR exchange_rate_date IS NULL;
  SELECT count(*) INTO lines   FROM journal_lines   WHERE transaction_currency_code IS NULL OR accounting_exchange_rate IS NULL;
  SELECT count(*) INTO vot     FROM vendor_open_transactions WHERE amount_reporting IS NULL;
  SELECT count(*) INTO vs      FROM vendor_settlements       WHERE amount_reporting IS NULL;
  IF entries > 0 OR lines > 0 OR vot > 0 OR vs > 0 THEN
    RAISE EXCEPTION '033: rows left unfilled — journal_entries %, journal_lines %, vendor_open_transactions %, vendor_settlements %. An orphan row is the usual cause.',
      entries, lines, vot, vs;
  END IF;
END $$;

ALTER TABLE journal_entries
  ALTER COLUMN accounting_currency_code SET NOT NULL,
  ALTER COLUMN reporting_currency_code  SET NOT NULL,
  ALTER COLUMN exchange_rate_date       SET NOT NULL;

ALTER TABLE journal_lines
  ALTER COLUMN transaction_currency_code SET NOT NULL,
  ALTER COLUMN transaction_debit_amount  SET NOT NULL,
  ALTER COLUMN transaction_credit_amount SET NOT NULL,
  ALTER COLUMN reporting_debit_amount    SET NOT NULL,
  ALTER COLUMN reporting_credit_amount   SET NOT NULL,
  ALTER COLUMN accounting_exchange_rate  SET NOT NULL,
  ALTER COLUMN reporting_exchange_rate   SET NOT NULL;

ALTER TABLE vendor_open_transactions
  ALTER COLUMN amount_reporting        SET NOT NULL,
  ALTER COLUMN exchange_rate_reporting SET NOT NULL;

ALTER TABLE vendor_settlements
  ALTER COLUMN amount_reporting        SET NOT NULL,
  ALTER COLUMN exchange_rate_reporting SET NOT NULL;

-- ── CHECKs ───────────────────────────────────────────────────────────────────
-- Rates only. No sign CHECK on amounts: STORNO corrections negate the amounts in
-- place, which is what keeps turnover truthful. Rates are never negated, in either
-- correction method, so a positive-rate rule is safe.

ALTER TABLE journal_lines
  ADD CONSTRAINT journal_lines_accounting_rate_positive_chk CHECK (accounting_exchange_rate > 0),
  ADD CONSTRAINT journal_lines_reporting_rate_positive_chk  CHECK (reporting_exchange_rate > 0);

ALTER TABLE vendor_open_transactions
  ADD CONSTRAINT vendor_open_transactions_reporting_rate_positive_chk CHECK (exchange_rate_reporting > 0);

ALTER TABLE vendor_settlements
  ADD CONSTRAINT vendor_settlements_reporting_rate_positive_chk CHECK (exchange_rate_reporting > 0);

-- ── Foreign keys ─────────────────────────────────────────────────────────────
-- Tenant-composite on the entry, so the database refuses another tenant's currency
-- or rate type. `journal_lines` carries no tenant_id, so its currency reference is
-- to the shared ISO table; that the currency is active for the tenant is enforced
-- by the journal service.

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_accounting_currency_code_fkey" FOREIGN KEY ("tenant_id", "accounting_currency_code") REFERENCES "tenant_currencies"("tenant_id", "currency_code") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_reporting_currency_code_fkey" FOREIGN KEY ("tenant_id", "reporting_currency_code") REFERENCES "tenant_currencies"("tenant_id", "currency_code") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_accounting_rate_type_id_fkey" FOREIGN KEY ("tenant_id", "accounting_rate_type_id") REFERENCES "exchange_rate_types"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_reporting_rate_type_id_fkey" FOREIGN KEY ("tenant_id", "reporting_rate_type_id") REFERENCES "exchange_rate_types"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_transaction_currency_code_fkey" FOREIGN KEY ("transaction_currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
