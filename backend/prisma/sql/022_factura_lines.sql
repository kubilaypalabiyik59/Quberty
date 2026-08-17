-- 022 — Factura lines, and `invoiced_qty` on the sales order line
--
-- S2P_O2C_STATUS §6 item 1: "the biggest remaining O2C gap. `Factura` is
-- header-only; `iva_amount` / `it_amount` are columns on it. No `FacturaLine`, so
-- partial invoicing and line-level tax are both impossible."
--
-- This is the exact mirror of what migration 010 did on the purchase side, on the
-- revenue side.
--
-- ═══ WHAT IS AND IS NOT ESTABLISHED HERE ══════════════════════════════════
--
-- **[OPEN — NOT VERIFIED]** whether Bolivian law *requires* line detail on the
-- printed factura is listed as a blocking open question in HANDOVER §7 and is NOT
-- answered by this migration. Answering it needs the SIN's own normativa, and the
-- research scope for this workstream is Microsoft Learn plus this repository
-- (CLAUDE.md §5). **Nothing below should be read as a compliance claim.** If the
-- answer turns out to be "yes", this migration is a prerequisite for compliance; if
-- "no", it is still required for everything in the next paragraph.
--
-- What IS established, and is sufficient on its own:
--   · partial invoicing is impossible without lines — an order half delivered
--     cannot be half invoiced;
--   · per-line tax is REQUIRED before Turkey (KDV 20/10/1) or Germany (USt 19/7),
--     where an order holding one standard-rated and one reduced-rate product has no
--     single header rate. The hooks for this have existed on `sales_order_lines`
--     since migration 004 and have had nothing to attach to;
--   · a credit note is a fiscal document that has to say what it credits.
--
-- **[OFFICIAL — Ley 843 art. 5]**, already sourced from the law in
-- docs/process/BOLIVIA_TAX_BASIS.md: the tax "forma parte integrante del precio
-- neto de la venta … no se mostrará por separado". So a Bolivian factura LINE is
-- gross-inclusive exactly as the header is, and `line_total` is the invoiced amount
-- with the IVA inside it. That is why the tax columns record what was computed
-- rather than what was added on top.
--
-- ═══ THE HEADER TOTALS STAY ═══════════════════════════════════════════════
-- `facturas.subtotal / iva_amount / it_amount / total_amount` are NOT dropped and
-- NOT made derived views. A factura is a legal document that STATES a total; the
-- lines explain it. Recomputing the header from lines would let a schema change
-- silently restate an issued document. The service asserts they agree at issue time
-- and the verification script asserts it across every existing factura.

CREATE TABLE IF NOT EXISTS "factura_lines" (
    "id"         UUID PRIMARY KEY,
    "tenant_id"  UUID NOT NULL,
    "factura_id" UUID NOT NULL REFERENCES "facturas"("id") ON DELETE CASCADE,

    -- What this line invoices. Nullable because a manual factura (source_type
    -- MANUAL) has no order behind it — the same reason `VendorInvoiceLine` can
    -- exist without a receipt line.
    "sales_order_line_id" UUID REFERENCES "sales_order_lines"("id"),

    "product_id" UUID REFERENCES "products"("id"),
    "variant_id" UUID REFERENCES "product_variants"("id"),

    -- A SNAPSHOT of how the item was described when the document was issued.
    -- Not a join: renaming a product must never change what an issued factura says.
    -- Same reasoning as the posting-profile description and the item-group change
    -- guard from migration 008.
    "description" TEXT NOT NULL,
    "sku"         TEXT,

    "quantity"     DECIMAL(12,2) NOT NULL,
    "unit_price"   DECIMAL(12,4) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,

    -- **[OFFICIAL — Ley 843 art. 5]** the invoiced amount for this line, tax
    -- INSIDE it under the current Bolivian regime. Under a NET regime (Turkey,
    -- Germany, Bolivia after Ley 1733) this is the amount before tax and
    -- `tax_amount` is added on top. Which of the two applies is `TaxCode.base_kind`,
    -- not a column here — the arithmetic stays data.
    "line_total" DECIMAL(14,2) NOT NULL,

    -- Per-line tax. The columns migration 004 put on `sales_order_lines` as hooks,
    -- now with a document to live on.
    "item_tax_group_id" UUID REFERENCES "item_tax_groups"("id"),
    "tax_base"          DECIMAL(14,2),
    "tax_amount"        DECIMAL(14,2),
    -- Split out because IVA and IT behave differently and CLAUDE.md §6 says a model
    -- that lumps them cannot represent IT: IVA is recoverable output VAT, IT is a
    -- non-recoverable turnover tax on sales only.
    "vat_amount"      DECIMAL(14,2) NOT NULL DEFAULT 0,
    "turnover_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,

    "sort_order" INT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "factura_lines" DROP CONSTRAINT IF EXISTS "factura_lines_quantity_check";
ALTER TABLE "factura_lines"
    -- Negative quantities ARE allowed: a nota de crédito is a factura with negative
    -- lines, and the existing return path already writes a negative-total factura.
    -- What is refused is a line that invoices nothing at all.
    ADD CONSTRAINT "factura_lines_quantity_check" CHECK ("quantity" <> 0);

ALTER TABLE "factura_lines" DROP CONSTRAINT IF EXISTS "factura_lines_discount_check";
ALTER TABLE "factura_lines"
    ADD CONSTRAINT "factura_lines_discount_check"
    CHECK ("discount_pct" >= 0 AND "discount_pct" <= 100);

CREATE INDEX IF NOT EXISTS "factura_lines_factura_idx"
    ON "factura_lines" ("factura_id", "sort_order");
CREATE INDEX IF NOT EXISTS "factura_lines_tenant_idx"
    ON "factura_lines" ("tenant_id");
CREATE INDEX IF NOT EXISTS "factura_lines_order_line_idx"
    ON "factura_lines" ("sales_order_line_id");

-- ── The accumulator ────────────────────────────────────────────────────────
-- `PurchaseOrderLine` has carried `received_qty` and `invoiced_qty` since migration
-- 010 and that is what makes "received but not invoiced" answerable per line. The
-- sales side had neither. `delivered_qty` is added at the same time because the
-- shipment document that would maintain it is the next piece of O2C, and adding one
-- accumulator now and its twin later means two migrations against the same table.
ALTER TABLE "sales_order_lines" ADD COLUMN IF NOT EXISTS "invoiced_qty"  DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "sales_order_lines" ADD COLUMN IF NOT EXISTS "delivered_qty" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Backfill: a factura already exists for these orders, so their lines are fully
-- invoiced. This is derivable and therefore backfilled — unlike a site, which was
-- left NULL because inventing one would put revenue in a city it did not happen in.
-- Here the fact "this order was invoiced in full" is recorded by `invoice_id`.
UPDATE "sales_order_lines" sol
SET "invoiced_qty" = sol."quantity"
FROM "sales_orders" so
WHERE so."id" = sol."order_id"
  AND so."invoice_id" IS NOT NULL
  AND sol."invoiced_qty" = 0;

-- Delivered: an order that reached SHIPPED, COMPLETED or RETURNED has left the
-- warehouse in full under the current single-step behaviour. Partial delivery is
-- not representable today — there are no shipment lines — so there is nothing
-- finer to derive and nothing is invented.
UPDATE "sales_order_lines" sol
SET "delivered_qty" = sol."quantity"
FROM "sales_orders" so
WHERE so."id" = sol."order_id"
  AND so."status" IN ('SHIPPED', 'COMPLETED', 'RETURNED')
  AND sol."delivered_qty" = 0;
