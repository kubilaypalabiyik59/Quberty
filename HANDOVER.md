# HANDOVER — Skarpine ERP

> Living context document. Read this first in a new session.
>
> **Codex/Claude collaboration:** after this file, read
> [docs/collaboration/CODEX_MEMORY.md](docs/collaboration/CODEX_MEMORY.md) and
> [docs/collaboration/CODEX_CLAUDE_WORKLOG.md](docs/collaboration/CODEX_CLAUDE_WORKLOG.md) before
> continuing an active shared work item.
>
> **Smoke-testing the 2026-08-16 session? Start at [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md)** —
> what to click, what to expect, and the four things that need Kubi rather than me.
>
> **Standing rules. They bind all future work.**
> 1. Everything built is **parametric and configurable** unless Kubi says otherwise.
> 2. For anything he asks: **research the official process first** (the real Learn parameter screens,
>    not overview pages) **and record what we are NOT building**, so future scope is visible.
>    The artefact is [docs/architecture/ERP_SETUP_CHECKLIST.md](docs/architecture/ERP_SETUP_CHECKLIST.md).
>
> **Added 2026-08-17:**
> 3. **Setup is module-scoped.** Every setting lives under the module that owns it — one module, one
>    Setup area, one Parameters record. Never a global settings page. Where two modules need the same
>    value, one owns it and the other reads it through a **stated fallback**, the way D365 inherits the
>    reservation default from Accounts receivable parameters.
> 4. **Everything must stay enhanceable.** A setting added today must not block the richer version of
>    itself — a boolean that will later want three values is an enum from the start.
> 5. **Verify everything through Microsoft.** Cite the Learn page. Where none exists, label it
>    **[REC]** and say so.
>
> **Added 2026-09-07 — Kubi's permanent product rule.** It restates rules 1, 3 and 4 as one
> standing decision and adds the part that was missing:
> 6. **Existing hard-coding is remediated incrementally, when its process is next touched.** This is
>    not authorisation for a sweeping refactor. It means a process is not finished while the code
>    path being changed still resolves configuration with an `if`. Full text, including the schema-
>    hook obligation, in
>    [docs/collaboration/CODEX_CLAUDE_WORKLOG.md](docs/collaboration/CODEX_CLAUDE_WORKLOG.md) §4.1.
>    **It must be carried into every future implementation prompt.**
>
> The registry of what each module owns, what is built and what is missing:
> [docs/architecture/MODULE_SETUP_AND_PARAMETERS.md](docs/architecture/MODULE_SETUP_AND_PARAMETERS.md).

**Last updated**: 2026-08-18 — **a Setup UI so all of it is configurable without this repo**
(§4i). Earlier: **seven setup tasks: financial dimensions + department master,
WH-MAIN putaway, the IT tax side, the correction journals POSTED, trade agreements, factura
lines** (§4h — read §4h.8, one switch is deliberately off).

Earlier: **vendor invoice, product receipt and three-way matching built**
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
- `backend/` — Node.js + Hono + Prisma
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
- `skarpine-pos/` — separate nested Git repository (mobile/terminal POS) with its own remote
  (`Quberty-POS`), **not tracked by this repository at all** since 2026-09-07. It was never
  *configured* as a Git submodule, because no `.gitmodules` entry ever existed — but the parent
  index nevertheless **represented it as an unregistered gitlink**, a pinned SHA that `git status`
  reported while `git submodule` could not see it. That is why older documents call it a submodule.
  The V1 reconstruction commit removes the gitlink. The directory remains physically present,
  committed and clean. Commit it from inside that directory; never from the parent.
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

**Working-tree state, corrected 2026-09-07**: this section previously reported the POS as having
uncommitted content. That is no longer true. The POS work was committed on its own branch
`codex/wip-incomplete-pos-2026-09-06` (`09fa4de`) and pushed to the private remote `Quberty-POS`;
its tree is clean. The commit is a **preservation snapshot of an incomplete application**, not a
completion claim — a POS type-check still reports five known TypeScript errors. Commit it from
inside that directory, never from the parent.

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
- ~~`skarpine-pos` still has uncommitted content. It is a separate repo and unrelated to this work —
  left untouched.~~ **Resolved 2026-09-06:** committed on its own branch and pushed to the private
  remote `Quberty-POS`; the tree is clean. See §5.

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

## 4c. Financial dimensions — design done, and the prerequisite BUILT 2026-08-17

Kubi: *"bırak mağazayı, kocaman bir mağazanın içerisindeki departmanlar bazında bile finansal takip
isteyebilirler."* Store level is not the requirement; store **and** department is, and the axis list
has to stay open.

**Design doc: [docs/architecture/FINANCIAL_DIMENSIONS.md](docs/architecture/FINANCIAL_DIMENSIONS.md).**
Read it before building any of this. It records the Learn model, what we take, what we cut, and the
defaulting order.

### The three findings from Learn that shaped it

1. **[OFFICIAL]** *"Don't create financial dimensions that have values that are not reusable"* — with
   an explicit forbidden list: documents, sales orders, purchase orders, transactions, checks,
   serials. Non-reusable values explode the chart of accounts and the damage lands at year-end close
   and consolidation. Those belong in **financial tags**, a separate mechanism.
   The usable test: *if changing it after posting would change a financial statement it is a
   dimension; if it would not, it is a tag.*
2. **[OFFICIAL]** the defaulting order is strict, and Microsoft concedes the framework *"can't
   determine whether a blank dimension value was intentionally left blank, or whether the default
   entry wasn't made"* — their workaround is a dimension value literally named `Blank`. We do not
   take that. NULL means not coded, and every report shows `(unassigned)` explicitly.
3. **[OFFICIAL]** *"the more dimensions that are created and used in a dimension set, the slower
   transaction entry, import, and processes become."* Axis count is a budget, not a free parameter.

### Shape chosen: 4 fixed slots + a registry

Not two hardcoded FKs (answers today's question, blocks Kubi's actual one) and not EAV (the shape
CLAUDE.md §3 names as the thing not to copy). `DimensionAttribute` + one `DimensionValue` table for
every axis + `JournalLine.dimension_1..4_id`. A P&L by store is `GROUP BY dimension_1_id` on one
index. Slot 5 is a nullable `ADD COLUMN`, which rewrites nothing in PostgreSQL 11+.

**Kubi's decisions, 2026-08-17:** store dimension **REQUIRED on revenue and COGS from day one**
(not optional-then-tighten); second axis is the **organisational** department, not the merchandising
one — which means it is blocked on a real `Department` master, because `Employee.department` is free
text today ([schema.prisma:1237](backend/prisma/schema.prisma#L1237)).

### Step 0 — `postJournal()`, BUILT and verified

Kubi's condition: *"bu yapı parametrik ve konfigüre edilebilir olmalı ve davranışın Learn'de
anlatıldığı gibi olması gerekmekte, aksi takdirde büyük sıçarız."*

There were **16 `journalEntry.create` call sites across 8 files**, each hand-building its lines. That
is why this had to come first: adding dimensions meant editing 16 arrays, and a missed one is
invisible — the entry still posts and still balances, it is merely uncoded.

**Three things were found by counting those sites, none of which was the dimension question:**

| Finding | Evidence |
|---|---|
| **Debits = credits was asserted for exactly ONE writer** — the manual journal route. The other 15, every machine-generated posting in the product, wrote whatever they were given | `finance.routes.ts:231` was the only check |
| **The closed-period check was in that same one route.** A POS sale, a product receipt or a payroll run posted into a closed period with nothing noticing | same |
| **`allow_posting_to_closed_period` and `rounding_tolerance` were declared in migration 001 and read by NOTHING** | `grep` returned only the schema and the DDL |

`shared/services/journal.service.ts` is now the single writer. Everything in it reads
`FinanceParameters` — no rule is baked into code.

**[OFFICIAL]** grounding for the one-voucher-per-call shape: *"Vouchers always represent individual
transactions, never a group of transactions"*
([One voucher](https://learn.microsoft.com/dynamics365/finance/general-ledger/one-voucher)). D365
gates grouping behind *Allow multiple transactions within one voucher* and documents it as breaking
settlement, tax calculation, reversal and inquiry. We do not offer it.

**Two real defects surfaced while wiring, both invisible before:**

- **Payroll did not balance when there were deductions.** It debited gross and credited **net** — the
  withheld amount was credited to nothing at all. New posting type `PAYROLL_DEDUCTION_PAYABLE` and a
  matching account category; deliberately NOT the employee payable, because one is owed to the
  employee on payday and the other to the state on a filing deadline. A zero-deduction payroll posts
  exactly the two lines it always did. **⚠ A payroll WITH deductions now needs that one account
  configured, or it fails loudly.**
- **POS numbered its vouchers from a different source.** `nextJournalEntryNumber` off
  `order_counters` (`JE-000001`) while every other module used the configured `NumberSequence`
  (`JE-2026-00081`) — two independent series numbering one ledger, only one of them configurable.
  Now one series.

**Found and deliberately NOT fixed** (it belongs with the correction journals, not a refactor): the
**POS void reverses only three of the five lines** the sale posted. It leaves the IT expense and IT
payable standing against a sale that no longer exists. It balances, so `postJournal` cannot catch it.
Marked in place at `pos.routes.ts`.

**Verified by running, not reading:**

```
scripts/verifyJournalPosting.ts     14/14 against the real database, self-cleaning
                                    (balance, two-sided line, empty voucher, zero-line drop,
                                     rounding refusal, closed period, and the parameter
                                     genuinely governing it — period state restored in a finally)
scripts/verifyProcessChain.ts       ALL CHECKS PASSED, counts back to baseline
scripts/verifyItemPolicy.ts         ALL CHECKS PASSED — real COGS posted through the new writer,
                                    item-group split intact (5101 dr 200 / 5201 dr 30), journals
                                    back to baseline 85
npx jest                            119 passing — the same 4 pre-existing suites fail
npx tsc --noEmit                    clean outside those 3 pre-existing test files
```

Database state checked first, which is why enabling the new checks was safe: **0 accounting periods
exist** (period closing has never been used) and **all 85 existing vouchers balance exactly**.

**⚠ New failure mode to know about:** with no `ROUNDING` posting profile configured, a voucher out by
a cent is now **refused** rather than posted unbalanced. Configuring `ROUNDING` is the fix and it
needs an `OTHER_INCOME` account, which this tenant still does not have.

**Not done, awaiting approval:** migration 013 (the dimension tables and the four slots), the
resolver, the P&L-by-store report, and the backfill. Sequencing table in the design doc §7.

---

## 4d. Corrections and reversals — researched and BUILT 2026-08-17

Kubi: waiting for the Finance co-founder could take a long time, so research the regulation and the
correct structure and build to that. Then, mid-work: **"olayı Bolivia olarak sınırlama, unutma bu bir
generic ERP olacak"** — which is why every jurisdiction rule below is configuration, not code.

**Design doc: [docs/architecture/CORRECTIONS.md](docs/architecture/CORRECTIONS.md)**, with sources.

### What the research settled

1. **[OFFICIAL]** two methods exist and **D365 makes the choice a parameter** (*General ledger
   parameters → Transaction reversal → Correction*). **Reverse** mirrors debit/credit and inflates
   turnover on both sides; **storno** negates in the original column and zeroes turnover out.
   Selection rule, quoted: *"Use the reverse entry in countries or regions where turnover is rarely
   used. Other countries or regions use Storno accounting."*
2. **[OFFICIAL]** Business Central: *"An entry can only be reversed one time"* and *"After you
   reverse an entry, you must make the correct entry."* Both taken verbatim.
3. **[LAW]** Ley 2492 art. 78 — a rectification **increasing** the balance in favour of the treasury
   may be filed on the taxpayer's own initiative, with no stated deadline. One **favouring the
   taxpayer** is once per tax/form/period, within **one year**, and **only after verification** by
   the administration. **Every known tax defect here is in the free direction** (we declared too
   little), so there is no deadline to race and no prior verification to wait for.
4. **[LAW]** a factura may be annulled only while its period is open; afterwards it is corrected by a
   **nota de crédito-débito** that adjusts without deleting, within twelve months. Generic shape: a
   **void window** then a **correction-document window**, both jurisdiction configuration. Nothing in
   the code enforces either window today.

### The finding that made the method choice non-stylistic

**[REPO]** the IVA report summed **one column per side** and ignored the other. Under REVERSE a
correction to output tax posts a *debit*, so **the correction was invisible to the declaration** —
books right, filing wrong. It also still hardcoded `2103` / `2105` / `1105`, the last place in the
finance module naming a chart of accounts in code, and Bolivian ones at that: a Turkish or German
tenant would have reported **zero output tax with no error**.

Both fixed. Accounts resolve by `Account.category`, and an uncategorised chart now **throws** rather
than returning a reassuring 0.00. The response also names which accounts produced the figure.

**Proved with real numbers rather than asserted** — reversing Bs 13 of output tax:

```
one-column sum (OLD): 404.96 → 417.96     the reversal never lands
netted        (NEW): 404.96 → 404.96     correct
```

**The D-7 regression this could have caused was checked first:** switching from literals to category
would silently drop any uncategorised tax account. Verified that `2103` **and** `2105` both carry
`VAT_PAYABLE`, so the category lookup finds everything the literals did.

### Built

| Artefact | What |
|---|---|
| [013_corrections.sql](backend/prisma/sql/013_corrections.sql) | **Applied.** `journal_entries.corrects_entry_id / correction_reason / is_correction`, `journal_lines.is_correction`, `finance_parameters.correction_method` + CHECK. Additive; a partial unique index enforces "reversed only once" in the database |
| `journal.service.ts` → `reverseJournal()` | Derives the lines from the original — never retyped — and applies the tenant's method. Refuses a second reversal, a reversal of a reversal, a DRAFT entry, and a correction with no reason |
| `postJournal({ corrects })` | Sets the provenance and flags; requires a non-empty reason |
| `finance.routes.ts` IVA report | Nets both columns, resolves by category, reports which accounts it read |

**One deliberate deviation from BC:** it reuses the original posting date; we post on today's date
instead, because backdating into a closed period is what the rest of this service exists to prevent.
The original date stays reachable through `corrects_entry_id`.

**Verified:** `scripts/verifyCorrections.ts` **21/21**, including the turnover difference measured on
a real account (REVERSE dr 100 / cr 100; STORNO dr 0 / cr 0; same net balance).
`verifyJournalPosting.ts` 14/14, `npx jest` 119 passing with the same 4 pre-existing suites,
`tsc --noEmit` clean.

### Still open

- The **windows** (§3.1 of the design) are not built — nothing stops a factura being cancelled a year
  late. This is the piece that makes it a generic ERP rather than a Bolivian one.
- Whether *nota de crédito-débito* is a separate legal numbering series is **still unresolved**;
  `SequenceReference` already distinguishes `CREDIT_NOTE` from `FACTURA`, so the hook exists.
- The RND deadlines above come from Bolivian tax commentary, **not** from the SIN's own publication.
  Confirm against the issuing authority before encoding them as configuration values.
- **No amounts have been corrected.** The machinery exists; which figures get corrected is still the
  co-founder's call — but that is now one item (the tax-basis understatement, which changes filed
  figures), not the whole backlog.

---

## 4e. PIM setup module — BUILT 2026-08-17 (migration 014)

First item of the order in [MODULE_FIT_ANALYSIS §7](docs/architecture/MODULE_FIT_ANALYSIS.md), and the
first module built under the new module-scoped setup rule.

### What the data actually looked like

Checked before writing anything, and it was worse than the analysis assumed:

```
150 product variants
  product_variants.size   IS NULL on ALL 150
  product_variants.color  IS NULL on ALL 150
  146 of them carry the size in `attributes` as {"Sizes": "42"}
```

So the variant's identity lived in a **free-form JSON key**. Nothing stopped the next writer using
`"Size"`, or `"Beden"`, or storing 42 as a number. Sizes sorted as text, so EU 10 sorted before EU 9.
And the two typed columns were a trap: the first person to write to them would have put half the
catalogue in one place and half in the other.

### Built

**[OFFICIAL]** D365 separates three things and the separation is the point — the **dimension** (axis),
the **value**, and the **dimension group** (which axes *this* product varies by)
([Product dimensions](https://learn.microsoft.com/dynamics365/supply-chain/pim/product-dimensions)).
Without the group, "varies by size" and "varies by size and colour" are indistinguishable.

| Table | What |
|---|---|
| `ProductDimension` | the axis. Rows, not an enum — a footwear tenant that also sells by *width* adds a row |
| `ProductDimensionValue` | the value, with `sort_order` — this is why 32…47 now sorts numerically |
| `ProductDimensionValueGroup` + members | D365's size/colour/style group, so the next shoe inherits EU 36–46 instead of somebody retyping it |
| `ProductDimensionGroup` + lines | which axes a product varies by |
| `ProductVariantValue` | the variant's value per axis — **this replaced the JSON** |
| `ProductParameters` | PIM's module parameters record; it had none |
| `Product.dimension_group_id`, `Product.tracking_policy` | the group, and the honest hook for selling batch/serial later |
| FKs on `sales_order_lines.variant_id` and `purchase_order_lines.variant_id` | the known defect, closed |

`ProductVariant.size` / `.color` / `.attributes` are **kept and marked deprecated**, not dropped: they
are empty, nothing is lost, and keeping `attributes` is what lets the old and new representations be
compared. Dropping columns is a separate decision.

### Verified — `scripts/verifyPimSetup.ts`, 16/16 against the live database

The assertion that matters is the lossless one: every variant that carried a JSON size resolves to
**the same** size through the typed structure. 146 of 146 agree, 0 unmapped, 0 mismatched.

```
sizes, in sort order: 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47
every product WITH variants has a dimension group        PASS
every product WITHOUT variants has none                  PASS   (NULL is a real answer)
the database now REFUSES a variant_id pointing at nothing PASS   (tested in a rolled-back transaction)
```

That last check is deliberately run inside a transaction that always rolls back. The naive version
would, if the constraint were missing, write a bogus `variant_id` onto a real order line and leave it
there — a verification script that corrupts what it verifies.

Regression: `verifyProcessChain` and `verifyItemPolicy` ALL CHECKS PASSED, `verifyJournalPosting`
14/14, `npx jest` 119 passing with the same 4 pre-existing suites, `tsc --noEmit` clean.

### Two things this deliberately did NOT do

- **The 37 dead units are still dead.** `SAMBA-OG-001` has 37 units on a NULL variant in
  `WH-IST-01/A-01-01` for a product that varies by size. Which size they are is a fact nobody
  recorded; assigning one would be inventing data. **It needs a physical count.** What changed is that
  the condition is now detectable in one query instead of being invisible.
- **4 of the 150 variants carry no size at all.** They are exactly what
  `ProductParameters.require_complete_variants` exists to reject — left `false` so nothing breaks, to
  be turned on once the data is clean.

---

## 4f. Cost layer rename + inventory transaction status — BUILT 2026-08-17 (migrations 015, 016)

Items 3 and 4 of the [MODULE_FIT_ANALYSIS §7](docs/architecture/MODULE_FIT_ANALYSIS.md) order.

### 015 — `InventoryBatch` → `InventoryCostLayer`

The table never held a batch. It holds `unit_cost`, `received_at`, `source_po_id` and a remaining
`quantity` — a FIFO cost layer, with no batch number, no expiry date and no customer-facing identity.
**[OFFICIAL]** a *batch* is a tracking dimension in the reservation hierarchy beside serial number.

Since batch tracking is to be sold as an option later, the name had to be freed **before** it arrives,
or the codebase ends up with two unrelated concepts called "batch" — one financial, one physical,
joined to the same tables. Pure rename: table, pkey and index; eleven call sites; no row touched.

### 016 — `InventoryTransaction` receipt/issue status

**[OFFICIAL]** two ladders, and a transaction is on exactly one of them
([Inventory posting profiles](https://learn.microsoft.com/dynamics365/finance/general-ledger/inventory-posting-profiles)):

```
receipt: ORDERED → REGISTERED → RECEIVED → PURCHASED
issue:   ON_ORDER → RESERVED_ORDERED → RESERVED_PHYSICAL → PICKED → DEDUCTED → SOLD
```

Hence **two nullable columns with a CHECK forbidding the pair**, quoting *"Each inventory transaction
has a status that's displayed in EITHER the Receipt OR the Issue field"* — not one column mixing two
ladders. Plus `physical_date` and `financial_date`, the two dates D365 keeps apart, which are what
make *received but not invoiced* answerable from the subledger rather than by joining documents.

This is also what finally gives migration 009's `post_physical_inventory` / `post_financial_inventory`
something to mean.

`shared/services/inventoryTransactionStatus.ts` is the single mapping, wired into **all 12** creation
sites — the `postJournal` lesson applied again, because a mapping repeated at twelve sites diverges
and a divergent subledger status is invisible until a report is wrong.

**PICKED is defined and deliberately unwritten.** **[OFFICIAL]** *"the inventory has been picked from
the warehouse … still physically in the warehouse, hasn't been removed, but isn't available for other
orders"* — that is the state warehouse Phase 1 needs, and the type carries it so the next step fills
it in rather than inventing a vocabulary.

### The judgement calls in the backfill

```
OUTBOUND          → issue DEDUCTED     32 rows
PURCHASE_RECEIPT  → receipt RECEIVED   23 rows
RETURN            → receipt RECEIVED    5 rows
ADJUSTMENT        → left UNCODED        1 row
```

*Received* and *Deducted* are the physical rungs and are safe to assert. **Whether the vendor invoice
later posted — which would make a receipt *Purchased* — is not recoverable per transaction, so it is
not guessed.** `ADJUSTMENT` is left uncoded because quantities are stored **unsigned**, so its
direction is genuinely unknowable from the row, and **[OFFICIAL]** a positive counting journal is a
receipt (*Purchased*) while a negative one is an issue (*Sold*). One row. Inventing a direction to
make a column look complete would put a fabrication in the subledger.

Going forward both adjustment paths *do* know their sign (`qty`, `diff`), so new rows are coded
correctly — and **[OFFICIAL]** a counting journal is physically and financially updated in one
posting, so they land on `PURCHASED`/`SOLD` directly with both dates set.

**Verified:** `scripts/verifyInventoryTxStatus.ts` **16/16** — including that the database rejects a
status outside its ladder, a receipt status in the issue column, and a row on both ladders at once,
each tested inside a transaction that always rolls back. An unknown transaction type maps to
*uncoded*, so a new type cannot silently inherit the wrong ladder.

Regression after both: `verifyItemPolicy`, `verifyProcessChain`, `verifyPurchaseCycle` all passed,
`verifyPimSetup` 16/16, `npx jest` 119 passing with the same 4 pre-existing suites, `tsc` clean.

### A self-inflicted incident worth recording

The rename was applied with a PowerShell `Get-Content | Set-Content` pass. **Windows PowerShell 5.1
reads as ANSI and writes as UTF-8**, which double-encoded every non-ASCII character in six files —
733 mojibake markers in `schema.prisma` alone. Caught immediately, reversed losslessly (decode UTF-8 →
re-encode Windows-1252 → write raw bytes, with a round-trip equality check before writing), and
verified back to 0 markers with box-drawing characters intact.

**Rule for anything after this: never bulk-edit source with `Get-Content`/`Set-Content` on this
machine.** Use `[System.IO.File]::ReadAllText/WriteAllText` with an explicit `UTF8Encoding($false)`,
which is what the later edits in this session used.

---

## 4g. Warehouse Phase 1 — BUILT 2026-08-17 (migration 017)

This is the real fix for the `SO-2026-00081` / `RCV-001` problem.

### The defect underneath it

`WarehouseService.completeWorkLine` set `quantity_done` and a status **and moved no stock at all.**
So putaway work could be created, shown to a worker and completed while the goods stayed exactly
where they were — work that reports success and changes nothing. That is why stock received into a
receiving location never became pickable no matter what anybody did in the UI. The arrival-journal
putaway path that already existed was decorative for the same reason.

### Built

| Artefact | What |
|---|---|
| [017_warehouse_parameters.sql](backend/prisma/sql/017_warehouse_parameters.sql) | **Applied.** `warehouse_parameters`, **per warehouse**: `require_putaway`, `require_pick_work`, `availability_counts`, `default_receive_location_id`. One row seeded per existing warehouse at the defaults |
| `shared/services/warehouseParameters.service.ts` | The resolver, plus `availabilityLocationFilter` — the one place that decides what counts as sellable |
| `inventory.service.ts` | `getAvailableStock` **and** `reserveStock` both apply the filter. Both, deliberately: if they diverge, an order passes its check and then reserves stock the check excluded |
| `warehouse.service.ts` | `completeWorkLine` now **moves the inventory**, inside a transaction, with the FIFO cost layers following the goods and a TRANSFER_OUT/TRANSFER_IN pair on the subledger |
| `productReceipt.service.ts` | Creates putaway work when the warehouse requires it, source = the receiving location, destination = the **existing** `LocationDirective` engine — the first thing that has ever read those tables |

### Verified against Learn, not assumed

- **[OFFICIAL]** *"the receipt is posted first to record the increase of inventory … The warehouse
  worker then registers the put-away to make the items available to pick"* — so the putaway is the
  step that makes stock available, which is why it has to be the step that moves it.
- **[OFFICIAL]** *"during purchase registration, the first pick is always from the location where the
  registration occurs"* — the source is recorded on the work, never directive-resolved. Only the
  destination is.
- **[OFFICIAL]** for a purchase-order location directive, *"Put is the only supported value"*.
- **[OFFICIAL]** a work policy's **Work creation method** can be *Never*, which *"prevents warehouse
  work from being created"* — so modelling "no putaway" as a setting rather than a code path is
  D365's own shape.
- **[OFFICIAL]** warehouse behaviour belongs on the individual warehouse (*Default inventory status
  ID* sits on the Warehouse FastTab), which is why these parameters are per warehouse and not per
  tenant.

**And the one thing deliberately NOT copied:** D365 gates this behind `Use warehouse management
processes` on the storage dimension group, which cannot be changed after saving and forces a new
warehouse plus a manual inventory move to adopt later. `InventoryStock` here is keyed on
`location_id` for every warehouse already, so a warehouse can be switched either way at any time.

### Verified by running — `scripts/verifyPutaway.ts`, 14/14

The RCV-001 scenario end to end, self-cleaning, parameters restored in a `finally`:

```
under ALL_LOCATIONS, stock on the receiving dock counts          PASS
under PICK_LOCATIONS_ONLY, the same stock does NOT count         PASS  ← the case you hit
the receiving location was emptied                               PASS
the pick location received the goods                             PASS
and NOW it counts as available                                   PASS
the FIFO cost layer moved with the goods, and kept its cost       PASS
the move is on the subledger as a transfer pair, both with status PASS
completing the same line twice is refused                        PASS
```

Full regression, all green: `verifyItemPolicy`, `verifyProcessChain`, `verifyPurchaseCycle` passed;
`verifyJournalPosting` 14/14, `verifyCorrections` 21/21, `verifyPimSetup` 16/16,
`verifyInventoryTxStatus` 16/16, `verifySalesDimensionsLive` 9/9; `npx jest` 119 passing with the same
4 pre-existing suites; `tsc --noEmit` clean.

### ⚠ Nothing is switched on

Every warehouse is still `require_putaway = false`, `availability_counts = ALL_LOCATIONS`. **Applying
migration 017 changed no behaviour.** To fix the actual `SO-2026-00081` situation, `WH-MAIN` needs:

1. a **pick location** — it has `RCV-001` (receive) and nothing to put away *into*;
2. a **putaway location directive** for the warehouse;
3. then `require_putaway = true` and `availability_counts = PICK_LOCATIONS_ONLY`.

`verifyPutaway.ts` had to run against `WH-IST-01` because it is the only warehouse with both a
receive and a pick location. That absence is itself a setup finding.

**Also still true:** `require_pick_work` is declared and **nothing reads it** — outbound work is
Phase 2/3 of the roadmap. Stated here rather than left to be discovered.

---

## 4h. Seven setup tasks — BUILT 2026-08-17 (migrations 018-022)

Kubi handed over seven items in one instruction. All seven were done; two of them
corrected what this document previously said, and one is deliberately left switched
off pending his decision. Read §4h.8 before assuming anything here is live.

### 1. Department master + financial dimensions — migrations 018, 019

**A department is not a table.** **[OFFICIAL]** D365 has no `departments`; a
department is an **operating unit** whose type is *Department*, and operating units
"are commonly used as financial dimensions"
([Organizations and organizational hierarchies](https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/organization-administration/organizations-organizational-hierarchies#organizations),
[Define the organizational structure](https://learn.microsoft.com/dynamics365/guidance/organizational-strategy/define-organizational-strategy)).

So `operating_units` carries a `unit_type` discriminator — which also turns
FINANCIAL_DIMENSIONS §6.1's *guess* that slots 3 and 4 would be "cost centre and
channel" into two more rows of the same table rather than two more tables.

Cut, with the hook named: D365's organization-hierarchy framework (purposes,
draft/publish, effective dates) is five screens before a shoe shop can tag a payroll
line "Sales". `parent_id` is the tree. Jobs and positions are cut too —
**[OFFICIAL]** D365 reaches the department *through* the position; we attach the
employee directly, and if a position master arrives `Employee.department_id` becomes
derived and survives.

Then the dimensions: 4 fixed slots + a registry, one value table for every axis,
requirement rules keyed on `Account.category`. Resolution happens in exactly one
place because `postJournal()` already made that possible.

| Artefact | What |
|---|---|
| [018](backend/prisma/sql/018_operating_units_and_financial_dimensions.sql) | **Applied.** `operating_units`, `employees.department_id`, `dimension_attributes`, `dimension_values`, `dimension_rules`, `default_dimension_assignments`, 4 slots on `journal_lines` |
| [019](backend/prisma/sql/019_dimension_rule_partial_indexes.sql) | **Applied.** Fixes a bug 018 shipped — see below |
| `shared/services/dimension.service.ts` | The resolver, the document context helpers, and the requirement enforcement |
| `scripts/provisionFinancialDimensions.ts` | Dry-run by default. Provisioned STORE (slot 1, entity-backed on Site) and DEPT (slot 2, on OperatingUnit) |
| `scripts/verifyFinancialDimensions.ts` | **25/25** against the real database |

**Payroll now splits its salary expense by department** — the point of the axis.
**[OFFICIAL]** a department "might have profit and loss responsibility", and no
report can recover a split that was never posted. The two credits stay aggregated:
they are liabilities owed to the employee and to the state, not functional-area costs.

**A bug 018 shipped, found by running it.** Both uniqueness indexes on
`dimension_rules` were `NULLS NOT DISTINCT`, copied by reflex from migration 001.
That is right for `legal_entity_id`, where NULL means "the tenant default". It is
wrong for `account_category` / `account_id`, where NULL means "this rule is not of
that kind" — and a CHECK guarantees exactly one of them is NULL, so the two indexes
were guaranteed to collide. **One tenant could hold exactly one category rule.**
They are partial indexes now, which Prisma cannot express, so the constraint lives
in SQL only and the model carries the warning: **`prisma db push` would drop them.**

A reversal **copies** the original's dimension coding rather than re-resolving it,
or the pair would not net to zero in a P&L by store.

### 2. WH-MAIN directed putaway — switched ON

**This document was wrong.** §4g said WH-MAIN had "RCV-001 and nothing to put away
into". It has an STG zone with five pick locations. What it actually lacked — and so
did every other warehouse — was a **location directive**: zero rows in the table the
whole engine reads.

**[OFFICIAL]** for exactly our scenario Microsoft prescribes **two** actions:
Consolidate first, then Empty location with no incoming work
([Work with location directives](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/create-location-directive#example-using-location-directives)).
That exposed a bug: `CONSOLIDATE` fell through to `EMPTY_LOCATION` in the same
switch, collapsing two documented actions into one and making a two-line setup a
lie. Each strategy now does only its own job.

Two further defects in `EMPTY_LOCATION`, both from the same definition: a stock row
at **zero** counted as occupancy (so a location that once held something was never
empty again), and **"no expected incoming work"** was missing entirely (so two
receipts processed before either was put away were both sent to the same location).

`WH-MAIN` now: `require_putaway = true`, `availability_counts = PICK_LOCATIONS_ONLY`,
`default_receive_location = RCV-001`, directive `PUTAWAY-WH-MAIN` with two lines.

**The switch would have been a trap without one more step.** The 15 units on RCV-001
arrived before putaway existed, so no work referenced them; switching on would have
made them invisible to sales with no action in the product able to move them.
`scripts/setupWarehousePutaway.ts` creates putaway work for stock already standing
on non-pick locations. **That work is OPEN and waiting in the UI** — completing it
asserts goods physically moved, which is a warehouse worker's claim, not a script's.

⚠ **`WH-001` is a setup defect in the same family.** Its only location, `A-01-01`, is
a *receive* location holding 90 units, and it has no pick location at all. It is also
the tenant's **default sales warehouse**. Do not enable `PICK_LOCATIONS_ONLY` there
until it has pick locations.

### 3. Default warehouse — it was never empty

This document's "⚠ NEEDS KUBI — the default warehouse is deliberately unset" is
**stale**. Live data: `default_warehouse_id = WH-001`, `require_warehouse_on_sales_order
= true`. Kubi's remembered decision ("WHS-001") is `WH-001`, Warehouse Bolivia / La Paz,
and it is in force. Nothing to do.

### 4. IT is no longer charged on purchases — migration 020

Ley 843 art. 74 bases IT on "los **ingresos brutos** devengados … en concepto de
**venta de bienes**". IT taxes the gross INCOME of the party carrying out the
activity. A purchase is the *supplier's* income, not ours; they owe their own IT and
have priced it in. Charging it again taxes one transaction twice.

`TaxCode.applies_to` (SALES | PURCHASE | BOTH), **not** a branch on `tax_type` —
filtering TURNOVER out of purchases would work for Bolivia and be wrong for any
jurisdiction with a purchase-side turnover tax, which is the mistake migration 002
existed to undo. The Bolivian template carries the value with its citation, so new
tenants are provisioned correctly rather than depending on one UPDATE.

It never reached the ledger, so this corrects the vendor-invoice **screen**, not the
books. `scripts/verifyTaxSide.ts` **11/11** — the half that matters is that the
SALES side is unchanged: Bs 1 299,00 still yields IVA 168,87 and IT 38,97.

### 5. The correction journals are POSTED

Nine vouchers, **Bs 8 109,68**. Every amount re-derived from the database;
GAP_ANALYSIS.md is the finding, the database is the fact.

```
1201 Activo Fijo    6 897,00 -> 0,00      D-6 cleared
2105 IVA Debito       793,45 -> 0,00      the second output-VAT account is closed
2103 IVA Debito     3 488,14 -> 4 308,04  +819,90
2104 IT por Pagar     804,94 ->   994,17  +189,23 — exactly the D-3 figure
4101 Ventas        32 545,41 -> 32 748,96 +203,55 the POS revenue never recorded
trial balance       dr = cr · 0 unbalanced vouchers
```

**Writing the detection query taught the lesson.** The first version matched revenue
to COGS on `source_id` and reported 21 orphans / Bs 44 000 — nearly every COGS entry
in the tenant. A COGS voucher is keyed on the *order*, a revenue voucher on the
*factura*; they never match. Trusted, it would have driven Bs 44 000 of corrections
against Bs 3 250 of real damage.

The ten it wrongly flagged are a different condition and were **not** corrected:
shipped, COGS posted, never invoiced — the documented O2C gap, not a posting defect.

Two things deliberately left alone: the five D-2 vouchers are posted **as their
facturas state them**, not recomputed (restating the Bs 637,47 of historically
understated tax is a filing decision for the co-founder), and a residual gap
survives — IT 15,28 and IVA 66,16 on the two oldest facturas of 2026-04-01,
different vintage, **not diagnosed**.

### 6. Trade agreements — migration 021

**[OFFICIAL]** a trade agreement line is a PARTY axis and a PRODUCT axis, each Table
/ Group / All, plus a quantity break and a date range — the same most-specific-first
matrix the posting profile resolver already implements, so the vocabulary is reused.

One official rule is enforced by the **database**: **[OFFICIAL]** "a price is an
absolute value and can't be the same for all products or a group of products", so a
PRICE row must name a specific product. A percentage discount may not.

Precedence is **most specific wins, not cheapest** — the opposite of D365's default,
deliberately: a price negotiated with one supplier must not be silently undercut by
a general row. **[OFFICIAL]** *Find next* is available per row.

Both purchase paths price through one resolver (agreement -> typed cost -> product
cost). `scripts/verifyTradeAgreements.ts` **18/18**. An empty price list resolves
nothing, so applying 021 changed no behaviour.

### 7. Factura lines — migration 022

**⚠ READ THIS BEFORE TREATING IT AS COMPLIANCE.** Whether Bolivian law *requires*
line detail on the printed factura is **still the open question in §7** and is NOT
answered. It needs the SIN's own normativa; the research scope for this workstream
is Learn + repo (CLAUDE.md §5). Migration 022, the model and the service each say so
in place. **Nothing there is a compliance claim.**

What is established and sufficient on its own: partial invoicing is impossible
without lines; per-line tax is required before Turkey or Germany; a credit note must
say what it credits.

**[OFFICIAL — Ley 843 art. 5]** a Bolivian factura LINE is gross-inclusive exactly as
the header is, so tax is computed FROM `line_total`, not added to it. The regime
lives in `TaxCode.base_kind`.

The governing rule: **lines explain the header, they never restate it.** The four
header totals are not dropped and not derived — a factura STATES a total.
`writeFacturaLines` **refuses** a line set that does not sum to the document, and
absorbs the sub-cent residue of taxing lines separately into the largest line.

`invoiced_qty` and `delivered_qty` join the sales order line, backfilled from facts
already recorded. Both invoicing paths write lines, ERP and POS.

`scripts/verifyFacturaLines.ts` **14/14**. **Not done:** no UI, no PDF change, the
printed factura still renders from the header, and the credit-note path still writes
a negative-total factura with no lines.

### 8. The store dimension is now REQUIRED — decided by Kubi 2026-08-18

Kubi's decision was **store dimension REQUIRED on revenue and COGS from day one**,
and after seeing the cost below he confirmed it: *"sadece 14 siparis icin
kesemeyeceksem hicbir sorun yok, onemli olan process implemente oldu mu olmadi mi"*.

**It is REQUIRED as of 2026-08-18.** The 14 orders below cannot be invoiced until a
warehouse is set on them. That is accepted, not overlooked:

**14 sales orders that can still be invoiced have no site, and no warehouse to
derive one from.** Migration 011 already backfilled everything derivable, so they
cannot be filled without inventing data.

```
SO-2026-00001 DRAFT      SO-2026-00016 DRAFT      SO-2026-00017 CONFIRMED
SO-2026-00018 CONFIRMED  SO-2026-00019 SHIPPED    SO-2026-00022 SHIPPED
SO-2026-00023 DRAFT      SO-2026-00026 SHIPPED    SO-2026-00028 CONFIRMED
SO-2026-00031 SHIPPED    SO-2026-00033 CONFIRMED  SO-2026-00036 SHIPPED
SO-2026-00041 CONFIRMED  SO-2026-00044 SHIPPED
```

All fourteen are un-invoiceable until somebody sets a warehouse on them. New orders
are unaffected — `require_warehouse_on_sales_order` is already on. The impact list is
now visible in the UI at `/setup/finance`, so answering this no longer needs a script.

Reversing it is one command, or the toggle on `/setup/finance`:

```bash
cd backend && npx tsx scripts/provisionFinancialDimensions.ts --apply
```

### 9. Also still true

- **The manual journal UI cannot enter dimensions.** The API accepts them
  (`lines[].dimensions` = `{ ATTRIBUTE_CODE: value_id }`); the form does not send
  them. Once STORE is REQUIRED, a manual entry touching revenue or COGS will be
  refused until the journal form grows a dimension picker. The refusal is correct;
  the missing picker is a real frontend gap.
- **3 of 5 employees have no department** and were left unassigned — inventing one
  would put their salary in a functional area they do not work in.
- `DimensionRule.fixed_value_id` is declared and **nothing reads it**.
- `TradeAgreement.party_scope = 'PARTY_GROUP'` is declared and the resolver **skips
  it with a WARN**, because customer/vendor groups still have no master.

---

## 4i. Setup UI — BUILT 2026-08-18

Kubi's objection, and it was correct: migrations 018-022 built operating units,
financial dimensions, warehouse parameters, location directives and trade
agreements, and **every one of them could only be applied by running a script from
this repo**. That is not a parametric system — it makes each new store an errand for
whoever wrote the migration.

> *"Heryer parametrik yapi olmali, ileride 0 dan bir magaza kurarsam nabacagim ben?
> Tek tek sana mi soracagim, bu cok surdurulebilir olmaz."*

### A note on the "missing buttons"

Kubi reported that Requisitions had no create button and Item Model setup had no new
button. **Both buttons existed.** The likely cause was self-inflicted: the backend
dev server was stopped for most of that session (Prisma holds the query-engine DLL
on Windows, so `prisma generate` cannot run while it is up). With the API down,
every page renders empty and dialogs whose dropdowns await data do not open. **If
pages look broken, check the backend is running before believing the UI.**

### Built

| Route | What |
|---|---|
| `/setup` | Readiness per module — **facts and counts, never a score**. "3 of 8 products have no item group" is actionable; "62% configured" is not. The one judgement it makes is whether a module BLOCKS trading, which is a real distinction: no posting profile refuses documents, no location directive merely means no directed putaway |
| `/setup/organisation` | **The "open a new store" page.** Site → warehouse → operating unit, in that order because `Warehouse.site_id` is NOT NULL |
| `/setup/finance` | Financial dimensions, their values, their requirement rules |
| `/setup/warehouse` | Putaway and availability per warehouse, plus a directive editor |
| `/setup/wizard` | The existing first-run wizard, moved off the hub route |

Backend: `modules/setup/setup.routes.ts` (operating units, dimensions, readiness),
plus warehouse parameters and directive lines on `warehouse.routes.ts`.

### Three things the screens refuse rather than warn about

Each one was learned the hard way earlier in the same session:

1. **A dimension's slot and value source are immutable once it exists** — moving an
   axis would silently re-interpret every voucher already coded against it. 409.
2. **Making an axis REQUIRED can refuse a posting**, so the screen asks the server
   what it would cost and lists the blocked documents **by name** first. That exact
   question could only be answered by writing a one-off script; nobody should learn
   it by breaking invoicing.
3. **Putaway switches are refused when the warehouse cannot support them.** Pick-only
   availability with no pick location makes all of that warehouse's stock unsellable;
   putaway with no directive creates no work at all. Both read as inventory
   evaporating.

`require_pick_work` is shown **disabled with its reason** rather than hidden — a
switch that silently does nothing is worse than one that admits it.

### ⚠ Load planning workbench — cannot be built yet, and this is a backend gap

Kubi asked how he would manage Shipment and Load planning. There is nothing to put a
screen on:

```
Shipment    exists but is HEADER-ONLY — one shipment = one order, NO LINES
            → partial shipment is not representable
Load        no model at all
Wave        exists (template, release)
require_pick_work   declared, nothing reads it
```

This is O2C steps 5-7 in S2P_O2C_STATUS, already marked ❌. A workbench today would
be an empty shell. **Shipment lines + a Load model + outbound work come first.**

### Still missing UI (stated, not hidden)

- **Trade agreements** — API exists (`/procurement/setup/trade-agreements`), no page.
- **Sales / Procurement parameters** — the hub links to them; the pages do not exist.
- **Dimension picker on the manual journal.** `STORE` is now REQUIRED on revenue and
  COGS, so a hand-entered journal touching those accounts **is refused today**. The
  API accepts `lines[].dimensions`; the form does not send it. Correct behaviour,
  real blocker.

---

## 5. Key Decisions

- **POS lives in its own repository** (`skarpine-pos`), not in the monorepo, and since 2026-09-07
  this repository does not track it at all. It was never **configured** as a Git submodule, because
  no `.gitmodules` entry ever existed — but the parent index nevertheless **represented it as an
  unregistered gitlink**, a pinned SHA that `git status` reported while `git submodule` could not
  see it. That half-state is the source of every older document that calls it a submodule. The
  gitlink was removed in the V1 reconstruction commit.
  *History, for the record:* the POS tree was uncommitted until 2026-09-06,
  when it was committed to `codex/wip-incomplete-pos-2026-09-06` (`09fa4de`) and pushed to the
  private remote `Quberty-POS`. That commit preserves an **incomplete** application — five known
  TypeScript errors remain — and is not a completion claim.
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
- ~~`skarpine-pos` has uncommitted content in the working tree.~~ **Closed 2026-09-06** — committed
  and pushed to `Quberty-POS`, tree clean. What remains open is not a Git issue: the POS
  application is functionally incomplete and its type-check reports five known errors. It is out of
  scope until Kubi scopes POS work.
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
