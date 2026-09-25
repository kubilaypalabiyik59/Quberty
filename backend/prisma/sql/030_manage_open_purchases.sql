-- =============================================================================
-- 030  Manage open purchases
--
-- Preserves the original ordered quantity, records explicit cancelled remainder,
-- adds line delivery-date hooks, and stores immutable before/after change evidence.
-- Existing purchase history is not rewritten.
-- =============================================================================

ALTER TABLE purchase_order_lines
  ADD COLUMN cancelled_qty NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN requested_delivery_date DATE,
  ADD COLUMN confirmed_delivery_date DATE;

UPDATE purchase_order_lines pol
SET requested_delivery_date = po.expected_date
FROM purchase_orders po
WHERE po.id = pol.po_id
  AND po.expected_date IS NOT NULL;

ALTER TABLE purchase_order_lines
  ADD CONSTRAINT purchase_order_lines_cancelled_qty_chk
    CHECK (cancelled_qty >= 0 AND cancelled_qty <= quantity),
  ADD CONSTRAINT purchase_order_lines_commitment_qty_chk
    CHECK (GREATEST(received_qty, invoiced_qty) <= quantity - cancelled_qty);

CREATE TABLE purchase_order_changes (
  id                UUID        PRIMARY KEY,
  tenant_id         UUID        NOT NULL,
  purchase_order_id UUID        NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  line_id           UUID,
  action            TEXT        NOT NULL CHECK (action IN ('DELIVERY_UPDATED', 'LINE_REMAINDER_CANCELLED', 'ORDER_REMAINDER_CANCELLED')),
  reason            TEXT        NOT NULL CHECK (length(btrim(reason)) >= 3),
  before_snapshot   JSONB       NOT NULL,
  after_snapshot    JSONB       NOT NULL,
  changed_by        UUID,
  created_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX purchase_order_changes_tenant_id_purchase_order_id_created__idx
  ON purchase_order_changes (tenant_id, purchase_order_id, created_at);
