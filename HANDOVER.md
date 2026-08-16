# HANDOVER — Skarpine ERP

> Living context document. Read this first in a new session.

**Last updated**: 2026-08-16 (config foundation + tax engine + frontend design system + sign-in rebuild)

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
2. **Per-line tax refactor** — required before Turkey or Germany.
3. **Purchase net-vs-inclusive.** Purchase treats `subtotal` as net and adds tax on top, while the
   Bolivian IVA code is price-inclusive. The existing arithmetic was preserved rather than silently
   changed — it would move every purchase total. Add to the co-founder question list.
4. **Turkish tevkifat ratios need legal validation** — the threshold is now sourced from primary law,
   but which of 2/10…9/10 applies per service category is not. Flagged in the template `note` and
   surfaced by the provisioning script.
5. The five Bolivian questions and the two account confirmations, in the review artifact.

### Not yet decided — flagged, not actioned

The repo has **no `prisma/migrations/` history**; it has been using `db push`. Adopting real
migrations requires baselining the existing schema first. `prisma/sql/` is an interim convention,
not an endorsement of it.

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
2. Charts still hardcode colours (the revenue bar is a fixed green) — they need token-driven
   series colours in both themes.
3. Density pass on list views: row height, padding, font size.
4. Decide whether the storefront gets its own density and type scale.

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
- `skarpine-pos` has uncommitted content in the working tree.
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
