# HANDOVER — Skarpine ERP

> Living context document. Read this first in a new session.
>
> **Smoke-testing the 2026-08-16 session? Start at [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md)** —
> what to click, what to expect, and the four things that need Kubi rather than me.
>
> **Two standing rules were set this session and they bind all future work:**
> 1. Everything built is **parametric and configurable** unless Kubi says otherwise.
> 2. For anything he asks: **research the official process first** (the real Learn parameter screens,
>    not overview pages) **and record what we are NOT building**, so future scope is visible.
>    The artefact is [docs/architecture/ERP_SETUP_CHECKLIST.md](docs/architecture/ERP_SETUP_CHECKLIST.md).

**Last updated**: 2026-08-16 — **vendor invoice, product receipt and three-way matching built**
(see [docs/process/VENDOR_INVOICE.md](docs/process/VENDOR_INVOICE.md)); earlier the same day: process
chain, Bolivian tax basis, item groups wired into posting

> **Where this leaves the purchase side.** The receipt and the invoice are separate documents with
> separate postings, matching, tolerances and an accrual that nets to zero — and they now have
> screens. **The test tenant runs on the split posting** (three-way matching, 2% price tolerance).
> Both flows were driven through the real browser end to end; the ledger was checked line by line.
>
> **Start here for the whole picture:** [docs/process/S2P_O2C_STATUS.md](docs/process/S2P_O2C_STATUS.md)
> — where both processes stand and what is left, with the open decisions.
>
> Other tenants stay on the old single-voucher behaviour until switched deliberately with
> `npx tsx scripts/setPurchaseFlow.ts --split --three-way --tolerance 2`.

---

## 1. What This Project Is

Skarpine is a full-stack ERP + E-commerce + POS platform for a retail shoe business in
Bolivia, architected as a future multi-tenant SaaS product. Design inspiration is
Microsoft Dynamics 365 F&O (waves, work templates, location directives, journal-based
finance).

**Stack**
- `backend/` — Node.js + Express + Prisma
- `frontend/` — Next.js 14 (App Router, Pages under `src/app/(erp)` and `src/app/(store)`),
  Tailwind 3, TanStack Query + Table, Zustand, Radix primitives, Recharts, Framer Motion,
  Playwright for E2E
- `database/` — schema and seed material
- **Supabase is the TEST/development database, not production** — corrected by Kubi 2026-08-15.
  Earlier revisions of this file called it the production database; that was wrong. The data in it
  (including the accounts and journals cited throughout `docs/process/GAP_ANALYSIS.md`) is test data.
  The defects D-1…D-7 are real defects in running code, but the *amounts* are not filed tax figures.
  **Where production runs, if anywhere, is not recorded anywhere in this repo — still to confirm.**
  `schema.prisma` uses the Supabase pooler pattern; migrations must run against `DIRECT_URL`, not the
  pooled `DATABASE_URL`. Postgres RLS is available, which matters for the multi-tenancy gap.
- `skarpine-pos/` — separate nested repo (mobile/terminal POS). NOT a submodule — there is no `.gitmodules`; commit from inside that directory.
- `docs/`, `alm/` — documentation and lifecycle material

**Overall stage**: BETA / MVP. See `Roadmap_Improvement_Prod.md` for the production audit
(feature completeness 7/10, security 5/10, production readiness 4/10) and
`DEVELOPMENT_PLAN.md` for module scope.

---

## 2. Current Status

Backend and frontend modules are broadly at MVP: sales, purchase, inventory, warehouse,
CRM, HR, reporting, data import, storefront, and a fairly deep finance module (chart of
accounts, journal, facturas, IVA report, P&L, balance sheet, aging, periods, bank
reconciliation, COA templates).

Most recent commit before this session added a Spanish end-user PDF manual plus
accumulated module work.

**Open working-tree state**: the `skarpine-pos` submodule has uncommitted/untracked
content. It is a separate repository — commit it from inside that directory, not from
the parent repo.

---

## 3. Active Workstream — ERP Productisation: P2P / O2C Foundations (opened 2026-08-15)

**Strategic shift.** Skarpine is being repositioned from a one-client custom build into a packaged
product for businesses too small for a €10–15k ERP and too big for spreadsheets (≤ ~50 employees).
Governing principle, recorded in [CLAUDE.md](CLAUDE.md): *feature scope is reduced, data model depth
is not — every scope cut must be a behaviour cut, never a schema cut.*

### Deliverables produced this session (analysis only — no code, no schema changes)

| Document | Phase |
|---|---|
| [docs/process/P2P_REFERENCE.md](docs/process/P2P_REFERENCE.md) | 1 — Source to Pay reference model |
| [docs/process/O2C_REFERENCE.md](docs/process/O2C_REFERENCE.md) | 1 — Order to Cash reference model |
| [docs/process/GAP_ANALYSIS.md](docs/process/GAP_ANALYSIS.md) | 2 — gap analysis + **live defects** |
| [docs/process/SCOPE_AND_HOOKS.md](docs/process/SCOPE_AND_HOOKS.md) | 3 — now/later + schema hooks |
| [docs/architecture/FOUNDATIONS.md](docs/architecture/FOUNDATIONS.md) | 4 — foundation design |

### Two corrections to our process understanding (from Microsoft Learn, official)

1. **Lead → Opportunity → Quotation is not Order to Cash.** It is *Prospect to Quote* (catalog 85),
   a separate upstream end-to-end process.
2. **Shipment / load / wave / packing slip is not Order to Cash.** It is *Inventory to Deliver*
   (catalog 60), officially *nested inside* both O2C and S2P.

Consequence: the wave / work / location-directive layer already in the codebase is I2D structure —
part of the "third process" is already built.

### Scope decisions

- **Order to Make / Plan to Produce (70): out of scope.** Officially supported — the catalog's own
  guidance cites a retailer marking Plan to Produce as *Not Applicable*. Needs **no schema hook**.
- Foundation work anchors on catalog processes **40** (Design to Retire — item master), **90**
  (Record to Report — accounting policies), **99** (Administer to Operate — reference data). These
  are officially upstream of both S2P and O2C, which is what keeps future processes additive.
- **Five foundations, not four.** Product dimensions was added as foundation zero: for a shoe
  retailer the variant is the stocking unit, and Microsoft documents that a product cannot be
  converted between variant models after implementation.

### Estimated cost

**9–12 weeks** for the foundation layer, plus defect remediation first. Stated plainly in
FOUNDATIONS.md §6 — this is a quarter of foundation work before new user-facing features.
**Not yet approved.**

### Implementation started 2026-08-15 — configuration foundation

Kubi approved proceeding. Sequence was revised (posting profiles and numbering moved **ahead of**
product dimensions) because they are what stops the ledger being wrong, and product dimensions do
not depend on them. Design rationale:
[docs/architecture/PARAMETERS_AND_CONFIG.md](docs/architecture/PARAMETERS_AND_CONFIG.md).

**Built and type-checked:**

| Artefact | What |
|---|---|
| `prisma/schema.prisma` | 6 new models: `PostingProfile`, `NumberSequence`, and `Finance/Sales/Purchase/Inventory Parameters`. All carry a nullable `legal_entity_id` forward hook. Additive only — no existing model touched. |
| [backend/prisma/sql/001_configuration_foundation.sql](backend/prisma/sql/001_configuration_foundation.sql) | Reviewed DDL. Verified additive: 6 `CREATE TABLE`, indexes, one FK on a new table. No `DROP`/`TRUNCATE`/`DELETE`/`ALTER` on anything pre-existing. Hand-edited to add `NULLS NOT DISTINCT` on all six unique indexes — Prisma cannot express it, and without it duplicate tenant-default rows slip through (the D-1 condition). |
| `src/shared/services/postingProfile.service.ts` | Most-specific-first resolver (ITEM → ITEM_GROUP → PARTY → PARTY_GROUP → ALL). **Unresolved throws; it never skips** — that is the D-4 fix. |
| `src/shared/services/numberSequence.service.ts` | Atomic allocator. `continuous=true` allocates on the caller's transaction (gapless, holds the lock); `false` allocates on its own connection (may gap, no contention). The Bolivian factura legal question now selects a flag instead of blocking design. |
| `src/infrastructure/database/provisionConfiguration.ts` | Derives posting profiles from the accounts a tenant **actually has**. Dry-run by default. Refuses to guess when several candidates exist. |

### Tax engine added 2026-08-15 — and a design correction

Kubi's requirement: the finance setup must be sellable in Turkey and Germany later, so everything
built now must be parameter-driven. That requirement **invalidated the first cut**: `SalesParameters`
originally held `vat_rate` / `turnover_tax_rate` as columns, which is Bolivia's shape parameterised,
not a tax engine. Caught before anything was wired; the tables were empty, so migration 002 replaced
those columns at zero cost. Full reasoning in
[PARAMETERS_AND_CONFIG.md §8](docs/architecture/PARAMETERS_AND_CONFIG.md).

Adopted D365's model: `TaxCode` (rate + rules) resolved by **`TaxGroup` (party) ∩ `ItemTaxGroup`
(product)**. One schema carries Bolivia (IVA 13% inclusive + IT 3% non-recoverable turnover), Turkey
(KDV 20/10/1 + tevkifat partial withholding above a threshold) and Germany (USt 19/7 + reverse
charge §13b + exempt intra-community supply).

**Bolivia does not regress, and it is tested rather than asserted:**
`src/__tests__/tax.service.test.ts` proves `calculateTax` with IVA13 + IT3 returns exactly what
`config/tax.ts resolveTax()` returns, using the real amounts from production. 19 tests, all passing.

### Migrations applied to production 2026-08-15

| File | Applied | Contents |
|---|---|---|
| [001_configuration_foundation.sql](backend/prisma/sql/001_configuration_foundation.sql) | yes | 6 tables, purely additive |
| [002_tax_engine.sql](backend/prisma/sql/002_tax_engine.sql) | yes | 5 tax tables; 4 nullable columns on customers/suppliers/products; drops 5 columns from `sales_parameters`, **verified 0 rows first** |

**Nothing is wired into the posting routes yet.** The tables are empty and no route reads them, so
applying the migrations changed no runtime behaviour. The IVA report hotfix (D-7) remains the only
behaviour change shipped.

### Provisioning preview against production — *read-only, verified 2026-08-15*

9 of 11 posting types resolve unambiguously. The 2 that do not are exactly the two defects:

```
AMBIG  AR          1103 "Cuentas por Cobrar" (22 lines)  ·  1201 "Activo Fijo" (4 lines)
AMBIG  VAT_OUTPUT  2103 "IVA Débito Fiscal" (11 lines)   ·  2105 "IVA Débito Fiscal" (4 lines)
```

The script stops on both rather than guessing. AR is easy for a human (`1201` is Fixed Assets; the
4 lines there are the D-6 damage). VAT_OUTPUT is a genuine Finance decision — which of the two IVA
Débito accounts becomes canonical, and how the other is closed out.

### Country independence — migration 003, `Account.category`

Requirement from Kubi: the finance setup must not need re-customisation per country. The remaining
hard-coding was **account numbers**, which are locally mandated and differ everywhere:

```
ACCOUNTS_RECEIVABLE = 1103 Bolivia PCG · 120 Alıcılar Turkey TDHP · 1200 German SKR04
VAT_PAYABLE         = 2103/2105 Bolivia · 391 Hesaplanan KDV Turkey
```

Adopted D365's **main account category** — a country-independent classification whose documented
purpose is to make the default financial reports work *"without making any modifications"*
([Plan your chart of accounts](https://learn.microsoft.com/dynamics365/finance/general-ledger/plan-chart-of-accounts)).

- `Account.category` (migration 003, one nullable column, applied).
- `shared/services/accountCategory.ts` — the category list and the
  `POSTING_TYPE_BY_CATEGORY` map. **Contains no account numbers.**
- `provisionConfiguration.ts` was rewritten to resolve everything by category. It too contains no
  account numbers, except in the one place that backfills old data from a template.
- COA templates now declare **chart + category + tax codes + tax groups together**. Onboarding a
  country is a JSON file, not a code change. Bolivia, Turkey (KDV 20/10/1, tevkifat, export
  exemption) and generic IFRS (domestic / EU reverse charge / export) all ship.
- `POST /seed-coa` now **refuses** to layer a template that would duplicate an existing account's
  *meaning* under a different code — the exact mechanism that produced D-1. Override with
  `?force=true`.

### Two safeguards added because the first implementation was wrong

1. **Backfill must agree by name, not only by code.** The bolivia-pcg template maps `1201` to
   ACCOUNTS_RECEIVABLE, but this tenant's `1201` is *Activo Fijo*. A code-only backfill would have
   labelled Fixed Assets as receivables and generated a posting profile from it — **recreating D-6
   with the script written to prevent it.** Mismatches are now reported and left uncategorised.
2. **A single candidate is not proof.** VAT_OUTPUT first resolved cleanly to `2105` only because its
   rival `2103` (11 posted lines) was unclassified and therefore invisible. The script now warns when
   a similarly-named uncategorised account exists. Threshold is **two** shared name stems — one
   produced false positives across a Spanish chart ("Cuentas por Cobrar" vs "Cuentas por Pagar").

### AR and VAT_OUTPUT — decided 2026-08-15, on evidence

Provisioning applied with explicit pins, recorded in each profile's description:

| Posting type | Chosen | Why | Rejected |
|---|---|---|---|
| `AR` | **1103** Cuentas por Cobrar | 22 posted lines; the ERP sales path; genuinely named AR | `1201` is *Activo Fijo* — a fixed-asset account. Its 4 lines / Bs 6 897 **are** the D-6 damage |
| `VAT_OUTPUT` | **2103** IVA Débito Fiscal | 11 posted lines, Bs 3 098,14; the IVA report reads it | `2105`, 4 lines, Bs 793,45 — must be closed into 2103 by correction journal |

Result: **11 posting profiles, 2 number sequences, tax codes IVA13 + IT3, groups DOM ∩ STD, and all
four parameter rows created.** Only `ROUNDING` is unconfigured (no OTHER_INCOME account exists yet;
not required to trade).

### Posting routes wired 2026-08-15 — the literals are gone

Every account-code literal has been removed from the posting paths. `grep -rn "code: '[0-9]"` over
`sales/`, `pos/`, `purchase/` and `hr/` now returns nothing, and no `journalEntry.count()` numbering
remains anywhere.

| Site | Change |
|---|---|
| `sales.routes.ts` — invoice, AR payment, return | Profiles + atomic voucher numbers |
| `sales.service.ts` — COGS on shipment | Profiles; the swallowing `catch` deleted |
| `pos.routes.ts` — sale, void | Profiles; **IT expense + payable lines added (D-3)**; revenue and COGS now share ONE guard (D-2) |
| `purchase.routes.ts` — receipt, AP payment | Profiles; the swallowing `catch` deleted |
| `hr.routes.ts` — payroll | Profiles via new `PAYROLL_EXPENSE` / `PAYROLL_PAYABLE` types |
| `finance.routes.ts` — manual journal | Atomic voucher number |

New `shared/services/posting.service.ts` is the single entry point. On unresolved profiles it throws
when `require_balanced_posting` is true, and logs at ERROR and skips when false — never silent
either way. An unprovisioned tenant defaults to strict.

**Verified end-to-end against the live test database**, not mocks:

```
AR         → 1103 Cuentas por Cobrar    (not Activo Fijo — D-6 clear)
VAT_OUTPUT → 2103 IVA Débito Fiscal     (matches the IVA report — D-7 clear)
sequence   → JE-2026-00081, JE-2026-00082, no collision (D-5 clear)
tax engine → gross Bs 1 299,00 → subtotal 1 149,56 · IVA 149,44 · IT 34,49
             identical to live factura #26
```

Tests: 77 passing. The 9 failures are the four pre-existing suites (Express middleware signatures,
`orderCounter` mock) — `git status` confirms those files were never touched.

### Turkish tevkifat — primary source, and it corrected two things

Researched from the legislation itself, not commentary: **KDV Genel Uygulama Tebliği I/C-2.1.3.4.1**
(Resmî Gazete 26.04.2014, no. 28983), obtained from the GİB PDF.

> "Kısmi tevkifat uygulaması kapsamına giren her bir işlemin **KDV dahil bedeli** […] fatura
> düzenleme sınırını aşmadığı takdirde, hesaplanan KDV tevkifata tabi tutulmaz. Sınırın aşılması
> halinde ise **tutarın tamamı** üzerinden tevkifat yapılır."

1. **The threshold is not a constant.** It is the VUK art. 232 invoice limit, reset annually:
   **12.000 TL for 2026** (VUK GT No. 588), 9.900 TL for 2025. The earlier 9.900 figure taken from
   community sources was last year's. `TaxCode` is date-effective, so a new row each January covers
   it — no schema change.
2. **The threshold is tested on the KDV-INCLUSIVE amount.** The first implementation compared the
   net and would have wrongly exempted transactions near the boundary. Fixed, with a test.
3. Once exceeded, withholding applies to the **whole** tax. Already correct.

**Still unvalidated:** which of the 2/10 … 9/10 ratios applies to which of the 15 service categories,
and who counts as a designated withholding agent. Flagged in the template `note` and surfaced by the
provisioning script as a `VALIDATE` line.

### Finance co-founder review document

Published as an artifact for the Finance co-founder: the seven defects, the two account decisions
with evidence, four correction entries awaiting approval, the five open Bolivian questions, and the
Turkish legal position. <https://claude.ai/code/artifact/5e778381-6217-4335-92e4-20998d566b83>

### Tax engine wired 2026-08-15 — `config/tax.ts` retired from the modules

The engine existed but nothing used it; amounts were still computed the old way. Every document now
resolves tax through `shared/services/documentTax.service.ts`.
`grep -rn "resolveTax\|TAX\." src/modules` returns nothing.

**A second defect surfaced while doing this.** `purchase.routes.ts` and `sales.service.ts` called
`TAX.iva(subtotal)` — the **hardcoded Bolivian constant**, not even the tenant's own `tax_config`.
Every tenant got 13% regardless of configuration. Invisible with one tenant; a correctness bug the
moment there are two. Fixed.

`Tenant.tax_config` survives only as a **fallback** for tenants with no tax setup, and the service
logs a warning when it is used. Delete it, and `config/tax.ts`, once every tenant is provisioned.

`POST /accounts/seed-default` no longer carries its own inline account list — it delegates to the
`bolivia-pcg` template. That inline list was the *other* half of D-1: a second definition of the
Bolivian chart that disagreed with the template on the meaning of `1201`. One definition now.

**Migration 004** adds `item_tax_group_id`, `tax_amount`, `tax_base` to `sales_order_lines` and
`purchase_order_lines`. Additive, nothing writes them yet — see the limitation below.

### D-4 is closed for this tenant

`require_balanced_posting` flipped to **true** after verifying all seven trade-critical posting types
resolve. A document that cannot post its journal now fails the whole operation.

### KNOWN LIMITATION — read before any multi-rate market

**Tax is computed on the document total, not per line.** Correct for Bolivia, where one rate applies
to everything. **Wrong for Turkey (KDV 20/10/1) and Germany (USt 19/7)** — an order holding one
standard-rated and one reduced-rate product has no single header rate.

The hook is in place (migration 004), so this is a service refactor rather than a migration against
live orders. **It must be done before selling into either market.** Documented in
`documentTax.service.ts`.

### Next decision points

1. **Correction journals** for D-2 (Bs 3 250), D-6 (Bs 6 897), D-3 (Bs 189,23), plus closing `2105`
   into `2103`. Test data, so low risk — but review with the Finance co-founder, because the same
   script will later run against real books.
2. **Per-line tax refactor** — required before Turkey or Germany. **Now covers three more document
   types**: quotation, requisition and RFQ lines all carry the same `item_tax_group_id` hook, so one
   refactor handles them together (§3b).
3. ~~**Purchase net-vs-inclusive.**~~ **RESOLVED 2026-08-16 from the legislation — see §3c.** The
   remaining question is not the arithmetic but whether the *historical* Bs 637,47 understatement
   needs correcting, and whether the Ley 1733 decree has been published.
4. **Turkish tevkifat ratios need legal validation** — the threshold is now sourced from primary law,
   but which of 2/10…9/10 applies per service category is not. Flagged in the template `note` and
   surfaced by the provisioning script.
5. The five Bolivian questions and the two account confirmations, in the review artifact.

### Not yet decided — flagged, not actioned

The repo has **no `prisma/migrations/` history**; it has been using `db push`. Adopting real
migrations requires baselining the existing schema first. `prisma/sql/` is an interim convention,
not an endorsement of it.

---

## 3b. Process Chain — BUILT overnight 2026-08-15→16

Kubi handed over the machine and asked for the processes to start where they actually start, and for
whatever got built to stay flexible for a future customer arriving with their own variations.

**Design doc: [docs/process/PROCESS_CHAIN.md](docs/process/PROCESS_CHAIN.md).** Read it before
touching any of this — it records what is official Microsoft behaviour, what is my recommendation,
and every deliberate deviation with its reason.

```
Prospect to Quote (85)   Lead ─▶ Opportunity ─▶ Quotation ─▶ Sales Order ─▶ (unchanged)
Source to Pay (75)       Requisition ─▶ RFQ ─▶ Purchase Order ─▶ (unchanged)
```

**This reverses a deferral.** SCOPE_AND_HOOKS.md §2 deferred requisition, RFQ, quotation and
lead/opportunity, keeping only the schema hooks. Kubi overrode that as owner, on productisation
grounds, and CLAUDE.md §4 already described these chains as the intended shape. The hooks that were
reserved (`source_document_type` + `source_document_id`) are exactly what got used.

### What was built

| Layer | Artefact |
|---|---|
| Schema | 11 tables + `Opportunity.originating_lead_id`; migrations [005](backend/prisma/sql/005_process_chain.sql) and [006](backend/prisma/sql/006_opportunity_originating_lead.sql), **both applied** |
| Vocabulary | `shared/services/documentChain.ts` — provenance enums, statuses, and the two official aggregation rules |
| Services | `modules/crm/crm.service.ts`, `modules/sales/quotation.service.ts`, `modules/purchase/requisition.service.ts`, `modules/purchase/rfq.service.ts` |
| Routes | `/api/v1/crm`, `/api/v1/sales/quotations`, `/api/v1/procurement` |
| Config | 5 number sequences + 5 default pipeline stages, added to `provisionConfiguration.ts` and provisioned |
| Frontend | 8 pages under `/crm`, `/sales/quotations`, `/procurement` + `StatusPill`, `DocumentChain`, `PageHeader` — **all written against design tokens, none against the legacy bridge** |

### Three things worth knowing

1. **Nothing here posts to the general ledger.** All five documents are pre-financial. The
   verification script records journal-entry and factura counts before and after and asserts they
   have not moved.
2. **Every step is optional and switchable in data.** Seven new parameters on Sales/Purchase
   Parameters decide which steps a tenant uses. A counter sale still goes straight to an order with
   `source_document_type = DIRECT`; all 47 historical sales orders and 14 purchase orders read
   `DIRECT` and were not touched.
3. **Pipeline stages are rows, not an enum.** `status` is semantic (code reasons about it),
   `stage_id` is a tenant-editable `SalesPipelineStage`. Same split as `Account.category` vs `code`.

### Three defects found by running it, not by reading it

- **Qualification destroyed the lead's origin.** Moving the opportunity's party to the new customer
  forced `lead_id` null, erasing where the deal came from — the one thing lead tracking exists to
  measure. Fixed by migration 006 (`originating_lead_id`), mirroring D365's `originatingleadid`.
- **The bid comparison rewrote its own history.** "Cheapest per line" counted only `RECEIVED` bids,
  so awarding — which rejects the losers — moved the marker onto the winner and erased the record of
  why a dearer vendor was chosen. Now counts every submitted bid, with a regression check.
- **A tendered requisition looked like it produced nothing**, because the awarded order points at the
  RFQ case rather than the requisition. The detail route now follows both routes.

### Verification — run this first in the morning

```bash
cd backend && npx tsx scripts/verifyProcessChain.ts          # 66 assertions, self-cleaning
cd backend && npx jest src/__tests__/documentChain.test.ts    # 19 unit tests
```

`verifyProcessChain.ts` drives both chains against the **real** test database with the real services,
tax engine and number sequences, then deletes what it made and asserts the counts return to the
baseline it started from. `--keep` leaves the documents for inspection in the UI — a kept run is
in the database now (LD/OPP/QT/PR/RFQ numbered ...00009 and up).

Screenshots: [docs/design/screenshots/](docs/design/screenshots/) — `chain-*.png`.

Test suite: **96 passing**, 9 failing — the same 4 pre-existing suites as before (Express middleware
signatures, `orderCounter` mock). No new failures.

### Not fixed on purpose — needs Kubi + the Finance co-founder

**The purchase tax arithmetic is incoherent.** `POST /purchase/orders` decomposes IVA out of the
subtotal (IVA13 is price-inclusive) and then adds it back on top:

```
Bs 2 500 → tax 287,61 → total 2 787,61       an effective 11,5%, not 13%
```

Either the subtotal is gross (add nothing) or net (tax is 325,00). It cannot be both. The new
requisition and RFQ paths **reproduce the existing behaviour exactly**, with a test asserting they
agree with the existing purchase path, so one fix will cover all three. Changing it moves every
purchase total in the system — that is a decision, not a bug fix.

### Left undone

- No quotation PDF or email; `sent_at` is recorded but nothing is actually sent.
- Purchase agreements, replenishment requisitions, vendor collaboration portal, RFQ questionnaires —
  hooks only. See PROCESS_CHAIN.md §6.
- Bare `@unique` on `sales_orders.order_number` / `purchase_orders.po_number` is still not
  tenant-scoped (NOW-list item 11). All **new** tables are scoped correctly; the old two need their
  own migration and were left alone deliberately.
- `skarpine-pos` still has uncommitted content. It is a separate repo and unrelated to this work —
  left untouched.

---

## 3c. Bolivian tax basis — DECIDED and fixed 2026-08-16

Kubi asked me to read the legislation and decide rather than hand the question back. Full reasoning,
sources and open questions: **[docs/process/BOLIVIA_TAX_BASIS.md](docs/process/BOLIVIA_TAX_BASIS.md)**.

**The purchase incoherence was the smaller half.** Reading Ley 843 to answer it showed the *sales*
side was wrong the same way.

**[OFFICIAL]** Ley 843 art. 5 — the tax "forma parte integrante del precio neto de la venta […] no se
mostrará por separado"; art. 7 applies the 13% to those totals. So Bolivian IVA is **13% of the
invoiced amount** (*IVA por dentro*), effective **14,9425%** of the true net. Art. 74 puts IT on
"ingresos brutos", i.e. the invoiced amount too.

The engine computed `gross − gross/1,13` = **11,50%**, and IT on the post-IVA net.

| On a Bs 1 299,00 factura | Engine (before) | Ley 843 |
|---|---:|---:|
| IVA débito | 149,44 | **168,87** |
| IT | 34,49 | **38,97** |

**Decision: one new column, `TaxCode.base_kind` (`NET` \| `GROSS`) — migration 007.** Not a fix in
the formula, because **Ley 1733 of 27 May 2026** moves Bolivia to IVA *por fuera* at a real 13% once
its reglamentary Decreto Supremo is published. `TaxCode` is date-effective, so that transition is a
new row, not a migration. **Whether that decree has already been published is unconfirmed — check
before relying on it.**

Purchase now goes through one helper, `computePurchaseMoney`: the agreed figure is the supplier's
gross, AP owes it in full, 13% is recoverable, and **inventory is debited net of the recoverable
tax** (capitalising reclaimable IVA was overstating stock and every COGS figure downstream).

**Historical impact, quantified, not restated** — `scripts/reportTaxBasisImpact.ts`:

```
27 issued facturas · invoiced Bs 34 632,00
UNDERSTATED IVA   517,96      UNDERSTATED IT   119,51      TOTAL  637,47
```

Test-database figures. **No factura was modified.** Whether a correction is filed is the co-founder's
call. The old test suite asserted equivalence with `config/tax.ts` and had been faithfully protecting
the defect; it now asserts the law (33 tests).

---

## 3d. Released-product setup — item groups, from the Learn documentation

Kubi's instruction: *"released product'ta item model grup, item group, procurement hierarchy — bu
detaylara bak, finansal ve muhasebe ilişkilerini çıkar; ne nereden başlar, neyi neden tanımlamalısın
oku ve kendine bir takip listesi çıkar."*

**The list: [docs/architecture/ERP_SETUP_CHECKLIST.md](docs/architecture/ERP_SETUP_CHECKLIST.md).**
It maps the official setup order tier by tier against what this codebase actually has, and produces a
dependency-ordered backlog. Use it to locate any proposed change before building it.

**The finding that mattered:** `PostingProfile.scope_kind` has accepted `ITEM_GROUP` since migration
001 and the resolver reads `ctx.itemGroupId` — but **no item group table existed**, so the most useful
axis of the posting matrix was unreachable. Same is still true of `PARTY_GROUP`.

**Migration 008** adds both mandatory released-product groups:

| | Answers | Drives |
|---|---|---|
| `ItemModelGroup` | HOW the item is valued and controlled | costing method per product, `stocked`, whether physical/financial updates post |
| `ItemGroup` | WHERE its money goes | the item axis of the posting profile matrix |

Deliberately **not** merged with `ProductCategory`, which is merchandising. F&O keeps them apart too;
conflating them means a shop re-shuffle silently repoints the ledger.

**The change guard is the interesting part.** **[OFFICIAL]** changing an item group after
transactions exist breaks ledger-to-subledger reconciliation. `PUT /products/:id` now refuses with a
409 that explains why, and requires `?force=true` plus a WARN log to proceed.

New endpoints: `GET/POST /products/setup/item-groups`, `.../item-model-groups`,
`GET /products/setup/coverage` (how many products are still unassigned — currently 7/8).

### Corrected same day — the group implied something false

The first cut seeded `FIFO` (stocked) and `SERVICE` (standard cost, not stocked), which made the
setup screen read as *"choosing STANDARD costing declares it a service"*. Kubi caught it from the UI.
It came from modelling the entity off an overview page instead of its parameter screen.

The documentation says the opposite three times: different costing models per item are normal;
`accrue liability on receipt` applies "regardless of whether you have a stocked product or a
not-stocked product"; and a **service item on a BOM must be stocked**. The axes are independent.

**Migration 009** adds the settings that were missing — accrual, deferred revenue and the four
process gates — turning the group into a real parameter screen. The seed is now `STOCKED-FIFO`,
`STOCKED-STD` and `NON-STOCKED`, with `STOCKED-STD` existing purely to occupy the cell the old pair
excluded. `reseedItemModelGroups.ts` renamed the originals in place, so assignments survived.

### Then wired — migration 008/009 stopped being declarative

Kubi's call: *"bunu öncelikle bir çözmemiz lazım"* — configuration nothing reads is worse than none,
because it looks like it works.

`shared/services/itemPolicy.service.ts` is the single resolver both posting and inventory consult.

| Setting | Now read by |
|---|---|
| **Item group** | COGS, purchase receipt and sales revenue postings — one debit/credit pair per group |
| **Stocked** | availability, reservation, fulfilment, COGS, purchase receipt |
| Registration / Picking / Deduction gates | purchase receipt · sales shipment · sales invoice |

A not-stocked item keeps no stock rows, batches or inventory transactions, posts no COGS, has its
purchase cost expensed rather than capitalised, and never reports "out of stock" — which is what made
a repair or a delivery charge unsellable.

**Proof:** `scripts/verifyItemPolicy.ts`, 21 assertions against the real database. The one that
matters: with an `ACCESSORY`-scoped COGS profile in place, one shipment posts **200 to 5101
[FOOTWEAR] and 30 to 5201 [ACCESSORY] in the same journal**. That is the item axis of the posting
matrix working end to end for the first time since migration 001 defined it.

Unassigned products are untouched: stocked, both postings on, no gates, costed by
`InventoryParameters` — identical to before.

**Still not wired, and why** (checklist items 5.11, 5.12):

- `receiving_requirements`, `post_physical_inventory`, `post_financial_inventory` — **there is no
  vendor invoice document**. The receipt *is* the posting, so there is nothing to gate and nothing to
  separate. Building that document also unblocks three-way matching.
- Accrual, deferred revenue, fixed receipt price, include physical value — accounts and the costing
  engine do not exist yet.
- A not-stocked purchase expenses to the `COGS` posting type because that is the closest configured
  account. A dedicated `PURCHASE_EXPENSE` type is correct — item 5.11.

---

## 4. Active Workstream — Frontend Design System (opened 2026-08-14)

Kubi's assessment: the ERP frontend "looks like AI slop" and needs to read as a
professional enterprise product. Investigation confirmed the root cause is **absence of a
design system**, not bad individual choices. Nothing has been changed yet — this is a
diagnosis plus an agreed direction, pending a go/no-go.

### Findings (measured across 88 `.tsx` files)

1. **Design tokens are dead code.** `src/app/globals.css` defines ~20 CSS variables
   (`--primary`, `--muted`, `--border`, `--radius`…) but `tailwind.config.ts` has
   `theme.extend: {}`, so none are wired into Tailwind. Every component therefore
   hardcodes palette classes.
2. **13 colour families in use**: gray 1826, red 255, blue 207, slate 179, green 149,
   indigo 107, amber 51, orange 48, purple 36, emerald 33, yellow 11, pink 9, teal 2.
   Note `gray` and `slate` are both used — two different neutrals in one product.
3. **Dark mode is a hack**: `html.dark body { filter: invert(1) hue-rotate(180deg) }` in
   `globals.css`, with a counter-invert on images. Breaks brand colour, shadows, and
   charts. Single biggest visual tell.
4. **Decoration pile-up**: `src/components/erp/StatCard.tsx` puts seven effects on one KPI
   tile — gradient background, dot-grid texture, corner glow orb, bottom accent line,
   count-up animation, spring hover lift, text-shadow.
5. **Two visual languages in one file**: `DarkCard` (maroon gradient) and `LightCard`
   (white with red left border) inside `StatCard.tsx`.
6. **No scales.** Radius: `rounded-lg` 317, `rounded-xl` 229, `rounded-2xl` 45,
   `rounded-md` 6. Shadow: sm/md/lg/xl/2xl plus coloured `shadow-indigo` (22×).
   Typography: arbitrary `text-[10px]`, `text-[11px]`.
7. **Two parallel component systems**: hand-rolled `src/components/ui/Button.tsx` (own
   variant map, `primary` = `gray-900`) alongside shadcn-style `src/components/ui/card.tsx`.
   `class-variance-authority` is installed but unused.
8. **Decorative randomness on data**: `AVATAR_COLORS` and the `colors` array in
   `src/app/(erp)/dashboard/page.tsx` assign colour by index, carrying no meaning.

### Separate real bug found

`src/app/(erp)/dashboard/page.tsx` ~line 36 (`KpiCard`): the trend badge renders
`up → bg-red-50 text-red-500` and `down → text-green-600`. Increase shows red, decrease
shows green — inverted for revenue-style KPIs. Not yet fixed; confirm intent per metric.

### Agreed remediation order

1. **Wire the tokens** — map the CSS variables into `tailwind.config.ts`
   `theme.extend.colors`. Collapse the palette to three roles: one neutral family (pick
   `zinc` *or* `slate`, not both), one brand accent, and semantic success/warning/danger.
2. **Real dark mode** — delete the invert filter, redefine tokens under `.dark`.
3. **Fix the scales** — two radii (`md` for controls, `lg` for cards), two shadows
   (`sm`, `md`), a six-step type scale, no arbitrary values.
4. **One Button/Card** — move to CVA, retire `Button.tsx`, migrate imports.
5. **Strip decoration** — reduce `StatCard` to border + number + delta. Keep Framer Motion
   only where it carries meaning (modals, drawers).
6. **Increase density** — tighten row height, padding, and font size toward Linear/Medusa
   levels. Generous whitespace reads as amateur in an ERP.

Steps 1–3 are one sitting and deliver most of the visible change; 4–6 are incremental.

### Reference repos to study

| Repo | Why |
|---|---|
| `medusajs/medusa` (`packages/admin`) | Closest domain: products, orders, inventory, returns. Tailwind. |
| `midday-ai/midday` | Finance/invoicing SaaS. Restrained palette, one radius, almost no shadow. |
| `dubinc/dub` | Production Next.js App Router SaaS; component discipline, dense lists. |
| `shadcn-ui/ui` | Not for components — for the correct `globals.css` + `tailwind.config` token wiring. |
| `twentyhq/twenty` | Open-source CRM; dense tables, record pages. (Emotion, not Tailwind — study layout, not code.) |
| `frappe/frappe-ui` + ERPNext | Real ERP conventions: list view, filter bar, bulk actions, document status flow. |

Also Linear and Vercel's own UIs as calibration for how little decoration is needed.

### BUILT 2026-08-15 — steps 1–5 done, commit `7718613`

Kubi approved and supplied three references: the
[ui-ux-pro-max skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), the
[motion library](https://github.com/motiondivision/motion), and a 21st.dev corridor hero for
sign-in. All three are in.

**Note on the skill's advice:** its reasoning engine recommended *glassmorphism* with
Fira Code. Rejected. Glassmorphism is exactly the decorated look this workstream exists to
remove, and section 4's own agreed direction is restrained enterprise with high density. The
palette direction (slate neutral, status colours) and the pre-delivery checklist were taken.

| Item | State |
|---|---|
| 1. Wire the tokens | **Done.** `theme.extend` is populated; `bg-surface`, `text-fg-muted`, `border-border` are real. Palette collapsed to one neutral (slate), one accent, four semantics. |
| 2. Real dark mode | **Done.** The `filter: invert()` hack is deleted. Two authored palettes; neither is pure white or pure black. |
| 3. Fix the scales | **Done.** Two radii, two shadows, six type steps, no arbitrary values. |
| 4. One Button/Card | **Done.** Button moved to CVA (already a dependency, previously unused). Card tokenised and tightened. |
| 5. Strip decoration | **Done for StatCard** — seven effects and two visual languages reduced to label, number, delta. |
| 6. Increase density | **Partial.** Card padding and row heights tightened; the list pages are untouched. |

**Design decisions taken without asking** (the open questions in this section are now answered
— override any of them by changing one token):

- **Neutral: slate.** The code used `gray` *and* `slate`; slate is cooler and reads operational.
- **Accent: deep teal.** Not blue or indigo, which is what every admin tool defaults to, and not
  red — an ERP is full of status and an accent colliding with "danger" is a usability problem.
- **Type: IBM Plex Sans + Mono**, replacing Inter. Drawn for enterprise software, real tabular
  figures, and not the safe default.
- **Storefront**: still shares the tokens, not yet given its own density scale.

### Sign-in and the entry moment — rebuilt once, commit `1242066`

The slideshow split-screen is gone. `image-stream-hero.tsx` runs a corridor of the store's own
photography on two rails.

**The first version put the corridor in a half-width column beside the form. Kubi rejected it,
correctly.** The reason is worth keeping: the component's geometry is measured in `cqw` — a share
of container **width** — so a tall half-width container collapses the corridor into a thin band
with dead space above and below. Scaling the path up makes the band bigger without making the
composition better. **Do not put this component in a narrow column.**

The corridor is now the page: full-bleed behind everything, sign-in card floating over it, which
is the composition the reference demo actually shows.

- **Two scrims, each with a job.** A linear one darkens top and bottom so the wordmark and footer
  copy hold at every frame of the loop; a radial one sits under the card so the form never
  competes with a photograph passing behind it.
- **The card is a solid surface, not frosted glass.** It carries a form, and form text over moving
  photography has to be readable at every frame, not most of them.
- `--panel` now tints the whole page ground rather than a dedicated left panel.

After a successful sign-in, `WelcomeCurtain.tsx` holds ~1.9s, names the product and the three
things it manages, then navigates. It is a fixed hold with a determinate bar — not a progress
claim — and it shortens under `prefers-reduced-motion`. The dashboard is prefetched during it.

Screenshots of both themes: [docs/design/screenshots/](docs/design/screenshots/).

### Defects found and fixed while doing this

- **Inverted KPI trend colours** (known, section 4) — a rise rendered red, a fall green. Now
  driven by a `polarity` prop, because rising *returns* or *cost* is bad news while rising
  revenue is not. The sign is spelled out so colour is never the only signal.
- **Decorative colour on data** — avatars and product swatches were coloured by list index, so a
  record changed colour whenever the list reordered.
- **`Button` silently ignored props** — callers passed `variant="outline"`, `variant="success"`
  and `as="span"`; none existed. The `as` case rendered a real `<button>` nested inside a
  `<label>`, which does not reliably trigger the file input.
- **Sidebar background was an inline indigo gradient**, invisible to every theme mechanism —
  which is why it stayed light after everything else went dark.
- **Two theme systems.** The sidebar had its own copy of the theme logic writing the same
  `localStorage` key as the new provider. One provider owns it now, with three states.

### THE IMPORTANT CAVEAT — the legacy bridge

`globals.css` ends with a **temporary bridge** mapping hardcoded palette classes onto dark
tokens. It exists because deleting the invert hack removed dark mode from the ~80 screens that
still hardcode colours: `text-gray-500` appears 374 times, `border-gray-200` 349, `bg-white` 176.

**It is scaffolding, not the design.** Its removal condition is written in place: the block goes
when a search for `bg-white`, `text-gray-*`, `border-gray-*` and `bg-slate-*` under `src/`
returns nothing. Never write a new component against those classes.

*Gotcha worth remembering:* the bridge must use flat descendant selectors (`.dark .bg-white`).
Written nested (`.dark { .bg-white {} }`) it compiles to nothing, because this project does not
load `postcss-nesting` — and it fails silently, leaving white cards on a dark ground.

### Waiting on Kubi — two components never arrived

Kubi sent three prompt blocks labelled *login*, *system theme*, and *login→dashboard transition*.
**All three were byte-identical**, all three the `image-stream-hero` corridor. The clipboard
evidently repeated the first. Only the login one was actionable and it is done.

The theme system and the entry transition currently use my own implementations
(`ThemeProvider.tsx`, `WelcomeCurtain.tsx`). Both work, but **Kubi intended specific components
for them.** Do not assume the current ones are the final choice; ask for the two missing blocks
before building further on either.

### Next steps (frontend)

1. Migrate list pages and the remaining `components/erp/*` off the bridge, deleting bridge lines
   as they become unused.
2. ~~Charts still hardcode colours~~ — **done 2026-08-16**, see §4b.
3. Density pass on list views: row height, padding, font size.
4. Decide whether the storefront gets its own density and type scale.

---

## 4b. CEO Dashboard workstream — opened 2026-08-16

**Design doc: [docs/design/CEO_DASHBOARD.md](docs/design/CEO_DASHBOARD.md).** Read it before
building any of this. Two inputs: HyperUI (chart composition) and the `ERP Gamification` panel at
`D:\ERP Gamification` (a separate app, read in full — the operations-panel reference).

Kubi's decisions, 2026-08-16: the panel lands at **`/reports/ceo-dashboard`**; sales orders get a
nullable promised-delivery date; and the map is in scope *as an architecture*, because the
e-commerce delivery leg is a real journey and a carrier tracking API will later feed it.

### Phase 0 done — charts are inside the design system for the first time

Charts were the last part of the product still outside it. `SalesChart.tsx` hardcoded hex and, in
dark mode, a **maroon palette left over from the visual direction abandoned when the accent became
teal**; `reports/page.tsx` carried its own six-colour array and cycled it.

- **A validated five-slot series ramp** is now in `globals.css` (`--series-1…5`, both themes) and
  wired in `tailwind.config.ts`. Chosen with the `dataviz` skill's checker — lightness band,
  chroma floor, CVD separation, normal-vision floor, contrast — **not by eye. Re-run that check
  before editing any value.** Note slot 1 is deliberately *not* `--accent`: the accent at its own
  step fails the chroma floor and reads grey as a large fill.
- `src/lib/chartTokens.ts` is the **one sanctioned place** that resolves tokens to colour strings,
  because Recharts writes SVG attributes and cannot take a Tailwind class. Chart components still
  name roles, never colours. It watches the `dark` class rather than the theme context, so it works
  outside `ThemeProvider`.
- **Status colours are reserved for the traffic light** and are never series colours.

Three defects fixed on the way, each one colour making a false claim:

| Was | Why it was wrong |
|---|---|
| Peak revenue bar painted with the **success** colour | Spent a reserved status colour on a non-status, and coloured by **rank** — changing the date range repainted whichever bar won. Now a direct label. |
| MoM growth line drawn in **green** | Claimed every point was good news, including the negative months. |
| Revenue-by-city pie **cycled** a six-colour array by index | A city changed colour when the list reordered. Now the ramp is consumed in order, capped at five, tail folded into "Other". |

**And a real bug, unrelated to colour:** the whole reports page rendered **`₺` — Turkish lira — on
a Bolivian tenant**. Same family as `PurchaseOrder.currency` defaulting to `TRY`. Replaced by one
`CURRENCY` constant with the real fix (tenant currency from configuration) written down in place;
six hardcodes became one, which is not the same as fixed.

**Verified in the browser, both themes, no console errors.** `npx tsc --noEmit` clean on every
file touched (the pre-existing errors in `inventory/counting/[id]` and `sales/orders/[id]` are
untouched and unrelated). The series tokens were read back out of the live DOM per theme to prove
the CSS variables actually resolve, rather than trusting the screenshot:

```
light  175 84% 32% · 19 90% 43% · 243 75% 59% · 26 90% 37% · 293 69% 49%
dark   173 80% 36% · 19 74% 56% · 235 65% 65% · 40 73% 44% · 292 62% 60%
```

The peak label clipped at the top of the plot on first render — fixed by raising the chart's top
margin. That is exactly the class of thing the validator cannot catch and only looking can.

### Running it found two things reading it did not — both block the CEO dashboard

1. **The sales documents carry no inventory dimension.** `getSalesByCity` inner-joins `sites`, so
   **"Revenue by City" has never returned a row** and failed silently as a blank card.

   My first reading of this was wrong and **Kubi corrected it: site is the warehouse's site.**
   `Warehouse.site_id` is not-null, so `SalesOrder.site_id` is a derived copy, never an
   independent attribute — "which site owns the order" was a false question. The real gap is one
   level down:

   ```
   sales_orders  51 rows · site 0 · warehouse 10     DIRECT 48 → 7 with warehouse
                                                     QUOTATION 3 → 3 with warehouse
   ```

   The process-chain documents set the warehouse every time; **the old direct sales path sets it
   on 7 of 48**, because `warehouse_id` is optional and unenforced (`sales.service.ts:53`,
   `pos.routes.ts:48`). Fix warehouse first, derive site from it, backfill the 10 that can be.

   **And it is not only reporting.** `sales.routes.ts:504` skips the warehouse filter when the
   order has none, so a **return** restores stock to whichever row `findFirst` reaches first.
   Invisible on one warehouse; this tenant has three.
2. **The site master would mislead the map on day one.** Two Turkish sites (`Istanbul`, `Ankara`,
   country `TR`) in the Bolivian tenant, and `Santa Cruz Store Site` has **`city = 'Bolivia'`** — a
   country in the city column. Geocoding that drops the store ~400 km from Santa Cruz: a map that
   looks plausible and is wrong, which is worse than one that looks broken.

Blank chart cards now state the reason instead of rendering an empty rectangle
(`EmptyChart` in `reports/page.tsx`) — a blank box reads as "broken" or "still loading", and a
reader cannot tell either from "there is genuinely nothing here".

Both findings are written up with evidence in
[CEO_DASHBOARD.md §5.3–5.4](docs/design/CEO_DASHBOARD.md).

### BUILT — migration 011 and the dimension resolver, applied 2026-08-17

Kubi approved all three. **[OFFICIAL]** grounding, and it is what shaped the design:

> "The site dimension is mandatory, and **you can set the warehouse dimension to be mandatory**."
> — [Master planning and multisite functionality](https://learn.microsoft.com/dynamics365/supply-chain/master-planning/master-plan-multisite-functionality)
>
> "the demand order is expected to indicate **where the order must be shipped from** (that is,
> what site and warehouse)." —
> [Flexible warehouse-level dimension reservation](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/flexible-warehouse-level-dimension-reservation)

Site mandatory always, warehouse mandatory **by choice** — so the switch is a parameter, not a
NOT NULL. And the second sentence is a description of the return bug.

| Artefact | What |
|---|---|
| [011_inventory_dimensions_on_demand.sql](backend/prisma/sql/011_inventory_dimensions_on_demand.sql) | **Applied.** `sales_orders.requested_delivery_date`, `sales_parameters.default_warehouse_id` + `require_warehouse_on_sales_order`, `purchase_orders.site_id`, backfill, 3 indexes. Additive only. |
| `shared/services/inventoryDimension.service.ts` | The single place site is written. Precedence explicit → register → parameter → sole-warehouse → none. Throws on an unknown warehouse rather than falling back; throws on nothing-resolved when the tenant requires it. |
| `sales.service.ts` · `pos.routes.ts` · `quotation.service.ts` | All three creation paths now resolve dimensions. **`site_id` is no longer accepted from callers** — accepting both let them disagree. POS now copies the register session's warehouse, which it never did. |
| `sales.routes.ts` return path | Resolves a warehouse instead of skipping the filter, and orders by `id` so an unresolvable case is at least repeatable. |
| `scripts/provisionSalesDimensions.ts` | Reports candidates, **refuses to guess**. |
| `scripts/verifyInventoryDimensions.ts` · `verifySalesDimensionsLive.ts` | The invariant, and a live self-cleaning round-trip. |

**Backfill result — every row that has a warehouse now has the matching derived site:**

```
sales_orders          51 total · 10 warehouse · 10 site
purchase_orders       18 total · 18 warehouse · 18 site   (100% — PO warehouse is NOT NULL)
sales_quotations       6 total ·  6 warehouse ·  6 site
purchase_requisitions  5 total ·  5 warehouse ·  5 site

41 sales orders have no warehouse and stay NULL — nothing to derive from.
Inventing a site would put revenue in a city it did not happen in.
```

**Verified:** `verifySalesDimensionsLive.ts` 9/9 against the real database (including "a `site_id`
passed by the caller is ignored"), `verifyProcessChain.ts` all checks passed with counts back to
baseline, `npx jest` 119 passing — the 4 failing suites are the same pre-existing ones. Backend
type-check clean outside those test files.

**A bug the live run caught that reading would not have:** Prisma rejects `"2026-09-30"` for a
`@db.Date` field ("premature end of input, expected ISO-8601 DateTime"). A date from a form would
have failed at runtime while type-checking cleanly. `toDateOrNull` in `sales.service.ts` normalises
it, and returns null on garbage rather than losing the order.

### ⚠ NEEDS KUBI — the default warehouse is deliberately unset

`provisionSalesDimensions.ts` refuses to pick, and the evidence shows why the obvious heuristic is
wrong:

```
code        name                   site                     city        country  SOs  POs  on_hand
WH-001      Warehouse Bolivia      Warehouse Bolivia        La Paz      BO         3    4       54
WH-IST-01   Istanbul Main Store    Istanbul                 Istanbul    TR         7   14       90
WH-MAIN     Santa Cruz Store       Santa Cruz Store Site    Bolivia     BO         0    0       60
```

**The busiest warehouse is the Turkish template leftover.** A script optimising for usage would
enshrine `WH-IST-01` as the default for a business that trades in Bolivia, and every future order
would inherit it. So nothing is pinned and `require_warehouse_on_sales_order` is still FALSE.

Note also `WH-MAIN`'s site has `city = 'Bolivia'` — a country in the city column, and it holds 60
units while having zero documents.

```bash
npx tsx scripts/provisionSalesDimensions.ts --warehouse WH-MAIN --require
```

**Provisioned 2026-08-17 on Kubi's call:** `WH-001 / Warehouse Bolivia` is the sales default and
`require_warehouse_on_sales_order` is now **TRUE** on the test tenant. Worth knowing: the warehouse
chosen is also the *least* configured one — 1 zone, 1 location, 54 units on hand.

### Warehouse setup screen — rebuilt 2026-08-17

`/warehouse/locations` already existed (390 lines, warehouse→zone→location drill-down). It was
**extended, not replaced**, and rewritten against design tokens.

**[OFFICIAL]** the documented order is zone groups → zones → location types → **location formats**
→ location profiles → locations, with a **Location setup wizard** for bulk creation, and the rule
that a location name may not exceed **10 characters including separators**
([Configure locations in a WMS-enabled warehouse](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/tasks/configure-locations-wms-enabled-warehouse)).

**What we took, and what we did not.** Zones and locations (both already in the schema) plus the
naming rule. We did **not** create master tables for location formats, profiles, types or zone
groups — five master tables before a shoe retailer can name a shelf is the enterprise weight this
product exists to avoid. **The cut is a behaviour cut, not a schema cut**: `WarehouseLocation`
already carries `aisle`/`rack`/`shelf`/`bin`, `location_type`, `is_pick_location`,
`is_receive_location`, `max_weight`, `max_volume` — the data a location profile would hold — so
profiles later become a table those columns point at, not a migration.

| Artefact | What |
|---|---|
| `modules/warehouse/locationFormat.service.ts` | Segment model + the 10-character rule + a 2,000-per-run cap. Refuses with an explanation rather than truncating. |
| `POST /warehouse/locations/bulk` | The Location setup wizard equivalent. **`dry_run` is the default** — a range that looks small often is not, and four segments of 1–10 is ten thousand bins. Existing codes are skipped, not errored. |
| `GET /warehouse/overview` | One read: warehouses, sites, zone/location counts, on-hand, doc counts, and which one is the sales default. |
| `POST /warehouse/warehouses` | **No longer invents a site.** It used to auto-create `SITE-<code>` with `city: 'La Paz'` defaulted — that is exactly how this tenant got one site per warehouse and a site whose city is `'Bolivia'`. A site is now chosen, or created explicitly with real values. |

The screen leads with what is *wrong*, not the happy path: no default warehouse, warehouses
spanning two countries, stock in a warehouse with no locations, and a ⚠ beside any city that is
actually a country name (resolved via `Intl.DisplayNames`, so there is no country table to
maintain).

### CEO dashboard — BUILT, at `/reports/ceo-dashboard`

Sidebar: **Management → Reports → CEO dashboard**.

The architecture from the gamification panel, adapted: **the server sends facts, the browser
derives everything time-dependent.** `ceoDashboard.service.ts` returns statuses and dates and
deliberately has **no `health` field**; the page computes `progress = clamp((now − start) /
(due − start), 0, 1)` against a clock that ticks every minute. A colour computed on the server is
stale the moment it is sent, and it makes the 15-minute refresh a free parameter.

Two rules are enforced in code and must stay: **no person is ever named** (there is no
`assigned_to` or `created_by` anywhere in the service, and the panel header says "situations, not
people"), and **no time window means no colour claim** — work with no promised date is grey and
labelled "no date", never green.

That second rule is doing real work right now:

```
Order to Cash  37 in flight · Bs 84 457 · 8/1/5/2/21 across Draft→Confirmed→Shipped→Invoiced→Paid
Source to Pay  18 in flight · Bs 20 585 · 2/0/3/2/11
coverage: 37 of 37 open sales orders have NO promised delivery date
          27 of 37 have no warehouse, so they group under "(no site)"
```

So the O2C traffic light is entirely grey and the panel says so in a banner rather than showing a
reassuring green bar. S2P has real dates (`expected_date`) and immediately surfaced three overdue
purchase orders, the worst 138 days late.

**Verified in the browser, both themes, no console errors.** Screenshots:
[docs/design/screenshots/](docs/design/screenshots/) — `ceo-*.png`, `warehouse-*.png`.

**Gotcha that cost a screenshot cycle:** `bg-series-1` rendered as nothing until the frontend dev
server was restarted. Adding colours to `tailwind.config.ts` requires a restart — already recorded
in the design-system notes, and it fails silently rather than erroring.

### THE MAP — built 2026-08-17, after Kubi rejected the panel without it

The first cut delivered floors 1 and 3 (process cards + station strip) and deferred the map to a
Phase 3, on the grounds that there were no coordinates. **Kubi overruled that, and the reason is
worth keeping:** *"eğer veri göremezsem ben bilirim ki veride bir sıkıntı var ve bunu
düzeltebilirim, ancak sen mapi direkt almazsan bu çok büyük bir sıkıntı olur."* A map that shows
gaps is a diagnostic; a missing map is just missing.

| Artefact | What |
|---|---|
| [012_geo_points.sql](backend/prisma/sql/012_geo_points.sql) | **Applied.** `geo_points` cache + `sites.latitude/longitude` manual override. |
| `shared/services/geocoder.service.ts` | Nominatim, with the usage policy enforced in code: 1 req/sec queue, real User-Agent, permanent caching, **and failures cached too** so an unresolvable address is asked about once rather than on every page load. |
| `scripts/warmGeocache.ts` | Deliberate warm-up. The panel reads **cache-only** — a dashboard must never wait on a rate-limited external service. |
| `components/erp/OperationsMap.tsx` | Mercator SVG, world topojson vendored to `public/geo/` (no external host). Coastlines generated once and the camera applied as a transform, because Mercator is affine. Camera fits the data — no country is hardcoded. |

**Precedence, and why the cache is a separate table rather than columns on Site:** a geocoder answer
is a *guess*. `site.lat/lng` → `geo_points source=manual` → `nominatim` → `none`. Writing the guess
onto Site would make it indistinguishable from a fact and let a re-run silently overwrite a human's
correction.

**The map never invents a position.** An agent missing an endpoint is absent and counted in the
caption. Live result:

```
28 of 55 agents on the map · 27 not shown
could not place: eindhoven, bolivia · bo
```

Those two strings are data defects, exactly as Kubi predicted: a **country name sitting in the
country CODE column**, and a record with a country and no city. The panel names them under the map
so they can be fixed.

### Finance / GL checked against Learn — one real gap

Full write-up: **[CEO_DASHBOARD.md §8b](docs/design/CEO_DASHBOARD.md)**.

**Matches, and closely:** main account + category, account type / normal balance, journal-based
posting with voucher sequences, fiscal periods, and — the one worth noting — `PostingProfile`'s
most-specific-first resolver *is* Business Central's **General Posting Setup**, the business ×
product posting-group matrix that maps parties and items to GL accounts.

**The gap: financial dimensions do not exist.** No dimension column on `JournalLine`, no
`AccountStructure`, no `Ledger`/`LegalEntity` entity. CLAUDE.md §3 argues *for* skipping the generic
dimension framework and that reasoning still holds — but the same section requires a deferred
capability to ship with a schema hook, and **this one has none.**

**The cost is already concrete.** Sales orders now carry a derived `site_id`, so "value by site"
works on the document side — but the dimension never reaches `JournalLine`, so **a P&L by store
cannot be produced at all.** For a three-store retailer that is close to the first question an
owner asks.

**[REC]** two nullable FK columns on `JournalLine` (`site_id`, `dimension_2_id`) rather than a
generic key/value table — the axis a retailer actually has, every query a plain join, no commitment
to account structures. **Not implemented; needs the Finance co-founder**, because which axes deserve
a column is an accounting decision.

---

## 5. Key Decisions

- **POS lives in its own repository** (`skarpine-pos`), not in the monorepo. Note: older docs call
  it a git submodule; there is no `.gitmodules` — it is a nested independent repo.
- **D365 F&O patterns are deliberate** in the warehouse and finance modules — waves, work
  templates, location directives, journal-based posting. Do not "simplify" these away;
  they are the product's differentiator and match Kubi's domain expertise.
- **Bolivia tax compliance** (facturas, IVA) is a first-class requirement, not an add-on.
- **Frontend visual direction**: restrained enterprise, high information density, minimal
  decoration. Explicitly *not* the gradient/glow/animation style currently in the code.

---

## 6. Known Issues / Blockers

### CRITICAL — live accounting defects found 2026-08-15, **verified against production same day**

Detail and evidence in [GAP_ANALYSIS.md §0](docs/process/GAP_ANALYSIS.md).
**§0.0 holds the production verification** — all defects confirmed with amounts.

**Headline:** the live tenant has **both** charts of accounts (seed applied 2026-03-31, JSON template
applied on top 2026-06-01, 29 accounts, two different `IVA Débito Fiscal` accounts). Both D-2 failure
modes therefore occurred in sequence, and a seventh defect was found:

- **D-7 (new, most urgent)** — the IVA report reads only `2103`; POS credits `2105`. **Every IVA
  declaration since 2026-06-01 understates débito fiscal by Bs 793,45** — all POS output tax is
  missing from the filing.
- **D-6 is ACTIVE, not latent** — Bs 6 897,00 of POS receivables sit in `1201 Activo Fijo`.
- **D-2** cost Bs 3 250,00 of COGS with no revenue (5 orphan journals, 2026-04-05).
- **D-3** Bs 189,23 of POS IT never posted.
- Trial balance is clean — no unbalanced entries. Damage is in account selection and missing
  entries, not corrupt double-entry.

Summary of the original findings:

- **D-1** Two incompatible charts of accounts exist. `bolivia-pcg.json` and the `finance.routes.ts`
  seed assign different codes to the same accounts — `1201` is *Cuentas por Cobrar* in one and
  *Activo Fijo* in the other.
- **D-2** POS and ERP Sales are hardcoded to different charts. Depending on which COA a tenant was
  provisioned with, **either** ERP facturas post no GL entry at all, **or** every POS sale posts
  COGS and inventory relief with no revenue entry. Both fail silently.
- **D-3** POS never posts IT (3%). Every POS sale under-accrues the transaction tax.
- **D-4** Posting failures are silent — truthiness guards and a swallowed `try/catch` let documents
  be created with no journal entry and no error.
- **D-5** Journal entry numbers are generated from a row count against a globally-unique column —
  concurrent postings collide.
- **D-6** Latent: POS resolves AR to `1201`, which is *Activo Fijo* in the seed COA. Fixing D-2
  without this would activate the bug.

**Not yet fixed. Not yet verified against the production database** — which COA the live tenant uses
determines which of the two D-2 failure modes is active. **That check is the single most urgent
next action.**

### Other

- Production readiness scored 4/10 and security 5/10 in the April 2026 audit; see
  `Roadmap_Improvement_Prod.md` for the gap list. Not yet closed.
- Frontend has no design system (section 4).
- Inverted KPI trend colours on the dashboard (section 4).
- `skarpine-pos` has uncommitted content in the working tree. Separate repo, unrelated to the
  process-chain work; deliberately left untouched.
- ~~Purchase tax arithmetic is incoherent~~ — **fixed 2026-08-16** (§3c). What remains open is the
  historical Bs 637,47 and the Ley 1733 decree status.
- **Silent-failure dialogs** — the first three dialogs written for the process chain rendered their
  error *behind* the modal and disabled the submit button with no stated reason, so a rejected
  request looked like a dead button. Kubi hit this on the requisition form. Fixed by
  `components/erp/Dialog.tsx`, which takes the error and the blocking reason as props so a caller
  cannot forget. **Any new dialog must use it.**
- `sales_orders.order_number` and `purchase_orders.po_number` still carry a bare `@unique` rather
  than a tenant-scoped one. All tables added in migrations 005/006 are scoped correctly.
- Turkish template leftovers in a Bolivian product: `PurchaseOrder.currency` defaults to `TRY`,
  `Site.country` defaults to `TR`. Four different currency defaults across the schema, no exchange
  rate table.

---

## 7. Open Questions

### Blocking the foundation design — need Kubi / the Finance co-founder

- **Factura sequentiality:** does Bolivian law require a strictly gapless series, or gaps with
  documented justification? Determines whether numbering can allocate early or needs a reservation
  table with explicit voiding. (FOUNDATIONS.md §4.3)
- **Do Bolivian facturas legally require line detail?** `Factura` is header-only today. If yes, this
  is a compliance gap and not only an architectural one. (O2C_REFERENCE.md §6)
- **Is *nota de crédito-débito* a separate legal numbering series** from the factura series?
  Determines whether numbering must support multiple independent legal series.
- **When is IVA *crédito fiscal* claimable** — at product receipt or at the supplier's factura?
  Skarpine recognises it at receipt today. If it is claimable only against the factura, current
  posting has a tax-timing error. (P2P_REFERENCE.md §7)
- **Landed cost:** does the business import shoes directly? If yes, deferring landed cost is
  recommended *against* — current margins would already be misstated and closed periods cannot be
  restated later. (SCOPE_AND_HOOKS.md §4)
- **Approve or re-scope the 9–12 week foundation estimate** before any implementation starts.

### Frontend (unchanged)

- Which neutral family becomes canonical — `zinc` or `slate`?
- What is the brand accent? Current code leans red/maroon (`StatCard`) but blue and indigo
  appear widely; the intent is unclear from the code alone.
- Should the storefront (`src/app/(store)`) share the ERP design system or keep a distinct
  consumer-facing identity? Recommendation: shared tokens, different density and type scale.
