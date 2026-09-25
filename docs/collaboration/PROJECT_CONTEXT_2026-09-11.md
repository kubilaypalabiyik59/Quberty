# Project context preserved from the Codex session

Updated 2026-09-11. This file is a durable handoff for a future Codex or Claude session. It records
project decisions and evidence from the conversation; it does not contain API keys, passwords, or
connection strings.

## Product objective

Skarpine / Quberty ERP is being shaped into a packaged ERP for businesses of roughly 50 employees,
with the anchor case a three-store shoe retailer in Bolivia. The product should feel simple while
keeping a serious D365-shaped data foundation. The goal is not D365 feature parity. The goal is a
usable Core ERP foundation whose scope is driven by complete business processes.

The current in-scope processes are Source to Pay (P2P) and Order to Cash (O2C). Manufacturing and
master planning are out of scope. Bolivia is the default jurisdiction: factura sequentiality, IVA
13%, and IT 3% behavior must not regress. Schema hooks may be added for deferred behavior, but a
scope cut must be a behavior cut rather than a destructive schema shortcut.

## Research and decision rules

For D365 claims, use Microsoft Learn MCP first and cite the official Learn URL in the worklog or
design document. Label claims as official documentation, repo-verified, architectural recommendation,
or assumption needing validation. Microsoft Learn cannot decide Bolivian legal/tax questions.

Codex owns scope, Learn validation, architecture, accounting, security, tenant isolation, schema and
migration review, testing, database acceptance, and final publication. Claude may draft bounded
implementation patches after the scope and invariants are explicit. Provider output is untrusted and
has no tool or database authority.

## Provider routing decision

The user approved the local hybrid strategy:

- Claude Pro remains the primary interactive implementation path when its subscription capacity is
  available.
- OneProvider is an Anthropic-compatible endpoint and forwards requests to a Claude model. It is the
  configured fallback for bounded implementation drafts. The local router pins `claude-sonnet-5`.
- NVIDIA NIM is reserved for low-risk summaries, source compression, documentation drafts, and test
  ideas. The configured pin is `deepseek-ai/deepseek-v4-flash-0731`; it is slow and a WORK-020 call
  returned a generic provider failure. It supplied no accepted claim or code.
- Direct Anthropic API is currently unconfigured. Do not paste or commit keys into this repository.

Credentials are held in the current Windows user's local secret store by the
`skarpine-hybrid-model-router` scripts. Never record their values in project files, prompts, logs, or
commits. The router scripts are under `C:\Users\Nieuw\.codex\skills\skarpine-hybrid-model-router\scripts`.

## Accepted work and database state

The active worktree is `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild` on
`codex/rebuild-2026-09-07`. The reconstruction chain and Core ERP slices are local and unpushed. The
latest completed checkpoint before WORK-021 was `7a8791d471acf4d0adb59dfb815fb15e4da7e2a6`.

WORK-011 through WORK-021 are accepted. The purchasing chain now covers requisitions, purchase
orders, receipts, put-away, invoices/matching, BOB vendor payments and settlement, supplier returns,
supplier credits, and their end-user web forms. WORK-020 refreshed put-away acceptance: 14/14 checks
passed on Supabase TEST.

WORK-021 adds:

- migration `030_manage_open_purchases.sql`;
- `cancelled_qty` and line delivery-date hooks on purchase-order lines;
- immutable `purchase_order_changes` snapshots;
- row-locked remainder cancellation and delivery-date update services;
- rejection of destructive direct edits to confirmed purchase orders;
- updated receipt and invoice remainder calculations;
- `/purchase/orders/:id/changes`, `/purchase/orders/:id/delivery`, and
  `/purchase/orders/:id/lines/:lineId/cancel-remainder` routes;
- the Purchase Orders “Manage” dialog with delivery update, per-line remainder cancellation, and
  visible change history;
- permanent `verify:open-purchase` acceptance coverage.

Microsoft Learn validation used the official purchase-order approval/cancellation page:
`https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-order-approval-confirmation`.
It confirms that confirmed lines must not be deleted, only the unreceived/uninvoiced remainder can be
cancelled, and confirmed changes require an auditable change path. The official delivery-date page is
`https://learn.microsoft.com/dynamics365/supply-chain/master-planning/supplier-requested-confirmed-dates`.

WORK-021 intentionally does not implement a generic D365 workflow/re-approval engine or price/quantity
change approval. The matrix row `75.40.050.000 Manage open purchases` remains PARTIAL for that reason.

## Verification evidence

- Microsoft Learn isolated migration verification: 31 migrations, temporary schema removed, Prisma
  drift empty.
- Supabase TEST migration ledger: ordinal 30 after applying migration 030; repeat runner is a no-op.
- `verify:open-purchase`: 7/7 passed; temporary purchase order, line, and audit rows removed.
- Backend Jest: 17 suites / 372 tests passed.
- Backend TypeScript build: passed.
- Backend script type-check: passed.
- Frontend TypeScript: passed.
- Backend health: `http://localhost:3001/api/health` returned `{"status":"ok","version":"2.0.0"}`.
- Frontend is normally available at `http://localhost:3000`.

## Deferred UI and product notes

The Item Groups setup screen still lacks the `New` and `Edit` actions that Item Model Groups already
has. This was deliberately noted for a later Core ERP strengthening item. Before implementing it,
validate the setup behavior with Microsoft Learn MCP and then add end-user forms. Do not infer the
behavior from the current screen alone.

The Android POS repository remains separate and out of scope until explicitly selected. The frontend
has no standing browser-render regression runner; this remains verification debt for future UI-heavy
changes.

## Manual Claude continuation prompt

Paste the following into Claude Code after it reads `AGENTS.md`, `HANDOVER.md`,
`docs/collaboration/CODEX_RESUME.md`, this file, and
`docs/process/CORE_ERP_COMPLETION_MATRIX.md`:

> Continue Skarpine Core ERP from WORK-021. Read the repository handover and completion matrix first.
> The active branch is `codex/rebuild-2026-09-07`; do not push, rebase, or alter production. Migration
> 030 is applied only to the Supabase TEST database and the latest acceptance is 7/7. Confirmed
> purchase orders must use the new delivery-update and remainder-cancellation routes; never restore
> the old delete-and-recreate edit path. Keep original ordered quantity, received quantity, invoiced
> quantity, and cancelled quantity distinct. Do not introduce a generic D365 workflow engine.
> For any new D365 claim, ask Codex to validate it with Microsoft Learn MCP before implementation.
> Keep conversation in Turkish and code/docs identifiers in English. Use the local OneProvider router
> only for bounded implementation drafting; keep schema, migration, accounting, security, tenant
> isolation, and final acceptance under Codex review.

## Git and database gates

A local commit is not a push. Push, merge, rebase, deployment, or any unknown/production database
operation requires explicit user authorization. The standing database authorization covers reviewed
operations against the repository-recorded Supabase TEST/development project only. Each migration
must pass isolated rebuild, drift, repeatability, and cleanup checks before TEST application.
