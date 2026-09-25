-- WORK-018 correction: the current service is intentionally BOB/BOB only.
-- A historical non-BOB posted invoice must never be silently absent from AP inquiry,
-- even when an earlier process happened to populate an FX snapshot. Stop the rollout
-- until a reviewed cross-currency opening-transaction migration exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM vendor_invoices vi
      JOIN tenants t ON t.id = vi.tenant_id
     WHERE vi.status = 'POSTED'
       AND (vi.currency <> 'BOB' OR t.currency_code <> 'BOB')
       AND NOT EXISTS (
         SELECT 1
           FROM vendor_open_transactions ot
          WHERE ot.tenant_id = vi.tenant_id
            AND ot.legal_entity_id IS NOT DISTINCT FROM vi.legal_entity_id
            AND ot.source_type = 'INVOICE'
            AND ot.source_id = vi.id
       )
  ) THEN
    RAISE EXCEPTION 'WORK-018 requires a reviewed cross-currency backfill before non-BOB posted invoices can enter AP inquiry';
  END IF;
END $$;
