-- 020 — Which SIDE of a transaction a tax code applies to
--
-- Open finding 1 in docs/process/S2P_O2C_STATUS.md §5, now closed.
--
-- ── The defect ──────────────────────────────────────────────────────────────
-- The tax engine resolves codes through TaxGroup (party) ∩ ItemTaxGroup (product)
-- and nothing else. A vendor invoice therefore evaluated `IT3` — Bolivia's
-- Impuesto a las Transacciones — and reported Bs 75 of `non_recoverable_tax` on a
-- Bs 2 500 purchase.
--
-- It never reached the ledger: the voucher is inventory + recoverable tax +
-- payable, `net = total − recoverable`, and it balances. So this corrects a figure
-- shown on the vendor-invoice screen, not the books.
--
-- ── Why IT cannot apply to a purchase ───────────────────────────────────────
-- Ley 843, art. 74 (quoted in docs/process/BOLIVIA_TAX_BASIS.md, read from the law
-- rather than from commentary):
--
--   "El impuesto se determinará sobre la base de los INGRESOS BRUTOS DEVENGADOS
--    durante el período fiscal […] Se considera ingreso bruto el valor o monto
--    total […] devengados en concepto de VENTA DE BIENES […]"
--
-- IT is a tax on the gross income of the party carrying out the activity. A
-- purchase is not income for the buyer — it is income for the SUPPLIER, who owes
-- their own IT on it and has already priced it in. Accruing IT on a purchase would
-- tax the same transaction twice, once in each party's books.
--
-- CLAUDE.md §6 states the same distinction: "IVA is recoverable input/output VAT;
-- IT is a turnover tax on sales only."
--
-- ── Why a column and not a branch on `tax_type` ─────────────────────────────
-- `tax_type = 'TURNOVER'` happens to identify IT today, and filtering on it would
-- work for Bolivia. It would be wrong the moment a jurisdiction has a purchase-side
-- turnover tax, and it would bake a Bolivian assumption into the engine — the exact
-- mistake migration 002 was created to undo, when SalesParameters held `vat_rate`
-- and `turnover_tax_rate` as columns.
--
-- The side a tax applies to is a property OF THE TAX, so it is a row value.
--
-- ── Default is BOTH, and IT3 is set explicitly ──────────────────────────────
-- BOTH preserves today's behaviour for every other code, including IVA13, which
-- genuinely applies to both sides — output VAT on sales, recoverable input VAT on
-- purchases. Only codes that are actually one-sided are narrowed, and each one is a
-- data statement with a legal citation rather than a code path.

ALTER TABLE "tax_codes" ADD COLUMN IF NOT EXISTS "applies_to" TEXT NOT NULL DEFAULT 'BOTH';

ALTER TABLE "tax_codes" DROP CONSTRAINT IF EXISTS "tax_codes_applies_to_check";
ALTER TABLE "tax_codes"
    ADD CONSTRAINT "tax_codes_applies_to_check"
    CHECK ("applies_to" IN ('SALES', 'PURCHASE', 'BOTH'));

-- Bolivia's IT: sales only, per Ley 843 art. 74. Matched on `tax_type` AND a
-- non-recoverable turnover rate rather than on the literal code 'IT3', so a tenant
-- that named it differently is still corrected — but scoped to TURNOVER so a future
-- purchase-side turnover tax in another jurisdiction is not swept up with it.
UPDATE "tax_codes"
SET "applies_to" = 'SALES'
WHERE "tax_type" = 'TURNOVER'
  AND "is_recoverable" = false
  AND "applies_to" = 'BOTH';

CREATE INDEX IF NOT EXISTS "tax_codes_tenant_applies_to_idx"
    ON "tax_codes" ("tenant_id", "applies_to");
