-- WORK-018: activate the BOB vendor-payment slice without inventing FX history.
-- Fail closed if a posted invoice falls outside the one currency pair this slice supports.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM vendor_invoices vi
      JOIN tenants t ON t.id = vi.tenant_id
     WHERE vi.status = 'POSTED'
       AND (vi.currency <> 'BOB' OR t.currency_code <> 'BOB')
       AND (vi.exchange_rate IS NULL OR vi.amount_functional IS NULL)
  ) THEN
    RAISE EXCEPTION 'WORK-018 cannot infer historical FX for non-BOB posted vendor invoices';
  END IF;
END $$;

UPDATE vendor_invoices vi
   SET exchange_rate = 1,
       amount_functional = vi.total_amount
  FROM tenants t
 WHERE t.id = vi.tenant_id
   AND t.currency_code = 'BOB'
   AND vi.currency = 'BOB'
   AND vi.status = 'POSTED'
   AND (vi.exchange_rate IS NULL OR vi.amount_functional IS NULL);

INSERT INTO vendor_open_transactions (
  id, tenant_id, legal_entity_id, supplier_id, source_type, source_id,
  direction, transaction_date, posting_date, currency, amount,
  exchange_rate, amount_functional, journal_entry_id, created_at
)
SELECT
  gen_random_uuid(), vi.tenant_id, vi.legal_entity_id, vi.supplier_id,
  'INVOICE', vi.id, 'CREDIT', vi.invoice_date, vi.posting_date, vi.currency,
  vi.total_amount, vi.exchange_rate, vi.amount_functional, vi.journal_entry_id, NOW()
FROM vendor_invoices vi
JOIN tenants t ON t.id = vi.tenant_id
WHERE vi.status = 'POSTED'
  AND t.currency_code = 'BOB'
  AND vi.currency = 'BOB'
  AND NOT EXISTS (
    SELECT 1 FROM vendor_open_transactions ot
     WHERE ot.tenant_id = vi.tenant_id
       AND ot.legal_entity_id IS NOT DISTINCT FROM vi.legal_entity_id
       AND ot.source_type = 'INVOICE'
       AND ot.source_id = vi.id
  );

-- Provision the internal vendor-payment document series for existing tenants.
INSERT INTO number_sequences (
  id, tenant_id, legal_entity_id, reference, name, format, continuous,
  manual, scope, next_number, current_year, is_active, created_at, updated_at
)
SELECT
  gen_random_uuid(), t.id, NULL, 'PAYMENT', 'Vendor payment',
  'VP-{YYYY}-{#####}', false, false, 'FISCAL_YEAR', 1,
  EXTRACT(YEAR FROM CURRENT_DATE)::integer, true, NOW(), NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM number_sequences ns
   WHERE ns.tenant_id = t.id
     AND ns.legal_entity_id IS NULL
     AND ns.reference = 'PAYMENT'
);
