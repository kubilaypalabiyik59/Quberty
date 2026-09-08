# Codex Session Memory — Skarpine

> Durable resume pointer for new Codex sessions.
>
> This is not a second project backlog and must not duplicate detailed implementation history.
> The shared worklog named below is the source of truth for current coordination state.

## Required reading order for every new Codex session

1. `AGENTS.md`
2. `HANDOVER.md`
3. `docs/collaboration/CODEX_MEMORY.md`
4. `docs/collaboration/CODEX_CLAUDE_WORKLOG.md`
5. Process and architecture documents referenced by the active work item

## Durable collaboration model

- Kubi is the product owner and final decision-maker.
- Codex is the directing process/architecture analyst and independent reviewer.
- Claude is the implementation agent for one explicitly approved, bounded work item at a time.
- Kubi describes the goal to Codex. Codex challenges assumptions, verifies Microsoft Learn and the
  repository, proposes scope and priorities, and waits for approval before implementation.
- After approval, Codex prepares the exact Claude prompt.
- Claude records its factual implementation report in the shared worklog.
- Codex reviews the actual repository diff and verification evidence independently; Claude's
  narrative report is not proof by itself.
- Every accepted work item ends with a clean, reviewable checkpoint before the next item begins.

## Product direction to preserve

- The goal is an SME-focused, AI-augmented ERP, not a full D365 clone.
- The immediate product objective is a real-life demonstrable ERP foundation.
- Prioritize complete golden flows over a large count of partially implemented modules.
- Source to Pay and Order to Cash must be proven through Inventory and Record to Report effects.
- Scope may reduce current behavior, but must preserve deliberate schema hooks for future growth.
- Bolivia remains the default, regression-protected jurisdiction.
- **Kubi's permanent product rule, recorded 2026-09-07.** Every new form and module is
  parameter-driven; its configuration belongs to the owning module's Setup area, never a global
  settings page; future capabilities receive non-destructive schema hooks; and existing hard-coding
  is remediated incrementally when its process is next touched. Full text in
  `CODEX_CLAUDE_WORKLOG.md` §4.1. **It must be carried into every future Claude implementation
  prompt.**
- **Business Process Catalog decision, recorded 2026-09-07.** The Microsoft Dynamics 365
  `JUL-2026` Business Process Catalog is Skarpine's canonical process taxonomy and the backbone of
  future Core ERP completion analysis. It is **not** a D365 feature-parity promise or an automatic
  backlog. Use all six levels, then add Skarpine-owned scope, implementation evidence, parameter
  ownership, hard-coding debt, schema hooks, localization impact, and acceptance evidence as a
  separate overlay. The binding framework is
  `docs/process/CORE_ERP_PROCESS_CATALOG.md`; carry relevant catalog IDs into every future analysis
  and Claude implementation prompt.

## Resume checkpoint — 2026-09-06 (SUPERSEDED by the 2026-09-07 checkpoint below)

- Kubi approved the prioritized P0–P5 delivery direction recorded in
  `docs/collaboration/CODEX_CLAUDE_WORKLOG.md`.
- P0 is approved, but must be executed as bounded work items rather than one broad implementation.
- `WORK-001 — Classify the current working tree and design the safe checkpoint` is approved.
- Codex supplied Kubi with the first Claude prompt for WORK-001.
- Claude's WORK-001 correction addendum was received and Codex accepted the work item. The safe
  checkpoint inventory is complete.
- D-1 is resolved: Kubi approved retaining `frontend/.env.local.bak` and adding `.env*.bak` to the
  root `.gitignore`; the file itself was not opened or changed.
- D-2 is resolved: tracked `.claude/skills/` is canonical; `.agents/skills/` is a generated/local
  runtime copy; `.agents/` and `.codex/` are ignored without deleting their current contents. A
  deterministic sync/setup mechanism is deferred to a separate reviewed work item.
- D-3 is resolved: the 34 local commits were pushed unchanged to the remote preservation branch
  `codex/pre-cleanup-2026-09-06`; remote `master` was not changed. The active checkout remains on
  local `master` with an empty index and the existing dirty tree.
- D-4 is resolved: the POS is backed up in private repository `Quberty-POS`. Its original `master`
  and explicit WIP branch are remote; `master` is default. The parent gitlink removal is staged while
  the physical nested repo remains present, ignored, clean, and independent. POS type-check still has
  five documented errors, so the WIP snapshot is not a completion claim.
- D-5 database verification is complete and matches the disclosed post-state: factura number is
  text, sequence manual is boolean, FACTURA next number is 34, maximum is `000033`, and duplicate
  groups are zero. Migration 023's effects are present in the test database.
- D-5 is resolved under Kubi's delegation of architectural control: Codex removed only the internal
  `BEGIN/COMMIT` commands from migration 023 because `applyMigration.ts` owns the atomic transaction.
  The three migration statements and verified test database were not changed.
- D-6 is resolved: retain stable `master`, use short-lived `codex/` feature branches and review; do
  not add a long-lived `develop` branch.
- D-7 is resolved: `docs/analysis/` is repository-owned product/architecture context and may be
  versioned, subject to the standing exclusion of secrets and transient/client-confidential data.
- All WORK-001 decisions D-1 through D-7 are now resolved. The next step is a non-mergeable full WIP
  snapshot of the valid dirty parent tree, followed by reconstruction into buildable vertical
  feature commits and verification. This next state-changing step has not yet run.
- Kubi clarified that `skarpine-pos/` is a roughly built but incomplete POS application. Treat it as
  a separate nested repository and preserve it until Kubi explicitly scopes POS work.
  **Superseded in part on 2026-09-07:** this bullet previously said its *uncommitted* state was
  deliberate context. The application is still deliberately incomplete, but its tree is no longer
  uncommitted — it was committed to `codex/wip-incomplete-pos-2026-09-06` (`09fa4de`) and pushed to
  the private remote `Quberty-POS` under decision D-4. "Incomplete" and "uncommitted" are now
  separate facts; only the first still holds.
- While WORK-001 is pending, Kubi requested a future configurable security foundation inspired by D365 Role -> Duty -> Privilege -> Permission, including UI/action authorization and scoped data access. Codex completed a Microsoft Learn + repo analysis in `docs/analysis/SECURITY_AUTHORIZATION_GAP_ANALYSIS.md`. Kubi approved the analysis and recommended starting assumptions, but not implementation. After WORK-001 is accepted, the next security step may be a separate read-only route/permission audit; it must not be added to Claude's current WORK-001 scope.

## Resume checkpoint — 2026-09-07 (SUPERSEDED by the 2026-09-08 checkpoint below)

- **WORK-002 is COMPLETE and independently ACCEPTED by Codex.** The valid dirty parent tree is
  preserved off-machine on `origin/codex/wip-full-snapshot-2026-09-06`.
  - Snapshot payload commit: `7aefd74fb2db028375f199d6c4be64267439702f` — the mixed working tree.
  - Branch tip: `b17c04723d7bb341bd88ad223e461602f398da10` — adds the WORK-002 report to the
    worklog. **`docs/collaboration/` must be restored from the tip, not from the payload.**
  - Clean reconstruction base: `0a8bdf2543909247a50f74670945b15e43da7165`.
  - The snapshot is **explicitly non-mergeable**. It is a restore source only — never merge,
    cherry-pick, amend, squash, rebase or force-push it.
  - `origin/master` is `5cd97a6dae2364d0fc3c557c2250c0223acd64f6` and must stay untouched.
- **WORK-003 is COMPLETE and ACCEPTED.** It produced the hunk-level reconstruction map, the
  line-ending policy, and findings F1–F5. Read it in `CODEX_CLAUDE_WORKLOG.md` before touching the
  reconstruction — F1 (a mixed-concern backend file) and F2 (one fewer mixed frontend file than
  WORK-001 recorded) both correct the earlier plan.
- **Accepted reconstruction sequence: V1 -> V2 -> V3** (Codex decision K-1, superseding Claude's
  recommended V1 -> V3 -> V2). The three mixed files are split by hunk, which is what removes V2's
  apparent dependency on `useTaxPreview` and lets the already-migrated test database become
  compatible one commit earlier.
  - V1 — governance, documentation, `.gitignore`, `.gitattributes`, gitlink removal. **WORK-004.**
  - V2 — factura numbering via `NumberSequence` (migration 023, schema, backend, Setup UI, tests).
  - V3 — server-driven tax preview (`useTaxPreview`, the `GET /finance/tax/preview` route hunk, and
    the POS/PDF/list consumers). **Delivered and published; see the 2026-09-08 checkpoint.**
- **Rebuild branch: `codex/rebuild-2026-09-07`**, created from `0a8bdf2` in a **separate worktree**
  at the sibling path `../skarpine-rebuild`. The snapshot checkout is never switched, restored into,
  or cleaned.
- **Next work item: WORK-004 / V1**, executed and awaiting Codex review. It is **not pushed** — the
  work item deliberately stops before any push.
- **Disclosed limitation carried forward (K-3):** `backend/tsconfig.json` has `include: ["src"]`, so
  **`backend/scripts/` has no type-check gate at all**. `backend/scripts/verifyFacturaLines.ts` will
  therefore ship in V2 unverified by any compiler. It must **not** be executed as a substitute gate
  — it temporarily mutates test data and needs its own safety review. A separate bounded work item
  will add `tsconfig.scripts.json` after reconstruction completes.
- **Line endings (K-2):** the `.gitattributes` policy is adopted in V1. **No repository-wide or
  selective renormalisation is needed or authorized during the current reconstruction**, because the
  tracked index is already LF throughout — `git add --renormalize` would rewrite nothing. This is a
  statement about the verified present state, not a permanent prohibition: **if a future audit
  proves that a specific tracked file holds CRLF in the index, that file may be renormalised in its
  own reviewed work item**, named file by file rather than as a sweep.
- **Workspace constraint:** the Claude Code permission classifier in this workspace refuses commands
  by *shape*, rejecting even read-only `git` invocations inside compound shell statements. Every
  work item must specify single, simple commands — no chaining, redirection, or command
  substitution.
- **Still not started:** the security module (analysis approved, implementation not), and backlog
  items P0.3 migration baselining, P0.4 checksum ledger, P0.5 CI drift checks, P0.6 parallel-
  developer rules.

### Resume checkpoint addendum — 2026-09-07 after WORK-007 review (HISTORICAL)

> Everything below describes the state at the time of the WORK-007 review. It is kept as a record
> and is no longer current: V3 has since been delivered, accepted and published. See the 2026-09-08
> checkpoint.

- V1 governance (`a713a53`) and the WORK-006 clean baseline (`cef88c9`) are pushed and accepted on
  `origin/codex/rebuild-2026-09-07`.
- **WORK-007 / V2 is independently ACCEPTED by Codex at commit
  `fcc008e9bf00b09ae450cdbe17d281561566cf48`.** Codex reviewed the repository diff rather than
  relying on Claude's report, ran the complete backend suite (12 suites / 264 tests), and completed
  the frontend production build (67 static pages). The rebuild worktree is clean.
- **V2 is published.** `origin/codex/rebuild-2026-09-07` contains the V2 checkpoint
  `fcc008e9bf00b09ae450cdbe17d281561566cf48`, pushed 2026-09-08 and confirmed with `git ls-remote`.
  The Business Process Catalog documentation is integrated on top of it by the commit this bullet
  belongs to. The next reconstruction slice was V3, which at that point had not started.
- WORK-007's accepted behaviour covers automatic/manual FACTURA numbering across the parent web
  surfaces, including customer returns, and fails closed on unsupported fiscal-year resumption.
- Residuals remain separate work: Android POS manual-number support; the Bolivian credit-note series
  decision; a year/legal-entity-aware FACTURA history model; shared JSX for the repeated manual-
  number control; and the `backend/scripts/` compiler gate.
- The July 2026 Business Process Catalog framework was prepared on the separate local branch
  `codex/business-process-catalog-framework-2026-09-07` and applied to the rebuild branch by
  cherry-pick — never by merge — only after the V2 remote checkpoint had been verified. That branch
  and its worktree remain in place; they were not deleted.

## Resume checkpoint — 2026-09-08 — RECONSTRUCTION COMPLETE

**Start a new session here.**

- **The reconstruction is finished and fully published.** `origin/codex/rebuild-2026-09-07` carries,
  in order: V1 governance `a713a53`, the WORK-006 green baseline `cef88c9`, V2 factura numbering
  `fcc008e9`, the Business Process Catalog documentation `2177d36a`, and V3
  `c362cdc0be37b4a1285469a32989cadc5c369de4`.
- **WORK-009 / V3 is independently ACCEPTED by Codex and PUBLISHED.** It provides a server-driven
  tax preview for the approved web ERP and POS surfaces: those screens now obtain their tax split
  from the same configured engine that posts the journal, instead of computing it in the browser.
- V3's final correction closes seven safety properties — React hook-order safety; tenant/session
  query-cache isolation; stale amount and debounce safety; fail-closed initial loading; fail-closed
  background refetch; fail-closed error and retry states; and PDF gating until a current successful
  tax result exists.
- **Independent verification** by Codex included a real `QueryClient`/`QueryObserver` state-chain
  check and a frontend type-check. The backend remained at the independently verified
  **13 suites / 285 passing tests**.
- **Verification debt, recorded deliberately.** Claude's scratch harnesses are uncommitted; their
  totals were NOT independently reproduced as artifacts and must never be represented as permanent
  regression tests. **No frontend unit-test runner and no browser-render regression suite exists**,
  so the tax-preview state machine has no standing automated guard in the repository. This is the
  first thing a reviewer should look for the next time these surfaces change.
- **No next Core ERP implementation item has started.** The next action is a fresh, catalog-aligned
  assessment of the remaining Core ERP gaps — anchored on the framework in
  `docs/process/CORE_ERP_PROCESS_CATALOG.md` — before any bounded implementation item is selected.
  The catalog remains a navigation spine, not a D365 feature-parity promise.
- Carried forward unchanged: the `backend/scripts/` type-check gap (K-3); the Android POS manual
  FACTURA number gap; the unverified Bolivian credit-note series decision; the year/legal-entity
  aware FACTURA history model; the header-level/per-line tax limitation; and backlog items P0.3–P0.6
  plus the security module, none of which has started.

## Maintenance rule

After each approval, implementation report, Codex review, or accepted checkpoint:

1. Update the detailed state in `CODEX_CLAUDE_WORKLOG.md`.
2. Update only the resume checkpoint in this file when the next-session starting point changes.
3. Never silently change an earlier decision; record the new decision and what it supersedes.
