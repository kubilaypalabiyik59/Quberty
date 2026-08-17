-- =============================================================================
-- 011 — Inventory dimensions on demand documents, and a promised delivery date
--
-- WHY
-- Two problems found by running the reports page, not by reading it.
--
-- 1. "Revenue by City" has never returned a row. `getSalesByCity` inner-joins
--    sites, and site_id is NULL on all 51 sales orders. The first diagnosis was
--    that the order needed a site captured on it; Kubi corrected that:
--    SITE IS THE WAREHOUSE'S SITE. `warehouses.site_id` is NOT NULL, so an
--    order's site is DERIVED, never entered. The real gap is one level down —
--    warehouse_id is optional and unenforced, and the old direct sales path
--    populates it on 7 of 48 orders.
--
--    Microsoft's model is the same shape, and it is why the switch below is a
--    parameter rather than a hardcoded NOT NULL:
--
--      "The site dimension is mandatory, and you can set the warehouse
--       dimension to be mandatory. When a dimension is mandatory, a dimension
--       value must be entered on all inventory transactions."
--      learn.microsoft.com/dynamics365/supply-chain/master-planning/master-plan-multisite-functionality
--
--      "the demand order carries the mandatory dimensions of site, warehouse,
--       and inventory status […] the demand order is expected to indicate where
--       the order must be shipped from (that is, what site and warehouse)."
--      learn.microsoft.com/dynamics365/supply-chain/warehousing/flexible-warehouse-level-dimension-reservation
--
--    That second sentence is also the description of a live defect: the return
--    path in sales.routes.ts skips its warehouse filter when the order has none
--    and restores stock to whatever row findFirst reaches first. On a tenant
--    with three warehouses that silently misplaces inventory.
--
-- 2. Sales orders have no promised delivery date, so the CEO panel's health
--    ratio — elapsed / planned — has no denominator on the O2C half and every
--    agent would render as "unknown". Purchase orders already have
--    `expected_date`; this is its sales-side counterpart, and it mirrors D365's
--    RequestedReceiptDate.
--
-- SHAPE
-- Additive only. No column is dropped, no column becomes NOT NULL, and the new
-- switch defaults to FALSE so an unprovisioned tenant behaves exactly as it
-- does today. Same pattern as `require_balanced_posting`: build the enforcement,
-- ship it off, turn it on per tenant once the data supports it.
--
-- No BEGIN/COMMIT and no DO$$ blocks: scripts/applyMigration.ts splits the file
-- on `;` and wraps the whole thing in one transaction already, so an explicit
-- BEGIN would nest and a DO block's inner semicolons would split mid-body. The
-- constraint adds are therefore plain and will fail loudly if this is applied
-- twice, which is the right outcome for a migration that should run once.
-- =============================================================================

-- ── 1. The promised delivery date ────────────────────────────────────────────
-- Nullable on purpose. Orders without one stay honestly "unknown" on the panel
-- rather than being given a fabricated window that would paint them green.
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS requested_delivery_date DATE;

COMMENT ON COLUMN sales_orders.requested_delivery_date IS
  'Date promised to the customer. Counterpart of purchase_orders.expected_date and of D365 RequestedReceiptDate. NULL means no commitment was recorded — health reports as unknown, never as on-time.';

-- ── 2. Warehouse defaulting and enforcement, as parameters ───────────────────
ALTER TABLE sales_parameters
  ADD COLUMN IF NOT EXISTS default_warehouse_id UUID,
  ADD COLUMN IF NOT EXISTS require_warehouse_on_sales_order BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE sales_parameters
  ADD CONSTRAINT sales_parameters_default_warehouse_id_fkey
  FOREIGN KEY (default_warehouse_id) REFERENCES warehouses(id);

COMMENT ON COLUMN sales_parameters.default_warehouse_id IS
  'Fallback warehouse when nothing more specific is known. Consulted after the explicit request value and the POS register session, before the sole-warehouse shortcut.';
COMMENT ON COLUMN sales_parameters.require_warehouse_on_sales_order IS
  'D365 makes the site dimension mandatory always and the warehouse dimension mandatory by choice. FALSE keeps today behaviour. TRUE refuses to create a demand document that cannot say where it ships from. (No semicolons in these strings — applyMigration.ts splits the file on them.)';

-- ── 3. Site on purchase orders ───────────────────────────────────────────────
-- purchase_orders.warehouse_id is already NOT NULL, so this backfills to 100%
-- and the S2P half of the panel gets geography for free. Without it, one process
-- can be placed on a map and the other cannot.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS site_id UUID;

ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_site_id_fkey
  FOREIGN KEY (site_id) REFERENCES sites(id);

COMMENT ON COLUMN purchase_orders.site_id IS
  'Derived from warehouse_id, never entered. Denormalised so geographic queries do not have to join through warehouses. Kept in step by inventoryDimension.service.ts.';

-- ── 4. Backfill site from the warehouse it already belongs to ────────────────
-- This can only fix rows that HAVE a warehouse. Rows without one are left NULL
-- deliberately: there is nothing to derive from, and inventing a site would put
-- revenue in a city it did not happen in. They report as unattributed.
UPDATE sales_orders o
   SET site_id = w.site_id
  FROM warehouses w
 WHERE w.id = o.warehouse_id
   AND o.site_id IS NULL;

UPDATE sales_quotations q
   SET site_id = w.site_id
  FROM warehouses w
 WHERE w.id = q.warehouse_id
   AND q.site_id IS NULL;

UPDATE purchase_requisitions r
   SET site_id = w.site_id
  FROM warehouses w
 WHERE w.id = r.warehouse_id
   AND r.site_id IS NULL;

UPDATE purchase_orders p
   SET site_id = w.site_id
  FROM warehouses w
 WHERE w.id = p.warehouse_id
   AND p.site_id IS NULL;

-- ── 5. Indexes for the panel's grouping queries ──────────────────────────────
CREATE INDEX IF NOT EXISTS sales_orders_tenant_site_idx      ON sales_orders (tenant_id, site_id);
CREATE INDEX IF NOT EXISTS sales_orders_tenant_warehouse_idx ON sales_orders (tenant_id, warehouse_id);
CREATE INDEX IF NOT EXISTS purchase_orders_tenant_site_idx   ON purchase_orders (tenant_id, site_id);

-- ── Verification (run separately; not part of the transaction) ───────────────
-- SELECT 'sales_orders' t, COUNT(*) total, COUNT(warehouse_id) wh, COUNT(site_id) site FROM sales_orders
-- UNION ALL SELECT 'purchase_orders', COUNT(*), COUNT(warehouse_id), COUNT(site_id) FROM purchase_orders
-- UNION ALL SELECT 'sales_quotations', COUNT(*), COUNT(warehouse_id), COUNT(site_id) FROM sales_quotations
-- UNION ALL SELECT 'purchase_requisitions', COUNT(*), COUNT(warehouse_id), COUNT(site_id) FROM purchase_requisitions;
--
-- Expect: site count == warehouse count on every row of the result.
