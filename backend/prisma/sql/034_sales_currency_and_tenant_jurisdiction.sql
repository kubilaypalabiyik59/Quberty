-- =============================================================================
-- 034  Sales-side currency defaults, the tenant mirror, and jurisdiction
--
-- Removes the last country defaults from the document tables and the second
-- source of truth for the ledger currency:
--
--   * seven `currency` columns lose their 'BOB' default. Sales orders, leads,
--     opportunities, quotations, requisitions and RFQs now take the currency the
--     ledger decides, resolved in the services the same way purchasing already
--     does since WORK-024a. A POS sale writes it explicitly.
--   * `tenants.currency_code` is dropped. It mirrored
--     `finance_parameters.accounting_currency_code`, and the two diverging is
--     exactly what WORK-024 was written to end. The one consumer was the factura
--     currency snapshot, which now reads the ledger — it is a posting path, so
--     failing closed there is correct.
--   * `tenants.country` is added: which jurisdiction this company files in.
--     Provisioning selects the chart of accounts from it instead of from the
--     currency, because Ecuador, Panama and El Salvador all use USD and none of
--     them files the same chart, while Turkey's TDHP is mandated by law rather
--     than by the lira. Nullable, because existing tenants have none and deriving
--     one from the currency is the inference being removed.
--
-- This migration is metadata-only by design: no row is rewritten, no column is
-- made NOT NULL, nothing takes a long exclusive lock. That is the lesson recorded
-- from 033's unbounded UPDATE.
--
-- Design reference: WORK-025a, docs/process/WORK-025_CURRENCY_LITERAL_SWEEP.md.
--
-- Manual rollback (for reference only; not executed):
--   ALTER TABLE tenants ADD COLUMN currency_code TEXT;
--   UPDATE tenants t SET currency_code = fp.accounting_currency_code
--     FROM finance_parameters fp
--    WHERE fp.tenant_id = t.id AND fp.legal_entity_id IS NULL;
--   ALTER TABLE tenants ALTER COLUMN currency_code SET NOT NULL, DROP COLUMN country;
--   ALTER TABLE sales_orders ALTER COLUMN currency SET DEFAULT 'BOB';  (likewise
--     leads, opportunities, sales_quotations, purchase_requisitions, rfq_cases,
--     rfq_requests)
-- =============================================================================

-- ── Pre-checks: stop rather than guess ───────────────────────────────────────

DO $$
DECLARE
  bad text;
BEGIN
  -- The mirror is about to be dropped, so it must agree with the ledger first.
  SELECT string_agg(t.slug || ' (' || t.currency_code || ' vs ' || fp.accounting_currency_code || ')', ', ')
    INTO bad
    FROM tenants t
    JOIN finance_parameters fp ON fp.tenant_id = t.id AND fp.legal_entity_id IS NULL
   WHERE t.currency_code <> fp.accounting_currency_code;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '034: tenant currency mirror disagrees with the ledger: %. Resolve which is the accounting currency before dropping the mirror.', bad;
  END IF;

  SELECT string_agg(t.slug, ', ') INTO bad
    FROM tenants t
   WHERE NOT EXISTS (
     SELECT 1 FROM finance_parameters fp
      WHERE fp.tenant_id = t.id AND fp.legal_entity_id IS NULL
   );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '034: tenants with no ledger: %. They would lose their only currency with the mirror.', bad;
  END IF;

  -- A document in another currency would keep a value the services can no longer
  -- produce, and nothing here may translate it.
  SELECT string_agg(DISTINCT x.label, ', ') INTO bad FROM (
    SELECT 'sales_orders' AS label FROM sales_orders s
      JOIN finance_parameters fp ON fp.tenant_id = s.tenant_id AND fp.legal_entity_id IS NULL
     WHERE s.currency <> fp.accounting_currency_code
    UNION ALL
    SELECT 'leads' FROM leads s
      JOIN finance_parameters fp ON fp.tenant_id = s.tenant_id AND fp.legal_entity_id IS NULL
     WHERE s.currency <> fp.accounting_currency_code
    UNION ALL
    SELECT 'opportunities' FROM opportunities s
      JOIN finance_parameters fp ON fp.tenant_id = s.tenant_id AND fp.legal_entity_id IS NULL
     WHERE s.currency <> fp.accounting_currency_code
    UNION ALL
    SELECT 'sales_quotations' FROM sales_quotations s
      JOIN finance_parameters fp ON fp.tenant_id = s.tenant_id AND fp.legal_entity_id IS NULL
     WHERE s.currency <> fp.accounting_currency_code
    UNION ALL
    SELECT 'purchase_requisitions' FROM purchase_requisitions s
      JOIN finance_parameters fp ON fp.tenant_id = s.tenant_id AND fp.legal_entity_id IS NULL
     WHERE s.currency <> fp.accounting_currency_code
    UNION ALL
    SELECT 'rfq_cases' FROM rfq_cases s
      JOIN finance_parameters fp ON fp.tenant_id = s.tenant_id AND fp.legal_entity_id IS NULL
     WHERE s.currency <> fp.accounting_currency_code
    UNION ALL
    SELECT 'rfq_requests' FROM rfq_requests s
      JOIN finance_parameters fp ON fp.tenant_id = s.tenant_id AND fp.legal_entity_id IS NULL
     WHERE s.currency <> fp.accounting_currency_code
  ) x;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '034: documents in a currency other than their ledger''s accounting currency exist in: %. They need a reviewed decision, not a default drop.', bad;
  END IF;
END $$;

-- ── Jurisdiction, and the end of the currency mirror ─────────────────────────

ALTER TABLE "tenants" ADD COLUMN "country" TEXT;

-- Seed the jurisdiction from the tenant's own site addresses where they agree.
-- A tenant whose sites disagree, or has none, is left NULL: provisioning then
-- refuses to pick a statutory chart rather than guessing one.
UPDATE tenants t
   SET country = s.country
  FROM (
    SELECT tenant_id, min(country) AS country
      FROM sites
     WHERE country IS NOT NULL AND country <> ''
     GROUP BY tenant_id
    HAVING count(DISTINCT country) = 1
  ) s
 WHERE s.tenant_id = t.id;

ALTER TABLE "tenants" DROP COLUMN "currency_code";

-- ── No country defaults on the document tables ───────────────────────────────

ALTER TABLE "sales_orders" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "leads" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "opportunities" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "sales_quotations" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "purchase_requisitions" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "rfq_cases" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "rfq_requests" ALTER COLUMN "currency" DROP DEFAULT;
