-- =============================================================================
-- 031  Tenant-scoped document numbers
--
-- Seven document-number columns were globally unique. Every generator is per
-- tenant, so the second tenant's first document deterministically collided with
-- the first tenant's (PO-2026-00001, JE-2026-00001, ...). Document numbers are
-- unique within their scope, never globally — the D365 number-sequence model.
--
-- Loosening a global unique to (tenant_id, col) cannot fail on existing data;
-- the duplicate check below is defensive.
--
-- Also moves purchase-order numbering from order_counters onto the
-- PURCHASE_ORDER number sequence, seeded above every number already issued.
--
-- Design reference: WORK-023 in docs/collaboration/CODEX_CLAUDE_WORKLOG.md.
-- =============================================================================

DO $$
DECLARE
  dup text;
BEGIN
  SELECT string_agg(tbl, ', ') INTO dup FROM (
    SELECT 'purchase_orders'  AS tbl FROM purchase_orders  GROUP BY tenant_id, po_number       HAVING count(*) > 1
    UNION ALL
    SELECT 'warehouse_work'          FROM warehouse_work   GROUP BY tenant_id, work_id_code    HAVING count(*) > 1
    UNION ALL
    SELECT 'arrival_journals'        FROM arrival_journals GROUP BY tenant_id, journal_number  HAVING count(*) > 1
    UNION ALL
    SELECT 'journal_entries'         FROM journal_entries  GROUP BY tenant_id, entry_number    HAVING count(*) > 1
    UNION ALL
    SELECT 'sales_orders'            FROM sales_orders     GROUP BY tenant_id, order_number    HAVING count(*) > 1
    UNION ALL
    SELECT 'shipments'               FROM shipments        GROUP BY tenant_id, shipment_number HAVING count(*) > 1
    UNION ALL
    SELECT 'inventory_counts'        FROM inventory_counts GROUP BY tenant_id, reference       HAVING count(*) > 1
  ) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION '031: duplicate document numbers within a tenant in: %', dup;
  END IF;
END $$;

-- ── Unique within the tenant, not globally ───────────────────────────────────

DROP INDEX "purchase_orders_po_number_key";
CREATE UNIQUE INDEX "purchase_orders_tenant_id_po_number_key" ON "purchase_orders"("tenant_id", "po_number");

DROP INDEX "warehouse_work_work_id_code_key";
CREATE UNIQUE INDEX "warehouse_work_tenant_id_work_id_code_key" ON "warehouse_work"("tenant_id", "work_id_code");

DROP INDEX "arrival_journals_journal_number_key";
CREATE UNIQUE INDEX "arrival_journals_tenant_id_journal_number_key" ON "arrival_journals"("tenant_id", "journal_number");

DROP INDEX "journal_entries_entry_number_key";
CREATE UNIQUE INDEX "journal_entries_tenant_id_entry_number_key" ON "journal_entries"("tenant_id", "entry_number");

DROP INDEX "sales_orders_order_number_key";
CREATE UNIQUE INDEX "sales_orders_tenant_id_order_number_key" ON "sales_orders"("tenant_id", "order_number");

DROP INDEX "shipments_shipment_number_key";
CREATE UNIQUE INDEX "shipments_tenant_id_shipment_number_key" ON "shipments"("tenant_id", "shipment_number");

DROP INDEX "inventory_counts_reference_key";
CREATE UNIQUE INDEX "inventory_counts_tenant_id_reference_key" ON "inventory_counts"("tenant_id", "reference");

-- ── Purchase-order number sequence ───────────────────────────────────────────
-- Non-continuous (an internal handle, no legal gaplessness requirement) and
-- LEGAL_ENTITY scope (never resets), which is exactly how order_counters numbered
-- purchase orders. Seeded above both the counter and the highest suffix already
-- issued, so the first allocated number can never collide. The suffix is taken
-- by regex, not by casting a split segment, so harness leftovers with other
-- formats are ignored rather than breaking the cast.

INSERT INTO number_sequences (
  id, tenant_id, legal_entity_id, reference, name, format,
  continuous, manual, scope, next_number, is_active, created_at, updated_at
)
SELECT
  gen_random_uuid(), t.id, NULL, 'PURCHASE_ORDER', 'Purchase order',
  'PO-{YYYY}-{#####}', false, false, 'LEGAL_ENTITY',
  GREATEST(
    COALESCE((SELECT oc.last_number FROM order_counters oc
               WHERE oc.tenant_id = t.id AND oc.doc_type = 'PO'), 0),
    COALESCE((SELECT MAX((substring(po.po_number FROM '^PO-[0-9]{4}-([0-9]+)$'))::bigint)
                FROM purchase_orders po
               WHERE po.tenant_id = t.id), 0)
  ) + 1,
  true, NOW(), NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM number_sequences ns
  WHERE ns.tenant_id = t.id AND ns.reference = 'PURCHASE_ORDER'
    AND ns.legal_entity_id IS NULL
);
