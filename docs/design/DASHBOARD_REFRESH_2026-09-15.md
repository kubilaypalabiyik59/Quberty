# Dashboard presentation refresh

## Scope and evidence

- **Architectural recommendation:** adapt the compact KPI hierarchy of [shadcn](https://ui.shadcn.com/examples/dashboard) and the chart/product/table composition of [TailAdmin](https://demo.tailadmin.com/) to Quberty's existing design tokens. No template dependency is installed.
- **Scope status:** approved dashboard-only presentation work. Sidebar, shared chart, other pages, backend, permissions and schema are unchanged.
- **Catalog alignment (repo-verified):** 65 Order to cash; 90 Record to report, as recorded in `docs/process/CORE_ERP_PROCESS_CATALOG.md`. This is a cross-cutting presentation change, not a new catalog scenario. Lower-level IDs are not asserted.
- **Parameter owner:** existing reporting endpoints own metric definitions; the dashboard owns its local chart interval/month/year controls. Existing theme and currency providers retain ownership of appearance and currency formatting.
- **Schema-hook decision:** none required; no capability or persistence is introduced or deferred.
- **Localization effect:** money remains formatted by `useMoney`; no tax, numbering or jurisdiction changes.

## Implementation evidence

`frontend/src/app/(erp)/dashboard/page.tsx` now uses four independent summary cards, a sales chart beside ranked products, and a full-width recent-order table with order links. All appearance uses existing semantic tokens. Missing growth is omitted rather than shown as a zero-percent comparison. Loading, error and empty states are explicit. The nonfunctional overview period picker and unsupported product Active badges are removed.

**Repo-verified:** `backend/src/modules/reporting/report.service.ts` groups monthly sales by month and site. The dashboard combines those rows by month and totals the displayed period. The monthly endpoint covers shipped/completed orders; the daily endpoint and overview exclude draft/cancelled orders. Labels disclose these existing differences; their accounting definitions are not changed. Customer count and pending orders are all-time counts, and their labels state that scope.

## Acceptance evidence

- Frontend TypeScript check passes.
- Browser: four equal-width KPI cards align at a 1440px viewport with no document overflow; dark palette resolves to existing dark surface/text tokens.
- Browser: monthly data renders one aggregated September column; daily mode renders daily totals and exposes month/year controls.
- UI-only scope: no database writes, migrations, dependency changes or backend changes.

## Remaining constraints

This is an order-based operational dashboard, not a new accounting revenue report. Existing reporting permissions and differing endpoint status definitions remain. The application's existing fixed sidebar behavior on narrow screens is outside this dashboard-only change.
