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

## Resume checkpoint — 2026-09-06

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
- Kubi clarified that `skarpine-pos/` is a roughly built but incomplete POS application. Its
  uncommitted state is deliberate context, not authorization to clean up or commit it. Treat it as a
  separate nested repository and preserve it until Kubi explicitly scopes POS work.
- While WORK-001 is pending, Kubi requested a future configurable security foundation inspired by D365 Role -> Duty -> Privilege -> Permission, including UI/action authorization and scoped data access. Codex completed a Microsoft Learn + repo analysis in `docs/analysis/SECURITY_AUTHORIZATION_GAP_ANALYSIS.md`. Kubi approved the analysis and recommended starting assumptions, but not implementation. After WORK-001 is accepted, the next security step may be a separate read-only route/permission audit; it must not be added to Claude's current WORK-001 scope.

## Maintenance rule

After each approval, implementation report, Codex review, or accepted checkpoint:

1. Update the detailed state in `CODEX_CLAUDE_WORKLOG.md`.
2. Update only the resume checkpoint in this file when the next-session starting point changes.
3. Never silently change an earlier decision; record the new decision and what it supersedes.
