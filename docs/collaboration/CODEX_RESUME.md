# Codex resume checkpoint

**Updated:** 2026-09-12
**Branch:** `codex/rebuild-2026-09-07`
**Scope completed:** WORK-011 through WORK-023, WORK-029, WORK-024 (a and b) and WORK-025 (a and b). All commits are
local and unpushed; Kubi pushes them himself.

## Codex resumption — 2026-09-17

**Latest, 2026-09-18:** WORK-048B return/UI and WORK-051A receipt locations are approved in the
uncommitted worktree; full Jest 37 suites / 1,035 tests and TypeScript checks pass. Read
WORK-048B_051A_LOCAL_REVIEW.md first for exact bounds. WORK-048A invoice/pay remains unchanged,
OPEN, and at the Claude correction cap. No Claude job is active. No DB/browser acceptance or push.
Earlier checkpoint/resumption statements below are historical where they conflict with this entry.

**Later instruction supersedes the pause below:** Kubi explicitly authorized Codex to coordinate
Claude CLI implementation while independently reviewing the remaining defects. WORK-048A is
dispatched via the subscription-only zero-tool helper; see WORK-048A_CLAUDE_BRIEF.md and the
2026-09-17 independent review. Preserve the dashboard changes. No push/deployment is authorized.
The earlier manual-number finding needs policy validation and is not an all-work blocker.

Kubi requested that Codex resume the solution-architect and independent-review role when available.
Implementation remains paused while the remediation programme is independently reviewed. The current
source of truth for the active checkpoint is `HANDOVER.md` (updated through WORK-047), not the
older scope list above. A returning Codex must first reconcile the Claude implementation reports,
actual diffs, tests, migrations and TEST evidence for WORK-042, WORK-030b, WORK-043/044, WORK-045
and WORK-047 before accepting any of them or authorizing WORK-048.

The first read-only review on 2026-09-17 reconfirmed these queued lifecycle defects in the actual
code: the general FACTURA cancel route changes status without a reversal; customer payment still
uses a free-text account with a `1102` default and checks state before its transaction; and the
customer-return path still draws a FACTURA number for an uninvoiced return. Those are already
scoped as WORK-048/049. They are not regressions attributed to the accepted POS work.

## Interim items awaiting Codex re-review

All of these were reviewed only by the Claude solution-architect agent, from the same model family
as the implementer.

- **WORK-022, tenant administration containment.** Security, tenant isolation, and accounting-setup
  authorization.
- **WORK-023, tenant-scoped document numbers.** Schema, migration 031, and numbering. Supabase TEST
  is now at ledger ordinal 31.
- **WORK-029, O2C containment.** Tenant isolation, authorization, and the POS stock path. Reviewed
  on Sonnet because the Opus limit was hit.
- **WORK-024a, currency foundation.** Migration 032 (ledger ordinal 32), the currency master, ledger
  currencies, exchange rates, the parametric purchase-to-pay guards, and the exchange-rate
  segregation of duties. Reviewed twice by the Claude solution-architect agent on Opus.
- **WORK-024b, voucher amount triple.** Migration 033 (ledger ordinal 33), the transaction,
  accounting and reporting amounts and rates on every journal line, the reporting basis on the AP
  subledger, and `reverseJournal` carrying them unchanged. Reviewed and ACCEPTED by the agent, with
  four follow-ups closed in the same session.
- **WORK-025a, sales-side currency and jurisdiction.** Migration 034 (ledger ordinal 34): the seven
  sales-side currency defaults dropped, the sales/POS/storefront/CRM/quotation resolution and the
  sales posting guard, the `PUT /purchase/suppliers/:id` mass-assignment fix, the `Tenant.currency_code`
  mirror dropped, and the chart of accounts selected by the new `Tenant.country`. Reviewed by the
  agent: CHANGES REQUIRED with no blockers, and every finding closed in the same session — the
  quotation path now carries the guard, the site-country default is gone (migration 035), the
  jurisdiction is settable through `PUT /tenant/config`, and a route-level test pins that the guards
  fire before a FACTURA number is drawn.
- **WORK-025b, frontend currency sweep.** No migration. `GET /tenant/currency` (auth only), the
  `CurrencyProvider`/`useMoney` channel, `lib/money.ts` with no default currency, 68 screens swept,
  PDFs take the currency as a required prop, and `setup.tenant.read` removed from cashier/employee.
  Not yet reviewed; browser pass and TRY render outstanding.
- **2026-09-11 decisions.** POS hybrid posting, BC-style perpetual FIFO, localization as data,
  shared payment terms, and partial invoicing in go-live scope. They are in the worklog, and each
  one names its sources.

## Current accepted state

- The Core ERP purchasing golden flow is tracked in
  `docs/process/CORE_ERP_COMPLETION_MATRIX.md`.
- WORK-018 vendor payments and settlement is accepted on Supabase TEST. Its live reversible
  acceptance marker is `WORK018-1789028756197`.
- WORK-019 supplier returns and supplier credits is accepted on Supabase TEST. Migration
  `029_supplier_returns_and_credits.sql` is ledger ordinal 29 and a repeat migration run is a no-op.
- WORK-019 live marker `WORK019-1789045833082` proved a one-unit physical return, exact PO cost-layer
  consumption, balanced shipment and credit journals, a 100 BOB supplier-credit DEBIT transaction,
  exact settlement, and invoice closure.
- WORK-020 closes the standing verification gap for catalog process `60.30.030.000 Put away
  received goods`. Microsoft Learn confirms the receive/work/put flow; the permanent Supabase TEST
  harness passed 14/14 assertions for pick-only availability, inventory and FIFO-cost movement,
  transfer subledger evidence, duplicate-completion refusal, parameter restoration, and cleanup.
- WORK-021 closes the bounded SME slice of `75.40.050.000 Manage open purchases`: confirmed orders
  are immutable through the old edit path; authorized users can update delivery dates, cancel an
  unreceived remainder, and inspect immutable change snapshots. Migration `030` is applied to
  Supabase TEST. Generic approval/reapproval workflow and price/quantity approval remain deferred.
- The next step is a fresh catalog-aligned review. `75.40.050.000` remains PARTIAL only for the
  deferred generic workflow and price/quantity approval gaps.
- The user-facing purchase workspaces include payment methods, vendor payments, supplier returns,
  and supplier credits. Return and credit creation use selectable business records rather than raw
  UUID entry.
- Final verification at this checkpoint: backend build, frontend TypeScript, script TypeScript,
  `git diff --check`, 17 Jest suites, and 372 tests passed. The isolated 000–030 Supabase rebuild
  produced empty Prisma drift and removed its temporary schema.

## Interim collaboration model (2026-09-11)

Kubi's Codex quota is exhausted, so Claude Code continues alone for now. The Codex role (design,
Learn validation, implementation prompt, independent review) is performed by the read-only
`.claude/agents/solution-architect.md` agent; the main Claude session implements. OneProvider second
opinions go through `.claude/skills/skarpine-second-opinion/`. See the worklog entry "Collaboration
change — Claude assumes the directing role — 2026-09-11". A returning Codex session should re-review
the items attributed to "Claude solution-architect agent".

## Runtime boundary

Supplier returns and credits currently support BOB documents, separate product-receipt ledger
posting, physical receipt-linked lines, and recoverable input tax. Cross-currency, service-only
credits, non-recoverable purchase tax, combined-mode historical reversal, outbound warehouse work,
and formal Bolivian tax-book export fail closed or remain deferred.

## Resume procedure

1. Read `AGENTS.md`, `HANDOVER.md`, this file, `CODEX_MEMORY.md`, and the completion matrix.
2. Verify the branch and require a clean worktree at this checkpoint before new mutation.
3. Confirm Supabase TEST migration ledger ends at ordinal 35
   (`035_site_country_no_default.sql`, applied as `claude-work-025a`); do not treat it as production.
4. Use Microsoft Learn MCP plus repository evidence for the next catalog decision.
5. Start a fresh bounded design from the completion matrix; use `75.40.050.000` only for its
   explicitly deferred workflow and price/quantity approval gaps, and do not assume all D365
   sub-scenarios belong in the SME product.
6. Preserve the established loop: bounded design, explicit unsupported boundaries, implementation,
   independent Codex review, tests, isolated migration rebuild, then Supabase TEST acceptance.
7. Never print or copy provider API keys. OneProvider and NVIDIA credentials remain in the local
   Windows-user secret store and are not repository configuration. The direct Anthropic credential
   is currently unconfigured; OneProvider is the configured Claude-compatible fallback.
8. Read `docs/collaboration/PROJECT_CONTEXT_2026-09-11.md` before resuming manual Claude work.

## Operational notes

- Local frontend: `http://localhost:3000`.
- Local backend health: `http://localhost:3001/api/health`.
- No production database location is recorded in the repository.
- A commit is local until separately pushed. Do not push, merge, rebase, or force-update without the
  user's explicit instruction.
