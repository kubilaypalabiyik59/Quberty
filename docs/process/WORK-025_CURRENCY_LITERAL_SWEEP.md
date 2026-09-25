# WORK-025 — Currency and country literal sweep (design)

**Status:** Designed 2026-09-12 by the Claude solution-architect agent (Opus) against `2190f78`.
Kubi decided §7.1, §7.2, §7.3 and §7.6 the same day. **025a is implemented and accepted locally and on
Supabase TEST on 2026-09-12** (migration 034, ledger ordinal 34) — see the worklog entry "WORK-025a —
sales-side currency and tenant jurisdiction". **025b (frontend) is designed and not started**; 025c
(Expo POS) stays deferred with its contract in §6.
**Labels:** [OFF] official documentation (URL) · [REPO] repo-verified (file:line) · [REC] architectural
recommendation · [ASSUMPTION] needs validation.

## 1. The finding that changes what this item is

This is not a cosmetic sweep.

- `sales.routes.ts` contains exactly **one** occurrence of the string `currency`: the `'BOB'` literal
  the storefront forces. The invoice route and its `postJournal` call never read `order.currency`.
- `sales.service.ts:86` writes `data.currency ?? 'BOB'` with **no validation at all** — any string is
  persisted.

So a sales order in another currency would invoice and post **at face value**: exactly the defect
WORK-024a closed for product receipts and vendor invoices. The `'BOB'` literal is currently the only
thing making that harmless on a Bolivian tenant. **Dropping the defaults without adding the sales-side
posting guard would open the hole**, so both land in the same commit.

## 2. Corrections to the assumed scope

- **`skarpine-pos/` is an empty directory in this worktree** [REPO]. The POS that actually posts is the
  Next.js POS under `frontend/src/app/pos/`, inside this repository. The Expo application exists only
  on the `Quberty-POS` remote as an incomplete snapshot, so it cannot be part of this item's
  acceptance. Its client contract is recorded in §6 as WORK-025c.
- **The frontend literal count is ~158 lines across 35 files**, not ~60 [REPO], plus three non-`Bs.`
  hard-codings: `finance/bank-reconciliation/page.tsx:9` and `hr/payroll/page.tsx:9` (`Intl` with
  `es-BO`/`BOB`), and `reports/page.tsx:21` (`const CURRENCY = 'Bs.'`).
- `frontend/src/lib/format.ts`'s `formatCurrency` **has no callers** [REPO]: every page ignored it in
  favour of a literal.

## 3. Official basis

- **Currency is a channel/store attribute in retail, not something a till sends.** A retail channel is
  configured with one currency
  (<https://learn.microsoft.com/dynamics365/commerce/channel-setup-retail>,
  <https://learn.microsoft.com/dynamics365/commerce/map-channels-sites>). That is the basis for the POS
  route accepting no currency from the client.
- **Foreign tender is cash management, not document currency**: a till may accept another currency,
  but the transaction stays in the store's currency
  (<https://learn.microsoft.com/dynamics365/commerce/cash-mgmt#cash-management-for-multiple-currencies>).
  Out of scope.
- **A currency on the customer master is a default, not a constant**
  (<https://learn.microsoft.com/dynamics365/business-central/finance-set-up-currencies>). `Customer`
  has no currency column today, and none is added speculatively.
- **Chart of accounts by jurisdiction is [REC], not [OFF].** Learn does not state it as a rule; the
  argument is that Ecuador, El Salvador and Panama all use USD and none files a generic IFRS chart,
  while Turkey's TDHP is mandated by law, not by the lira.

## 4. Scope

**In:** the seven `@default("BOB")` schema values (`SalesOrder`, `Lead`, `Opportunity`,
`SalesQuotation`, `PurchaseRequisition`, `RfqCase`, `RfqRequest`); parametric resolution in sales, POS,
storefront, CRM and quotations; **the sales-side posting guard**; the `PUT /purchase/suppliers/:id`
mass-assignment fix; dropping `Tenant.currency_code` and the request-context `currencyCode`;
jurisdiction-based chart selection; the verification scripts; and (as WORK-025b) the frontend.

**Out, each with its hook:** foreign-currency sales orders and facturas (WORK-026 — the `currency`
columns stay, only the defaults go; `journal_lines` already carries the triple, so **NONE_REQUIRED**);
a per-customer default currency (**NONE_REQUIRED** — a nullable column with a stated fallback is
additive); store/channel currency (**NONE_REQUIRED** — it lands on the `Store`/`Channel` entity
WORK-033 needs anyway); POS foreign tender (**NONE_REQUIRED** — payment methods are data);
currency-aware reporting (blocked by `REPORTING_CURRENCY_UNSUPPORTED` until WORK-026/027/031).

**Explicitly not touched:** the tax engine and its own rounding, IVA 13% inclusive, IT 3% sales-only,
the POS IT expense/payable pair, the continuous FACTURA series and its in-transaction allocation,
`postJournal`/`reverseJournal`, and every WORK-024 guard. `(store)/checkout/page.tsx:133` computes IVA
client-side — a tax defect, recorded separately, not fixed here.

## 5. Design

**Backend resolution.** `sales.service.ts`, `crm.service.ts` (lead and opportunity),
`quotation.service.ts` resolve through `resolveDocumentCurrency`. The storefront stops forcing `'BOB'`
and stops honouring `body.currency` — an anonymous caller must not set a document currency. The POS
resolves `getLedgerCurrencies` **before the transaction opens**, beside the order-number allocation,
and writes the ledger's accounting currency; `PosSaleSchema` gains no currency field. Existing
propagation (lead → opportunity, quotation → order, RFQ case → request) keeps copying the source
document's currency rather than re-resolving.

**Posting guard.** `assertDocumentCurrencySupported(..., 'SALES_FX_NOT_IMPLEMENTED')` at the top of the
sales invoice route, the POS sale, the credit-note/return path and the AR payment path — before any
FACTURA allocation, stock deduction, cost-layer write or voucher. [REC] also refuse a foreign-currency
sales order at creation: a draft that can never be invoiced is worse for an SME than a clear refusal.

**`Tenant.currency_code`.** [REC] drop it, and delete `currencyCode` from the request context with it.
Its only runtime consumer is the factura snapshot, which is already inside a posting path where
failing closed is correct. Making the tenant middleware read the ledger instead would put a 422 on
every request, including auth — the wrong place for a fail-closed boundary.

**Chart selection.** By jurisdiction: explicit `--template` wins, then the tenant's country, then
**stop and ask** rather than silently choosing the generic chart. Needs `Tenant.country` —
[ASSUMPTION] unless the 2026-09-11 "localization as data" decision already created a jurisdiction
owner, in which case the country belongs there and no column is added.

**Frontend (WORK-025b).** The display currency comes from **`GET /tenant/currency`** as a documented
read-only projection of `FinanceParameters` + `TenantCurrency` (`code`, `symbol`,
`rounding_precision`, `rounding_method`, `locale` from `Tenant.language`); writes stay on
`PUT /finance/ledger-currencies`. Reason for not reading `/finance/ledger-currencies` from the UI:
`cashier` deliberately has no `finance.currency.read`, and the POS renders money on every screen.

> **Superseded during 025b — its own route, not `/tenant/config`.** 025a gave `cashier` and
> `employee` `setup.tenant.read` so they could reach the currency on the tenant config. That was the
> wrong shape, and the storefront is what made it obvious: a shopper sees prices and holds no
> permission at all, so the same argument would have handed the tenant's plan, modules and branding to
> every customer. The currency now has its own route, needing **authentication and no permission**,
> and `setup.tenant.read` was **taken back off both roles** (this also closes review nit 7). The
> payload is the currency and its rounding, nothing else.

`lib/money.ts` replaces `lib/format.ts` with **no default currency** — a missing currency is a
programming error and must be visible, not rendered as dollars — and fraction digits derive from the
currency's own rounding precision. A `CurrencyProvider`/`useMoney` replaces every literal; a component
with no currency renders no number. The hook also carries `quantity` and `date`, because the same
hard-coded `es-BO` sat on eight purchase screens' quantity and date helpers, not only on money.

**React-pdf documents take the currency as a required prop**, exactly as they already take the tax:
a document cannot read React context, and the only fallback available is somebody else's currency
printed on a customer's invoice. Their buttons resolve it and offer no document until it is known.
`FacturaPDF` keeps printing `invoice_metadata.currency_code` — a filed document keeps its own
currency — and only its `'BOB'` fallback is replaced.

**Migration 034** drops the seven defaults and `tenants.currency_code`, adds `tenants.country` if
approved, and carries pre-checks that RAISE if any row's currency differs from its tenant's accounting
currency or any mirror has drifted. It **updates no currency value**, adds no FK and no NOT NULL, and
touches no factura, numbering, tax, journal, vendor or cost-layer table. Metadata-only by design, which
is the lesson recorded from 033's unbounded `UPDATE`.

## 6. WORK-025c — the Expo POS client contract

Recorded so a future session does not re-derive it; executed inside that directory, committed to its
own remote, never from the parent.

1. `POST /pos/sale` accepts no currency field and will not while the sale is in the ledger currency.
2. The display currency comes from `GET /tenant/currency` (authentication only, no permission).
3. A client must not hard-code a symbol, a code or a fraction-digit count.
4. `422 LEDGER_CURRENCY_NOT_CONFIGURED` is terminal: show the setup message, do not retry.

## 7. Decisions needed from Kubi

1. Drop `Tenant.currency_code` and the request-context mirror in 034 — *recommend yes*.
2. Add `Tenant.country` and select the chart by jurisdiction — *recommend yes*, after checking whether
   the localization decision already owns jurisdiction.
3. Refuse a foreign-currency sales order at creation, or allow the draft — *recommend refuse*.
4. Composite `(tenant_id, currency)` FK on sales documents — *recommend no, not here*: 032 did not add
   it on purchase orders, and asymmetry is worse than a later uniform migration.
5. Where the anonymous storefront gets its currency — *recommend the existing public product endpoint
   or the `(store)` server layout, not a new public config route*.
   **Resolved in 025b: the question rested on a false premise.** The storefront is not anonymous. Every
   `/api/v1` route, `/products` included, is mounted inside `tenantMiddleware` + `authMiddleware`
   (`backend/src/app.ts`), and `(store)/shop` fetches `/products` like any other screen — so a shopper
   is already signed in and the ordinary authenticated channel serves them. No public route was added;
   the shop reads `GET /tenant/currency` through the same provider as the ERP and the POS.
6. Split into 025a (backend + migration) and 025b (frontend) — *recommend yes*.
7. `PUT /purchase/suppliers/:id` in 025a rather than WORK-030 — *recommend 025a*: it is already
   permission-guarded, so a permission sweep would legitimately pass over it; the defect is unvalidated
   input on a path this item touches.

## 8. Sizing and acceptance

**025a** backend, size M+: schema, migration 034, resolution, the posting guard, the supplier fix, the
mirror removal, template selection, scripts, harness extension, unit tests, full T0–T6 with
`MIGRATION_APPLIED_BY=claude-work-025a`.
**025b** frontend, size M: the currency channel, `format.ts`, the provider, ~158 literal sites, the
supplier/payment-method/wizard pages. T1 plus a browser pass; no migration.
**025c** Expo POS: deferred, contract above.

Acceptance additions: a **TRY-ledger parametric proof for the sales, storefront, quotation and POS
paths**, mirroring the purchasing one; the harness (extended, not duplicated) asserting no
`column_default` on the seven columns, no `tenants.currency_code`, every sales-side row matching its
tenant's accounting currency, and a cashier reading its currency from `/tenant/currency` **while still
being refused `/tenant/config`**. **No successful
POS sale runs on TEST** — it would consume a FACTURA number; the POS route is probed only with an
invalid session, and the FACTURA sequence is asserted unchanged.
