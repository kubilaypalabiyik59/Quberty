# HANDOVER — Skarpine ERP

> Living context document. Read this first in a new session.

**Last updated**: 2026-08-14

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

## 3. Active Workstream — Frontend Design System (opened 2026-08-14)

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

### Next decision point

Kubi to either (a) approve starting at step 1, or (b) review the reference repos first and
pick a direction. Proposed approach once approved: apply to a vertical slice (dashboard +
one list page) as a before/after, confirm direction, then roll out.

---

## 4. Key Decisions

- **POS lives in its own repository** (`skarpine-pos` submodule), not in the monorepo.
- **D365 F&O patterns are deliberate** in the warehouse and finance modules — waves, work
  templates, location directives, journal-based posting. Do not "simplify" these away;
  they are the product's differentiator and match Kubi's domain expertise.
- **Bolivia tax compliance** (facturas, IVA) is a first-class requirement, not an add-on.
- **Frontend visual direction**: restrained enterprise, high information density, minimal
  decoration. Explicitly *not* the gradient/glow/animation style currently in the code.

---

## 5. Known Issues / Blockers

- Production readiness scored 4/10 and security 5/10 in the April 2026 audit; see
  `Roadmap_Improvement_Prod.md` for the gap list. Not yet closed.
- Frontend has no design system (section 3).
- Inverted KPI trend colours on the dashboard (section 3).
- `skarpine-pos` submodule has uncommitted content in the working tree.

---

## 6. Open Questions

- Which neutral family becomes canonical — `zinc` or `slate`?
- What is the brand accent? Current code leans red/maroon (`StatCard`) but blue and indigo
  appear widely; the intent is unclear from the code alone.
- Should the storefront (`src/app/(store)`) share the ERP design system or keep a distinct
  consumer-facing identity? Recommendation: shared tokens, different density and type scale.
