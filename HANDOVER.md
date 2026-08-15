# HANDOVER — Skarpine ERP

> Living context document. Read this first in a new session.

**Last updated**: 2026-08-15

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
- **Production database: Supabase** (managed PostgreSQL). The `docker-compose.yml` Postgres is
  local development only. `schema.prisma` uses the Supabase pooler pattern — migrations must run
  against `DIRECT_URL`, not the pooled `DATABASE_URL`. Postgres RLS is therefore available, which
  matters for the multi-tenancy gap in `docs/process/GAP_ANALYSIS.md`.
- `skarpine-pos/` — **git submodule**, separate repo (mobile/terminal POS)
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

### Next decision point

Kubi to approve or re-scope the implementation sequence in FOUNDATIONS.md §6:
`D-1…D-6 → numbering → product dimensions → financial dimensions → posting profiles → tax`.
**No implementation has begun and none should begin without that approval.**

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

### Next decision point (frontend)

Kubi to either (a) approve starting at step 1, or (b) review the reference repos first and
pick a direction. Proposed approach once approved: apply to a vertical slice (dashboard +
one list page) as a before/after, confirm direction, then roll out.

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

### CRITICAL — live accounting defects found 2026-08-15

Detail and evidence in [GAP_ANALYSIS.md §0](docs/process/GAP_ANALYSIS.md). Summary:

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
