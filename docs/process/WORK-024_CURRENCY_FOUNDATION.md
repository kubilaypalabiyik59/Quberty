# WORK-024 — Currency foundation (design)

**Status:** Design approved by Kubi on 2026-09-11. **024a is implemented and accepted locally and on
Supabase TEST on 2026-09-12** (migration 032, ledger ordinal 32) — see the worklog entry "WORK-024a —
currency master and ledger currencies". **024b is implemented and accepted locally and on Supabase
TEST on 2026-09-12** (migration 033, ledger ordinal 33) — see the worklog entry "WORK-024b — voucher
amount triple". WORK-024 is complete; the next currency work is WORK-026 (foreign-currency AP) and
WORK-027 (revaluation), after WORK-025 and WORK-030.
**Designer:** Claude solution-architect agent (Opus), interim Codex role. Listed for Codex re-review.
**Labels:** [OFF] official documentation, [REPO] repo-verified, [REC] architectural recommendation,
[ASSUMPTION] needs validation.

## 0. Decisions (Kubi, 2026-09-11)

1. Split into **024a** (currency master, ledger currencies, parametric guards, migration 032) and
   **024b** (voucher transaction/accounting/reporting amounts, migration 033), in that order.
2. Exchange-rate segregation of duties: `store_manager` and `finance_approver` may only **add** dated
   rate rows. Editing an existing rate row is admin-only (`finance.setup.maintain`) and audited.
3. Reporting currency stays **BOB** (BOB/BOB). All current data is test data; no production tenant
   exists yet.
4. Open for the Bolivian accountant (does not block): which BCB series (official buy, official sell,
   or referencial) is the accounting rate type. The rate type is data.

## 1. Findings that change the premise

1. **[REPO] Foreign-currency P2P posting is wrong today, not merely unsupported.**
   `productReceipt.service.ts` has no currency reference at all, so a receipt values stock and cost
   layers at PO cost in the PO's currency. `vendorInvoice.service.ts:605` writes `exchange_rate: 1`
   and `amount_functional = total` for every currency. The invoice post only rolls back because
   `createInvoiceOpenTransaction` calls the BOB guard (`vendorPayment.service.ts:76`). WORK-024 must
   make receipt and invoice fail closed **before** any stock, cost-layer, or voucher write.
2. **[REPO] A `'BOB'` literal lives in a database constraint:**
   `supplier_credits_bob_exchange_rate_chk CHECK (currency <> 'BOB' OR exchange_rate = 1)`
   (`029_supplier_returns_and_credits.sql:139-142`). Migration 032 drops it (029 is byte-frozen).
3. **[OFF] Reporting currency cannot be added or changed after posting**
   (<https://learn.microsoft.com/troubleshoot/dynamics-365/finance/general-ledger/add-change-accounting-reporting-currency>).
   The only non-guessing backfill for existing tenants is reporting = accounting at rate 1, which
   D365 supports (<https://learn.microsoft.com/dynamics365/finance/general-ledger/dual-currency>).

## 2. Official process

- Ledger: accounting currency, reporting currency, accounting and reporting rate types; a blank
  reporting rate type falls back to the accounting type
  (<https://learn.microsoft.com/dynamics365/finance/general-ledger/configure-ledger#configuring-currencies-for-the-ledger>).
- Dual currency: both accounting and reporting amounts are translated from the transaction amount.
- Balancing: a voucher balances in transaction currency (single transaction currency), accounting,
  and reporting; lines are translated and rounded individually; a difference within the penny
  tolerance goes to the penny-difference account; multi-transaction-currency vouchers get no penny
  line (<https://learn.microsoft.com/troubleshoot/dynamics-365/finance/general-ledger/posting-fail-imbalance>).
- Rates: rate types are shared; a pair exists once per type and the reciprocal pair is refused; the
  rate used is the latest start date on or before the transaction date; conversion factor 1 or 100;
  changes are new dated rows
  (<https://learn.microsoft.com/training/modules/configure-currencies-dyn365-finance/3-currency-exchange-rate>).
- Rate date: Posting date by default, Document date as the alternative
  (<https://learn.microsoft.com/dynamics365/finance/accounts-payable/vendor-invoice-dates#exchange-rate-date>).
- Currency rounding rules are per currency
  (<https://learn.microsoft.com/dynamics365/business-central/finance-set-up-currencies#rounding-currencies>).
- Provider import lists no BCB provider
  (<https://learn.microsoft.com/dynamics365/finance/general-ledger/import-currency-exchange-rates>);
  automated import is out of scope.

## 3. Hard-coding inventory

### Fixed in WORK-024a (ledger and P2P path)

| # | Location | Defect |
|---|---|---|
| 1 | `schema.prisma:27` | `Tenant.currency_code @default("USD")` |
| 2 | `schema.prisma:2617` | `FinanceParameters.functional_currency @default("BOB")`, written by provisioning, never read |
| 3 | `schema.prisma:903` | `PurchaseOrder.currency @default("TRY")` |
| 4 | `schema.prisma:869, 1207, 1391, 1567` | Supplier, VendorInvoice, VendorPayment, SupplierCredit default `"BOB"` |
| 5 | `shared/schemas/index.ts:227` | PO zod `.default('BOB')`; any string accepted |
| 6 | `purchase.routes.ts:103, 359` | `currency \|\| 'BOB'`, `body.currency ?? 'BOB'` |
| 7 | `vendorInvoice.service.ts:211, 605` | `po?.currency ?? 'BOB'`; unconditional rate 1 |
| 8 | `vendorPayment.service.ts:19-30, 87, 189` | Literal BOB guard and literals |
| 9 | `purchaseReturn.service.ts:32-42, 726/741/763` | Literal BOB guard; rate 1 |
| 10 | `productReceipt.service.ts:321-338` | No currency guard; cost layer has no currency basis |
| 11 | `029…sql:139-142` | Literal `'BOB'` CHECK |
| 12 | `tenantMiddleware.ts:28` | `?? 'USD'` context currency |
| 13 | `finance.routes.ts:357` | Factura snapshot `currency_code ?? 'BOB'` |
| 14 | `tenant.routes.ts:68-96` | `PUT /tenant/setup currency_code` writes only `Tenant.currency_code`; check-then-update race |
| 15 | `scripts/verifyVendorPayment.ts:36` | Finds the tenant by `currency_code: 'BOB'` |

### Deferred to WORK-025 (literal sweep)

Sales-side defaults (`SalesOrder`, CRM, quotation, requisition, RFQ); sales/procurement literals;
POS creates sales orders without a currency and relies on the `SalesOrder` default, so that default
and the POS path change together in 025; frontend `format.ts:8` `'USD'` and about 60 `Bs.` literals;
verification scripts; chart-of-accounts template selection by currency; the separate `skarpine-pos/`
repository. Migrations 027/028 literals are byte-frozen and inert.

## 4. SME scope

Build: ledger currency pair, manually entered dated rates, correct voucher amount triple (024b),
fail-closed guards. Do not build: triangulation, rate providers/import, reporting-currency adjustment
journal, budget rate types, per-document fixed rates, sales-tax rate types, multi-transaction-currency
vouchers. [REC]

## 5. Data model

### 024a — migration `032_currency_master_and_ledger_currencies.sql`

- **`Currency`** — platform ISO 4217 reference, no `tenant_id` (shared reference data): `code` PK
  (`^[A-Z]{3}$`), `numeric_code`, `name`, `minor_unit Int`; seeded with the ISO list.
- **`TenantCurrency`** — `id`, `tenant_id`, `currency_code → Currency`, `symbol?`,
  `rounding_precision Decimal(6,4)`, `rounding_method` (`NEAREST|UP|DOWN`, default `NEAREST`),
  `is_active`; `@@unique([tenant_id, currency_code])`; CHECK `rounding_precision >= 0.01` (amounts
  are `(14,2)`; 3-decimal currencies fail closed).
- **`ExchangeRateType`** — `id`, `tenant_id`, `code`, `name`, `description?`, `is_active`;
  `@@unique([tenant_id, code])`.
- **`ExchangeRateCurrencyPair`** — `id`, `tenant_id`, `rate_type_id`, `from_currency_code`,
  `to_currency_code`, `conversion_factor Decimal(10,0) @default(1)`;
  `@@unique([tenant_id, rate_type_id, from_currency_code, to_currency_code])`; CHECK `from <> to`;
  reciprocal refusal in the service under a row lock on the rate type.
- **`ExchangeRate`** — `id`, `tenant_id`, `currency_pair_id`, `valid_from Date`,
  `rate Decimal(18,8)`, `source` (`MANUAL|IMPORTED`, default `MANUAL`), `created_by`, `updated_by`,
  timestamps; `@@unique([tenant_id, currency_pair_id, valid_from])`; CHECK `rate > 0`.
- **`FinanceParameters`** — rename `functional_currency` → `accounting_currency_code` and drop its
  default; add `reporting_currency_code` (NOT NULL after backfill), `accounting_rate_type_id`
  (NOT NULL), `reporting_rate_type_id?` (falls back to accounting), `exchange_rate_date_basis`
  (`POSTING_DATE|DOCUMENT_DATE`, default `POSTING_DATE`; only `POSTING_DATE` has behaviour,
  `DOCUMENT_DATE` is refused 422), `reporting_rounding_tolerance Decimal(14,2) @default(0.02)`;
  composite FKs `(tenant_id, *_currency_code)` → `TenantCurrency(tenant_id, currency_code)`.
- **`InventoryCostLayer.cost_currency_code`** — NOT NULL after backfill; declares `unit_cost` is in
  accounting currency (WORK-031 basis).
- Drop currency defaults on Tenant, FinanceParameters, PurchaseOrder, VendorInvoice, VendorPayment,
  SupplierCredit, Supplier. Drop `supplier_credits_bob_exchange_rate_chk`; add
  `CHECK (exchange_rate > 0)`.

**Backfill with pre-checks** (no `BEGIN`/`COMMIT`; defensive `DO` blocks):
1. RAISE if a tenant's `currency_code` differs from its `functional_currency`.
2. RAISE if a tenant lacks a `finance_parameters` row with `legal_entity_id IS NULL`.
3. RAISE if a PO in a currency other than the tenant's has a posted receipt or invoice.
4. Insert `TenantCurrency` for every code referenced by a tenant, its parameters, or a document
   currency column; precision `10^-minor_unit`; RAISE on non-ISO or more than 2 minor units.
5. Insert one `ExchangeRateType` `DEFAULT` per tenant; point `accounting_rate_type_id` at it (the
   operator renames it to BCB with `configureLedgerCurrencies.ts`).
6. `reporting_currency_code = accounting_currency_code`.
7. `cost_currency_code` = ledger accounting currency.
8. `SET NOT NULL`.

Deterministic and reversible with a documented manual rollback kept as a comment in the migration.

### 024b — migration `033_voucher_currency_amounts.sql`

- **`JournalEntry`** — `accounting_currency_code`, `reporting_currency_code`,
  `exchange_rate_date Date` (NOT NULL), `accounting_rate_type_id?`, `reporting_rate_type_id?`.
- **`JournalLine`** (no `tenant_id`; validated in the service) — `transaction_currency_code`,
  `transaction_debit_amount`/`transaction_credit_amount`, `reporting_debit_amount`/
  `reporting_credit_amount` (`Decimal(14,2)`), `accounting_exchange_rate`/`reporting_exchange_rate`
  (`Decimal(18,8)`, CHECK > 0). `debit_amount`/`credit_amount` stay the accounting amounts so every
  report keeps working. No sign CHECK (STORNO lines are negative).
- **`VendorOpenTransaction`** — `amount_reporting`, `exchange_rate_reporting` (NOT NULL after
  backfill): the WORK-027 revaluation base.
- Backfill: transaction = accounting = reporting, rates 1, currency = ledger accounting currency,
  `exchange_rate_date = entry_date`; RAISE first if any tenant has reporting ≠ accounting.

### Drift and rebuild

The drift snapshot must stay empty, so SQL uses Prisma's `_key`/`_idx`/`_fkey` names. Draft DDL with
`prisma migrate diff`, then insert the backfill between add-column and set-not-null. Pre-check
blocks are no-ops on an empty database, so `verify:migration-supabase` rebuilds cleanly.

## 6. Services [REC]

| Service | Rule |
|---|---|
| `ledgerCurrency.service.ts` `getLedgerCurrencies(tenantId, legalEntityId, client)` | Reads FinanceParameters only; no row → 422 `LEDGER_CURRENCY_NOT_CONFIGURED`. Single writer; mirrors `Tenant.currency_code` in the same transaction under `pg_advisory_xact_lock(hashtext('ledger-currency:'\|\|tenant))` |
| `exchangeRate.service.ts` `resolveRate(tenant, rateTypeId, from, to, date)` | Same currency → 1 with no DB read. Exact pair with latest `valid_from ≤ date`, then reciprocal (divide; never a rounded reciprocal). No triangulation. Missing → 422 `EXCHANGE_RATE_MISSING {type, from, to, date}`; inactive → 422 `CURRENCY_INACTIVE`. `Prisma.Decimal` only |
| `currencyRounding.ts` `roundAmount(value, tenantCurrency)` | Stored precision and method. The tax engine keeps its own `round2` (`tax.service.ts:93`); tax rounding is untouched |
| `assertDocumentCurrencySupported(tenant, docCurrency, capability)` | Replaces both BOB guards: only `docCurrency === ledger.accounting`, else 409 with the existing codes and a message naming WORK-026. Also used by receipt and vendor-invoice post before any write |

**024b `postJournal`:** optional voucher-level `currency?: { code }`; line amounts are transaction
amounts. Omitted means ledger accounting currency, so all existing callers keep their meaning and no
rate is read while reporting = accounting. Refuse multi-currency vouchers
(`JOURNAL_MULTI_CURRENCY_UNSUPPORTED`); translate each line to accounting and to reporting (from the
transaction amount; copy when reporting = accounting); penny differences within tolerance become
accounting-only or reporting-only ROUNDING lines, beyond it the voucher is refused. `reverseJournal`
copies the triple and rates through a `rawAmounts` path and never re-translates. The manual-journal
route refuses a `currency` field.

## 7. API, permissions, UI

- Permissions: `finance.currency.read`, `finance.exchange_rate.maintain` beside
  `FINANCE_SETUP_PERMISSIONS`. `store_manager`, `finance_approver`: read + maintain (add only).
  `ap_clerk`, `buyer`, `auditor`: read. `admin`: all. `cashier`: none.

| Route | Guard |
|---|---|
| `GET /finance/ledger-currencies` | read |
| `PUT /finance/ledger-currencies` | `finance.setup.maintain`; atomic lock; 409 `CURRENCY_LOCKED` for accounting and reporting after any POSTED entry; same values no-op; 422 on `DOCUMENT_DATE` |
| `GET/POST/PUT /finance/currencies` | read / `finance.setup.maintain`; deactivating a ledger currency refused |
| `GET/POST/PUT /finance/exchange-rate-types` | read / `finance.setup.maintain` |
| `GET/POST /finance/exchange-rates` | read / `finance.exchange_rate.maintain`; reciprocal pair 409; rate ≤ 0 400; audited |
| `PUT /finance/exchange-rates/:id` | `finance.setup.maintain` (admin only, per decision 2); audited |
| `GET /finance/exchange-rates/resolve` | read |
| `PUT /tenant/setup` | `currency_code` removed from the strict schema (400); the wizard uses the ledger endpoint |

- UI: `/setup/finance/currencies` (ledger card, read-only after posting with the reason; currency
  list with rounding; rate types) and `/finance/exchange-rates` (grid by type and pair, dated add).
  Setup checklist facts. New pages format with the ledger currency code, no literals.

## 8. Fail-closed boundaries and hooks

Refused in 024: P2P document currency ≠ accounting (receipt, invoice, payment, return, credit);
PO/supplier currency not active in `TenantCurrency` (422); multi-currency vouchers; `DOCUMENT_DATE`;
3-decimal currencies; missing rates; missing ledger row; **024a only:** reporting ≠ accounting
(`createTenant --reporting-currency` must equal `--currency` until 024b ships).

| Deferred | Hook |
|---|---|
| WORK-026 foreign-currency AP, realized FX, kur farkı faturası | Line transaction currency and rates, open-transaction `amount_reporting`, existing settlement currency/rate; gain/loss posting types and a kur-farkı document referencing `VendorSettlement` are additive — NONE_REQUIRED |
| WORK-027 revaluation | Rate types plus reporting amounts — NONE_REQUIRED beyond 033 |
| WORK-031 FIFO | `cost_currency_code`; reporting cost derived at voucher translation — NONE_REQUIRED |
| Module rate-date overrides | Nullable column with fallback to Finance — NONE_REQUIRED |
| Triangulation, provider import, staleness limit | Additive; `ExchangeRate.source` exists now — NONE_REQUIRED |
| Multiple legal entities | `FinanceParameters.legal_entity_id` exists; journal `legal_entity_id` is the WORK-023 deferral |

## 9. Invariants and Bolivia regression

Every new tenant-scoped unique includes `tenant_id`; tax engine and FACTURA allocator untouched;
with BOB/BOB every line has transaction = accounting = reporting at rate 1, including the
Bs 1 299,00 → IVA 168,87 / IT 38,97 voucher on invoice, POS, and negated credit note; a refused POS
sale leaves FACTURA `next_number` unchanged.

## 10. Tests and acceptance

Unit: rate resolution (latest on or before, future ignored, reciprocal, no triangulation, missing,
same-currency with no DB call, cross-tenant invisible); rounding methods and BOB = `round2`;
024b posting and reversal; SoD matrix with denial before DB; `CURRENCY_LOCKED` for both currencies;
**TRY-ledger parametric proof** for every P2P flow with USD refused; USD receipt refused before any
stock or layer write; `PUT /tenant/setup currency_code` 400; `createTenant` arguments.

Harness `verify:currency-foundation` (guard `ALLOW_TEST_DATABASE_WRITE=WORK024_ACCEPTANCE`, marker
`WORK024-<ts>`): read-only ledger checks plus rollback-only writes; live SoD denials.

TEST sequence per slice: T0 read-only step 0; T1 build, script and frontend typecheck, Jest,
`git diff --check`; T2 `verify:migration-supabase` with empty drift; T3 apply with
`MIGRATION_APPLIED_BY=claude-work-024a` (then `-024b`); T4 repeat no-op; T5 harness; T6 regressions
(`verify:vendor-payment`, `verify:supplier-return`, `verify:open-purchase`, `verify:putaway`,
`verify:tenant-numbering`, `verify:o2c-containment`). Operator step after 032:
`scripts/configureLedgerCurrencies.ts --tenant skarpine-demo --rate-type-code BCB --rate-type-name "…"`
(dry run unless `--apply`).

## 11. Sizing

024a M+, 024b M; order 024a → 024b. No real tenant may be created between them.

## 12a. WORK-024b — refined design (2026-09-12, after 024a acceptance)

Produced by the Claude solution-architect agent on Opus against `53015d4`. **Approved by Kubi and
implemented on 2026-09-12**, with one correction the unit tests forced: where the reporting currency
IS the accounting currency it now mirrors it exactly, penny line included, instead of being
translated a second time.

### Migration 033 — `033_voucher_currency_amounts.sql`

- **`journal_entries`**: `accounting_currency_code`, `reporting_currency_code`, `exchange_rate_date`
  (all NOT NULL after backfill), `accounting_rate_type_id`, `reporting_rate_type_id` (both nullable —
  a historical or identity-translated voucher was never quoted against a rate type, and inventing one
  repeats the `exchange_rate: 1` defect). `journal_entries` still has no `legal_entity_id` (WORK-023
  deferral), so everything joins the tenant ledger (`legal_entity_id IS NULL`).
- **`journal_lines`**: `transaction_currency_code`, `transaction_debit_amount`/`_credit_amount`,
  `reporting_debit_amount`/`_credit_amount` `Decimal(14,2)`, `accounting_exchange_rate`/
  `reporting_exchange_rate` `Decimal(18,8)`. **No defaults on any new column** — a rate defaulting to
  1 would re-create the defect 024a closed. `debit_amount`/`credit_amount` stay the accounting
  amounts, so every existing report keeps working.
- **`vendor_open_transactions` and `vendor_settlements`**: `amount_reporting`,
  `exchange_rate_reporting`. Settlements were not in the original §5; they are added now because a
  settlement is where WORK-026 computes realized FX, and a later backfill would have to guess.
- CHECKs: every rate `> 0`. No sign CHECK on amounts — STORNO negates amounts in place, never rates.
- FKs: tenant-composite to `tenant_currencies` and `exchange_rate_types` on the entry;
  `journal_lines.transaction_currency_code` references shared `currencies(code)` only, because
  `journal_lines` carries no `tenant_id` and adding one for this would touch every insert for no
  isolation gain. No new uniqueness constraint, so the tenant-scoped-unique rule is untouched.
- Order: pre-check (reporting = accounting everywhere; every posting tenant has a ledger) → add
  nullable columns → backfill (transaction = accounting = reporting, rates 1, `exchange_rate_date =
  entry_date`; subledger reporting = functional) → post-check for leftover NULLs → `SET NOT NULL` →
  CHECKs → FKs → rollback comment. Deterministic against TEST (115+ posted entries, all BOB/BOB) and a
  no-op on an empty database, so the isolated rebuild is unchanged. A repeat run reports "No pending
  migrations"; the file is byte-frozen once applied.

### `postJournal`

Optional voucher-level `currency?: { code }`; line amounts become transaction amounts. Omitted means
the ledger's accounting currency, so all 14 existing callers keep today's behaviour exactly and every
translation is identity — which returns 1 without a database read.

Order: normalise lines (rounding through the currency's own rule, provably equal to the old `round2`
at 0.01/NEAREST) → parameters and closed-period check → transaction-currency balance → resolve the
accounting and reporting rates → **translate each line from the transaction amount and round it, then
sum** (**[OFFICIAL]** each line is translated and rounded, then summed, and both targets come from the
transaction amount: <https://learn.microsoft.com/dynamics365/finance/general-ledger/dual-currency>) →
accounting penny line within `rounding_tolerance`, else refuse → reporting penny line within
`reporting_rounding_tolerance`, else refuse (**[OFFICIAL]** the two tolerances are separate:
<https://learn.microsoft.com/troubleshoot/dynamics-365/finance/general-ledger/posting-fail-imbalance>)
→ dimensions and write.

Two constraints the implementer must not lose: the `ROUNDING` posting account is resolved **only**
inside an imbalance branch (it is unconfigured on TEST, and identity never produces a penny line), and
a voucher with more than one transaction currency is refused before any write.

**Documented deviation [REC]:** D365 balances the transaction currency strictly and never adds a penny
line there; we keep today's ROUNDING absorption, because it is live behaviour and the two rules
coincide exactly while transaction = accounting.

### `reverseJournal`

A `rawAmounts` branch beside the existing `rawSlots`: no rate lookup, no translation, no re-rounding.
The reversal copies the original's currencies, rates, rate types and **`exchange_rate_date`**, while
its posting date stays today (the existing deliberate deviation that keeps a reversal out of a closed
period). Re-translating at today's rate would leave an FX residue that never nets to zero. REVERSE
swaps all three amount sets; STORNO negates all six amounts, never the rates. Balance is asserted
exactly in all three currencies instead of appending a second penny line.

### AP subledger

One `resolveSubledgerAmounts` helper feeds every writer in `vendorPayment.service.ts` and
`purchaseReturn.service.ts`, removing the literal `exchange_rate: 1` from those paths.

**Decided 2026-09-12 (Kubi):** a document row is measured at its own posting date and a settlement at
the settlement date — the difference between an open item's rate and the settlement day's rate is the
realized exchange difference WORK-026 posts, so the settlement must be free to differ from the item it
settles. A row derived from another row (a reversal) still copies its basis, because a reversal has to
net to zero. While every document is in the accounting currency, all of this is an identity.

### The reporting-currency restriction stays closed in 024b [REC]

`REPORTING_CURRENCY_UNSUPPORTED` remains, its message pointing at WORK-026/027. 033 gives vouchers and
AP a reporting amount; it gives **inventory** none — `InventoryCostLayer.unit_cost` is accounting
currency only, so COGS in a different reporting currency would be translated at the issue date instead
of carried from the receipt. For a shoe retailer inventory is the balance sheet, and **[OFFICIAL]** a
reporting currency cannot be added or changed after posting, so enabling it early is irreversible.
Before it can be lifted: 033 shipped, AP and settlements carrying reporting amounts, a decided
reporting cost basis (WORK-031), realized FX (WORK-026), revaluation (WORK-027), and the setup UI.
The gate is then the existing `hasLedgerActivity`. The reporting ≠ accounting path is still exercised
in service-level unit tests, so the machinery is proven before it is reachable.

### Boundaries and hooks

Every 024a fail-closed rule stays; nothing user-reachable is lifted. 024b builds the engine and leaves
the doors locked. WORK-026 needs no new hook beyond the settlement reporting amounts (`FX_GAIN`/
`FX_LOSS` are posting-type data rows); WORK-027 needs none beyond 033; WORK-031 needs none from 033.
`journal_entries` must **not** gain `legal_entity_id` here.

**Rate semantics, to be written into the schema comment:** the stored rate is the effective per-unit
quote for audit and inquiry; **the amounts are authoritative**, and nothing may recompute an amount
from the 8-decimal rate.

### Tests

New `journalCurrency.test.ts`: identity with no database read; Microsoft's own EUR 3.33/3.33/3.34
penny fixture; refusal above tolerance with `ROUNDING` never resolved; a reporting-only penny line
against its own tolerance; missing rate propagates with nothing written; multi-currency refused;
penny lines dimension-coded; REVERSE and STORNO carrying the triple; **a rate change between posting
and reversal still nets to zero in all three currencies**; the Bs 1 299,00 → IVA 168,87 / IT 38,97
voucher unchanged with all three sets identical; every AP writer populating the reporting columns.

The harness is extended rather than replaced: ordinal 33; over **all** posted lines transaction =
accounting = reporting with rates 1; entry currencies equal the tenant ledger's; subledger reporting =
functional; a foreign-currency voucher and a posting-and-reversal pair inside rolled-back
transactions; and FACTURA continuity under an injected failure. T0–T6 as in §10, applied with
`MIGRATION_APPLIED_BY=claude-work-024b`.

### Size and open questions

Size M — no new UI and no new route; 024b is invisible to the end user by design.

1. Keep the reporting-currency restriction closed in 024b — recommended yes.
2. Keep our transaction-currency penny absorption as a documented deviation — recommended yes.
3. Reuse the `ROUNDING` posting type for penny differences, or add `PENNY_DIFFERENCE` — recommended
   reuse; the Finance co-founder decides whether FX rounding must be separated in the P&L. Note that
   `ROUNDING` is recorded as unconfigured on TEST; harmless for 024b, a blocker for WORK-026.
4. `reporting_rounding_tolerance` default 0.02 — Finance sign-off at BOB scale.
5. Which BCB series is the accounting rate type — still open, still not blocking.
6. Whether a true second accounting currency is wanted at all, or the reporting currency is purely a
   future export-market feature — it changes how much of WORK-027 is worth building.

## 12b. Recorded, not for 024b

`PUT /purchase/suppliers/:id` spreads the request body into `updateMany`, so `currency` bypasses
`resolveDocumentCurrency` and `tenant_id` is assignable. It stays in WORK-025 / the WORK-030 security
sweep — but it is a tenant-isolation defect on a mounted, permission-guarded route, not tidiness, and
must not slip past WORK-030.

## 13. Catalog

90.10 *Develop currency policies* (level 3 UNVERIFIED), 90.50.040.000, UNVERIFIED-90.60-E (hooks
only), 75.40.030.000, 60.30.010.000, 75.50.020/080/090/110.000, 99.25.050/060.000.
