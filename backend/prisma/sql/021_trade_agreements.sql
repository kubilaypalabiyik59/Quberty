-- 021 — Trade agreements (vendor and customer price lists)
--
-- Item 6 of MODULE_FIT_ANALYSIS §7, and item 13 of the S2P table in
-- S2P_O2C_STATUS: "Purchase pricing / trade agreements — `unit_cost` typed by hand".
--
-- ── The shape, from Learn ───────────────────────────────────────────────────
-- **[OFFICIAL]** a trade agreement journal line is identified by a PARTY axis and a
-- PRODUCT axis, each of which can be *Table* (this one), *Group*, or *All*, plus a
-- quantity break and a date range:
--   learn.microsoft.com/dynamics365/supply-chain/sales-marketing/tasks/create-new-trade-agreement
--
-- **[OFFICIAL]** Business Central states the same combination for purchases: a
-- special price applies "if a certain combination of vendor, item, minimum
-- quantity, unit of measure, or starting/ending date exists".
--   learn.microsoft.com/dynamics365/business-central/purchasing-how-record-purchase-price-discount-payment-agreements
--
-- This is the SAME most-specific-first matrix the posting profile resolver already
-- implements (ITEM → ITEM_GROUP → PARTY → PARTY_GROUP → ALL), which is why the
-- scope columns are named to match rather than inventing a second vocabulary.
--
-- ── One rule taken verbatim, because it is a real constraint ────────────────
-- **[OFFICIAL]** "When you're entering a trade agreement of type Price (sales), you
-- must select Table in the Product code type field. This requirement exists because
-- A PRICE IS AN ABSOLUTE VALUE and can't be the same for all products or a group of
-- products."
--
-- So: a PRICE row must name a specific product. A DISCOUNT row, being a
-- percentage, may name a group or all. That is enforced by a CHECK rather than left
-- to the UI, because a price against a product group is not a policy choice — it is
-- meaningless.
--
-- ── What is deliberately CUT ────────────────────────────────────────────────
-- **[OFFICIAL]** D365 enters trade agreements through a JOURNAL that is created,
-- validated and POSTED into the live price table. That is three screens and a
-- posting step before a shop can record "this vendor charges Bs 40 a pair", and the
-- audit value it buys is already provided here by `valid_from` / `valid_to`: a
-- superseded agreement is closed, never edited, so history is preserved without a
-- journal.
--   Hook if it is ever wanted: an `agreement_journal_id` on this table plus a
--   journal header table. Rows already carry their own validity, so a journal would
--   be a batching and approval mechanism over them, not a change of shape.
--
-- Also CUT: multiline and total discounts (they are order-level, and we have no
-- discount engine at all yet), price attributes and Unified Pricing Management
-- (enterprise-scale), and currency — the tenant has one currency and there is no
-- exchange-rate table, which is a known gap tracked separately. `currency` is
-- stored so a row states its own unit rather than inheriting an assumption.

CREATE TABLE IF NOT EXISTS "trade_agreements" (
    "id"              UUID PRIMARY KEY,
    "tenant_id"       UUID NOT NULL,
    "legal_entity_id" UUID,

    -- **[OFFICIAL]** D365's `relation`: Price (sales) | Price (purch) | Line discount.
    -- Split into the two questions it actually asks, because "which side" and "price
    -- or discount" are independent and a single enum of four values hides that.
    "side"            TEXT NOT NULL,              -- SALES | PURCHASE
    "agreement_type"  TEXT NOT NULL DEFAULT 'PRICE',  -- PRICE | LINE_DISCOUNT

    -- ── The party axis. **[OFFICIAL]** Table | Group | All ──────────────────
    "party_scope"     TEXT NOT NULL DEFAULT 'ALL',   -- PARTY | PARTY_GROUP | ALL
    "customer_id"     UUID REFERENCES "customers"("id") ON DELETE CASCADE,
    "supplier_id"     UUID REFERENCES "suppliers"("id") ON DELETE CASCADE,
    -- PARTY_GROUP has no master yet — customer/vendor groups are still an open item
    -- in S2P_O2C_STATUS §4. The column is the hook; the resolver refuses the scope
    -- until the master exists, rather than silently never matching.
    "party_group_id"  UUID,

    -- ── The product axis ───────────────────────────────────────────────────
    "product_scope"   TEXT NOT NULL DEFAULT 'PRODUCT', -- PRODUCT | ITEM_GROUP | ALL
    "product_id"      UUID REFERENCES "products"("id") ON DELETE CASCADE,
    -- The variant, for a retailer whose stocking unit IS the variant. D365 carries
    -- the product dimensions on the agreement line for the same reason.
    "variant_id"      UUID REFERENCES "product_variants"("id") ON DELETE CASCADE,
    "item_group_id"   UUID REFERENCES "item_groups"("id") ON DELETE CASCADE,

    -- ── Quantity break. **[OFFICIAL]** From / To quantity ───────────────────
    "quantity_from"   DECIMAL(12,2) NOT NULL DEFAULT 0,
    "quantity_to"     DECIMAL(12,2),

    -- ── The value ──────────────────────────────────────────────────────────
    -- A PRICE row uses `amount`; a LINE_DISCOUNT row uses `discount_percent`.
    "amount"           DECIMAL(14,4),
    "discount_percent" DECIMAL(7,4),
    "currency"         TEXT,
    -- **[OFFICIAL]** D365's `PriceUnit`: the price is "amount per N units", so a
    -- price quoted per dozen does not need a fabricated per-unit figure.
    "price_unit"       DECIMAL(12,2) NOT NULL DEFAULT 1,

    -- ── Validity. Date-effective, like TaxCode ─────────────────────────────
    "valid_from"      DATE NOT NULL DEFAULT CURRENT_DATE,
    "valid_to"        DATE,

    -- **[OFFICIAL]** D365's *Find next* / `SearchAgain`: "When Find next is set to
    -- Yes, the pricing engine continues to search for applicable trade agreements
    -- with a lower sale price."
    --
    -- Default FALSE, which is the opposite of best-price-wins and is deliberate: our
    -- resolver returns the most SPECIFIC match, the same rule as posting profiles. A
    -- price negotiated for one customer should not be silently undercut by a general
    -- one. Setting it true opts a row into the cheaper-wins search.
    "find_next"       BOOLEAN NOT NULL DEFAULT false,

    "is_active"       BOOLEAN NOT NULL DEFAULT true,
    "note"            TEXT,
    "created_by"      UUID,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "trade_agreements" DROP CONSTRAINT IF EXISTS "trade_agreements_side_check";
ALTER TABLE "trade_agreements"
    ADD CONSTRAINT "trade_agreements_side_check" CHECK ("side" IN ('SALES', 'PURCHASE'));

ALTER TABLE "trade_agreements" DROP CONSTRAINT IF EXISTS "trade_agreements_type_check";
ALTER TABLE "trade_agreements"
    ADD CONSTRAINT "trade_agreements_type_check"
    CHECK ("agreement_type" IN ('PRICE', 'LINE_DISCOUNT'));

ALTER TABLE "trade_agreements" DROP CONSTRAINT IF EXISTS "trade_agreements_party_scope_check";
ALTER TABLE "trade_agreements"
    ADD CONSTRAINT "trade_agreements_party_scope_check"
    CHECK ("party_scope" IN ('PARTY', 'PARTY_GROUP', 'ALL'));

ALTER TABLE "trade_agreements" DROP CONSTRAINT IF EXISTS "trade_agreements_product_scope_check";
ALTER TABLE "trade_agreements"
    ADD CONSTRAINT "trade_agreements_product_scope_check"
    CHECK ("product_scope" IN ('PRODUCT', 'ITEM_GROUP', 'ALL'));

-- The party named must match the scope AND the side. A SALES agreement scoped to a
-- party must name a customer, a PURCHASE one a supplier. Without this a row can
-- name a supplier on a sales agreement and simply never match anything, which looks
-- like a pricing bug and is a data bug.
ALTER TABLE "trade_agreements" DROP CONSTRAINT IF EXISTS "trade_agreements_party_target_check";
ALTER TABLE "trade_agreements"
    ADD CONSTRAINT "trade_agreements_party_target_check" CHECK (
        ("party_scope" = 'PARTY' AND "side" = 'SALES'
            AND "customer_id" IS NOT NULL AND "supplier_id" IS NULL AND "party_group_id" IS NULL)
     OR ("party_scope" = 'PARTY' AND "side" = 'PURCHASE'
            AND "supplier_id" IS NOT NULL AND "customer_id" IS NULL AND "party_group_id" IS NULL)
     OR ("party_scope" = 'PARTY_GROUP'
            AND "party_group_id" IS NOT NULL AND "customer_id" IS NULL AND "supplier_id" IS NULL)
     OR ("party_scope" = 'ALL'
            AND "customer_id" IS NULL AND "supplier_id" IS NULL AND "party_group_id" IS NULL)
    );

ALTER TABLE "trade_agreements" DROP CONSTRAINT IF EXISTS "trade_agreements_product_target_check";
ALTER TABLE "trade_agreements"
    ADD CONSTRAINT "trade_agreements_product_target_check" CHECK (
        ("product_scope" = 'PRODUCT'     AND "product_id" IS NOT NULL AND "item_group_id" IS NULL)
     OR ("product_scope" = 'ITEM_GROUP'  AND "item_group_id" IS NOT NULL AND "product_id" IS NULL AND "variant_id" IS NULL)
     OR ("product_scope" = 'ALL'         AND "product_id" IS NULL AND "item_group_id" IS NULL AND "variant_id" IS NULL)
    );

-- **[OFFICIAL]** "a price is an absolute value and can't be the same for all
-- products or a group of products" — so a PRICE row must name a specific product.
-- A percentage discount has no such problem.
ALTER TABLE "trade_agreements" DROP CONSTRAINT IF EXISTS "trade_agreements_price_needs_product_check";
ALTER TABLE "trade_agreements"
    ADD CONSTRAINT "trade_agreements_price_needs_product_check" CHECK (
        "agreement_type" <> 'PRICE' OR "product_scope" = 'PRODUCT'
    );

-- The value has to match the type, or the row is configured and inert.
ALTER TABLE "trade_agreements" DROP CONSTRAINT IF EXISTS "trade_agreements_value_check";
ALTER TABLE "trade_agreements"
    ADD CONSTRAINT "trade_agreements_value_check" CHECK (
        ("agreement_type" = 'PRICE'         AND "amount" IS NOT NULL AND "amount" >= 0)
     OR ("agreement_type" = 'LINE_DISCOUNT' AND "discount_percent" IS NOT NULL
            AND "discount_percent" >= 0 AND "discount_percent" <= 100)
    );

ALTER TABLE "trade_agreements" DROP CONSTRAINT IF EXISTS "trade_agreements_quantity_check";
ALTER TABLE "trade_agreements"
    ADD CONSTRAINT "trade_agreements_quantity_check" CHECK (
        "quantity_from" >= 0 AND ("quantity_to" IS NULL OR "quantity_to" >= "quantity_from")
    );

ALTER TABLE "trade_agreements" DROP CONSTRAINT IF EXISTS "trade_agreements_validity_check";
ALTER TABLE "trade_agreements"
    ADD CONSTRAINT "trade_agreements_validity_check" CHECK (
        "valid_to" IS NULL OR "valid_to" >= "valid_from"
    );

ALTER TABLE "trade_agreements" DROP CONSTRAINT IF EXISTS "trade_agreements_price_unit_check";
ALTER TABLE "trade_agreements"
    ADD CONSTRAINT "trade_agreements_price_unit_check" CHECK ("price_unit" > 0);

-- The resolver's lookup: side + tenant + active + date, then narrow.
CREATE INDEX IF NOT EXISTS "trade_agreements_lookup_idx"
    ON "trade_agreements" ("tenant_id", "side", "is_active", "valid_from");
CREATE INDEX IF NOT EXISTS "trade_agreements_product_idx"
    ON "trade_agreements" ("tenant_id", "product_id");
CREATE INDEX IF NOT EXISTS "trade_agreements_supplier_idx"
    ON "trade_agreements" ("tenant_id", "supplier_id");
CREATE INDEX IF NOT EXISTS "trade_agreements_customer_idx"
    ON "trade_agreements" ("tenant_id", "customer_id");

-- Nothing is seeded. An empty table means every price still comes from where it
-- comes from today — `Product.selling_price` and a hand-typed `unit_cost` — so
-- applying this migration changes no behaviour.
