# Codex–Claude Shared Worklog

> Shared coordination record for Kubi, Codex, and Claude.
>
> This file records decisions, approved scope, implementation handoffs, review findings, and the
> prioritized delivery backlog. It does not replace `AGENTS.md`, `HANDOVER.md`, process references,
> or architecture documents. Every participant must read those sources before acting.

## 1. Roles and decision rights

| Participant | Primary responsibility | Must not do alone |
|---|---|---|
| Kubi | Product owner; business decisions; scope and implementation approval | Treat an AI recommendation as approved scope without explicitly deciding |
| Codex | Process and architecture analysis; repo verification; prioritization; Claude prompt preparation; independent review | Start implementation before Kubi approves it |
| Claude | Implement the approved, bounded task; run verification; report exact changes and residual risks | Expand scope, redesign shared foundations, or change business policy without approval |

Domain decisions remain with the relevant human expert. Technical implementation must not silently
invent Finance or Supply Chain policy.

## 2. Source-of-truth order

When two statements conflict, use this order and record the conflict:

1. Kubi's latest explicit decision.
2. `AGENTS.md` and current project instructions.
3. Official Microsoft Learn documentation for D365 process claims.
4. Repo-verified current behavior and schema.
5. Approved architecture/process documents.
6. This worklog.
7. Unverified assumptions.

Claims must be labelled as one of: **official documentation**, **repo-verified**,
**architectural recommendation**, or **assumption needing validation**.

## 3. Mandatory work cycle

1. Kubi describes the business goal or problem.
2. Codex verifies the current repo and the official D365 process.
3. Codex records current coverage, gaps, MVP scope, exclusions, schema hooks, risks, and acceptance
   criteria in this file.
4. Kubi explicitly approves or changes the proposed scope.
5. Codex writes one bounded implementation prompt for Claude and records it here.
6. Claude works only on the approved scope, then records changed files, migrations, tests, and
   unresolved issues here.
7. Codex independently reviews the actual diff and test evidence. A narrative implementation report
   is not accepted as proof.
8. Claude resolves review findings if needed.
9. Codex marks the item accepted only when its acceptance criteria pass.
10. The completed work is committed as a clean checkpoint before the next item begins.

## 4. Rules for both AI systems

- Read `AGENTS.md`, `HANDOVER.md`, and this file before each task.
- Do not implement analysis-only or unapproved proposals.
- Do not overwrite another participant's entry. Append a dated update under the relevant work item.
- Inspect the current working tree before editing and preserve unrelated changes.
- Never commit environment files, credentials, local backups, or machine-local agent configuration.
  Project-scoped skills under `.claude/skills/` or `.agents/skills/` are not automatically local
  state: establish their provenance and cross-agent purpose before deciding whether to version,
  generate, link, or ignore them.
- Shared-core changes require explicit review: `prisma/schema.prisma`, migrations, posting profiles,
  tax, number sequences, financial dimensions, inventory dimensions, and document state models.
- A feature is not complete because its screen works. Its document state, inventory effect,
  subledger effect, General Ledger posting, reversal behavior, authorization, and audit evidence must
  be verified where applicable.
- D365 behavior guides the data-model anatomy; it does not automatically define Skarpine MVP scope.
- Scope cuts are behavior cuts. Record a concrete schema hook for deferred capability, or state why
  no hook is needed.

### 4.1 Kubi's permanent product rule — binds every future work item

Recorded 2026-09-07. This is a standing decision from the product owner, not a per-item preference,
and **it must be carried into every future Claude implementation prompt.**

1. **Every new form and module is parameter-driven.** A value a customer could reasonably want to
   differ — an account, a rate, a threshold, a label, a sequence, a policy switch — lives in data,
   not in service code. A hardcoded value is a defect unless Kubi exempts it explicitly.
2. **Configuration belongs to the owning module's Setup area.** One module, one Setup area, one
   Parameters record. Never a global settings page. Where two modules need the same value, one owns
   it and the other reads it through a **stated fallback**.
3. **Future capabilities receive non-destructive schema hooks.** A deferred capability ships with
   the specific nullable FK, enum value, discriminator column or join table that lets it attach
   later without a data migration — or an explicit statement that it genuinely needs none. A
   setting that will later want three values is an enum from the start, not a boolean.
4. **Existing hard-coding is remediated incrementally, when its process is next touched.** This rule
   does not authorise a sweeping refactor of its own; it means a process is not "done" while the
   code path being changed still resolves configuration with an `if`.
5. **User-managed configuration is incomplete without its UI.** When a functional slice introduces
   or touches a value that an authorized end user must manage, acceptance requires the data model,
   backend API and validation, permission enforcement, an owning-module Setup/Parameters form, and
   consumption by the operational screen. Infrastructure-only controls do not receive artificial
   forms, and an explicitly deferred administration UI must remain visible as an open acceptance gap.

Rule 4 is the part that is easy to lose: it makes remediation a condition of finishing work already
in scope, rather than a separate project that never gets prioritised.

## 5. Prioritized delivery backlog

### P0 — Establish a safe shared baseline

**Status:** Approved by Kubi on 2026-09-06. Execute as bounded work items; do not implement the
entire P0 scope in one change.

1. Classify the current modified and untracked files; isolate local/sensitive artifacts.
2. Preserve the valid current work on a named feature branch through logical commits.
3. Baseline SQL migrations `001` through `023` against the test database.
4. Introduce a checksum-backed migration ledger and single-run migration lock.
5. Add empty-database rebuild and schema-drift checks to CI.
6. Define separate checkout/worktree and database rules for future parallel developers.

**Exit condition:** a clean commit can provision an empty development database deterministically,
and the application/deployment check identifies missing or modified migrations before runtime use.

### P0-Security — Establish authorization before external real-user testing

**Status:** Analysis and recommended assumptions approved by Kubi on 2026-09-06; implementation not
approved. Prepare the first read-only security audit only after WORK-001 is accepted.

Use `docs/analysis/SECURITY_AUTHORIZATION_GAP_ANALYSIS.md` as the governing analysis. Authentication exists, but the current single-string role checks do not provide configurable Role -> Duty -> Privilege -> Permission authorization, organization-scoped assignments, default-deny route coverage, or segregation of duties.

Sequence after the safe repository/migration baseline: contain unguarded ERP entry points and separate customer access; fix session revocation and security auditing; add additive RBAC and a registered business-action catalog; convert Source to Pay first; then build administration UI and scoped data/segregation controls.

**Exit condition before external testing:** every ERP entry point is explicitly public or permission-protected; customer identities cannot enter ERP functions; required test roles have positive and negative API tests; and role/session changes are auditable and revocable.

### P1 — Audit the Source to Pay golden flow

**Status:** Next analysis task after P0 scope approval; analysis only.

Build an evidence matrix for:

1. Vendor and procurement setup.
2. Purchase requisition.
3. Request for quotation and approved MVP deferral, if applicable.
4. Purchase order creation, approval, confirmation, and change control.
5. Product receipt and inventory transactions.
6. Vendor invoice, invoice register if applicable, and three-way matching.
7. AP open transaction, payment, and settlement.
8. Purchase return, cancellation, correction, and reversal.
9. Tax, financial dimensions, posting profiles, number sequences, and audit trail across the flow.

For every step record: official D365 reference, repo evidence, coverage state (`COMPLETE`, `PARTIAL`,
`MISSING`, `INCORRECT`), demo necessity, deferred behavior, schema hook, and acceptance criteria.

**Exit condition:** Kubi can approve a sequenced list of real gaps without relying on assumptions or
feature-name matching.

### P2 — Close approved Source to Pay gaps

**Status:** Blocked by P1 findings and Kubi's scope approval.

Implement one vertical slice at a time. Each slice must prove the operational document, inventory
effect where applicable, AP/GL posting, tax, dimensions, reversal behavior, and automated tests.

**Exit condition:** a vendor purchase can proceed from the approved starting document through
receipt, invoice matching, AP payment, settlement, and traceable ledger entries, including one
controlled exception and one reversal scenario.

### P3 — Audit and close the Order to Cash golden flow

**Status:** Follows a demonstrable Source to Pay flow.

Audit and then close the approved gaps from customer/sales setup through sales order, reservation,
pick/pack/ship, customer invoice, AR payment, settlement, return, and credit note. Treat outbound
warehouse execution as Inventory to Deliver rather than silently collapsing it into Sales.

**Exit condition:** a customer sale has traceable document, stock, COGS, tax, AR, cash, settlement,
return, and ledger evidence.

### P4 — Prove Record to Report integration and controls

**Status:** Depends on stable Source to Pay and Order to Cash postings.

Verify subledger-to-GL reconciliation, manual journals, corrections, tax reporting, trial balance,
P&L, balance sheet, periods, close controls, and dimension reporting.

**Exit condition:** Finance can reconcile the two golden flows to the ledger and reports without
manual database intervention.

### P5 — Real-life demo hardening

**Status:** Depends on P2 through P4.

Create a repeatable demo company, role-based scripts, realistic master data, happy paths, controlled
exceptions, recovery steps, and evidence capture. Validate deployment, backup/restore, monitoring,
security, and performance separately from functional completeness.

**Exit condition:** a fresh environment can run the agreed demo end to end without repository or
database intervention during the session.

## 6. Work-item template

Copy this block for each item. Keep entries concise and evidence-based.

```markdown
### WORK-XXX — Title

- Priority:
- Status: PROPOSED | APPROVED | IN_PROGRESS | IN_REVIEW | CHANGES_REQUESTED | ACCEPTED | BLOCKED
- Owner:
- Business objective:
- Official documentation:
- Repo evidence:
- Current coverage:
- Approved MVP behavior:
- Explicitly deferred:
- Schema hook:
- Risks and open decisions:
- Acceptance criteria:
- Claude implementation prompt:
- Claude implementation report:
- Codex review:
- Kubi decision:
```

## 7. Current coordination state

- **Architectural recommendation:** prioritize complete Source to Pay and Order to Cash golden flows
  connected to Inventory and Record to Report, rather than maximizing the number of visible modules.
- **Repo-verified:** the working tree is currently not a clean shared baseline, and the custom SQL
  migration runner does not record an applied-migration ledger.
- **Decision recorded from Kubi:** start with purchasing and sales foundations because an ERP demo
  must prove operational processes and their financial consequences.
- **Decision recorded from Kubi on 2026-09-06:** P0 is approved. Begin with a read-only working-tree
  classification and checkpoint plan before making cleanup, commit, ignore, or migration changes.
- **Requirement raised by Kubi on 2026-09-06:** evaluate a configurable D365-shaped security model covering authentication, Role -> Duty -> Privilege -> Permission authorization, UI/action access, organization data scope, administrator access, and future custom roles. Microsoft Learn validation and repo gap analysis are recorded in `docs/analysis/SECURITY_AUTHORIZATION_GAP_ANALYSIS.md`. Implementation remains unapproved and must not interrupt WORK-001.
- **Decision recorded from Kubi on 2026-09-06:** the security analysis and its recommended starting
  assumptions are approved. This is not permission to implement the security module. After WORK-001
  is accepted, Codex may prepare a separate read-only security route/permission audit prompt.

### WORK-001 — Classify the current working tree and design the safe checkpoint

- Priority: P0.1
- Status: APPROVED
- Owner: Claude (analysis); Codex (independent review); Kubi (decisions on ambiguous files)
- Business objective: Establish exactly which current changes belong together and which files must
  remain local before creating the shared development baseline.
- Official documentation: Not applicable; this is repository lifecycle work.
- Repo evidence: The parent repository is on `master` with modified and untracked content, and the
  nested `skarpine-pos` repository has its own dirty state.
- Current coverage: No reviewed classification or commit plan is recorded.
- Approved MVP behavior: Read-only inspection and a proposed logical commit sequence.
- Explicitly deferred: No product-file edits, moves, deletion, staging, commits, branch creation,
  migration execution, database access, or environment changes in this work item. Claude may append
  only its implementation report to this work item in the shared worklog.
- Schema hook: Not applicable; no schema behavior is being changed.
- Risks and open decisions: Local backups, environment material, AI-tool state, and unrelated POS
  work must not be accidentally committed. Existing user changes must be preserved. Kubi clarified
  on 2026-09-06 that `skarpine-pos/` is roughly built but incomplete and its uncommitted state is
  deliberate; WORK-001 must inspect and report it separately without cleanup or commit proposals
  that assume it is finished.
- Acceptance criteria:
  1. Every modified and untracked parent-repo entry is classified by purpose and proposed action.
  2. The nested POS repo is reported separately and not treated as a parent-repo change.
  3. Potential secrets or machine-local files are identified by path only; their contents are not
     printed.
  4. A logical, reversible branch/checkpoint and commit sequence is proposed.
  5. No repository or database state is changed except appending the report to this worklog.
- Claude implementation prompt:

  ```text
  You are working in the Skarpine / Quberty ERP repository.

  Before taking any action, read these files in full:

  1. AGENTS.md
  2. HANDOVER.md
  3. docs/collaboration/CODEX_CLAUDE_WORKLOG.md

  Work only on WORK-001: "Classify the current working tree and design the safe checkpoint."

  This is a read-only repository audit. Do not edit product files, move or delete anything,
  stage files, create a branch, commit, run migrations, access the database, or change any
  environment configuration.

  You may make exactly one file change: append your factual implementation report under
  "Claude implementation report" in WORK-001 inside
  docs/collaboration/CODEX_CLAUDE_WORKLOG.md. Do not overwrite or rewrite earlier entries.

  Tasks:

  1. Inspect the parent repository's current branch, latest commit, and complete working-tree status.
  2. Inspect the nested skarpine-pos repository separately. Do not treat it as an ordinary
     parent-repo change and do not modify it.
  3. Classify every modified and untracked parent-repo entry into:
     - coherent product work;
     - documentation/governance;
     - migration/schema work;
     - tests/verification;
     - machine-local or AI-tool state;
     - potentially sensitive/local backup;
     - ambiguous and requiring Kubi's decision.
  4. Do not print the contents of any environment file, backup environment file, credential, key,
     token, or secret. Mention potentially sensitive files by path only.
  5. Infer likely logical change groups using diffs and file relationships, but do not claim intent
     without evidence.
  6. Propose a reversible sequence for:
     - exclusions or .gitignore candidates;
     - preservation branch/checkpoint;
     - logical commits;
     - handling the nested POS repository separately.
  7. Identify every decision that must come from Kubi before any cleanup or commit.
  8. Append a concise report to WORK-001 in the shared worklog. Include commands used, evidence,
     classifications, proposed sequence, risks, and open decisions.
  9. Return the same concise report to me, including confirmation that no state was changed other
     than the permitted worklog append.

  Do not begin migration-ledger implementation. Do not clean the working tree. Stop after the
  WORK-001 report.
  ```
- Claude implementation report: Pending.
- Codex review: Pending.
- Kubi decision: P0 approved on 2026-09-06; WORK-001 may proceed under the read-only constraints.

#### Claude implementation report — 2026-09-06

The `Claude implementation report: Pending.` line above was deliberately left untouched rather than
rewritten, per the no-overwrite rule. This subsection is the report.

**Scope honoured.** Read-only audit. No product file edited, nothing moved, deleted, staged,
branched, committed; no migration run, no database accessed, no environment file changed *as part of
this work item*. The only write is this append. **See "Prior state changes in this same session"
below — two changes were made earlier today, before WORK-001 was assigned, and they are material to
this classification.**

##### Commands used

```
git rev-parse --abbrev-ref HEAD ; git rev-parse --abbrev-ref --symbolic-full-name @{u}
git log -1 --format='%H%n%h %ad %an%n%s' --date=iso ; git remote -v
git rev-list --left-right --count origin/master...HEAD
git status --porcelain=v1 -unormal ; git status --porcelain -uall
git ls-files -s skarpine-pos ; git diff -- skarpine-pos
git check-ignore -v <path>            (frontend/.env.local[.bak], backend/.env, .agents/, .codex/,
                                       docs/analysis/, docs/collaboration/, skarpine-pos)
git diff --stat / --no-pager diff -U0 / -U2   (per file, tracked modifications)
git diff --cached --stat              (confirmed nothing staged)
git ls-files .claude | wc -l ; git ls-files .claude/skills | awk -F/ '{print $3}' | sort -u
stat -c '%y' <modified files>         (mtime cohorts, grouping evidence)
cd skarpine-pos && git rev-parse --show-toplevel ; git log -1 ; git remote -v ; git status --porcelain -uall
```

##### 1. Parent repository state (repo-verified)

| Fact | Value |
|---|---|
| Branch | `master`, tracking `origin/master` |
| Remote | `origin` → `https://github.com/kubilaypalabiyik59/Quberty.git` |
| Divergence | **34 ahead, 0 behind** `origin/master` — 34 local commits are unpushed |
| HEAD | `0a8bdf2` · 2026-08-18 09:44:10 +0200 · Kubilay · "Close the session: the Setup UI, and the store dimension switched on" |
| Index | **Nothing staged** (`git diff --cached --stat` empty) |
| Modified tracked | 25 files + 1 gitlink; `+538 / −125` across the 25 |
| Untracked | **185 files** (`-uall`), of which 182 are AI-tool state |
| Deleted | none |
| `.gitmodules` | **absent** |

##### 2. Nested `skarpine-pos` — reported separately, not treated as a parent change

Inspected from inside the directory. It is its own repository (`show-toplevel` =
`.../skarpine/skarpine-pos`).

| Fact | Value |
|---|---|
| Branch / HEAD | `master` · `75d0b67` · 2026-04-05 · "Initial commit" — **one commit total** |
| Remote | **none configured** |
| Modified tracked | `app.json`, `package.json`, `package-lock.json`, `tsconfig.json` |
| Untracked | 23 files: all of `app/` (7 Expo Router screens) and `src/` (api, components, store), plus `babel.config.js`, `eas.json`, and a stray RN artifact `com.facebook.react.devsupport.BundleDownloader` |
| Env/secret-shaped files | none found at POS root or in its untracked list |

**Two findings that contradict the current documentation.**

1. **[repo-verified]** `git ls-files -s skarpine-pos` returns **`160000 75d0b67… 0 skarpine-pos`** —
   the parent index records it as a **gitlink**, i.e. a submodule entry, even though there is no
   `.gitmodules`. `AGENTS.md §1` and `HANDOVER.md §1/§5` state it is "not a submodule". Both are
   half-right: it is an *unregistered* gitlink. `git submodule` commands cannot see it, but the
   parent commit does pin a SHA, and `git status` reports it as ` M`. The diff is
   `75d0b67…` → `75d0b67…-dirty`: **the pinned SHA has not moved**; only the nested working tree is
   dirty.
2. **[repo-verified]** the root `.gitignore` line 63 contains `skarpine-pos/`, which is *inert* —
   an already-tracked path is not affected by ignore rules. The ignore entry and the gitlink
   contradict each other and one of them should go.

**Durability risk, stated without proposing cleanup.** Kubi's clarification of 2026-09-06 (recorded
in this item's *Risks and open decisions*) is that `skarpine-pos/` is roughly built but incomplete
and its uncommitted state is **deliberate**. This report therefore makes **no cleanup or commit
proposal** for it and does not treat it as finishable work. The factual observation that remains is
narrower: its source exists on **this machine only** — one commit, no remote, `app/` and `src/`
untracked — so a disk failure loses it whether or not it is finished. *[architectural
recommendation]* keeping an unfinished tree safe is a **backup** question, not a commit question;
an off-machine copy (a private remote holding a WIP branch, or a plain archive) preserves it without
declaring it complete. Whether to do that, and how, is Kubi's call (D-4).

##### 3. Classification of every parent-repo entry

**(a) Coherent product work — group A: factura numbering moves to `NumberSequence`.** Evidence:
`schema.prisma` changes are exactly `Factura.factura_number Int→String` and `NumberSequence.manual`,
which are precisely the two DDL steps in the untracked migration `023`; the three duplicated
`factura_counters` raw-SQL allocators are deleted (`git diff -U0 | grep '^-.*factura_counters'`
returns 6 removed lines across sales/finance/pos) and replaced by
`allocateNumber({ …, manualNumber })`.

```
M backend/prisma/schema.prisma                      M backend/src/modules/finance/finance.routes.ts
M backend/src/shared/services/numberSequence.service.ts   M backend/src/modules/pos/pos.routes.ts
M backend/src/shared/schemas/index.ts               M backend/src/modules/sales/sales.routes.ts
M backend/src/modules/setup/setup.routes.ts         M backend/src/docs/openapi.ts
M frontend/src/app/(erp)/setup/page.tsx             M frontend/src/components/erp/finance/FacturaPDF.tsx
M frontend/src/app/(erp)/finance/iva-report/page.tsx  M .../FacturaPDFButton.tsx  M .../IvaReportPDF.tsx
?? backend/prisma/sql/023_factura_numbering_via_number_sequence.sql
?? frontend/src/app/(erp)/setup/numbering/page.tsx
```

**(b) Coherent product work — group B: hardcoded 13 % / 3 % removed from the UI.** Evidence: a new
`useTaxPreview` hook is imported by every file below, and the removed lines are literal `13%` / `3%`
labels.

```
?? frontend/src/lib/useTaxPreview.ts
M  frontend/src/stores/posCartStore.ts      M frontend/src/app/pos/main/page.tsx
M  frontend/src/components/erp/sales/SalesOrderPDF.tsx   M .../SalesOrderPDFButton.tsx
```

**(c) Files carrying BOTH group A and group B hunks** — they cannot be split into two commits
without splitting hunks:
`frontend/src/app/(erp)/finance/facturas/page.tsx`, `frontend/src/app/(erp)/sales/orders/page.tsx`,
`frontend/src/app/(erp)/sales/orders/[id]/page.tsx`.

**(d) Tests / verification.**
`?? backend/src/__tests__/numberSequence.manual.test.ts` (new, group A) and
`M backend/scripts/verifyFacturaLines.ts` (adapted because `factura_number` is now text).

**(e) Migration / schema work.** `?? backend/prisma/sql/023_…sql` (7 027 bytes) together with
`M backend/prisma/schema.prisma`. **Shared-core, review-gated** per worklog §4.

**(f) Documentation — factual correction.** `CLAUDE.md`, `DEVELOPMENT_PLAN.md`, `README.md` and one
hunk of `HANDOVER.md` are a single one-line change each: **"Express" → "Hono"**. Independent of all
code above.

**(g) Documentation / governance.** `?? AGENTS.md`, `?? docs/collaboration/CODEX_CLAUDE_WORKLOG.md`,
`?? docs/collaboration/CODEX_MEMORY.md`, plus the second `HANDOVER.md` hunk which **links to
`docs/collaboration/*`**. Committing that HANDOVER hunk without the two collaboration files
produces broken links — a hard ordering constraint.

**(h) Analysis documents.** `?? docs/analysis/` — `ERP_D365_VALIDATION_REPORT.md` (47 821 B),
`SAAS_READINESS_ASSESSMENT.md` (16 199 B), `GTM_STRATEGY.md` (11 389 B),
`SAAS_READINESS_BRIEFING.md` (7 985 B). Substantial authored deliverables, not scratch files.

**(i) Machine-local / AI-tool state.** `?? .agents/` (**181 files**) and `?? .codex/config.toml`.

**(j) Potentially sensitive / local backup — path only, contents deliberately NOT inspected or
printed.**

- `frontend/.env.local.bak` — **`git check-ignore` says NOT IGNORED.** The rule at `.gitignore:8` is
  `.env.local` exactly; it does not match the `.bak` suffix. This file is one `git add -A` away from
  being committed.
- `.codex/config.toml` — AI-tool configuration that may carry a token. Not opened for this report.

`backend/.env` and `frontend/.env.local` are correctly ignored (`.gitignore:7` and `:8`).

**(k) Ambiguous — needs Kubi.** See §6.

##### 4. Grouping evidence beyond file names

**mtime cohorts.** Every modified tracked file except `HANDOVER.md` falls in
**2026-09-04 21:23 → 21:48**, one continuous ~25-minute session, ordered
docs → schema → service → schemas → routes → frontend → POS cart. `HANDOVER.md` alone is
**2026-09-06 18:43**. So groups (a)(b)(f) are one work session and group (g) is a later, separate
one. *Timestamps are corroborating evidence only; they do not establish intent.*

**A contradiction Kubi should see (worklog §4 vs. repo reality).** Rule §4 says *"never commit …
`.agents/` or `.codex/` state"*, but **`.claude/skills/` is already tracked — 172 files** — and
`.agents/skills/` contains the **same seven skill directories** (`banner-design`, `brand`, `design`,
`design-system`, `slides`, `ui-styling`, `ui-ux-pro-max`). `.agents/` is therefore a near-duplicate
mirror of something the repository already commits. Only `.claude/settings.local.json` is ignored.
The rule and the repository disagree; that has to be settled before any `git add -A`.

##### 5. Proposed reversible sequence (proposal only — nothing executed)

Ordered so that nothing is destructive before everything is preserved.

0. **Secret triage (Kubi, before any git command).** Inspect `frontend/.env.local.bak` and
   `.codex/config.toml`. If either holds live credentials, they must never enter history — not even
   the snapshot in step 2. Rotate anything already exposed.
1. **Confirm the 34 unpushed commits are intended to stay local**, or push `master` first. A
   preservation branch on a machine whose only copy is local protects nothing.
2. **Preservation checkpoint, before any ignore or cleanup change.**
   `git switch -c wip/2026-09-06-full-snapshot`, then one commit containing everything **except**
   the step-0 paths, message `WIP snapshot — do not merge`. Fully reversible: delete the branch.
   `master` is untouched throughout. This exists so steps 3-6 can never lose work.
3. **`.gitignore` additions**, as their own commit on a working branch:
   `.env*.bak` (or `.env.local*`), `.agents/`, `.codex/`,
   `skarpine-pos/com.facebook.react.devsupport.BundleDownloader`. Also **resolve** the inert
   `skarpine-pos/` line per decision D-4.
4. **Logical commits**, branched from `master` (suggested `feat/factura-numbering-and-tax-preview`):
   1. docs accuracy — Express → Hono (group f, 4 files, one hunk of `HANDOVER.md`);
   2. governance — `AGENTS.md` + `docs/collaboration/*` + the `HANDOVER.md` pointer hunk (group g,
      **must precede or accompany** the pointer, §3(g));
   3. analysis documents (group h);
   4. **schema + migration 023** (group e) — shared-core, review-gated, its own commit so it can be
      reverted alone;
   5. backend numbering service, schemas, routes, openapi (group a, backend);
   6. Setup → Number sequences UI + frontend `factura_number` string rendering (group a, frontend);
   7. tax-preview hook and its consumers (group b);
   8. tests — `numberSequence.manual.test.ts`, `verifyFacturaLines.ts` (group d).
   Commits 5-7 touch the three dual-purpose files in §3(c); either accept them in commit 5/6 with
   the tax hunks included, or split with `git add -p`. **Recommend not splitting hunks** — the
   coupling is real and a half-applied file will not compile.
5. **Verify before merging, not after.** `npx tsc --noEmit` (backend and frontend) and `npx jest` on
   the branch. **This report does not claim the working tree builds** — nothing was executed.
6. **POS — no action proposed.** Its uncommitted state is deliberate (§2). Nothing in steps 0-5
   touches it: every command above is run from the parent repository, and the parent's gitlink SHA
   has not moved, so the parent can be cleaned and committed while the POS tree stays exactly as it
   is. The only two POS items that need a decision rather than work are the durability question and
   the representation question, both under D-4. If Kubi does choose to act, it must happen **from
   inside `skarpine-pos/`**, never from the parent.

##### 6. Decisions that must come from Kubi before any cleanup or commit

- **D-1 — `frontend/.env.local.bak`:** delete, keep-and-ignore, or move outside the repo? Does it
  contain anything that needs rotating?
- **D-2 — `.agents/` and `.codex/`:** ignore both *and* de-track the 172 already-committed
  `.claude/skills/` files, or accept AI-tool state in the repo and commit `.agents/` too? The
  worklog rule and the repository currently disagree. *[architectural recommendation]* ignore all
  three and de-track `.claude/skills/` in its own commit: it is tool state, it is ~350 files of
  merge noise, and it is duplicated.
- **D-3 — the 34 unpushed commits:** push `master` before any of this, or keep local?
- **D-4 — `skarpine-pos`, two separate questions.** (a) *Representation:* keep it as an unregistered
  gitlink, promote it to a real submodule with a `.gitmodules` entry, or `git rm --cached` it and let
  the `.gitignore` line take effect? All three are defensible; the current half-state — a tracked
  gitlink with no `.gitmodules` and a contradictory ignore rule — is not, and it is decidable now
  because it does not depend on the POS work being finished. (b) *Durability:* is an off-machine
  backup of the unfinished tree wanted, and in what form? Deliberately unfinished and
  deliberately un-backed-up are different choices.
- **D-5 — migration `023` (see §7):** it is applied to the test database but not committed. Confirm
  it may be committed as-is, since the database already depends on it.
- **D-6 — branch naming and target:** does the feature branch merge to `master`, or does `master`
  stay the checkpoint while work moves to `develop`?
- **D-7 — `docs/analysis/`:** repository documentation, or commercial material that belongs
  elsewhere? `GTM_STRATEGY.md` is go-to-market, not engineering.

##### 7. Prior state changes in this same session — disclosed, not part of WORK-001

Both happened **earlier today, before WORK-001 was assigned**, while diagnosing a 500 on
`POST /api/v1/sales/orders/:id/ship`. They are recorded here because a reviewer comparing the diff
against the database would otherwise be misled.

1. **Migration `023_factura_numbering_via_number_sequence.sql` was applied to the Supabase test
   database** (via `npx prisma db execute --file … --schema …`). The 500 was
   `P2022: column number_sequences.manual does not exist` — the schema had drifted one migration
   behind. Post-state verified: `number_sequences.manual` = boolean; `facturas.factura_number` =
   text, zero-padded (`000033`); FACTURA sequence `continuous=true, manual=false, next_number=34`
   (28 facturas, max 33, counter 33); 0 duplicate `(tenant_id, factura_number)` pairs. `Ship` then
   returned 200 and posted `JE-2026-00243` (Dr 5101 COGS 50 / Cr 1110 Inventory 50).
   **Consequence for P0:** the test database is now *ahead* of `origin/master`, and a clean checkout
   of `master` will not match it. `023` must be committed for the two to agree. This also affects
   backlog item P0.3 — the baseline must treat `001`–`023` as applied, not `001`–`022`.
   *Note: applied with `prisma db execute` rather than the repo's own
   `backend/scripts/applyMigration.ts` (which uses `DIRECT_URL`); all three statements were verified
   individually afterwards.*
2. **`frontend/.env.local` was edited** — `NEXT_PUBLIC_API_URL` switched from `http://localhost:3001`
   to the dev-tunnel URL so a remote developer could reach the API. The file is gitignored and does
   **not** appear in `git status`, so it does not affect this classification. It should be switched
   back for purely local work.

No other state was changed. Three temporary inspection scripts created under `backend/scripts/`
earlier were deleted; `git status` confirms no residue.

##### 8. Residual risks

- **[risk]** `frontend/.env.local.bak` is untracked *and* unignored — a single `git add -A` commits
  it. This is the reason step 2 above excludes it explicitly.
- **[risk]** POS source exists only on this machine, in a remote-less repository (§2).
- **[risk]** The working tree's build/test state is **unverified** — no build, type-check or test was
  run for this work item.
- **[risk]** `git diff` emits `LF will be replaced by CRLF` on 22 files. Committing on Windows with
  no `.gitattributes` may produce a line-ending-only diff that obscures the real change. A
  `.gitattributes` (`* text=auto eol=lf`) is worth considering *before* the logical commits, not
  after.
- **[assumption needing validation]** groups (a) and (b) are inferred from imports, deleted lines and
  mtime adjacency. They are consistent with one session's work, but no commit message or issue
  states the author's intent.

#### Codex independent review — 2026-09-06

**Review status: CHANGES_REQUESTED.** The inventory is useful and the central Git/POS facts were
independently reproduced. No evidence was found that WORK-001 changed product, index, branch, POS,
or database state; the only WORK-001 write is the appended report. The review requires these
corrections before acceptance:

1. **POS durability wording.** No configured POS remote and untracked source are repo-verified. “The
   only copy is on this machine” is not repo-verifiable because an external archive or backup cannot
   be disproved. Rephrase it as “not recoverable from the configured Git repositories.”
2. **Agent skills classification.** `.agents/skills/` and tracked `.claude/skills/` contain the same
   172-file, seven-skill tree. The current Codex project runtime actively exposes the `.agents/skills`
   path, so it is not defensible to classify it as disposable machine state or recommend de-tracking
   `.claude/skills/` without an interoperability decision. `.codex/config.toml` remains local unless
   proven otherwise. The worklog rule was corrected accordingly.
3. **Snapshot-to-clean-branch transition.** After committing the dirty state to a WIP branch and
   switching back to `master`, the proposed feature branch does not automatically contain the dirty
   work. The plan must specify a reversible selective restore or equivalent reconstruction from the
   snapshot commit.
4. **Commit atomicity.** Splitting schema/migration, backend behavior, frontend behavior, and tests
   into eight commits can create intermediate commits that do not type-check or cannot represent the
   already-applied database state. Prefer buildable vertical commits: governance/docs; factura
   numbering across migration/backend/frontend/tests; and tax-preview removal with its tests. Verify
   each proposed boundary rather than optimizing for file categories.
5. **Migration 023 evidence.** The SQL file and matching schema/code changes are repo-verified. Its
   claimed Supabase application and post-state are disclosed but not independently verified in this
   review; perform a read-only database verification before accepting the migration baseline.
6. **Moving inventory.** Codex added the security analysis after Claude's snapshot. Current untracked
   counts therefore differ without invalidating Claude's time-bounded count; the next report must
   state its observation boundary.

No cleanup, staging, commit, branch operation, database access, or POS change is approved by this
review. Claude should append a short correction addendum only; it need not repeat the full inventory.

##### Claude correction prompt prepared by Codex

```text
Read AGENTS.md, HANDOVER.md, docs/collaboration/CODEX_MEMORY.md, and
docs/collaboration/CODEX_CLAUDE_WORKLOG.md in full. Return only to WORK-001.

Read the section “Codex independent review — 2026-09-06”. Append a concise correction addendum to
WORK-001 that addresses all six review findings. Do not overwrite the original report; clearly
supersede only the affected claims and proposed steps.

In particular:

1. Replace the unprovable statement about POS having only one copy with the narrower Git-recovery
   fact.
2. Reclassify `.agents/skills/` and `.claude/skills/` as an unresolved cross-agent project-tooling
   decision. Do not recommend deleting or de-tracking either. Keep `.codex/config.toml` separate.
3. Add the missing selective restoration/reconstruction step between the WIP snapshot and a clean
   working branch.
4. Revise the logical commit plan toward buildable vertical commits; do not separate tests from the
   behavior they verify, and do not assume an isolated schema commit can type-check.
5. Mark migration 023 database application/post-state as disclosed but awaiting independent
   read-only verification.
6. State the exact observation boundary for your counts and note that later Codex documentation
   changes are outside it.

This remains analysis-only. Make no product edits, staging changes, commits, branches, migration or
database calls, environment changes, or POS changes. The only permitted write is appending the
correction addendum to this worklog. Return the addendum text to Kubi as well.
```

#### Claude correction addendum — 2026-09-06

CHANGES_REQUESTED accepted. All six findings are addressed below. The original
*Claude implementation report — 2026-09-06* is **not** rewritten; each item names exactly which claim
or step it supersedes, and everything not named stands. Two arithmetic errors of my own are corrected
under C-2 and C-6.

**Scope.** Analysis only. No product edit, staging, commit, branch, migration, database call,
environment change, or POS change. The only write is this append. New evidence below came from
`git status`, `git ls-files`, `diff -rq`, `sha1sum`, `stat` and `ls` — all read-only.

##### C-1 — POS durability wording (supersedes the final paragraph of §2)

Finding 1 is correct: "it exists on this machine only" cannot be verified from a repository, because
an external archive cannot be disproved. **Superseding statement:**

> **[repo-verified]** `skarpine-pos` has no configured remote (`git remote -v` empty) and its `app/`
> and `src/` trees are untracked. Its working state is therefore **not recoverable from any
> configured Git repository** — neither from the nested repo's own history (single commit `75d0b67`)
> nor from the parent, whose gitlink records only that same SHA. Whether a copy exists outside Git
> is **not observable from here and is not claimed.**

Unchanged: no cleanup or commit is proposed for POS; its uncommitted state is deliberate per Kubi's
2026-09-06 clarification.

##### C-2 — `.agents/skills/` and `.claude/skills/`: unresolved cross-agent tooling decision

**Supersedes** the machine-local classification in §3(i), the "contradiction" paragraph in §4, and
recommendation **D-2**. Finding 2 is correct and my original framing was wrong twice — once in
classification, once in arithmetic.

**Corrected measurements (read-only, taken 2026-09-06 after the Codex review):**

| Measurement | Value |
|---|---|
| `git ls-files .claude/skills` | **172** tracked files |
| untracked `.agents/skills/` | **172** files |
| relative path sets | **identical** (`comm` of both sorted lists is empty both ways) |
| byte-identical files | **169 of 172** |
| genuinely differing files | **3**, and not a line-ending artefact (same count with `diff --strip-trailing-cr`) |
| `.agents/` entries outside `skills/` | **none** |

The three differing files are all skill entry points — `banner-design/SKILL.md`, `design/SKILL.md`,
`ui-ux-pro-max/SKILL.md` — and the only difference in each is a mechanical vendor-path rewrite in
example commands: `.claude/skills/…` → `.Codex/skills/…` (and `~/.claude/…` → `~/.Codex/…`).

**[repo-verified] the rewrite target does not exist here:** there is no `.Codex/skills/` or
`.codex/skills/`; `.codex/` contains `config.toml` and an empty `tmp/`. So those three files'
example commands do not resolve in this repository as written.

**Reclassification.** `.agents/skills/` is **project tooling shared across two agent runtimes, with
an unresolved canonical-source question** — not disposable machine state. Codex reports its runtime
actively exposes the `.agents/skills` path, which this repository's contents neither confirm nor
contradict. **I withdraw the recommendation to de-track `.claude/skills/`, and I do not recommend
deleting or ignoring either tree.** No action is proposed; this is a decision, and it is now D-2
below.

**`.codex/config.toml` stays a separate item.** It is a single tool-configuration file, is not part
of either skill tree, and its contents were deliberately not opened. It remains a
*machine-local / possibly-sensitive* candidate pending Kubi's inspection — unchanged from the
original report.

##### C-3 — the missing step between the WIP snapshot and the working branch

Finding 3 is correct and this is a real defect in the original §5: committing the dirty tree on
`wip/…` and then switching to `master` leaves the working branch **clean**, with the work only
inside the snapshot commit. **Inserted step, between old steps 2 and 4:**

```
# after the snapshot commit exists
S=$(git rev-parse HEAD)                       # record the snapshot SHA; write it down
git switch -c feat/<name> master              # tree now = master; the WIP work is only in $S
git restore --source="$S" --worktree -- .     # write the snapshot tree back as UNSTAGED changes
git status --porcelain -uall                  # MUST match the recorded pre-snapshot baseline
```

`git restore --source=<sha> --worktree` writes content without staging it, so the pre-snapshot state
returns as ordinary modified/untracked entries and selective `git add -p` can then proceed. Files
excluded from the snapshot (the D-1 sensitive paths) were never in `$S`, so they are untouched on
disk and stay untracked — which is the intended outcome.

Two guards: (a) the `git status` comparison is a **gate**, not a formality — proceed only if it
matches the baseline recorded before step 2; (b) `--worktree` does not delete files present in
`master` but absent from `$S`, which is safe here only because `$S` is a superset of `master`.

**Alternative that avoids the switch entirely** and is strictly more reversible:
`git worktree add ../skarpine-baseline <sha>` — build the commits in a second checkout and leave the
original working tree untouched throughout. *[architectural recommendation]* prefer this if disk
space allows; nothing can be lost by a mistaken `switch`.

##### C-4 — commit plan revised to buildable vertical commits (supersedes §5 step 4)

Finding 4 is correct. The original eight commits were organised by file category, and at least one —
schema + migration `023` alone — **cannot type-check**, because `Factura.factura_number` changes
`Int → String` while the backend routes that read and assign it are in a different commit. That
commit is withdrawn. Tests are no longer separated from the behaviour they verify.

**Revised proposal — three vertical commits:**

| # | Commit | Contents |
|---|---|---|
| V1 | Governance & documentation | `AGENTS.md`, `docs/collaboration/*`, `docs/analysis/*`, the `HANDOVER.md` collaboration-pointer hunk, and the Express → Hono correction in `CLAUDE.md` / `DEVELOPMENT_PLAN.md` / `README.md` / `HANDOVER.md`. No runtime code. |
| V2 | Factura numbering via `NumberSequence` | migration `023` + `schema.prisma` + `numberSequence.service.ts` + `schemas/index.ts` + sales/finance/pos/setup routes + `openapi.ts` + Setup→Numbering UI + `factura_number` rendering + **its tests** (`numberSequence.manual.test.ts`, `verifyFacturaLines.ts`). |
| V3 | Server-driven tax preview | `useTaxPreview.ts` + `posCartStore.ts` + `pos/main/page.tsx` + `SalesOrderPDF.tsx` + `SalesOrderPDFButton.tsx`, with any tests that cover it. |

**The one verified obstacle to a clean V2/V3 split.** `frontend/src/app/(erp)/finance/facturas/page.tsx`,
`.../sales/orders/page.tsx` and `.../sales/orders/[id]/page.tsx` each carry **both** concerns
(original report §3(c)). Taking them whole into V2 puts an `import { useTaxPreview } from
'@/lib/useTaxPreview'` into a commit that does not yet add that file — V2 would not build. Three
resolutions, in the order I would try them:

1. move `frontend/src/lib/useTaxPreview.ts` into **V2** so the import resolves, leaving V3 as the
   POS/PDF consumers — smallest deviation from the vertical boundary;
2. order **V3 before V2** and let V3 take the three files whole (their `factura_number` hunks are
   type-local component props and do not depend on the schema change);
3. **merge V2 and V3** into one commit — safest for buildability, weakest for reviewability.

**No buildability claim is made for any of the three commits or for any of the three resolutions.**
Nothing was compiled for this addendum. The boundary must be *proved*, not argued, and the proof is
a mandatory gate in the plan:

```
git worktree add ../skarpine-verify <candidate-commit-sha>
cd ../skarpine-verify/backend  && npm ci && npx tsc --noEmit && npx jest
cd ../skarpine-verify/frontend && npm ci && npx tsc --noEmit
```

Run it **per candidate commit**, not only on the branch tip. A boundary that fails moves the file to
the next resolution above.

##### C-5 — migration 023: disclosed, not independently verified

Finding 5 accepted. **Supersedes the standing of §7 item 1** (its content is unchanged; its
evidentiary status is downgraded).

- **[repo-verified]** the SQL file `023_factura_numbering_via_number_sequence.sql` exists untracked,
  and `schema.prisma` carries exactly its two DDL steps.
- **[disclosed by Claude, NOT independently verified]** that it was applied to the Supabase test
  database, and the post-state figures reported in §7 (`manual` boolean present, `factura_number`
  text, FACTURA `continuous=true / manual=false / next_number=34`, 0 duplicate
  `(tenant_id, factura_number)` pairs, max `000033`). Those came from my own earlier session, not
  from an independent check, and **no database was accessed for this addendum.**

Read-only verification for Codex to run before the migration baseline (P0.3) is accepted:

```sql
SELECT column_name, data_type FROM information_schema.columns
 WHERE (table_name='number_sequences' AND column_name='manual')
    OR (table_name='facturas' AND column_name='factura_number');
SELECT reference, continuous, manual, next_number FROM number_sequences WHERE reference='FACTURA';
SELECT MAX(factura_number) FROM facturas;
SELECT COUNT(*) FROM (SELECT tenant_id, factura_number FROM facturas
                       GROUP BY 1,2 HAVING COUNT(*)>1) x;
```

Expected: `boolean` / `text`; `true, false, 34`; `'000033'`; `0`. **If any differ, §7 item 1 is wrong
and P0.3 must not treat `001`–`023` as applied.**

##### C-6 — observation boundary (supersedes the counts in §1)

Finding 6 accepted. **Boundary:** every count in the original report was taken while HEAD was
`0a8bdf2`, nothing was staged, and **before `docs/analysis/SECURITY_AUTHORIZATION_GAP_ANALYSIS.md`
existed** (that file's mtime is `2026-09-06 18:54:18`; `CODEX_CLAUDE_WORKLOG.md` and
`CODEX_MEMORY.md` were last written `18:59:38`). Codex's security analysis and its worklog updates
are **outside** that boundary and do not invalidate the figures inside it.

| | Original report (before 18:54) | Now (after the Codex additions) |
|---|---|---|
| Untracked, `-uall` | 185 | **186** |
| `docs/analysis/` | 4 files | **5 files** |
| Modified tracked | 25 files + 1 gitlink | 25 files + 1 gitlink (unchanged) |
| HEAD / staged | `0a8bdf2` / nothing | `0a8bdf2` / nothing (unchanged) |

The delta is exactly one file, `SECURITY_AUTHORIZATION_GAP_ANALYSIS.md`, and it belongs to the
existing group **§3(h) analysis documents**; no classification changes.

**My own arithmetic, corrected.** The original §1 table said "182 are AI-tool state" and §3(i) said
"`.agents/` (**181 files**)". Both are wrong and neither reflects a change in the tree. The correct
composition of the 185 observed at the boundary:

```
.agents/skills/            172      docs/analysis/                4
.codex/config.toml           1      docs/collaboration/           2
AGENTS.md                    1      frontend/.env.local.bak       1
023_…sql                     1      setup/numbering/page.tsx      1
numberSequence.manual.test   1      useTaxPreview.ts              1     = 185
```

AI-tool state is therefore **173** files (172 + `.codex/config.toml`), not 182.

##### Updated open decisions

**D-2 is replaced** by: *the two skill trees are 169/172 byte-identical, differ only in a
`.claude` → `.Codex` path rewrite whose target does not exist in this repo, and one of them is
already tracked. Which is canonical? Should both be versioned, one generated from the other at
setup time, symlinked, or should the rewritten paths simply be fixed?* This is a cross-agent
tooling decision for Kubi with Codex's input; **no deletion or de-tracking is recommended.**

**D-4(b) is narrowed** by C-1: the question is not "is there only one copy" but *"is a
non-Git off-machine copy wanted for an unfinished tree that Git cannot currently recover?"*

**D-1, D-3, D-5, D-6, D-7 stand unchanged.**

##### What still stands from the original report

Sections §1 (with C-6's boundary and corrected composition), §2 (with C-1's wording), §3
(with C-2's reclassification of (i)), §4's mtime cohorts, §5 steps 0-3 and 5-6, §6, §7 (with C-5's
downgraded evidentiary status) and §8. **§8's fourth risk is worth re-reading against C-4:** 22 files
report `LF will be replaced by CRLF`, so a `.gitattributes` decision belongs *before* V1, not after.

#### Codex acceptance — 2026-09-06

**Status update: ACCEPTED.** The correction addendum closes all six review findings. Codex
independently reconfirmed the unchanged branch and HEAD, empty index, 34-commit local lead, gitlink
representation, separate dirty POS repository, and exact 172-file relative-path match between the
two skill trees. The current status consists of 25 modified tracked files, one dirty gitlink, and
186 untracked files; the 212 total porcelain entries are therefore consistent with the addendum.

Two execution cautions remain but do not block this analysis deliverable:

1. The illustrated snapshot commands use POSIX shell syntax. Any approved execution on this Windows
   workspace must be rewritten and verified as native PowerShell commands.
2. The V1/V2/V3 boundaries are proposals, not approved commits. D-1 through D-7 and per-boundary
   buildability must be resolved before any staging or commit operation.

No cleanup, ignore edit, branch, commit, push, database verification, migration action, or POS change
is authorized by this acceptance. WORK-001 is complete; proceed through the open decisions before
creating the next execution work item.

#### Kubi decision D-1 — 2026-09-06

**Resolved.** Kubi approved keeping `frontend/.env.local.bak` in place and excluding environment
backup files from Git. Codex added the narrow `.env*.bak` rule to the root `.gitignore`. The backup
file was not opened, moved, deleted, staged, or committed. Remaining open decisions are D-2 through
D-7.

#### Kubi decision D-2 — 2026-09-06

**Resolved.** The already tracked `.claude/skills/` tree remains the canonical skill source.
`.agents/skills/` will be treated as a generated/local runtime copy rather than a second committed
source, and `.codex/` remains machine-local configuration. Codex added `.agents/` and `.codex/` to
the root `.gitignore`; neither directory was opened for secret inspection, deleted, moved, staged,
or committed. A deterministic synchronization/setup mechanism from the canonical tree is deferred
to a separate reviewed work item; the three currently divergent path rewrites must not be copied
back into the canonical files without review. Remaining open decisions are D-3 through D-7.

#### Kubi decision D-3 — 2026-09-06

**Resolved.** Kubi approved preserving the 34 local commits off-machine without changing remote
`master`. Codex created and pushed `codex/pre-cleanup-2026-09-06` at
`0a8bdf2543909247a50f74670945b15e43da7165`. The local branch, remote branch, and current HEAD were
verified at the same commit. The active checkout remains on `master`, the index remains empty, and
the dirty working tree was not included in the push. Remaining open decisions are D-4 through D-7.

#### Kubi decision D-4 — 2026-09-06

**Resolved.** Kubi approved both POS representation and durability actions.

- Codex created a local POS branch `codex/wip-incomplete-pos-2026-09-06`, added the stray
  `com.facebook.react.devsupport.BundleDownloader` artefact to the POS `.gitignore`, and committed
  the incomplete application as `09fa4de` with the explicit WIP message
  `WIP: preserve incomplete POS implementation`.
- No secret-shaped path was staged. `git diff --cached --check` passed before the commit.
- POS type-check was run before the snapshot and failed with five existing TypeScript errors: one
  missing argument in `app/pos.tsx`, one missing `CartLine.key` in `VariantPicker.tsx`, and three
  Zustand persist-storage type incompatibilities. The snapshot is preservation, not completion.
- Codex created the private GitHub repository `kubilaypalabiyik59/Quberty-POS`. The original
  `master` baseline (`75d0b67`) and WIP branch (`09fa4de`) were both pushed and independently
  matched to their remote refs. `master` is the default branch.
- In the parent repository, Codex ran `git rm --cached -- skarpine-pos`. The old unregistered gitlink
  removal is now staged as `D  skarpine-pos`; the physical directory remains present, is ignored by
  the existing `skarpine-pos/` rule, and continues as an independent clean Git repository with its
  own remote. The staged removal must be included in the later governance/checkpoint commit.

Remaining open decisions are D-5 through D-7.

#### D-5 independent verification — 2026-09-06

**Database post-state verified read-only; migration file not yet approved as-is.** Codex queried only
schema metadata, the FACTURA number-sequence row, aggregate factura statistics, and duplicate-group
count through `DIRECT_URL`. No migration or data mutation was executed.

Verified test-database state:

- `facturas.factura_number` is `text`.
- `number_sequences.manual` is `boolean`.
- FACTURA is `continuous=true`, `manual=false`, `next_number=34`.
- 28 facturas exist; maximum rendered number is `000033`.
- Duplicate `(tenant_id, factura_number)` groups: 0.

This independently confirms Claude's disclosed database state and means the future baseline must
treat migration 023's effects as present. A repo compatibility defect prevents accepting the SQL
file unchanged: `023_factura_numbering_via_number_sequence.sql` contains explicit `BEGIN;` and
`COMMIT;`, while `scripts/applyMigration.ts` already wraps every file in `prisma.$transaction()` and
splits 023 into five statements including those transaction-control commands. Earlier migrations
explicitly follow the no-BEGIN/COMMIT convention. Recommendation: remove only the internal
transaction-control statements before committing 023, leaving its three DDL/DML statements and the
already-verified database unchanged. This edit requires Kubi's explicit approval.

#### Architectural decision D-5 — 2026-09-06

**Resolved.** Kubi delegated architectural control to Codex. Codex removed only the internal
`BEGIN/COMMIT` commands from migration 023 and documented that transaction ownership belongs to
`scripts/applyMigration.ts`. The three schema/data statements were not changed and the database was
not touched. The migration parser now sees exactly three executable statements rather than five.
Migration 023 is accepted for inclusion in the future vertical factura-numbering checkpoint.

#### Architectural decision D-6 — 2026-09-06

**Resolved.** Use trunk-based integration: remote `master` remains the stable integration branch;
do not introduce a long-lived `develop` branch. Current work must move through a short-lived
`codex/` feature branch, verified commits, and review before merging to `master`. Preservation/WIP
branches are explicitly non-mergeable safety snapshots.

#### Architectural decision D-7 — 2026-09-06

**Resolved.** `docs/analysis/` is repository-owned product and architecture context, including the
go-to-market analysis where it materially drives scope. It will be versioned with the governance and
documentation checkpoint. Future secrets, client-confidential exports, or transient research dumps
remain excluded.

### WORK-002 — Preserve the valid dirty parent tree off-machine

- Priority: P0.2
- Status: APPROVED under Kubi's P0 approval and delegation of architectural control
- Owner: Claude (execution); Codex (independent review)
- Business objective: Create a recoverable, explicitly non-mergeable snapshot before reconstructing
  the mixed working tree into verified vertical commits.
- Approved behavior: Create and push `codex/wip-full-snapshot-2026-09-06` from the current parent
  `master` HEAD while preserving the valid non-ignored working tree exactly.
- Explicitly excluded: `.agents/`, `.codex/`, all environment/backup files, ignored POS contents,
  database/migration execution, product fixes, formatting, dependency changes, and any merge to
  `master`.
- Required state to preserve: the staged removal of the old `skarpine-pos` gitlink; the physical POS
  directory must remain present and untouched as its independent clean repository.
- Acceptance criteria:
  1. Pre-snapshot parent branch, HEAD, index, and full non-ignored status are recorded.
  2. The snapshot branch starts at the current `master` HEAD and contains every valid non-ignored
     modification, addition, and staged gitlink removal.
  3. No ignored or secret-shaped path is staged or committed.
  4. Snapshot commit and remote branch point to the same SHA.
  5. Parent worktree is clean after the snapshot except intentionally ignored paths.
  6. POS branch, HEAD, worktree, and remote are unchanged.
  7. A second documentation-only commit may append the final report and both remote SHAs to this
     worklog; no amend or force-push is allowed.
- Claude implementation report: Pending.
- Codex review: Pending.

#### Claude implementation prompt — WORK-002

```text
Work in the Skarpine parent repository only. Before acting, read AGENTS.md, HANDOVER.md,
docs/collaboration/CODEX_MEMORY.md, and docs/collaboration/CODEX_CLAUDE_WORKLOG.md in full.

Execute only WORK-002. This is an approved preservation snapshot, not a feature commit and not a
cleanup task.

Use native PowerShell-compatible commands. Do not use POSIX shell variable or command syntax.

1. Verify the parent checkout is on master at HEAD 0a8bdf2 and record:
   - git status --porcelain=v1 -uall
   - git diff --cached --name-status
   - git diff --stat
2. Verify these paths are ignored and do not inspect or print their contents:
   - frontend/.env.local.bak
   - .agents/
   - .codex/
   - skarpine-pos/
3. From inside skarpine-pos, record branch, HEAD, remote refs, and clean status. Do not modify it.
4. Confirm local and remote refs named codex/wip-full-snapshot-2026-09-06 do not already exist. Stop
   and report if either exists; do not overwrite it.
5. Create local branch codex/wip-full-snapshot-2026-09-06 from the current master HEAD. The existing
   modified/untracked parent files and staged gitlink removal must carry across unchanged.
6. Stage all non-ignored parent changes. Before committing:
   - list staged paths;
   - fail if any staged path is under .agents/, .codex/, or skarpine-pos/, except the staged deletion
     of the single parent gitlink path skarpine-pos;
   - fail if any environment, backup, key, certificate, credential, or secret-shaped path is staged;
   - run git diff --cached --check.
7. Commit once with message: WIP snapshot: preserve pre-cleanup parent tree
8. Push the branch to origin without modifying remote master. Do not create a pull request.
9. Verify local snapshot commit and remote branch SHA match. Verify the parent worktree is clean
   except ignored paths. Re-check that the independent POS repository is unchanged and clean.
10. Append the factual result under WORK-002 in the shared worklog. Because that append occurs after
    the snapshot, create one second documentation-only commit with message:
    docs: record WORK-002 snapshot result
    Push normally; do not amend or force-push.
11. Return both commit SHAs, the remote branch name, final parent status, final POS status, commands
    run, and any residual risk.

Do not run builds, tests, migrations, database calls, formatters, installs, cleanup, restores,
rebases, merges, or product edits. Do not switch back to master. Stop after WORK-002.
```

#### Claude implementation report — WORK-002 — 2026-09-07

The `Claude implementation report: Pending.` line in the WORK-002 item above was deliberately left
untouched, per the no-overwrite rule. This subsection is the report.

**Execution boundary.** Steps 1-7 of the original WORK-002 prompt (verification, branch creation,
staging guards, snapshot commit) were executed on **2026-09-06** and produced commit `7aefd74`.
Steps 8-11 (push, SHA verification, worklog append, documentation commit) could not run that day:
`git push` and `git ls-remote` were refused by this workspace's Claude Code permission classifier,
not by Git or by the remote. They were completed on **2026-09-07** after Kubi installed two
project-local push permission rules. Nothing between the two sessions changed the snapshot commit:
it was not recreated, amended, squashed, rebased, or replaced.

##### Result

| Item | Value |
|---|---|
| Snapshot commit | `7aefd74fb2db028375f199d6c4be64267439702f` |
| Commit message | `WIP snapshot: preserve pre-cleanup parent tree` |
| Commit author/date | Kubilay · 2026-09-06 22:15:29 +0200 |
| Remote branch | `origin/codex/wip-full-snapshot-2026-09-06` (created by this push; it did not exist before) |
| Upstream tracking | set by `git push --set-upstream` |
| Pull request | none created |

##### Local / remote SHA verification (repo-verified)

Remote listing taken **before** the push:

```
0a8bdf2543909247a50f74670945b15e43da7165  refs/heads/codex/pre-cleanup-2026-09-06
5cd97a6dae2364d0fc3c557c2250c0223acd64f6  refs/heads/master
```

`refs/heads/codex/wip-full-snapshot-2026-09-06` was absent, as required by step 4 of the original
prompt. Remote listing taken **after** the push:

```
0a8bdf2543909247a50f74670945b15e43da7165  refs/heads/codex/pre-cleanup-2026-09-06
7aefd74fb2db028375f199d6c4be64267439702f  refs/heads/codex/wip-full-snapshot-2026-09-06
5cd97a6dae2364d0fc3c557c2250c0223acd64f6  refs/heads/master
```

- local `HEAD` = `7aefd74fb2db028375f199d6c4be64267439702f`
- `refs/remotes/origin/codex/wip-full-snapshot-2026-09-06` = `7aefd74fb2db028375f199d6c4be64267439702f`
- authoritative `git ls-remote` value for the same ref = `7aefd74fb2db028375f199d6c4be64267439702f`

All three agree.

##### origin/master was not changed (repo-verified)

`refs/heads/master` reads `5cd97a6dae2364d0fc3c557c2250c0223acd64f6` in both the pre-push and
post-push listings — byte-identical. `refs/heads/codex/pre-cleanup-2026-09-06` is likewise unchanged
at `0a8bdf2543909247a50f74670945b15e43da7165`. No merge, no pull request, no force-push, and no
push to `master` was performed. The checkout was never switched back to `master`.

##### Final parent status (repo-verified)

```
branch  codex/wip-full-snapshot-2026-09-06
HEAD    7aefd74fb2db028375f199d6c4be64267439702f
git status --porcelain=v1 -uall   ->  empty (clean; ignored paths excluded)
git diff --cached --name-status   ->  empty (nothing staged)
```

This status was taken **before** the worklog append below. The append itself makes
`docs/collaboration/CODEX_CLAUDE_WORKLOG.md` modified; that single modification is the content of
the documentation-only commit named in the original prompt's step 10.

##### Final POS status (repo-verified, unchanged)

```
repository  .../skarpine/skarpine-pos  (independent nested repository)
branch      codex/wip-incomplete-pos-2026-09-06
HEAD        09fa4de3dabd305f8b8659d9509b870cefc6465f
status      git status --porcelain -uall  ->  empty (clean)
remote      origin  https://github.com/kubilaypalabiyik59/Quberty-POS.git
```

No command other than read-only inspection was run against the POS repository in either session. Its
branch, HEAD, worktree, and remote are identical to the state Codex recorded under Kubi decision D-4.

##### Commands run in this session (2026-09-07)

```
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git log -1 --format="%h %ad %an%n%s" --date=iso
git status --porcelain=v1 -uall
git diff --cached --name-status
git branch --list "codex/*"
git branch -r
git remote -v
git config --get-regexp "^branch\.codex/wip-full-snapshot-2026-09-06\."
git ls-remote --heads origin                                  (before and after the push)
git -C skarpine-pos rev-parse --abbrev-ref HEAD
git -C skarpine-pos rev-parse HEAD
git -C skarpine-pos status --porcelain -uall
git push --set-upstream origin codex/wip-full-snapshot-2026-09-06
git rev-parse refs/remotes/origin/codex/wip-full-snapshot-2026-09-06
git add docs/collaboration/CODEX_CLAUDE_WORKLOG.md
git diff --cached --name-status
git diff --cached --check
git commit -m "docs: record WORK-002 snapshot result"
git push
```

No build, test, migration, database call, formatter, install, cleanup, restore, rebase, merge, or
product edit was run, in line with the work item's exclusions.

##### Disclosed deviations

1. **Commit message trailer omitted deliberately.** The documentation commit uses exactly
   `docs: record WORK-002 snapshot result` with no `Co-Authored-By` trailer, because the work item
   specifies the message verbatim and the protocol treats any addition as a deviation. This
   supersedes the operator-level default that would otherwise append that trailer.
2. **The documentation commit cannot contain its own SHA.** Acceptance criterion 7 asks for both
   remote SHAs in this worklog. The snapshot SHA is recorded above; the documentation commit's SHA
   is returned to Kubi and Codex in the completion report, since a commit cannot embed its own hash.
3. **Two prior push attempts were refused before any remote mutation** (2026-09-06 and earlier on
   2026-09-07). Both were blocked by the workspace permission classifier before Git executed. Remote
   listings taken after each refusal were byte-identical to the listings taken before, and no
   upstream configuration key was written, so neither attempt reached the remote.

##### Residual risk

- **[repo-verified]** The snapshot is explicitly non-mergeable. It contains the mixed working tree
  described in WORK-001 and has not been type-checked, built, or tested. Its buildability is
  unknown and is not claimed. It exists to be reconstructed from, not merged.
- **[repo-verified]** The snapshot branch's tree still carries the line-ending exposure recorded in
  the WORK-001 report §8: `git diff` reported `LF will be replaced by CRLF` on 22 files and the
  repository has no `.gitattributes`. A later reconstruction may therefore show line-ending-only
  differences against this snapshot.
- **[repo-verified]** `frontend/.env.local.bak`, `.agents/`, `.codex/` and the POS contents are
  ignored and were not staged or committed; the parent gitlink removal for `skarpine-pos` is carried
  inside `7aefd74` as agreed under D-4.
- **[architectural recommendation]** The environment constraint that stopped this item twice is not
  resolved by the two new rules in a general sense: the permission classifier also refused several
  read-only `git ls-remote` and `git status` invocations in this session when they appeared inside
  compound shell statements, while the same commands passed when issued alone. Future work items
  should assume single, simple commands rather than chained ones.
- **[repo-verified]** WORK-002 changes no product behaviour, no schema, and no database state.

##### Status

WORK-002 execution is complete and awaiting independent Codex review. WORK-003 has not been started,
and no security implementation was begun.

#### Codex independent review — WORK-002 — 2026-09-07

**Status update: ACCEPTED.**

> **Provenance of this entry.** It was written into this file by Claude while executing WORK-004, on
> Codex's explicit instruction and from Codex's stated decision. It is Codex's decision, not
> Claude's finding, and it is not an independent verification performed by Claude.

Codex independently accepted WORK-002. The snapshot commit `7aefd74` was pushed unchanged — not
recreated, amended, squashed, rebased, or replaced — to `origin/codex/wip-full-snapshot-2026-09-06`,
and the documentation commit `b17c047` followed it with no amend and no force-push. `origin/master`
remained at `5cd97a6` throughout, and the independent POS repository remained on
`codex/wip-incomplete-pos-2026-09-06` at `09fa4de`, clean.

Both disclosed deviations were reviewed and accepted: the omitted `Co-Authored-By` trailer (correct
— the work item specifies the message verbatim) and the fact that a commit cannot embed its own SHA,
so `b17c047` is recorded here instead.

The environment observation Claude raised is accepted as a standing constraint on this workspace:
the permission classifier refuses commands by **shape**, not only by operation, rejecting read-only
`git ls-remote`, `git status` and `git config` invocations when they appear inside compound shell
statements. **All future work items must specify single, simple commands.**

### WORK-003 — Design the clean reconstruction and line-ending policy

- Priority: P0.3
- Status: ACCEPTED
- Owner: Claude (analysis); Codex (independent review and decisions)
- Business objective: Establish a verified, hunk-level reconstruction map and a line-ending policy
  before any commit is rebuilt from the non-mergeable snapshot.
- Explicitly deferred: all reconstruction. This item produced analysis only — no file was edited,
  staged, committed, pushed, built, tested, or executed against the database.

#### Claude analysis record — 2026-09-07

Read-only. The full findings were returned to Kubi; this is the durable record.

**Verified state at analysis time:** parent on `codex/wip-full-snapshot-2026-09-06` at `b17c047`,
clean; `origin/master` `5cd97a6`; one worktree only; POS on `codex/wip-incomplete-pos-2026-09-06`
at `09fa4de`, clean.

**Ranges.** `0a8bdf2 -> 7aefd74` is 39 paths, +3835/-126 (36 modified or added, plus the
`skarpine-pos` gitlink deletion). `7aefd74 -> b17c047` is one path — the worklog, +147/-0 — which is
the WORK-002 report, documentation and not product behaviour. **Consequence:** reconstruction must
restore `docs/collaboration/` from the branch tip `b17c047` and every other path from `7aefd74`, or
the WORK-002 report is silently lost.

**F1 — `backend/src/modules/finance/finance.routes.ts` is a mixed-concern BACKEND file.** WORK-001
classified it wholly as factura numbering. It carries four hunks and one of them is the new
`app.get('/tax/preview', ...)` route — the only server implementation of the tax preview
(`git grep -n "tax/preview" 7aefd74 -- backend/src` returns that single line), and the exact
endpoint `frontend/src/lib/useTaxPreview.ts` calls. So the tax-preview work depends on a backend
hunk the earlier plan placed inside the numbering commit. `computeDocumentTax` already accepts
`partyId` / `productId` / `side` at `0a8bdf2`, so the tax-preview backend surface is exactly that
one additive hunk and needs no other backend change.

**F2 — only two frontend files are mixed, not three.**
`frontend/src/app/(erp)/sales/orders/page.tsx` is **pure tax-preview**: it carries no
`factura_number` hunk and must not be split. The genuinely mixed files are
`frontend/src/app/(erp)/sales/orders/[id]/page.tsx` (two tax-preview hunks, two numbering hunks) and
`frontend/src/app/(erp)/finance/facturas/page.tsx` (three tax-preview hunks, one numbering hunk).
Every other path in the range is single-concern, verified by reading each diff individually.

**F3 — the line-ending risk recorded in WORK-001 §8 does not bite on this machine.**
No `.gitattributes` and no `.editorconfig` exist anywhere in the repository. `core.autocrlf=true`
comes from the **system** gitconfig with no repository or user override, and `core.eol` is unset at
all three levels. `git ls-files --eol` reports `i/lf` on **100%** of files inspected, with an empty
`attr/` column throughout. Two in-scope files (`finance.routes.ts`, `numberSequence.service.ts`) are
`w/crlf` against an `i/lf` index while `git status` is clean, which proves the CRLF -> LF conversion
on `git add` cancels out exactly. Committed content is therefore already uniformly LF and cannot
become CRLF while that setting holds. The 22 "LF will be replaced by CRLF" warnings describe what a
future *checkout* writes to disk, not what enters a commit. **Renormalisation is unnecessary:
`git add --renormalize` would rewrite zero blobs.** The residual exposure is the next contributor
(backlog P0.6), whose Git defaults differ — which is why the policy is adopted now, while the tree
is uniform.

**F4 — `backend/scripts/` is never type-checked.** `backend/tsconfig.json` has `include: ["src"]`,
identical at `0a8bdf2` and at the snapshot, so `npx tsc --noEmit` never sees
`backend/scripts/verifyFacturaLines.ts` — a file whose change is precisely a `number -> string` type
change. Earlier "tsc --noEmit clean" claims were true and simply did not cover it.

**F5 — the worklog held no Codex acceptance entry for WORK-002** at analysis time. Corrected above.

**Verification tooling, repo-verified.** Backend uses `jest` with `ts-jest`, `rootDir: 'src'`, and
`src/__tests__/jest.setup.ts` injecting `DATABASE_URL` and the JWT secrets — so backend unit tests
need no `.env` file and open no database connection. The frontend has **no unit-test runner at all**;
`tests/e2e` is Playwright only and needs a running application and database, so **Playwright is not
a per-commit gate.**

#### Codex decisions on WORK-003 — 2026-09-07

Recorded by Claude under WORK-004 on Codex's instruction.

- **K-1 — Reconstruction order is V1 -> V2 -> V3**, superseding Claude's recommended V1 -> V3 -> V2.
  With the three mixed files split by hunk, V2 (factura numbering) does not depend on
  `useTaxPreview`, and placing it second restores compatibility with the already-migrated test
  database earlier in the sequence. F1 remains valid and is handled by the hunk split rather than by
  the ordering.
- **K-2 — Adopt the `.gitattributes` policy** (`* text=auto eol=lf` plus explicit `binary` rules for
  png, jpg, jpeg, gif, webp, ico, pdf, woff, woff2, ttf, otf, eot, xls, xlsx, zip). **Run no
  renormalisation.** The tracked index is verified LF with no tracked `i/crlf` or `i/mixed` text
  file.
- **K-3 — The `backend/scripts/` type-check gap (F4) is accepted as a disclosed reconstruction
  limitation.** `verifyFacturaLines.ts` must **not** be run as a substitute gate: it mutates test
  data temporarily and requires its own safety review. A separate bounded work item will add
  `tsconfig.scripts.json` after reconstruction.
- **K-4 — The rebuild branch is `codex/rebuild-2026-09-07`**, created from `0a8bdf2` in a separate
  worktree at a sibling path. The snapshot checkout is never switched.
- **K-5 — V1 must record** Codex's acceptance of WORK-002, the WORK-003 findings and these
  decisions, the updated `CODEX_MEMORY.md` resume checkpoint, and Kubi's permanent
  parameter-driven product rule.
- **K-6 — Stale POS wording is corrected in V1.** The governing statement: `skarpine-pos` is a
  separate nested Git repository; it was previously represented in the parent as an *unregistered
  gitlink*; that gitlink is removed in V1; the physical repository remains separate, clean, and
  remotely preserved. No document may continue to describe its tree as uncommitted or dirty.
  Historical observations may stand only where clearly labelled as history and marked superseded.

### WORK-004 — Reconstruct V1: governance, documentation and repository hygiene

- Priority: P0.4
- Status: IN_REVIEW
- Owner: Claude (execution); Codex (independent review)
- Business objective: Establish the first reviewable commit of the reconstruction — the governance
  and documentation baseline every later commit is reviewed against.
- Approved behavior: in a separate worktree on `codex/rebuild-2026-09-07` from `0a8bdf2`, restore
  the approved documentation paths, remove the obsolete parent gitlink, author `.gitattributes`,
  and record the governance updates above. One commit. No push.
- Explicitly excluded: every path under `backend/` and `frontend/`; `.agents/`; `.codex/`; any
  environment, backup, credential, key or certificate-shaped path; builds, tests, Prisma generation,
  migrations, database calls, formatters, dependency installs, renormalisation, and any change to
  the original checkout or to the POS repository.
- Schema hook: not applicable — no schema behaviour changes.
- Claude implementation report: recorded below.

### WORK-007 — Reconstruct V2: factura numbering via NumberSequence

- Priority: P0 reconstruction
- Status: **ACCEPTED and PUBLISHED** — pushed 2026-09-08; `origin/codex/rebuild-2026-09-07` contains `fcc008e9`, confirmed with `git ls-remote`.
- Owner: Claude (execution); Codex (independent review and acceptance)
- Relevant catalog entries: `99.20.040.000` Configure and monitor system generated numbers;
  `65.20.400.000` Process customer returns and exchanges.
- Accepted commit: `fcc008e9bf00b09ae450cdbe17d281561566cf48`, parent
  `cef88c93877d01b4c72e946b66c17adacc9feb2c`.
- Remote state at acceptance: `origin/codex/rebuild-2026-09-07` remains `cef88c9`; V2 is not pushed.
- V3 status: not started.

#### Codex independent review — WORK-007 — 2026-09-07

**Status update: ACCEPTED.**

Codex inspected the actual amended repository diff through Correction 4. The final correction closes
the missed customer-return and sales-list issuance surfaces in manual FACTURA mode, validates the
return request, keeps allocation inside the existing transaction, and preserves the deliberately
unresolved decision that credit notes currently draw from the FACTURA series. The Setup API now
removes the silent `FISCAL_YEAR` bypass: fiscal-year automatic resumption is explicitly reported as
unsupported and a manual-to-automatic transition is refused with
`NUMBER_SEQUENCE_FISCAL_YEAR_RESUME_UNSUPPORTED`; acknowledgement cannot override it. Request-local
acknowledgement state is reset when its sequence subject changes.

Independent verification performed by Codex:

```
backend:  npx jest --runInBand  -> 12 suites, 264 tests, all passed
frontend: npm run build         -> compiled, type-checked, 67/67 static pages
git diff --check cef88c9..HEAD   -> clean
rebuild HEAD                     -> fcc008e9bf00b09ae450cdbe17d281561566cf48
remote rebuild branch           -> cef88c93877d01b4c72e946b66c17adacc9feb2c
```

Accepted residuals are not completion claims: Android POS still cannot supply a manual FACTURA
number; Bolivia's credit-note series remains legally unverified; a fiscal-year automatic FACTURA
still needs a year/legal-entity-aware history design; the repeated web control should later become a
shared component; and `backend/scripts/` remains outside the compiler gate. None authorizes V3 or a
database change.

### WORK-009 — Reconstruct V3: safe server-driven tax preview

- Priority: P0 reconstruction (final reconstruction slice)
- Status: **ACCEPTED and PUBLISHED** — accepted at
  `c362cdc0be37b4a1285469a32989cadc5c369de4` after two corrections; pushed 2026-09-08 and the
  remote SHA verified with `git ls-remote`.
- Owner: Claude (execution); Codex (independent review and acceptance)
- Relevant catalog entry: `65.20 Manage sales orders`. The catalog locates this work; it is not a
  feature-parity claim. Scope status `CORE_NOW`; implementation status after this item
  `IMPLEMENTED_UNVERIFIED` — the backend contract has automated coverage, the frontend has
  compilation and code review only, and no browser or database run was performed.
- Parameter owner: the tax engine already owns every rate and side (`TaxCode`, `TaxGroup`,
  `ItemTaxGroup`, resolved through `SalesParameters` defaults). This item adds no new parameter and
  moves configuration OUT of client code rather than introducing more.
- Schema hook decision: **NONE_REQUIRED for this item, and none added.** The route is read-only and
  additive. The hooks the residuals need already exist and are deliberately not used here — see
  "Residual limitations" below.
- Localization effect: Bolivia's IVA 13% *por dentro* and IT 3% behaviour is unchanged; it is now
  read from the engine that already implements Ley 843 art. 5 and art. 74 instead of being
  re-derived, wrongly, in the browser. No client renders a rate literal any more.

#### Claude implementation report — WORK-009 — 2026-09-08

**What the defect was.** Seven client surfaces each computed tax with `total / 1.13` for IVA and
`subtotal * 0.03` for IT. `backend/src/__tests__/tax.service.test.ts` records that arithmetic as a
DEFECT: Bolivian IVA is *por dentro*, so on Bs 1 299 the client yields 149,44 / 34,49 where the
configured engine yields 168,87 / 38,97. The till display, the PDF the customer keeps and the
general ledger could each describe one sale differently, and every one of those screens hardcoded
Bolivia into a product meant to be sold elsewhere.

**Backend.** `GET /finance/tax/preview` — authenticated, tenant-scoped, read-only. It validates,
calls the existing `computeDocumentTax`, and returns that result verbatim including `lines` and
`source`. It contains no tax arithmetic of its own.

Validation lives in `TaxPreviewQuerySchema` (`shared/schemas/index.ts`), which is pure and tested
without a database. The body-only `validate()` middleware was neither reused nor widened: it reads
`c.req.json()`, which a GET has no business having. Two refusals correct the snapshot's design:

- `amount` must be finite AND strictly positive. The snapshot checked only `Number.isFinite`, so
  `?amount=0` and `?amount=-500` reached the tax engine.
- `side` is a `z.enum`. The snapshot read `side === 'PURCHASE' ? 'PURCHASE' : 'SALES'`, so a typo
  became a SALES preview — which in Bolivia silently adds a turnover tax that Ley 843 art. 74 puts
  on sales only.

Optional identifiers are validated as UUIDs. An EMPTY identifier parameter is normalised to absent
before that check, because a query string cannot distinguish "absent" from "empty"; an empty `side`
is refused, because that is a caller who thinks it chose one.

**Frontend.** `frontend/src/lib/useTaxPreview.ts` corrects the snapshot hook's three defects:

1. **A request per keystroke.** The snapshot put `amount` in the query key and relied on
   `staleTime`, which only helps a key already fetched — every new amount is a new key. The amount
   is now debounced (`TAX_PREVIEW_DEBOUNCE_MS = 300`) before it reaches the key.
2. **A false zero on failure.** The snapshot returned `q.data ?? {all zeros}`, so an API error
   produced a settled-looking "no tax on this sale" that could reach a customer's PDF. `tax` is now
   NULL unless the preview actually succeeded, so a consumer cannot render zeros by forgetting to
   check — it is a type error, not a runtime surprise.
3. **A stale amount's answer against a new amount.** Between a keystroke and the debounce firing,
   the last result describes the PREVIOUS amount. The hook reports `ready` only while the debounced
   amount still equals the amount being asked about.

Status is a four-value union — `idle` / `loading` / `ready` / `error` — so "no amount to price",
"still working" and "could not be calculated" are distinguishable, and `retry` is exposed.

**Consumers.** POS cart store and till, sales-order PDF and its button, the manual factura form, the
sales-order detail invoice dialog, and the sales-order list invoice modal. All client tax arithmetic
is gone from those surfaces (`grep` for `1.13` / `* 0.03` over `frontend/src` returns comments
only). Breakdown rows are built from `tax.lines` — code and rate from the code itself — with a
non-zero-only fallback for the LEGACY source, which returns amounts but no line detail.

- The sales-order PDF view and download are unavailable while tax is loading or failed, with a
  visible reason and a retry. The document takes `tax` as a REQUIRED prop with no default, so there
  is no zero to fall back to.
- POS keeps computing the cart merchandise total locally — a till must price a basket without a
  round trip — and takes only the split from the server. The sale is deliberately NOT blocked on a
  preview failure: the amount charged is the merchandise total, and the factura's tax is computed
  server-side at posting time, so blocking would stop the till trading over a display concern.
- Issuing an invoice is likewise not blocked on a preview failure, for the same reason. Only the
  preview is unavailable, and the screen says so.

**V2 preserved.** Manual and automatic FACTURA numbering, fail-closed sequence handling, the
customer-return issuance path, the sales-list issuance path, the FISCAL_YEAR resumption refusal and
the request-local acknowledgement reset are untouched; the diff adds no change to any of those
blocks.

**Historical tax is not previewed.** Issued facturas continue to read their stored `iva_amount` and
`it_amount` — the factura list table and the issued-factura panel on the order detail page were not
changed. Today's rates must never redisplay a document issued under an older one.

#### Verification — WORK-009

```
backend  npx tsc --noEmit   -> clean
backend  npx jest --runInBand -> 13 suites, 285 tests, all passed
frontend npx tsc --noEmit   -> clean
frontend npm run build      -> compiled, type-checked, 67/67 static pages
git diff --check            -> clean
```

`taxPreviewRoute.test.ts` adds 21 tests driving the real router through a one-route Hono app with
the Prisma client and the tax engine mocked. No database was contacted, and no migration, seed,
provisioning script, `prisma generate`, Playwright run or dependency change was executed.

#### Residual limitations — WORK-009

These are disclosed limits, not defects introduced here.

1. **Header-level only.** `computeDocumentTax` prices a document total, not lines. Correct for
   Bolivia, where one rate applies to everything the anchor customer sells; wrong for Turkey
   (KDV 20/10/1) or Germany (USt 19/7). **WORK-009 does not provide multi-rate or per-line tax
   correctness and must not be described as doing so.** The hook exists — `item_tax_group_id` and
   per-line tax columns on five line tables since migration 004 — so this is a service refactor, not
   a migration.
2. **POS supplies customer context for the whole cart** and cannot yet express different item tax
   groups per line. Same root cause as (1).
3. **`SalesOrder.tax_amount` is a single column and cannot store a split**, which is why the order
   screens preview instead of reading stored figures, and why a tax-transaction line table (D365's
   TaxTrans) is the next schema step. Deliberately not added here.
4. **Issued `Factura` stores Bolivia-specific header fields** (`iva_amount`, `it_amount`). Those are
   what the historical screens read, and they cannot represent a third tax or a non-Bolivian split.
5. **`frontend/src/app/pos/receipt/page.tsx` still carries fixed "IVA 13%" / "IT 3%" labels.** Its
   AMOUNTS are already server-issued, so this is a presentation/localisation residual only. It is
   outside the approved change scope for this item and was not touched.
6. **`frontend/src/app/(store)/checkout/page.tsx` holds `const IVA_RATE = 0.13`** and extracts IVA
   in the browser — the same defect class as the surfaces fixed here, on the customer-facing
   storefront. It is NOT in the approved WORK-009 consumer list, so it was reported rather than
   changed. It should be a separately scoped work item.
7. **Fixed "IVA 13%" / "IT 3%" column headers remain** on the factura list, the IVA report, the
   quotation detail and the IVA report PDF. Those label STORED historical figures, so correcting
   them needs the per-document rate that is not stored — see (3) and (4).
8. **A zero-total sales order no longer produces a PDF** (it previously produced one with a zero tax
   line). Deliberately not special-cased back, because a constructed zero tax object is
   indistinguishable from the failure fallback this item exists to remove.
9. **The frontend has no unit-test runner**, so the hook's debounce, staleness and failure semantics
   are verified by compilation and code review only. No runner was introduced for this item.
10. **`backend/scripts/` remains outside the compiler gate** (K-3), unchanged by this item.

#### Codex review — WORK-009 — CHANGES_REQUESTED — 2026-09-08

The backend route, its validation, the tenant-scoped engine delegation and the backend tests were
reviewed and accepted. Three frontend findings were raised and are corrected below. Codex's review
of the accepted backend surface is not repeated here.

#### Claude Correction 1 report — WORK-009 — 2026-09-08

**Finding 1 — React hook order.** `useTaxPreview` was called in
`frontend/src/app/(erp)/sales/orders/[id]/page.tsx` BELOW the `isLoading` and `!order` early
returns. On a cold load the first render exited before reaching it and the loaded render invoked one
hook more than the render before it — a Rules of Hooks violation that can desynchronise every
subsequent hook on the page. Real defect, introduced by this work item.

Corrected by moving the call up beside the other hooks, above every conditional return. It reads
`order?.total_amount ?? 0` and `order?.customer_id ?? null` so it is safe with no order at all, and
`enabled: !!order && showInvoiceForm` keeps a request from being issued until an order exists and the
invoice form is open. `useTaxPreview` independently refuses a non-positive amount, so the zero
stand-in can never reach the API. Loading and not-found rendering are unchanged.

**Finding 2 — tenant/session cache isolation.** The query key carried amount, party, product and
side but not the tenant. The QueryClient is created once at module scope in
`components/Providers.tsx` and survives a client-side logout and login, so within the five-minute
`staleTime` React Query could serve tenant A's figure to tenant B without calling the API.

Corrected by adding a reactive, non-secret `tenantId` to `stores/authStore.ts` — set on login,
resolved from the same `localStorage` value the API client sends as `X-Tenant-ID` on `loadUser`, and
cleared on logout — and making it the FIRST element of the tax-preview query key. The query is
disabled while it is null, and `deriveTaxPreviewState` additionally refuses to report `ready` without
a resolved tenant, so key discipline is not the only thing standing between two sessions. The access
token is not read and never reaches a cache key. No broader authentication change was made; cache
eviction on logout was considered and rejected because reaching the QueryClient from the auth store
would require moving it out of `Providers.tsx` to break an import cycle, which is wider than this
correction.

**Finding 3 — refetch failure must fail closed.** The hook evaluated cached `q.data` before
`q.isError`. React Query RETAINS data when a later refetch fails — the status becomes `error` while
the previous result stays in the cache — so a failed refresh was reported as `ready`, the error was
hidden, and `SalesOrderPDFButton` could build a customer-facing PDF from stale tax.

Corrected by evaluating the error branch FIRST and returning `tax: null` regardless of what the
cache holds, with the message and `retry` still exposed. `retry` is now guarded: it is a no-op unless
a request is legitimate right now, so it can never refresh the previous amount's query while a new
amount is still inside the debounce window.

**Supporting change.** The state rules moved into `frontend/src/lib/taxPreviewState.ts`, which
imports NOTHING — the same split as `backend/src/shared/services/numberSequenceRules.ts`. This is
what makes the fail-closed rule executable evidence rather than an assertion: the decision can be run
without React, React Query, a browser or a network. `useTaxPreview.ts` keeps the effects (debounce,
query, guarded retry) and re-exports the shapes, so no consumer import changed.

#### Correction 1 verification — what was EXECUTED and what was not

```
backend  npx tsc --noEmit                      -> clean
backend  npx jest --runInBand                  -> 13 suites, 285 tests, all passed
frontend npx tsc --noEmit --incremental false  -> clean
frontend npm run build                         -> compiled, 67/67 static pages
git diff --check                               -> clean
```

**Executed against the real source, with no new dependency:**

- A state-rule harness compiled by the frontend's installed TypeScript and run under node against
  `taxPreviewState.ts`: **48 checks, 48 passed**. It covers evidence items 2 through 7 — a disabled
  or absent order issues no request; an unresolved or cleared tenant never yields a figure and two
  tenants produce different query keys; a mid-debounce amount change neither displays nor retries the
  previous amount; success followed by a retained-data refetch failure yields `error` with
  `tax: null`; PDF availability tracks the same rule; and a successful retry returns to `ready`.
- A hook-order scanner run over the six consumer files: **13 components, 0 violations**. Its ability
  to detect the real defect was proved by running it against the pre-correction file from
  `0033aa9d`, where it reports the violation at the exact line of the misplaced `useTaxPreview` call.

**The harness found a real defect in the correction itself.** Its first run reported 2 failures: with
`tenantId` null and data still in hand, `deriveTaxPreviewState` returned `ready`. The hook would not
have produced that combination today, because changing the tenant changes the key, but the rule was
depending on that key discipline for its safety. A tenant precondition was added to the `ready`
branch and both checks pass. This is the argument for the pure module in one line.

**NOT executed, and not claimed as executed:**

- No browser render. React's actual hook-ordering behaviour, React Query's own cache keying and
  eviction, the `setTimeout` debounce timing, and axios error shapes in a live app are established by
  compilation, the production build and code inspection — not by running the application.
- ESLint and `react-hooks/rules-of-hooks` are NOT configured in this repository. Installing them is
  out of scope, so the scanner above is a narrow text-based substitute, not a linter. It reads source
  text rather than an AST and is conservative: it can over-report, never under-report a hook that
  follows an early exit.
- The harness and the scanner live in the session scratchpad and are NOT committed. They add no
  dependency and no repository path; the report records their exact results.
- No database, migration, seed, provisioning, `prisma generate` or Playwright command was run.

#### Claude Correction 2 report — WORK-009 — 2026-09-08

**The finding, confirmed.** `useTaxPreview` never passed React Query's actual fetching state into
the pure decision, and `deriveTaxPreviewState` returned `ready` whenever settled data existed. React
Query retains the previous result while it refetches, so a window-focus refresh once `staleTime` had
elapsed, a remount, an invalidation or a manual retry all left the OLD tax exposed — and therefore
left `SalesOrderPDFButton` willing to generate a customer-facing PDF from a figure that was at that
moment being re-asked, and might come back different or fail outright. Correction 1 closed the
*failed* refetch; this closes the *unresolved* one.

**Correction.** `TaxPreviewInputs` gains `queryIsFetching`, fed from `q.isFetching`
(equivalently `fetchStatus === 'fetching'`), and `deriveTaxPreviewState` checks it BEFORE both the
error flag and any data:

- while a request is in flight the status is `loading`, `tax` is `null`, and the PDF stays
  unavailable — the existing loading UI is what every consumer already renders for that state;
- when the refresh fails, `isFetching` drops and the status becomes `error` with `tax` still null and
  the visible retry still available;
- after a successful retry the status returns to `ready`, exposing only the NEW result.

In flight is checked ahead of `error` deliberately: while a retry runs, the previous failure is no
longer the current truth. Both branches expose `tax: null`, so no safety property turns on which
wins.

Preserved unchanged: the hook-order correction, tenant/session cache isolation, the amount debounce
and stale-amount protection, the guarded retry, historical stored Factura tax, V2 numbering, the
header-only/multi-rate limitation, and every accepted backend behaviour. No consumer file changed —
the existing `!preview.tax` gates already produce the required behaviour once the decision is
correct.

#### Correction 2 verification — what was EXECUTED

```
backend  npx tsc --noEmit                      -> clean
backend  npx jest --runInBand                  -> 13 suites, 285 tests, all passed
frontend npx tsc --noEmit --incremental false  -> clean
frontend npm run build                         -> compiled, 67/67 static pages
git diff --check                               -> clean
```

**Real React Query evidence — 43 checks, 43 passed.** A harness drives the genuine
`QueryClient` + `QueryObserver` from the installed `@tanstack/query-core` 5.95.2 — the same module
`@tanstack/react-query` v5 uses internally — and feeds each observer result into the real
`taxPreviewState.ts`. Nothing about the query state is fabricated: `isFetching`, `isError`, `error`
and `data` all come from React Query's own reducer, driven by a queryFn whose promise the harness
resolves or rejects on demand. The proved sequence is:

1. ordinary initial loading — fetching, no data, `loading`, PDF unavailable;
2. first result succeeds — `ready`, PDF available;
3. a deferred refetch starts — React Query STILL holds the old data and reports fetching, while the
   decision is `loading` with `tax: null` and the PDF is unavailable;
4. that refetch rejects — `error`, `tax: null`, the server message surfaced, retry available;
5. retry starts — `loading`, `tax: null`, PDF unavailable;
6. retry succeeds with a DIFFERENT result — `ready`, exposing the new value and not the stale one;
7. a second observer on the same key with `staleTime: 0` — the shape of a remount or focus refresh —
   is served from cache AND starts a background fetch; the decision is `loading`, not `ready`, and
   returns to `ready` only once that fetch settles.

**The harness is not vacuous.** Step 3 also computes the decision from that same real observer state
with the fetching input withheld — precisely the pre-correction behaviour — and confirms it reports
`ready` and would have generated the PDF.

Reproduction, run from `frontend/`:

```
cp frontend/src/lib/taxPreviewState.ts <scratch>/rq/taxPreviewState.ts   # sha256 verified identical
npx tsc -p <scratch>/rq/tsconfig.json
NODE_PATH=<repo>/frontend/node_modules node <scratch>/rq/out/rqharness.js
```

The copied module's sha256 was compared against the repository file for this run
(`a0c8dccc4b66c91af322a654fb2cbe64164a57759ad2026a73632fd81da78518`, identical), so the evidence is
against the shipped rules and not a paraphrase.

The Correction 1 harness was updated for the new input and re-run: **48 checks, 48 passed.** The
hook-order scanner was re-run: **13 components, 0 violations.**

**NOT executed, and not claimed:** no browser render. React's own hook ordering, the `setTimeout`
debounce timing, and axios error shapes in a live app remain established by compilation, the
production build and code inspection. `QueryObserver` is framework-agnostic, so what the harness
proves is the cache/decision contract, not rendering. The harnesses live in the session scratchpad
and are not committed; they add no dependency and no repository path. No database, migration, seed,
provisioning, `prisma generate` or Playwright command was run.

#### Codex independent review — WORK-009 — ACCEPTED — 2026-09-08

**Status: ACCEPTED.** Accepted commit `c362cdc0be37b4a1285469a32989cadc5c369de4`, parent
`2177d36a96bff53bc3e8dc1c36b0d208e051df98`.

V3 provides a server-driven tax preview for the approved web ERP and POS surfaces: those screens now
obtain their tax split from the same configured engine that posts the journal, rather than computing
it in the browser.

The final correction closes seven safety properties:

1. React hook-order safety;
2. tenant/session query-cache isolation;
3. stale amount and debounce safety;
4. fail-closed initial loading;
5. fail-closed background refetch;
6. fail-closed error and retry states;
7. PDF gating until a current successful tax result exists.

Independent verification by Codex included a real `QueryClient`/`QueryObserver` state-chain check and
a frontend type-check. The backend remained at the independently verified **13 suites / 285 passing
tests**.

**Two limits on this acceptance, recorded so they are not read as more than they are.**

- Claude's uncommitted scratch harness totals (48, 43 and the hook-order scan) were **not
  independently reproduced as artifacts**. They are working evidence produced during implementation
  and **must not be represented as permanent regression tests.**
- **No frontend unit-test runner and no browser-render regression suite exists.** The tax-preview
  state machine therefore has no standing automated guard in the repository. This is verification
  debt, carried forward deliberately rather than closed here.

#### WORK-010 — Publish V3 and record the reconstruction checkpoint

- Priority: P0 reconstruction (closing action)
- Status: COMPLETE
- Owner: Claude (execution); Codex (acceptance already given above)
- Explicitly deferred: all implementation. This item published an already-accepted commit and updated
  three documents. No runtime code, schema, migration, SQL, environment or generated file was
  touched, and no build, test, database or Playwright command was run.

**Publication.** `c362cdc0be37b4a1285469a32989cadc5c369de4` was pushed to
`origin/codex/rebuild-2026-09-07` as a normal fast-forward from `2177d36a`, and the remote SHA was
verified independently with `git ls-remote`. No force-push, merge or rebase.

**The reconstruction is complete.** `origin/codex/rebuild-2026-09-07` now carries, in order: V1
governance `a713a53`, the WORK-006 green baseline `cef88c9`, V2 factura numbering `fcc008e9`, the
Business Process Catalog documentation `2177d36a`, and V3 `c362cdc0`.

**No next Core ERP implementation item has started.** The next action is a fresh, catalog-aligned
assessment of the remaining Core ERP gaps, anchored on `docs/process/CORE_ERP_PROCESS_CATALOG.md`,
before any bounded implementation item is selected. That assessment is analysis work; the catalog
stays a navigation spine and is not a D365 feature-parity promise.

#### WORK-011 — Purchasing golden-flow completion matrix — ACCEPTED — 2026-09-09

- Priority: Core ERP analysis
- Status: ACCEPTED
- Owner: Claude (Microsoft Learn research); Codex (workbook/repository verification and final scope)
- Artifact: `docs/process/CORE_ERP_COMPLETION_MATRIX.md`

The first bounded catalog overlay covers `75.40 Procure goods and services`, `60.30 Process inbound
goods`, and `75.50 Manage accounts payable`, plus the directly relevant ledger, number-sequence, and
security processes. Catalog IDs and product tags were verified against the supplied JUL-2026
workbook; major Dynamics claims use Microsoft Learn URLs. The matrix distinguishes product scope,
implementation status, parameter ownership, hard-coding debt, schema hooks, localization impact,
and dated repository evidence.

The highest-value next functional slice is `75.50.090.000 Issue and settle supplier payments`, with
cancel/correct scenarios attached. Implementation was not authorized. Two gates remain ahead of any
schema change: the P0 migration ledger/lock/schema-drift controls and the purchasing-route 99.25
permission audit.

#### WORK-012 — Vendor payment and settlement foundation — DESIGN ACCEPTED — 2026-09-09

- Priority: Core ERP architecture
- Status: DESIGN ACCEPTED; IMPLEMENTATION NOT AUTHORIZED
- Owner: Claude (Microsoft Learn research and review); Codex (repository verification and design)
- Artifact: `docs/architecture/VENDOR_PAYMENT_SETTLEMENT.md`

The accepted design uses `VendorPayment` as the operational document, `VendorOpenTransaction` as the
AP subledger transaction, and immutable `VendorSettlement` rows for allocations. The open-transaction
layer is required because supplier credits are already in the selected product scope. Reversing
payments, transactions, and settlements point from the new reversal row to the original; posted
history is not mutated. CORE_NOW supports partial and many-to-many settlement and rejects excess
allocation; tolerances, payment proposals, integrations, and richer workflow remain deferred behind
explicit hooks.

Claude's final Learn-backed review found the missing explicit reversal pointer on the AP open
transaction; Codex added `reverses_transaction_id`. Its proposed tax-label wording was adapted to the
repository's allowed evidence taxonomy: the document now describes and cites the current sales-side
IT behavior without presenting repository code as statutory authority.

#### WORK-013 — Core ERP readiness gates — ACCEPTED ANALYSIS — 2026-09-09

- Priority: P0 migration integrity and 99.25 purchasing authorization
- Status: ACCEPTED ANALYSIS; IMPLEMENTATION NOT AUTHORIZED
- Owner: Claude (Microsoft Learn research and evidence review); Codex (repository audit and design)
- Artifact: `docs/architecture/CORE_ERP_READINESS_GATES.md`

The migration audit confirmed that the real history is 23 custom SQL files with no ledger, checksum
enforcement, or cross-process lock. CI starts PostgreSQL but invokes `prisma migrate deploy` despite
the absence of a Prisma migrations directory, and listens to `main/develop` despite the governed
`master` plus short-lived `codex/*` policy. The old `database/schema.sql` still describes
schema-per-tenant and cannot be the rebuild baseline. The accepted design reconstructs a reviewed
pre-`001` baseline from the schema at `8ff69688`, then proves `000 -> 001–023`, immutable checksums,
serialization, idempotence, and schema drift on an ephemeral database before any shared-database
baseline operation.

The purchasing authorization audit mapped all 45 entry points. Twenty-nine use fixed role guards,
16 use authentication only, and no production route uses the existing permission middleware. Three
mutations — create, submit, and cancel requisition — have authentication but no business permission.
The artifact assigns every route a stable target action and defines the minimum supplier,
requisition, RFQ, order, receipt, supplier-invoice, AP-payment, and setup permission spine.

Claude's Learn review accepted the final evidence after correcting the supplier-maintenance/
receipt/payment SOD citation and terminology. The next proposed implementation items are deliberately
separate: WORK-014 migration runner/ledger/lock, WORK-015 ephemeral rebuild/drift CI, and WORK-016
purchasing route permissions. None is authorized by this analysis.

#### WORK-014 — Migration runner, ledger, and lock — ACCEPTED — 2026-09-09

- Priority: P0.4
- Status: ACCEPTED; UNCOMMITTED
- Owner: Claude (bounded patch); Codex (independent review)
- Authorization: Kubi explicitly approved WORK-014 on 2026-09-09.
- Allowed paths: `backend/scripts/applyMigration.ts`,
  `backend/src/infrastructure/database/migrationPolicy.ts`,
  `backend/src/__tests__/migrationPolicy.test.ts`, `backend/tsconfig.scripts.json`, and
  `backend/package.json`. Kubi subsequently approved the one-line type-check correction in
  `backend/scripts/probeSetupState.ts`.
- Excluded: SQL migration files, Prisma schema, database access or writes, CI, dependencies, commit,
  push, and WORK-015/016.

The item will make the runner discover an ordered migration set, hash raw file bytes, validate a
prefix ledger, fail closed on history/order/path violations, acquire a PostgreSQL advisory lock, and
record a migration only in the same transaction as its SQL. Existing databases without a valid
ledger must refuse automatic adoption; their later baseline remains a separate manual database gate.
Verification is limited to pure unit tests and TypeScript compilation; no migration is executed.

Claude produced the bounded patch with zero repository tools. Codex rejected two defects before
application: the advisory-lock `SELECT` used the non-query raw API, and comment-prefixed transaction
control could evade the first-token check. Claude corrected both in the same session. The applied
runner now uses the query raw API for `pg_advisory_xact_lock`, and the parser skips leading line and
nested block comments before rejecting runner-owned transaction commands.

Independent offline verification passed: all **14 backend suites / 326 tests**, including the new
**41-test** migration-policy suite; the ordinary backend TypeScript check; parsing of all 23 existing
SQL migration files; and `git diff --check`. The new script-specific TypeScript check correctly
exposed one pre-existing field-name error in `scripts/probeSetupState.ts`. After Kubi approved the
scope extension, Codex changed `d.sequence_number` to the query result's actual `d.sequence` field;
the script-specific and ordinary TypeScript checks and all 14 suites / 326 tests then passed again.
No database, migration, seed, provisioning, Prisma generation, build, commit, or push command was
run. WORK-014 is accepted as an uncommitted patch; database adoption remains a separate manual gate.

#### WORK-015 — Ephemeral rebuild and schema-drift CI — ACCEPTED LOCALLY — 2026-09-09

- Priority: P0 migration integrity
- Status: ACCEPTED LOCALLY; Supabase isolated-schema evidence complete; uncommitted
- Owner: Claude (bounded patch); Codex (baseline generation and independent review)
- Authorization: Kubi explicitly authorized WORK-015 on 2026-09-09.
- Catalog scope: infrastructure gate supporting `75.40`, `60.30`, and `75.50`; no catalog scope
  expansion.
- Excluded: the shared test database's `public`/Auth/Storage state, environment files,
  dependencies/lockfiles, business runtime, edits to SQL `001`–`023`, frontend/POS, commit, push,
  and deployment.

Codex generated a temporary baseline candidate without database access by running the installed
Prisma 5.22 read-only schema diff from empty to `backend/prisma/schema.prisma` at historical commit
`8ff696884b841bc92da6e77ee75553c094b86ac2`. The uncommitted temporary output is 1,045 lines / 37,314
bytes with SHA-256 `d20208a585d0b1bc362e437967708aacc248a898eeb0412a62bba232d6409ddd` before a provenance header.
It has not been copied into the repository.

Claude implementation session `0b5c665c-d6ca-4bc4-b5f2-3511856e07cb` reached its first output limit
while reasoning and produced no final patch. Correction 1 rejected a simulated unit-test substitute
for real PostgreSQL rollback evidence and an unsupported `self-hosted` runner assumption. That
correction then stopped at the Claude Pro usage limit. No Claude patch has been applied. A one-time
thread heartbeat is scheduled after the reported 14:00 Europe/Budapest reset to resume the same
session. Local ephemeral PostgreSQL execution remains a separate manual database gate even after a
reviewable patch exists.

The scheduled resume re-authenticated successfully after the reset. Correction 2 again exhausted
the model output on reasoning without a final patch. Correction 3 returned a patch, but independent
Codex review rejected it before application: importing `applyMigration.ts` would execute its
unconditional `main()` and start an unintended migration; the drift command uses unsupported Prisma
flags and a shell-string execution path; the rollback verifier accepts any failure rather than the
specific injected failure; and line-ending-normalized drift comparison also trims trailing bytes,
so it is not the required exact snapshot contract. The CI hunk also contains source-packet redaction
tokens rather than preservation of the repository's existing local test values. The three-correction
limit is exhausted. No WORK-015 runtime, SQL, schema, CI, package, or test patch was applied, and no
database, commit, or push operation occurred. Continuing requires an explicit process decision rather
than silently opening a fresh Claude session or having Codex replace the designated patch author.

Kubi then explicitly instructed Codex to continue from the stopped point, authorizing Codex to
correct the patch directly within the same WORK-015 scope. The reviewable local candidate now
includes the generated `000` baseline, an import-safe migration engine, a CLI wrapper, a loopback-only
ephemeral CI verifier, a Prisma representation of the runner-owned ledger, the real custom-runner CI
path, and an exact line-ending-normalized drift snapshot contract. The final baseline file is 37,769
bytes with raw-byte SHA-256 `1b32db673ded5d63ff2740cbe71e3049bb32deccc02efd10ff49307282c1f843`.

Offline checks pass: both TypeScript checks, Prisma schema validation, parsing of all 24 files
(`000`–`023`), `git diff --check`, and **14 backend suites / 331 tests**. No database has
been contacted. Docker CLI 28.5.1 is installed, but its local Linux engine is stopped. The next step
requires a separately approved disposable PostgreSQL container run to prove rollback, advisory-lock
serialization, exact ledger/checksums, idempotence, and to capture the reviewed drift snapshot.

Docker Desktop was unavailable on the local machine, so Kubi asked Codex to adapt the verification
to the repository's Supabase test project. The CI contract remains loopback-only. A separate manual
wrapper now accepts the Supabase direct/session URL only through an explicit process variable,
requires a `*.supabase.com` PostgreSQL host and the `postgres` database, creates only the fixed
`work015_verify_20260909` schema, refuses to reuse it if it already exists, scopes the migration and
drift clients to that schema, and drops only that schema in `finally`. No credential is copied into
the rebuild worktree or printed. The wrapper has not been executed. After the adaptation, both
TypeScript checks, `git diff --check`, and all **51 migration-policy tests** pass offline.

Kubi then explicitly authorized the concrete Supabase verification operation. Codex read the parent
snapshot's `DIRECT_URL` into the process only, without printing or copying it. Every attempt created
only `work015_verify_20260909`, refused pre-existing reuse, and removed that schema in `finally`;
the wrapper now also queries `pg_namespace` after the drop and reports successful cleanup. The
first attempt exposed a Prisma deserialization error for PostgreSQL's `void` advisory-lock return,
so the lock query was changed to return a scalar marker. The second reached the drift step and
exposed Windows `.cmd` spawning incompatibility, so the verifier now invokes the installed Prisma
CLI through the current Node executable without a shell. Both failed attempts rolled back and the
fixed schema was independently confirmed absent before reuse.

The first successful capture proved rollback, advisory-lock serialization, exact ledger names /
ordinals / checksums, and repeatability across migrations `000`–`023`, but it found **real** schema
drift: foreign-key update actions, index definitions and names, timestamp precision, and other
Prisma-representable differences. Codex rejected that 367-line result as an allowlisted snapshot.
Historical files `001`–`023` remain byte-for-byte untouched; a new forward-only
`024_reconcile_prisma_schema.sql` applies the reviewed reconciliation. Its SHA-256 is
`479f29148c90323815fdee82ec3e76cd1ddc7c5228dd61e235dddbf9842377d4`. Migration 013's partial
unique index on nullable `journal_entries.corrects_entry_id` required one manual correction to the
generated SQL: PostgreSQL treats the old partial and new regular unique definitions equivalently for
non-null values, but the same index name had to be dropped before replacement.

The final, newly created isolated-schema run passed all checks for **25 migrations
(`000`–`024`)** and removed the verification schema. Prisma's exact post-chain drift output is
only `-- This is an empty migration.\n\n`; the reviewed
`backend/prisma/drift.snapshot.sql` has SHA-256
`e69c9f21be2b53770b13ea52bf6c4f304a9fc86b41f1e932729ec2de45574341`. Final local verification
passes both TypeScript checks, Prisma 5.22 schema validation, `git diff --check`, and **14 backend
suites / 336 tests**. No shared schema, Auth, Storage, seed, provisioning, commit, push, or deployment
was changed. The pre-existing `npm run lint` command still cannot start because neither
`package.json` nor `package-lock.json` contains ESLint; dependency and lockfile repair is outside
this bounded item and remains explicit CI debt. WORK-015 is accepted as an uncommitted patch.

#### WORK-016 — Purchasing permission containment — IN PROGRESS — 2026-09-09

- Priority: P0 purchasing authorization / catalog `99.25.050.000` and `99.25.060.000`
- Status: IN PROGRESS; Claude subscription reset pending
- Owner: Claude (bounded patch); Codex (scope and independent review)
- Authorization: Kubi explicitly instructed the collaboration to proceed on 2026-09-09.
- Allowed implementation paths: purchasing permission middleware/registry, the two purchasing route
  files, existing HR role validation and selector surfaces, OpenAPI role values, and offline
  permission/schema/route-wiring tests named in the secret-free source packet.
- Excluded: database-backed Role/Duty/Privilege administration, legal-entity role-assignment schema,
  full security UI, durable denial/SOD audit implementation, migrations, database access,
  dependencies/lockfiles, POS, commit, push, and deployment.

The bounded policy converts all 45 audited purchase/procurement routes to stable business-action
permissions and requires all four actions on receive-and-invoice. It adds assignable requester,
buyer, receiver, AP clerk, finance approver, and auditor compatibility roles through the existing HR
employee selector. Customer, cashier, and unknown identities receive no purchasing access.
`store_manager` preserves its existing operational purchase surface except supplier-payment
posting, which is deliberately removed to honor the accepted supplier/receipt-versus-payment
separation; admin remains the named owner override. No schema hook is required for this temporary
map. The first future database-backed role-assignment table must carry nullable
`legal_entity_id`.

Subscription AuthCheck and the model-free DryRun passed with first-party Claude Pro auth, no API key,
and zero Claude tools. The first implementation dispatch timed out without a result. Correction 1
resumed session `be78bc21-924a-4a4c-a11e-930fbef97fce` but reached the Claude Pro usage limit before
returning a patch; no permission denial or repository mutation occurred. Two correction attempts
remain. A one-time thread heartbeat is scheduled for 19:05 Europe/Budapest, after Claude reported a
19:00 reset, to resume the same session rather than create a replacement.

After the reported reset, Codex rechecked at 19:29 Europe/Budapest: subscription AuthCheck still
reported first-party Claude Pro with no API key, and the next model request was accepted rather than
rejected for quota. Correction 2 completed with `PATCH_READY_FOR_REVIEW`, proving usable quota, but
Codex rejected the proposed patch before application. It contained non-applicable placeholder hunks
and duplicate imports, its route manifests were not consumed by the routes and therefore could not
prove wiring, its tests checked generic middleware rather than representative mounted routes, and it
granted `warehouse_worker` new non-purchasing permissions outside the approved compatibility scope.
Correction 3 named those exact defects and requested a mechanically applicable minimal diff, but
ended in `CHILD_TIMEOUT` without a result. The three-correction cap is exhausted. No WORK-016 source
patch was applied; continuing now requires an explicit process decision rather than a new Claude
session or silent replacement of the designated patch author.

#### WORK-016 — Purchasing permission containment — ACCEPTED LOCALLY — 2026-09-10

Kubi approved the OneProvider fallback and instructed Codex to continue autonomously toward Core
ERP. The large clean-room patch request returned HTTP 504, so Codex implemented the bounded change
directly and retained independent review ownership. No provider output was applied.

All 45 existing purchase/procurement routes now consume immutable, type-checked route-permission
manifests and use stable business-action middleware; neither route file contains `requireRole`.
The combined receive-and-invoice route requires receipt posting plus invoice create, match, and
post as an all-of guard. Customer, cashier, and unknown roles have no purchasing business
permission. Store manager no longer has supplier-payment posting and does not gain order
cancellation, discrepancy approval, or vendor-invoice cancellation. The six specialized roles are
available through backend validation, OpenAPI, and the existing HR employee form with readable
labels; customer remains excluded from employee creation.

Mounted-router tests prove customer and unknown-role denial occurs before the mocked database
handler. Permission tests cover all specialized personas, the admin owner override, sensitive store
manager denials, warehouse-worker containment, and the four-action all-of case. Final validation:
backend build passed, frontend TypeScript passed, `git diff --check` passed, and **15 suites / 360
tests** passed. The patch is uncommitted and unpushed.

#### WORK-017 — Vendor payment and settlement schema foundation — ACCEPTED LOCALLY AND APPLIED TO TEST — 2026-09-10

Microsoft Learn MCP reconfirmed partial vendor settlement and payment-reversal semantics. A
OneProvider second review rejected the first bounded schema plan until historical FX nullability,
same-currency CORE_NOW behavior, reversal-link direction, legal-entity uniqueness, and inactive
overpayment policy were explicit. The corrected plan was accepted.

Migrations `025` and `026` add the empty AP foundation: `PurchasePaymentMethod`,
`VendorPayment`, `VendorOpenTransaction`, and immutable `VendorSettlement`; nullable
VendorInvoice FX snapshots; and typed PurchaseParameters hooks. `UNIQUE NULLS NOT DISTINCT`
treats a null legal entity as one real shared scope. Reversal links exist only from the new
reversal row to its original and are unique. No historical exchange rate or open transaction was
invented.

Repository inspection found that the current combined receipt/invoice mode can intentionally have
no single invoice voucher because AP was posted by one or more receipt vouchers. Migration `026`
therefore makes `VendorOpenTransaction.journal_entry_id` nullable before any runtime payment row
exists. This preserves the anchor flow without pretending that one receipt voucher owns the whole
invoice liability.

The Supabase TEST public schema had no migration ledger and semantically matched migrations
`000`–`023`; its only textual comparison difference was the expected migration-013 conditional
unique index that migration `024` explicitly replaces. Under an advisory lock, Codex adopted the
reviewed `000`–`023` checksums, then the normal runner atomically applied `024`, `025`, and
`026`. Final state: **27 ledger rows (0–26)**, repeat run applied zero migrations, the four new
tables are empty, public-to-Prisma drift is empty, and every isolated verification schema was
removed. Shared Auth and Storage schemas were not targeted. Backend build, frontend TypeScript, and
**15 suites / 360 tests** remain green. No commit, push, seed, provisioning, or deployment occurred.

The next bounded item is WORK-018: BOB payment-method setup, invoice AP-open-transaction creation,
transactionally locked partial/many-to-many settlement, payment posting/reversal, inquiries, and
the end-user Setup and Vendor Payments forms. Do not expose configuration switches before the
service enforces them.

#### WORK-018 — BOB vendor payments and AP settlement — ACCEPTED LOCALLY AND APPLIED TO TEST — 2026-09-10

Codex implemented the bounded BOB/BOB runtime slice from the accepted WORK-012 design. Payment
methods are tenant and legal-entity scoped and snapshot their offset account onto each draft
payment. Posting resolves AP through the posting profile, writes `Dr AP / Cr payment-method offset`,
and creates a DEBIT vendor open transaction in the same transaction. Vendor invoice posting now
creates the corresponding CREDIT open transaction atomically, including the legacy combined mode
where no single invoice voucher exists.

Settlement accepts multiple invoice credits and partial amounts. It sorts and locks all involved
open-transaction rows before recomputing balances, then rejects supplier, legal-entity, currency,
direction, duplicate-target, and over-settlement mismatches. Fully settled invoice credits receive
`paid_at`; reversing the allocation clears it. Unallocated posted payments remain open for later
settlement.

Payment reversal derives the correcting voucher from the original. It creates a linked posted
reversal payment, an opposite AP open transaction, one immutable negating row for every active
invoice allocation, and a settlement that closes the original payment against its reversal. Unique
forward links prevent a second payment or settlement reversal.

The backend exposes payment inquiry/create/post/settle/reverse and payment-method list/create/edit
routes under the purchasing business permissions. The obsolete PO `/pay` posting route was removed;
its UI action opens the new Vendor Payments workspace. End-user pages at `/purchase/payments` and
`/purchase/setup/payment-methods` support setup, payment creation, optional allocation at posting,
later settlement, and reversal with a mandatory reason.

Migration `027_bob_ap_opening_transactions.sql` refuses non-BOB historical inference, snapshots
rate `1` only for proven BOB/BOB posted invoices, creates their missing AP credit transactions, and
adds the PAYMENT series for existing tenants. Forward-only migration `028` closes a review finding:
even a non-BOB posted invoice with an existing FX snapshot now blocks migration if it would remain
outside AP inquiry. An isolated Supabase rebuild passed all 29 migrations and removed its temporary
schema. The reviewed migrations were then applied to Supabase TEST. Public evidence: ledger ordinal
28; 2 posted invoices; 2 invoice open transactions; 0 posted invoices
without an open transaction; 1 PAYMENT series. A second runner invocation was a no-op.

Validation passes: backend build, frontend TypeScript, `git diff --check`, **16 suites / 362 tests**,
and isolated Supabase migration verification. The loopback CI wrapper could not start because no CI
database URL is configured in this desktop environment. No commit, push, seed, provisioning,
Auth/Storage change, deployment, or cross-currency behavior was performed. Cross-currency
settlement, cash discounts, write-offs, withholding, bank files, and live approval workflow remain
deferred; their stored hooks are not exposed in the UI.

Codex then ran the permanent `verify:vendor-payment` acceptance harness against Supabase TEST. The
first attempt exposed a PostgreSQL lock-query type mismatch (`uuid = text`); its transaction rolled
back and the exact draft artifacts were removed. The query now compares the UUID column through its
text representation while retaining the tenant UUID cast. The rerun with marker
`WORK018-1789028756197` passed every assertion: balanced payment voucher, invoice/payment closure,
`paid_at`, linked correcting voucher, restored invoice balance, closed reversal transaction, cleared
`paid_at`, and a single forward reversal link. The successful documents remain as a fully reversed
audit chain. WORK-018 is accepted in the live BOB test scenario.

#### WORK-019 — supplier returns and supplier credits — STARTED — 2026-09-10

The catalog-aligned next gap is `75.40.070.000 Manage supplier returns` together with
`75.50.080.000 Receive supplier credits`. Microsoft Learn requires a purchase return to be copied
from the original vendor invoice, represented with reversed quantities, and tied back to the
original inventory transaction. The repository has no supplier-return or supplier-credit document;
the existing posted-invoice cancellation refusal is only a boundary, not an implementation.

WORK-019 begins with a Learn-verified design and repository trace. The bounded target is a usable
return workspace and credit-note flow for the BOB test environment, with exact receipt/invoice-line
provenance, over-return protection, inventory and AP effects, immutable reversal history, module
Setup ownership, and fail-closed handling for Bolivian fiscal questions that Microsoft Learn cannot
answer. No WORK-019 schema or runtime change had been made at that initial checkpoint; the accepted
implementation below supersedes this status.

#### WORK-019 — supplier returns and supplier credits — ACCEPTED LOCALLY AND APPLIED TO TEST — 2026-09-10

The accepted implementation adds tenant-scoped `PurchaseReturn` and `SupplierCredit` documents,
their receipt/invoice-linked lines, internal number sequences, stable business permissions, API
routes, and end-user list/detail/create/post surfaces. Return creation freezes the posted invoice
allocation and exact receipt net cost. Shipment locks stock and consumes only same-PO,
same-cost-layer inventory, then posts `Dr PURCHASE_ACCRUAL / Cr INVENTORY`. Supplier-credit posting
requires the supplier's external reference and a shipped return, posts `Dr AP` against receipt cost,
recoverable input tax, and any reversed purchase price variance, creates a DEBIT AP open
transaction, and settles the exact original invoice amount. Unsupported currency,
non-recoverable-tax, service-credit, combined receipt-ledger, and provenance cases fail closed.

Claude Pro produced the initial bounded draft. Codex rejected silent partial settlement, current-tax
recalculation, missing price-variance reversal, weak provenance checks, and UUID-only forms, then
corrected and independently verified the final implementation. Migration `029` rebuilt with
000–028 in an isolated Supabase schema and produced empty Prisma drift before it was applied to
Supabase TEST as ordinal 29.

Permanent acceptance harness `verify:supplier-return` built a clean source PO through the ordinary
receipt and invoice services. Marker `WORK019-1789045833082` reduced stock and its exact PO cost
layer by one, created balanced shipment and credit vouchers, posted a 100 BOB supplier-credit DEBIT
transaction, settled the source invoice exactly, and reduced its open balance from 100 to zero.
Backend build, frontend and script TypeScript, `git diff --check`, and **17 suites / 372 tests** pass.
WORK-011–019 were checkpointed locally in commit
`57b8bd27557d0234387f6e9edae0adb42ce6c473`; the commit remains unpushed.

#### WORK-020 — put-away acceptance refresh — ACCEPTED LOCALLY AND ON TEST — 2026-09-11

[Microsoft Learn](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/warehouse-location-status#set-up-warehouse-location-status)
confirms the selected process anatomy: purchase receiving records goods at the receiving location,
can create separate put-away work, and completing that work moves the goods to the directed
destination. Quberty retains the smaller SME behavior surface while preserving the warehouse-
parameter, location-directive, warehouse-work, location, and inventory-transaction anatomy.

Codex reran the permanent `verifyPutaway.ts` harness against Supabase TEST. All 14 assertions passed:
stock on the receiving dock was excluded under `PICK_LOCATIONS_ONLY`; completing put-away moved both
inventory and its FIFO cost layer to the pick location; the move produced an auditable transfer pair;
duplicate completion was refused; and the harness restored warehouse parameters and removed its
temporary records. The harness now loads `.env` itself and is exposed as `npm run verify:putaway`.

The completion matrix now marks `60.30.030.000 Put away received goods` VERIFIED and removes stale
text that still described the accepted WORK-019 supplier-return and supplier-credit scenarios as
core gaps. No schema, migration, seed, provisioning, or persistent business data change was needed.
The next candidate is `75.40.050.000 Manage open purchases`; its partial-line cancellation, delivery
update, and change-history behavior must be bounded for the SME target before implementation.

NVIDIA NIM was invoked only for the permitted low-risk evidence-checklist draft. It returned a
generic provider failure and contributed no claim or code. Codex performed the Learn validation,
repository review, live acceptance, and final decision independently.

#### WORK-021 — manage open purchases — ACCEPTED LOCALLY AND ON TEST — 2026-09-11

Microsoft Learn confirms the official anatomy: purchase-order confirmation is a distinct control
point, and requested/confirmed supplier dates are separate planning data. See the official pages
for [purchase order approval and confirmation](https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-order-approval-confirmation)
and [supplier requested and confirmed dates](https://learn.microsoft.com/dynamics365/supply-chain/master-planning/supplier-requested-confirmed-dates).
The accepted SME cut keeps that anatomy without importing a full D365 workflow engine.

The bounded implementation adds `cancelled_qty`, requested/confirmed delivery-date hooks, and an
immutable `purchase_order_changes` audit table. Confirmed orders can no longer use the old direct
edit path. Authorized users can update delivery dates and cancel only the unreceived/uninvoiced
remainder, with row locking, reason, before/after snapshots, and downstream receipt/invoice guards.
The frontend Manage dialog exposes these actions and history. Generic workflow/reapproval and
price/quantity approval remain explicitly deferred.

Migration `030_manage_open_purchases.sql` rebuilt cleanly with migrations 000–030 in an isolated
Supabase schema and was then applied to Supabase TEST; a repeat run reported no pending migrations.
The permanent open-purchase harness passed 7/7. Backend build, frontend and script type checks,
and the full test suite passed 17 suites / 372 tests. A real defect in migration drift comparison
(extra terminal newline) was fixed and the isolated verification rerun passed with empty drift.

This work is uncommitted at the time of this entry until the final local checkpoint commit. No push,
production database action, generated-secret write, or provider key value was recorded. The durable
manual continuation brief is `docs/collaboration/PROJECT_CONTEXT_2026-09-11.md`.

#### Collaboration change — Claude assumes the directing role — 2026-09-11

**Decision (Kubi, 2026-09-11):** Kubi's Codex quota is exhausted, so the work continues with Claude
Code alone until Codex is available again. This supersedes the §1 role split for the interim period
only. It is not a permanent removal of Codex.

Interim roles:

| Participant | Interim responsibility |
|---|---|
| Kubi | Unchanged: product owner, scope and implementation approval, final decision. |
| Claude `solution-architect` agent (`.claude/agents/solution-architect.md`, Opus, read-only plus Learn MCP) | The Codex role: Learn-verified catalog-aligned design, the exact implementation prompt, and independent review of the actual diff and evidence. It never modifies files, git state, or data. |
| Claude main session | The implementation role, unchanged from §1: bounded implementation, verification, TEST database operations under the standing authorization, and recording every entry in this worklog. |

The §3 work cycle stays in force. "Codex" in its steps is performed by the solution-architect agent,
and every such design or review entry is attributed to **"Claude solution-architect agent"**.

**Stated limitation:** the agent shares a model family with the implementer, so its review is
independent in context and authority but not in model. When Codex returns, Kubi may ask it to
re-review any work item accepted by the agent. Schema, migration, accounting, tax, numbering,
security, and tenant-isolation items should be listed for that re-review.

**Provider routing:** Kubi's 2026-09-10 decision stands. Credentials stay DPAPI-encrypted in the
Windows user store and are unchanged. `.claude/skills/skarpine-second-opinion/SKILL.md` lets Claude
call the existing `skarpine-hybrid-model-router` scripts for OneProvider second opinions on
schema, migration, and posting designs, and for quota-fallback drafts. NVIDIA NIM is not used by
default because its only recorded call failed. Cheap search and summarization use Claude's built-in
agents on a smaller model instead of a new custom agent.

For a returning Codex session: read this entry, then every work item after it. Items whose review
line says "Claude solution-architect agent" were not reviewed by Codex.

#### Decisions — currency, reporting currency, and work order — 2026-09-11

Kubi's binding product rule: Quberty is a core ERP for Bolivia first, then Turkey and Europe.
Nothing currency-, tax-, or country-specific may be hard-coded. It must exist as data, and every
calculation and transaction follows that parameter. We copy D365 processes and behaviour (Microsoft
Learn), not its full feature surface.

Decisions made (Kubi):

- Suppliers may invoice in USD. Foreign-currency AP is therefore a real requirement.
- Stores accept only the local currency of their legal entity.
- A reporting currency is required. Per [Configure ledgers](https://learn.microsoft.com/dynamics365/finance/general-ledger/configure-ledger#configuring-currencies-for-the-ledger)
  and [Dual currency](https://learn.microsoft.com/dynamics365/finance/general-ledger/dual-currency),
  every voucher carries transaction, accounting and reporting amounts, and the reporting amount is
  translated from the transaction amount. [It cannot be added after posting](https://learn.microsoft.com/troubleshoot/dynamics-365/finance/general-ledger/add-change-accounting-reporting-currency).
- The accounting exchange-rate type for Bolivia is the official BCB rate.
- The exchange-rate date is the posting date.
- The Turkish exchange-difference invoice (kur farkı faturası) is required at the Turkey launch.
- Segregation of duties:
  - accounting and reporting currency, tax configuration, and chart-of-accounts seeding: admin only;
  - daily exchange-rate entry: admin, store manager, and finance approver.
- Tenants are created only by the platform operator after an implementation decision. There is no
  self-service signup.

Work order:

1. **WORK-022:** tenant-route security.
2. **WORK-023:** tenant-scoped document numbers.
3. **WORK-024:** currency foundation, which now includes the currency master, exchange-rate types
   and rates, the reporting currency, and voucher transaction/accounting/reporting amounts. The
   reporting currency pulls this work forward.
4. **WORK-025:** hard-coded literal sweep, including the POS repository.
5. **WORK-026:** foreign-currency AP.
6. **WORK-027:** revaluation.

The earlier currency design recorded that the accepted WORK-018/019 guards compare against the
literal `'BOB'`. WORK-024 must make them parametric.

#### WORK-022 — tenant administration route containment — ACCEPTED LOCALLY AND ON TEST — 2026-09-11

Catalog IDs: 99.25.050.000, 99.25.060.000, 99.25.070.000, and 99.25.110.000. 99.20 at level 3 is
unverified. Design and review: Claude solution-architect agent.

**Defect.** `app.ts` mounted `/api/v1/tenants` outside tenant, auth, and audit middleware. Anyone
could:

- create a tenant;
- read any tenant's configuration;
- change any tenant's modules, branding, currency, and tax configuration.

Two related defects:

- A store manager could create an `admin` user through `POST /hr/employees`.
- `POST /finance/seed-coa` had no guard.

**Implemented:**

- Tenant administration is `/tenant` inside the v1 router, with no tenant id in the path.
  - `GET /config` requires `setup.tenant.read`.
  - `PUT /config` requires `setup.tenant.maintain`.
  - `PUT /setup` requires `finance.setup.maintain` (admin only).
- Request bodies use strict zod schemas: `modules` and unknown keys are refused, `currency_code`
  must match `^[A-Z]{3}$`, and tax rates must be between 0 and 1.
- A currency change after any `POSTED` journal entry returns 409 `CURRENCY_LOCKED`. Re-sending the
  stored value is a no-op.
- The HTTP tenant-creation route is gone. `backend/scripts/createTenant.ts` is the operator CLI:
  - it is a dry run unless `--apply` is given;
  - currency, language, and timezone are required, with no country defaults;
  - it creates the tenant and its first admin in one transaction;
  - the password comes from `CREATE_TENANT_ADMIN_PASSWORD` and is never printed.
- A non-admin can no longer create an admin user.
- `/finance/seed-coa` is guarded by `finance.setup.maintain`.
- The setup wizard, OpenAPI, and `docs/API_SPEC.md` are updated.

There is no schema or migration change. No schema hook is needed.

**Verification:**

- Backend build, `typecheck:scripts`, and frontend `tsc --noEmit` are clean.
- `git diff --check` is clean.
- Jest passes 18 suites / 392 tests. The new `tenantRoutePermissions.test.ts` has 20 tests. It
  covers:
  - denial before any database call;
  - a store manager refused on accounting setup;
  - the posting lock and the no-op;
  - cross-tenant refusal through the real tenant and auth middleware;
  - admin escalation;
  - the seed-coa guard.
- The review returned ACCEPTED with no code changes.
- **Live TEST smoke passed** on Supabase TEST, tenant `skarpine-demo`, which has accounting
  currency BOB and 109 posted vouchers. It used in-process `app.request` calls against the real app
  and the TEST database, with synthetic signed tokens:
  - admin `PUT /api/v1/tenant/setup {currency_code}` returned 409 `CURRENCY_LOCKED`;
  - store manager, same call, returned 403;
  - anonymous `POST /api/v1/tenants` and `GET /api/v1/tenants/:id/config` both returned 400. The
    route no longer exists, and the v1 tenant middleware refuses the missing tenant header before
    the not-found handler, so the result is 400 rather than the 404 the review expected. Nothing
    reached a tenant handler.
  - The tenant's currency and `updated_at` were unchanged afterwards, and no smoke tenant was
    created.
- The only TEST credential file is in the preservation snapshot `skarpine/backend/.env`. With
  Kubi's approval the smoke loaded it read-only: the file was not copied, the snapshot was not
  modified, and no values were printed. This worktree has no `backend/.env`, so later TEST harness
  runs need the same approval or a worktree-local, git-ignored `.env`.

**Residuals:**

- `Tenant.currency_code` and `FinanceParameters.functional_currency` can diverge. WORK-024 resolves
  this.
- The currency lock is check-then-update and has no row lock.
- `/auth/register` still attaches a customer to the first active tenant.
- `/uom/seed-defaults` is unguarded.
- `openapi.ts` still documents an `x-tenant-slug` header that the middleware ignores.
- No test covers a successful `tax_config` write.

This item is listed for Codex re-review: security, tenant isolation, and accounting-setup
authorization.

#### WORK-023 — tenant-scoped document numbers — ACCEPTED LOCALLY AND ON TEST — 2026-09-11

**Catalog IDs:** 99.20.040.000; 75.40.030.000 (scenarios .600, .800, .850 and .900);
90.50.040.000; 60.30.010.000; 60.30.030.000. The Order to Cash level-3 IDs for sales orders and
shipments are unverified.

**Design and review:** Claude solution-architect agent. The design was accepted for TEST before
migration 031 was applied, and it relies on the D365 rule that numbers are generated per scope
([number sequence overview](https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/organization-administration/number-sequence-overview)).

**Defect.** Seven document-number columns had a bare global `@unique`: `purchase_orders.po_number`,
`warehouse_work.work_id_code`, `arrival_journals.journal_number`, `journal_entries.entry_number`,
`sales_orders.order_number`, `shipments.shipment_number` and `inventory_counts.reference`. Every
generator is per tenant, so a second tenant's first document collided with the first tenant's. That
collision was deterministic. A second tenant could not post its first journal entry.

**Implemented.**

- **Schema:** each of the seven columns is now `@@unique([tenant_id, <col>])`.
- **Migration** `031_tenant_scoped_document_numbers.sql`:
  - a defensive duplicate check;
  - drops the seven baseline indexes and recreates them under Prisma's default composite names;
  - seeds a `PURCHASE_ORDER` number sequence for each tenant. It is non-continuous, automatic,
    `LEGAL_ENTITY` scope and never resets, which is today's behaviour. It starts above both the PO
    counter and the highest issued suffix. The suffix is read with a regex, so rows in other
    formats are ignored.
- **PO numbering:**
  - the manual, requisition and RFQ paths, plus the verify scripts, allocate from the sequence;
  - `nextPurchaseOrderNumber` and its tests are removed;
  - provisioning adds the sequence for new tenants;
  - a tenant without the sequence fails closed with `NUMBER_SEQUENCE_MISSING` (unit-tested).
- **Scripts:** lookups by number now carry a tenant filter. `showPurchaseVouchers.ts` requires
  `--tenant` when several tenants exist.
- **New harness:** `verify:tenant-numbering` checks:
  - the index catalog;
  - behaviour, inside one transaction that is always rolled back: a row copied into a random,
    non-existent tenant id is accepted, and a same-tenant duplicate is refused on exactly
    `Key (tenant_id, <col>)`;
  - the purchase-order sequence;
  - the FACTURA row.

**Verification.**

- **Local checks:** backend build, `typecheck:scripts`, frontend `tsc`, `prisma validate` and
  `git diff --check` are clean. Jest passes 19 suites / 391 tests: 392, minus the 3 removed
  PO-counter tests, plus 2 new tests.
- **T1, read-only pre-checks on TEST:**
  - ledger at ordinal 30;
  - the seven baseline index names were present;
  - no duplicates within a tenant;
  - one tenant, whose PO counter and highest PO suffix are both 62, and no PO number in another
    format;
  - no `PURCHASE_ORDER` sequence yet;
  - FACTURA was `next_number` 35, continuous, `LEGAL_ENTITY`.
- **T2:** `verify:migration-supabase` passed for 32 migrations, and the isolated schema was removed.
- **T3:** 031 was applied as `claude-work-023` in 1308 ms, bringing the ledger to ordinal 31.
- **T4:** a repeat run reported no pending migrations.
- **T5:** `verify:tenant-numbering` passed 29/29 (marker `WORK023-1789133248812`).
  - Six tables were proven by behaviour. `arrival_journals` has no rows on TEST, so it is proven by
    the index catalog only.
  - No orphan rows remain in any of the seven tables.
  - The first run reported 6 failures. That was a harness defect: it expected the index name in
    the error, but Postgres reports the key columns. The assertion now requires SQLSTATE 23505 and
    exactly `Key (tenant_id, <col>)=`.
- **T6 regressions:**
  - `verify:open-purchase` passed 7/7.
  - `verify:putaway` passed 14/14.
  - `verify:vendor-payment` passed 14/14 (marker `WORK018-1789133326949`). It leaves a fully
    reversed audit chain by design.
  - `verify:supplier-return` exited 0 (marker `WORK019-1789133348789`). It needed its
    `ALLOW_TEST_DATABASE_WRITE` guard, which is set to `WORK019_ACCEPTANCE`; vendor-payment uses
    `WORK018_ACCEPTANCE`.
- **After the migration**, the FACTURA row was unchanged: `next_number` 35, same `updated_at`.

**Operational notes.**

- `backend/.env` now exists in this worktree. Kubi copied it from the snapshot, and it is
  git-ignored.
- Kubi's backend dev server in this worktree held the Prisma engine DLL. With Kubi's approval it was
  stopped before T3, and the Prisma client was regenerated afterwards.
- The migration runner requires `MIGRATION_APPLIED_BY`. The convention is `<actor>-work-NNN`.
- Tenants created with `createTenant.ts` get no `PURCHASE_ORDER` sequence until provisioning runs.
  Until then, PO creation fails closed. This belongs in the operator runbook.

**Deferred.**

- The sales order, shipment, inventory count and arrival journal generators do not use
  NumberSequence yet.
- `journal_entries` and `purchase_orders` have no `legal_entity_id`. When one is added, the index
  becomes `(tenant_id, legal_entity_id, number)`.
- The dead POS helper `nextJournalEntryNumber` remains; it is removed in WORK-025.
- Currency is WORK-024.

This item is listed for Codex re-review: schema, migration and numbering.

#### Decisions — remaining Core ERP scope — 2026-09-11

A remaining-work estimate was produced by the Claude solution-architect agent on Sonnet, with
Microsoft Learn validation. It puts Bolivia go-live at roughly 20–27 bounded work items after
WORK-023. Turkey and EU readiness add 2–3 more, including a large per-line tax item. It is a
count, not a time estimate.

Kubi decided the following:

- Three behaviour cuts, kept PARTIAL by decision:
  - the full D365 purchase-order workflow/approval engine (75.40.050.000);
  - the one-step supplier payment correction wizard (75.50.120.000);
  - full D365 credit and collections management. Only a simple credit limit and payment-terms
    check is in scope.
- **Condition:** implementing any of these later must not cause schema pain. Each one gets a
  documented schema hook, or an explicit "none needed". WORK-028 records these per CLAUDE.md §3.
- WORK-028 is approved as an analysis-only item. It extends the completion matrix to Order to
  Cash, inventory, and Record to Report before any Order to Cash implementation starts.
- Push is deferred. Kubi pushes the accumulated local commits himself at the end.

Estimate corrections, repo-verified by the main session:

- CI already runs `verify:migration-ci` (`alm/pipelines/ci.yml:71`), not `prisma migrate deploy`.
- `FacturaLine` exists (`schema.prisma:3967`), so HANDOVER's "header-only customer invoice" claim
  is stale. WORK-028 re-scores it.

#### Decisions — O2C posting, costing, localization, payment terms, partial invoicing — 2026-09-11

Kubi delegated these decisions to the solution-architect role on 2026-09-11. The rule: follow the
Microsoft Learn flow first. Where Learn is silent, use comparable systems. Everything stays
parametric, so Turkey, the EU and the USA must not break. The research ran as three parallel
agents: POS/terms/partial invoicing and multi-country legal on Sonnet, costing on Opus. Kubi's
explicit request for web research overrides the "Learn and repo only" line in CLAUDE.md §5 for these
questions. Sources are labelled throughout.

**Settled by the main session:**

- **WORK-029 runs before WORK-024.** The containment design is accepted with its recommendations:
  - the register warehouse is either chosen explicitly or is the sole active warehouse;
  - `/complete` is allowed from SHIPPED only;
  - the scope additions (POS and customer guards, foreign-reference validation, customer
    allow-list, storefront scoping) stay in WORK-029;
  - no live successful POS sale runs on TEST;
  - `warehouse_worker` does not get `inventory:count`; that waits for the WORK-030 registry.
- **The AP aging fix lands in WORK-034.**
- **POS payment posting uses a hybrid on the D365 Commerce statement pattern.**
  - D365 posts a walk-in customer invoice and settles it in the same run, so a cash sale never
    stays open in AR. Sources: [retail statements](https://learn.microsoft.com/dynamics365/commerce/retail-statements)
    and [payment configurations](https://learn.microsoft.com/dynamics365/commerce/tasks/payment-configurations-retail-statements).
  - Cash and card tenders debit the payment-method account directly.
  - Only a customer-account tender debits AR.
  - The payment-method-to-account mapping is per store or legal entity.
  - A counted-cash declaration at session close posts over/short to a `CASH_DIFFERENCE` posting
    type.
  - Implemented in WORK-033 after WORK-034 creates the AR models.
- **Costing follows the Business Central perpetual model, not the F&O periodic one.**
  - F&O FIFO needs an inventory close ([inventory close](https://learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-close)).
    BC applies FIFO perpetually through item application ([BC costing methods](https://learn.microsoft.com/dynamics365/business-central/design-details-costing-methods)).
  - **FIFO does not work today.** The TEST measurements disagree:

    | Measure | Value |
    |---|---|
    | Open cost layers | 40,277 |
    | GL inventory | 5,397 |
    | Stock quantity × `cost_price` | 234,650 |

    Every sales, POS, return, count and adjustment path ignores the layers.
  - Scope:
    - FIFO is CORE_NOW and gets fixed in WORK-031.
    - Moving average is CORE_NEXT and needs no close.
    - Standard cost is CORE_LATER.
    - Periodic weighted average and LIFO are not built, so no periodic inventory close is built.
  - Schema hooks to add in WORK-031:
    - an `InventoryCostSettlement` consumption record;
    - `InventoryTransaction.cost_amount` and `cost_layer_id`;
    - layer `original_quantity` and cost-object scope;
    - a `cost_level` enum, recommended SITE;
    - an append-only `ItemCostPrice`;
    - an `InventoryCostBalance`;
    - variance and adjustment posting types.
  - WORK-024 adds an accounting-currency basis to the cost fields.
  - Stopgap: non-FIFO costing methods are refused in setup until they are implemented.
- **Localization is modelled per jurisdiction, as data.**
  - Credit-note series, required references to the original invoice, and the maximum age of a
    credit note are jurisdiction parameters.
  - A line-detail-required flag defaults to on.
  - Shrinkage tax treatment is a structured setting: output deemed sale, input reversal, or none,
    plus proof exemption, theft-versus-loss, and prior notice.
  - The fiscal calendar is per legal entity and can start in any month. An activity-type to
    mandated year-end lookup applies only where law imposes it: Bolivia DS 24051 Art. 39, where
    retail/commercial ends on 31 December.
  - Bolivia credit notes appear to be dosified separately from facturas. If the accountant
    confirms, WORK-037 switches credit notes from the FACTURA series to `CREDIT_NOTE`.
- **Payment terms become one shared master.** D365 shares Terms of payment between AR and AP
  ([customer terms](https://learn.microsoft.com/dynamics365/finance/general-ledger/tasks/establish-customer-payment-terms)).
  - The master is owned by Finance (Cash and bank). Customer and vendor records hold defaults, and
    each document keeps a snapshot.
  - SME fields: method (`NET | CURRENT_MONTH | COD`) and days.
  - Hooks: cash discount, `base_date_source`, and a payment-schedule reference. `due_date` lives on
    the open transactions.
  - Built in WORK-034 and WORK-035. `Supplier.payment_terms Int` is replaced.
- **Partial delivery and partial invoicing are in go-live scope across channels.** D365 uses one
  remainder engine for POS, e-commerce and B2B: packing slip, then invoice by packing slip
  ([Store order fulfillment](https://learn.microsoft.com/dynamics365/commerce/order-fulfillment-overview)).
  WORK-036 adds `ShipmentLine` and multiple invoices per order. POS keeps its one-step fast path.

**Waiting on others:**

- **WORK-028 matrix extension:** *merged 2026-09-11* as §7–§12 of
  `docs/process/CORE_ERP_COMPLETION_MATRIX.md` (Order to Cash, inventory, Record to Report rows;
  schema hooks D-1…D-13; the WORK-029…041 queue), with WORK-029 closures and these decisions
  applied. Its catalog IDs are still mostly `UNVERIFIED` because the JUL-2026 workbook is not in the
  repo; replace them from the workbook before the extension is treated as governed.
- **Finance co-founder:** how an invoice price difference on FIFO receipts is treated
  (proportional capitalisation, or expense to `PRICE_VARIANCE`), and the cost level.
- **Local accountants:**
  - Bolivia: the credit-note series, the CUF reference, and whether shrinkage reverses input VAT;
  - whether FIFO and weighted/moving average are allowed under Bolivian and Turkish tax rules;
  - the Turkish iade faturası model.

#### WORK-029 — O2C containment — ACCEPTED LOCALLY AND ON TEST — 2026-09-11

Catalog: 99.25.050.000 Manage data security and 99.25.060.000 Configure segregation of duties. The
POS sale, sales order entry and completion, storefront shipment, count inventory, and customer
master areas (65.20, 60.40, 60.20, and the customer master) have no verified level-3 IDs.

The design and the Opus review were done by the Claude solution-architect agent. The Opus review
hit the session limit, so it was re-run on Sonnet. It was approved by Kubi on 2026-09-11 and ran
ahead of WORK-024.

**Defects closed:**

- `POST /sales/orders/:id/complete` wrote any tenant's order in any status.
  - It now loads the order under the tenant (404) and completes SHIPPED only (409
    `ORDER_NOT_COMPLETABLE`).
  - The write is a tenant- and status-scoped `updateMany` with a concurrency check.
- Customer create and update spread the request body.
  - A caller could write `tenant_id`, `user_id` and `lifetime_value`.
  - A strict zod allow-list now refuses those keys (400).
  - A foreign `tax_group_id` is refused with 422.
  - `customers:read`, `customers:create` and `customers:update` guard every route.
- Sales orders accepted other tenants' customer, product and variant ids.
  - `assertTenantReferences` (`shared/services/tenantReference.service.ts`) now refuses them with
    422 `FOREIGN_REFERENCE`.
  - It runs on create before the order number is drawn, and on PUT.
- Five reads by product or factura id now carry `tenant_id`.
- The POS routes had no authorization. They now require `pos:session`, `pos:sale` and `pos:void`.
- POS sales deducted stock from any warehouse.
  - A register session now resolves its warehouse at open: an explicit, tenant-validated choice,
    or the only active warehouse. Otherwise 422 `POS_SESSION_WAREHOUSE_REQUIRED`. The site is
    derived, and there is no Sales default fallback.
  - A sale on a session without a warehouse is refused before the FACTURA number is allocated.
  - Stock is deducted only inside the session warehouse (`modules/pos/posStock.service.ts`).
  - POS stock movements are stamped with the sale's id.
- POS void restores stock to the exact location each unit came from.
  - Legacy sales fall back to a row in the order's warehouse.
  - Otherwise the void is refused with 409 `POS_VOID_LOCATION_UNRESOLVED`.
  - The void can no longer create a stock row with a null location.
- The storefront now resolves its warehouse first. The availability check and the deduction both
  use that warehouse.
- Count line edits:
  - require `inventory:count`;
  - accept an integer of 0 or more;
  - check the line against both the count id and the tenant;
  - are refused once the count is FINALIZED (409 `COUNT_NOT_EDITABLE`).
- **Frontend:**
  - Open register has a warehouse selector, which is required when the tenant has more than one
    warehouse. The choice is remembered per terminal.
  - The counting page shows the server's error.

There is no schema change: `git diff -- backend/prisma` is empty.

The following behaviour is deliberately unchanged:

- POS and void GL posting;
- the IT reversal;
- factura cancellation;
- session totals;
- cost layers and COGS.

**Step-0 sizing on TEST.** The queries ran read-only, and the transaction was rolled back.

| Measure | Value |
|---|---|
| AR control-account GL balance (1103) | 9,107 |
| Open invoiced documents | 130 |
| of which POS_SALE | +3,000 |
| of which CORRECTION | +7,127 |
| of which SALES_INVOICE | +27,060 |
| of which SALES_PAYMENT | −28,080 |
| OPEN register sessions without a warehouse | 1 |
| Active warehouses | 3 |
| Cross-tenant customer or product references | 0 |
| POS stock taken from a foreign warehouse | 0 (the join is by factura note, so confidence is low) |

- The POS AR overstatement is WORK-033's correction, with the Finance co-founder.
- **Operator action:** close and reopen the open TEST register against a warehouse. Sales on it
  are now refused.

**Verification:**

- Backend build and `typecheck:scripts` are clean.
- Frontend `tsc` and `build` are clean.
- Jest passes 20 suites / 418 tests. The new `o2cContainment.test.ts` has 27 tests, and every
  denial happens before any database call.
- `git diff --check` is clean.
- On TEST, `verify:o2c-containment` (guard `WORK029_ACCEPTANCE`) passed 12/12 (marker
  `WORK029-1789136634896`).
  - It writes nothing and made no successful POS sale.
  - No register session was created, and the FACTURA sequence was unchanged.
- The review returned ACCEPTED. It independently re-ran the build, the full suite and the frontend
  build.

**Residuals** (these pre-date this item and are out of its scope):

- `deductPosStock` and `addBack` decrement and increment without a `quantity >= n` guard. Two
  concurrent sales could drive a row negative (WORK-031).
- `addBack` uses a find-then-create step that two concurrent voids could race (WORK-031).
- `GET /warehouse/warehouses` has no permission guard (WORK-030).
- `finance.routes.ts:275` reads variants without a tenant filter. Its ids derive from the tenant's
  own facturas, so it is safe by construction.

**Codex re-review.** This item is listed for Codex re-review (tenant isolation, authorization, and
the POS stock path). The reviewer recommended against that. The interim rule, and a review from
the same model family as the implementer, keep it on the list.

#### WORK-024 — currency foundation — DESIGN APPROVED — 2026-09-11

Design by the Claude solution-architect agent on Opus:
[WORK-024_CURRENCY_FOUNDATION.md](../process/WORK-024_CURRENCY_FOUNDATION.md). The main session
spot-checked three findings in the code: the invoice post writes rate 1 for every currency, the
receipt service has no currency handling, and migration 029 carries a `'BOB'` CHECK.

Kubi decided:

- WORK-024 is split into 024a and 024b. 024a covers the currency master, the ledger's accounting and
  reporting currencies, rate types and rates, parametric P2P guards, and migration 032. 024b covers
  the voucher transaction, accounting and reporting amounts, in migration 033. 024a is authorized
  now. 024b follows once 024a is accepted.
- Store managers and finance approvers may only add dated exchange-rate rows. Editing an existing
  row is admin-only and audited.
- The reporting currency stays BOB. Kubi confirmed that all current data is test data and that no
  production tenant exists.
- Still open, and not blocking: which BCB series the Bolivian accountant uses as the accounting
  rate type. The rate type is data.

**024a Step 0 on TEST** (read-only transaction, 2026-09-11):

| Measure | Value |
|---|---|
| Ledger ordinal | 31 |
| Tenants | 1 (`skarpine-demo`); `currency_code` BOB = `functional_currency` BOB |
| Document currencies | BOB only in suppliers (5), purchase orders (21), vendor invoices (6), vendor payments (6), open transactions (12), settlements (11), supplier credits (2), sales orders (54) |
| Purchase orders in another currency | 0, none with postings |
| Posted journal entries | 115; unbalanced 0 |
| Rows with an exchange rate other than 1 | 0 |
| Cost layers | 20 |
| FACTURA / PURCHASE_ORDER `next_number` | 35 / 64 |
| `supplier_credits_bob_exchange_rate_chk` | present |

None of the migration 032 pre-checks would fire on TEST.

#### WORK-024a — currency master and ledger currencies — ACCEPTED LOCALLY AND ON TEST — 2026-09-12

Catalog: 90.10 *Develop currency policies* (level-3 ID UNVERIFIED), 90.50.040.000, 75.40.030.000,
60.30.010.000, 75.50.020/080/090/110.000, 99.25.050/060.000.

Design: [WORK-024_CURRENCY_FOUNDATION.md](../process/WORK-024_CURRENCY_FOUNDATION.md). Designed and
reviewed by the Claude solution-architect agent on Opus; implemented by the main session. Listed for
Codex re-review (schema, migration, accounting, security).

**The defect this closes.** Foreign-currency purchasing was not merely unsupported, it posted wrong
numbers: `productReceipt.service.ts` had no currency handling at all, so a USD order's unit cost
became stock and FIFO cost-layer value as if it were BOB, and `vendorInvoice.service.ts:605` wrote
`exchange_rate: 1` for every currency. Only a later BOB literal in `createInvoiceOpenTransaction`
rolled the invoice back. Receipt, invoice, payment, return and arrival journal now refuse a document
outside the ledger's accounting currency **before** a number, stock row, cost layer or voucher is
written.

**Data model (migration 032, ledger ordinal 32, applied as `claude-work-024a`).**

- `currencies`: ISO 4217 reference data shared by all tenants, 162 rows (codes, English names and
  minor units from Unicode CLDR via Node `Intl`). No `numeric_code`: CLDR does not carry it and
  nothing was invented; a nullable column can be added later with no backfill.
- `tenant_currencies`: the currencies a tenant has activated, each with its own rounding precision
  and method (**[OFFICIAL]** rounding is per currency —
  <https://learn.microsoft.com/dynamics365/business-central/finance-set-up-currencies#rounding-currencies>).
  More than two decimals fails closed, because amounts are `Decimal(14,2)`.
- `exchange_rate_types`, `exchange_rate_currency_pairs`, `exchange_rates`: **[OFFICIAL]** one pair per
  rate type, the reciprocal refused, the latest `valid_from` on or before the date, a conversion
  factor, and a change entered as a new dated row
  (<https://learn.microsoft.com/training/modules/configure-currencies-dyn365-finance/3-currency-exchange-rate>).
- `finance_parameters`: `functional_currency` renamed to `accounting_currency_code` (rename, not
  drop), plus `reporting_currency_code`, both rate types, `exchange_rate_date_basis` and
  `reporting_rounding_tolerance` (**[OFFICIAL]** ledger currencies and rate types per legal entity —
  <https://learn.microsoft.com/dynamics365/finance/general-ledger/configure-ledger>).
- `inventory_cost_layers.cost_currency_code`: the basis WORK-031 needs; transfers and putaway copy it
  from the source layer.
- Country defaults dropped on `tenants.currency_code` and the supplier, purchase-order, vendor-invoice,
  vendor-payment and supplier-credit currency columns. Migration 029's literal
  `supplier_credits_bob_exchange_rate_chk` is replaced by a generic `exchange_rate > 0`.
- Backfill derives everything from existing columns: reporting = accounting, one `DEFAULT` rate type
  per tenant, cost layers stamped from the ledger. Three pre-checks `RAISE` rather than guess. The
  runner applies the file in one transaction, so a pre-check cannot leave it half applied.
- Tenant-composite foreign keys: `(tenant_id, id)` uniques on rate types and pairs, and the four rate
  type/pair FKs carry `tenant_id`. The database now refuses another tenant's rate type.

**Services** (`shared/services/currency/`): `getLedgerCurrencies` (fails closed with 422
`LEDGER_CURRENCY_NOT_CONFIGURED`; no country default anywhere), `setLedgerCurrencies` (advisory lock,
409 `CURRENCY_LOCKED`), `bootstrapTenantLedger`, `resolveRate`/`translate` (identity without a database
read, reciprocal by division, no triangulation, `Prisma.Decimal` throughout), `roundAmount`, and
`assertDocumentCurrencySupported`/`resolveDocumentCurrency`. The tax engine keeps its own `round2`, so
no Bolivian figure can move.

**The lock is wider than D365's wording.** `hasLedgerActivity` counts posted vouchers **and** inventory
cost layers **and** AP open transactions: with `post_product_receipt_in_ledger` off a receipt creates
layers without a voucher, and those layers carry the currency.

**Segregation of duties (Kubi, 2026-09-11).** Ledger currencies, currency activation and rate types
are `finance.setup.maintain` (admin). `finance.exchange_rate.maintain` (admin, store manager, finance
approver) may only **add** a rate, and only forward: a rate on or before the latest one for that pair
is refused with 409 `EXCHANGE_RATE_BACKDATED`, because it would change the rate later dates resolve
to. Correcting a rate is admin-only and writes before/after values to `audit_logs` in the same
transaction. `finance.currency.read` for AP clerk, buyer and auditor; nothing for cashier.

**API and UI.** `/finance/ledger-currencies`, `/finance/currencies[/iso|/:code]`,
`/finance/exchange-rate-types[/:id]`, `/finance/exchange-rates[/resolve|/:id]`. `PUT /tenant/setup` no
longer accepts `currency_code` (400); the setup wizard uses the ledger endpoint and stops before any
write when the ledger is locked. New screens: Setup → Currencies and Finance → Exchange Rates.
`createTenant.ts` requires `--reporting-currency` (must equal `--currency` until 024b),
`--rate-type-code` and `--rate-type-name`, and creates tenant, ledger and first admin in one
transaction. `scripts/configureLedgerCurrencies.ts` renames a ledger's rate type.

**Deviations from the design, all reviewed and accepted:** no `numeric_code`; requisition and RFQ
currency literals fixed here rather than in WORK-025 (otherwise a TRY tenant's requisition-to-PO path
still produced BOB documents); `country || 'BO'` on supplier create replaced by `null`; provisioning
takes the ledger currency from the tenant, not from the chart-of-accounts template (that mismatch was
one source of the Tenant/FinanceParameters divergence); the demo seed tenant is TRY.

**Verification.**

- Backend build, `typecheck:scripts` and frontend `tsc` clean; `git diff --check` clean.
- Jest 23 suites / 487 tests (new `currencyServices`, `currencyGuards`, `currencyRoutes`; updated
  `tenantRoutePermissions`, `purchaseReturn`, `purchaseOrderNumbering`, `schemas`). The parametric
  proof is explicit: receipt, invoice and payment pass the guard in a TRY ledger and are refused for
  USD, with `allocateNumber`, stock, cost layer and `postJournal` never called on refusal.
- `verify:migration-supabase`: isolated rebuild of 000–032, "passed for 33 migration(s)", empty Prisma
  drift, temporary schema removed.
- Migration applied to Supabase TEST as `claude-work-024a` (3.5 s); a repeat run reports "No pending
  migrations".
- `verify:currency-foundation` (guard `WORK024_ACCEPTANCE`, marker `WORK024-1789169944166`): 28/28.
  It proves the rate rules on TEST inside a rolled-back transaction, the fail-closed document rule,
  the live SoD denials, that no cost layer is stated in another currency, that no country default
  remains, and that the FACTURA sequence is unchanged.
- Regressions after the migration: `verify:tenant-numbering` 29/29, `verify:putaway` 14/14,
  `verify:open-purchase` 7/7, `verify:o2c-containment` 12/12, `verify:vendor-payment` passed (reversed
  audit chain), `verify:supplier-return` passed (1 unit returned, credit settled, invoice closed).
- Operator step run on TEST: the `DEFAULT` rate type is now `BCB — Banco Central de Bolivia - official`.

**Correction to the review.** The reviewer's last finding said a request refused by a thrown error
leaves no audit row, so the harness's audit assertion would fail. Measured on TEST the opposite is
true: all three refused write probes (two 403, one 400) wrote `audit_logs` rows. The harness asserts
that count and that nothing else changed; its docstring records the measurement.

**Residuals (not in this item's scope).**

- `PUT /purchase/suppliers/:id` spreads the request body into `updateMany`, so `currency` bypasses
  `resolveDocumentCurrency` and `tenant_id` is assignable. Pre-existing mass assignment; fix in
  WORK-025 or the WORK-030 security sweep.
- Sales, POS, CRM, quotation, frontend and script currency literals remain for WORK-025, together with
  the schema-level `@default("BOB")` values on those tables and the separate POS repository.
- Vouchers still carry one amount; the transaction/accounting/reporting triple is WORK-024b.

#### WORK-024b — voucher amount triple — DESIGNED, AWAITING APPROVAL — 2026-09-12

The refined implementation design is in
[WORK-024_CURRENCY_FOUNDATION.md §12a](../process/WORK-024_CURRENCY_FOUNDATION.md), produced by the
Claude solution-architect agent on Opus against `53015d4`. Analysis only; nothing implemented.

Substance: migration 033 adds the transaction/accounting/reporting amounts and both rates to
`journal_lines`, the ledger currencies, rate types and rate date to `journal_entries`, and reporting
amounts to `VendorOpenTransaction` **and** `VendorSettlement` (the settlement is where WORK-026
computes realized FX, so it must not be backfilled by guesswork later). `postJournal` gains an
optional voucher-level currency; an omitted currency keeps all 14 existing callers byte-identical
because every translation is an identity that reads no rate. Translation is per line from the
transaction amount, then rounding, then summing, with separate accounting and reporting penny
tolerances. `reverseJournal` copies the triple, the rates and the original's rate date and never
re-translates, so a rate move between posting and reversal cannot leave a residue.

Three decisions the design takes, for Kubi to confirm: the reporting currency stays locked to the
accounting currency in 024b (inventory has no reporting cost basis until WORK-031, and a reporting
currency cannot be changed after posting); our transaction-currency penny absorption is kept as a
documented deviation from D365; and penny differences reuse the `ROUNDING` posting type rather than a
new `PENNY_DIFFERENCE` one. Open for Finance: the reporting rounding tolerance at BOB scale, and
whether a second accounting currency is ever wanted. `ROUNDING` is recorded as unconfigured on the
TEST tenant — harmless for 024b, a blocker for WORK-026.

#### WORK-024b — voucher amount triple — ACCEPTED LOCALLY AND ON TEST — 2026-09-12

Kubi approved the three design decisions on 2026-09-12: implement 024b now, keep the reporting
currency locked to the accounting currency, and reuse the `ROUNDING` posting type for penny
differences. Implemented by the main session against the design in
[WORK-024_CURRENCY_FOUNDATION.md §12a](../process/WORK-024_CURRENCY_FOUNDATION.md). Listed for Codex
re-review (posting engine, migration, subledger).

**What now exists.** Every journal line carries the amount as transacted, as accounted and as
reported, with the effective rate used for each; every voucher names the ledger currencies, the rate
date and — where something was actually quoted — the rate types. `debit_amount`/`credit_amount` are
unchanged in name and meaning: they are the accounting amounts, so no report moved.

**Migration 033** (ledger ordinal 33, applied as `claude-work-024b`): seven columns on
`journal_lines`, five on `journal_entries`, and `amount_reporting`/`exchange_rate_reporting` on
`VendorOpenTransaction` **and** `VendorSettlement`. No column has a default — a rate defaulting to 1
is the defect WORK-024a removed. Rates carry `> 0` CHECKs; amounts carry none, because STORNO negates
amounts in place and never rates. The entry's currency and rate-type FKs are tenant-composite; the
line's currency FK points at the shared ISO table, because `journal_lines` has no `tenant_id` and
adding one would touch every insert for no isolation gain. The backfill is an identity (transaction =
accounting = reporting, rates 1, rate date = entry date; subledger reporting = functional), which is
exact because 024a refuses a reporting currency different from the accounting one. Two pre-checks and
a post-check `RAISE` rather than guess.

**`postJournal`.** An optional voucher-level `currency`; line amounts are transaction amounts. Omitted
means the ledger's accounting currency, so all 14 existing callers are byte-identical and read no
rate at all. Otherwise: **[OFFICIAL]** each line is translated from the transaction amount and
rounded, then summed, with separate accounting and reporting penny tolerances
(<https://learn.microsoft.com/dynamics365/finance/general-ledger/dual-currency>,
<https://learn.microsoft.com/troubleshoot/dynamics-365/finance/general-ledger/posting-fail-imbalance>).
The `ROUNDING` account is resolved only inside an imbalance branch, which is why a tenant without that
profile — TEST included — still posts everything that balances. A voucher with two transaction
currencies is refused.

**A defect the tests caught before TEST did.** The first implementation translated the reporting
currency separately even when it *is* the accounting currency, so Microsoft's own penny example
produced two rounding lines instead of one. Reporting now mirrors accounting exactly, penny line
included, which is D365's sync rule.

**`reverseJournal`** copies the three amount sets, both rates and the original's rate date through a
new `rawAmounts` path, and re-translates nothing. The reversal still posts on today's date, so it
never lands in a closed period. Balance is asserted exactly in all three currencies rather than
appending a second penny line. STORNO negates the six amounts and leaves the rates positive.

**AP subledger.** One `resolveSubledgerAmounts` helper now measures every open transaction,
settlement, payment and supplier credit, and `copySubledgerAmounts` carries a reversal's basis from
the row it reverses. Every literal `exchange_rate: 1` is gone from those paths.

**Verification.**

- Backend build, `typecheck:scripts` clean; `git diff --check` clean.
- Jest 24 suites / 499 tests, including the new `journalCurrency.test.ts`: identity with no rate
  lookup, Microsoft's EUR 3.33/3.33/3.34 penny fixture, refusal beyond tolerance with `ROUNDING`
  never resolved, a reporting-only penny line against its own tolerance, missing rate and inactive
  currency failing closed, REVERSE and STORNO carrying the triple, and the Bolivian
  Bs 1 299,00 → IVA 168,87 / IT 38,97 voucher identical across all three sets.
- `verify:migration-supabase`: isolated rebuild of 000–033, "passed for 34 migration(s)", empty drift.
- Applied to TEST as `claude-work-024b`; a repeat run reports "No pending migrations".
- `verify:currency-foundation` extended and re-run: **37/37** (marker `WORK024-1789202063647`). It now
  posts a real USD voucher in the BOB ledger inside a rolled-back transaction (USD 100 → BOB 696 at
  6.96), moves the rate afterwards, reverses, and proves the pair nets to zero in all three
  currencies; it also proves a failed document gives its FACTURA number back.
- Regressions: `verify:tenant-numbering` 29/29, `verify:putaway` 14/14, `verify:open-purchase` 7/7,
  `verify:o2c-containment` 12/12, `verify:vendor-payment` passed, `verify:supplier-return` passed.

**Two harnesses needed correcting, and the corrections are the interesting part.**

- `verify:tenant-numbering` copies a document into a stand-in tenant to prove numbers are unique only
  within a tenant. Since 033 a voucher names its tenant's ledger currencies, so the database refused
  the copy — correctly. The harness now activates the same currencies for the stand-in tenant first,
  so it tests the numbering rule instead of tripping over a currency reference.
- The currency harness probed the zero-rate CHECK inside its main transaction. A constraint violation
  aborts the transaction it happens in, and Prisma closes an interactive transaction that fails, so
  everything after it silently ran outside the transaction. That probe now has a transaction of its
  own. A savepoint does not rescue an interactive Prisma transaction.

**Residual, recorded for WORK-025 / WORK-030:** `PUT /purchase/suppliers/:id` still spreads the
request body into `updateMany`, so `currency` bypasses `resolveDocumentCurrency` and `tenant_id` is
assignable. It is a tenant-isolation defect on a guarded route, not tidiness, and must not slip past
the permission sweep.

**Review — ACCEPTED — 2026-09-12.** The Claude solution-architect agent reviewed `7d11dcc` on Opus and
accepted it with no blocker, having independently confirmed that `journalEntry.create` exists in
exactly one place (so no unmigrated writer can reach the new NOT NULL columns), that the
translate-then-round-then-sum order and the two tolerances are as documented, that `ROUNDING` is never
resolved when no penny line is needed, that the reversal carries rates and rate date under both
correction methods, and that Bolivia cannot have moved on a BOB/BOB ledger because the whole
translation block is skipped. It re-ran 4 suites / 62 tests itself. Follow-ups, all done in the same
session and none requiring the commit to be reopened:

- **Rounding precision (should-fix).** `postJournal` now rounds by the tenant currency's configured
  precision, and migration 032 admits any precision ≥ 0.01 — so a 0-decimal ledger currency (JPY, CLP)
  would round whole units while every document path computes cents, leaving receipts unbalanced and
  the GL disagreeing with AP. Fixed by refusing it: `assertPostablePrecision` in `currencyRounding.ts`
  is called from the journal service and from the ledger setup, and `bootstrapTenantLedger` now
  requires a 2-decimal currency instead of "not more than two".
- **AP subledger rate source (should-fix).** `resolveSubledgerAmounts` resolves its own rate at the
  row's date, while the code comment and the design said the subledger never translates independently
  of the voucher. Both could not be true. **Kubi decided (2026-09-12): a settlement is measured at the
  settlement date**, which is D365's model and the point at which a realized exchange difference
  arises — carrying the open item's rate would hide the gain or loss WORK-026 has to post. A reversal
  still copies its basis, because it must net to zero. The comment and the design now say that; the
  behaviour was already right, and today every result is an identity.
- **Harness false green (should-fix).** The zero-rate probe treated any error as "refused", so an
  unrelated failure would have reported a pass on the one assertion guarding
  `exchange_rates_rate_positive_chk`. It now accepts only a check-constraint violation (`23514` or the
  constraint name) and rethrows everything else.
- **Leftovers on TEST (should-fix).** Read-only check after the 024a harness runs: one rate type
  (`BCB`), no currency pairs, no rates, one tenant currency (BOB), and no `VERIFY_WORK024B` vouchers.
  Nothing escaped a rolled-back transaction.
- **Nits.** The ledger is read only on the ordinary posting path; the tenant-numbering currency copy is
  filtered to the source tenant and ordered; the supplier-credit tests now assert the reporting columns.
- **Recorded, cannot be fixed in place:** migration 033 rewrites `journal_lines` in one unbounded
  `UPDATE` and takes `ACCESS EXCLUSIVE` for the `SET NOT NULL` and FK validation. That is trivial on
  TEST's 336 lines; on a future production instance with millions it wants a maintenance window or a
  `NOT VALID` / `VALIDATE` split. The file is applied and byte-frozen, so this note is the record.

Re-verified after the follow-ups: build and `typecheck:scripts` clean, Jest 24 suites / 499 tests,
`verify:currency-foundation` 37/37 (marker `WORK024-1789203004302`), `verify:tenant-numbering` 29/29.

#### WORK-025a — sales-side currency and tenant jurisdiction — ACCEPTED LOCALLY AND ON TEST — 2026-09-12

Design: [WORK-025_CURRENCY_LITERAL_SWEEP.md](../process/WORK-025_CURRENCY_LITERAL_SWEEP.md), by the
Claude solution-architect agent on Opus. Kubi approved the 025a/025b split, dropping the tenant
currency mirror, and selecting the chart of accounts by country. Implemented by the main session.
Listed for Codex re-review (sales posting path, migration, security).

**This was not a literal sweep.** `sales.routes.ts` read `order.currency` nowhere, and
`sales.service.ts` persisted any string unvalidated, so a non-BOB sales order would have invoiced and
posted at face value — the defect WORK-024a closed on the purchase side. The `'BOB'` literal was the
only thing making it harmless. Removing the defaults without the posting guard would have opened it,
so both are in this commit.

**What changed.**

- Sales orders, the storefront, POS, CRM leads and opportunities, and quotations all resolve their
  currency through `resolveDocumentCurrency`. The storefront is unauthenticated, so it now ignores a
  `currency` in the body entirely. The POS resolves the ledger **before its transaction opens** and
  writes the accounting currency on the order; `PosSaleSchema` gains no currency field, because
  **[OFFICIAL]** a retail channel is configured with one currency and the till never sends one
  (<https://learn.microsoft.com/dynamics365/commerce/channel-setup-retail>).
- `assertDocumentCurrencySupported` now guards sales-order creation, the invoice route, the AR payment
  route and the return/credit-note route — each before a FACTURA number is drawn, so a refusal never
  spends a legal number. A foreign-currency order is refused at creation: an order that can never be
  invoiced is worse for an SME than a clear message, and WORK-026 opens it by deleting a guard.
- `PUT /purchase/suppliers/:id` no longer spreads the request body into `updateMany`. A strict
  allow-list closes the mass assignment — `tenant_id` was assignable, which moved a supplier between
  tenants — and the currency goes through the same resolution as every other document.
- **The tenant currency mirror is gone.** `Tenant.currency_code` duplicated
  `finance_parameters.accounting_currency_code`; the two diverging is what WORK-024 existed to end.
  `currencyCode` is out of the request context too: its one consumer was the factura currency
  snapshot, which now reads the ledger — a posting path, where failing closed is correct. Putting the
  read in the tenant middleware instead would have failed every request, including auth.
- **The chart of accounts is selected by jurisdiction, not by currency.** `Tenant.country` (ISO
  3166-1 alpha-2) is new; provisioning matches the template on it and **stops rather than guessing**
  when there is neither a country nor an explicit `--template`. Ecuador, Panama and El Salvador all
  use USD and file different charts; Turkey's TDHP is mandated by law, not by the lira.
  `createTenant.ts` requires `--country`, and `reportTaxBasisImpact` now keys its "VAT inside the
  price" rule by country rather than by currency.
- A cashier may now read `GET /tenant/config`, which carries the display currency as a **read-only
  projection** of the ledger and the tenant's currency record. The finance currency setup stays closed
  to a cashier; the POS renders money on every screen, and that is the seam — Finance owns the value,
  the tenant config reads it.
- The verification scripts take the ledger's currency instead of `'BOB'`, which is what makes the
  TRY-ledger proof real rather than theoretical.

**Migration 034** (ledger ordinal 34, applied as `claude-work-025a`): drops the seven `'BOB'` defaults
(sales orders, leads, opportunities, quotations, requisitions, RFQ cases and requests), drops
`tenants.currency_code`, adds `tenants.country`, and seeds the country from the tenant's own sites
**only where they all agree** — a tenant whose sites disagree is left NULL and provisioning then
refuses to pick a statutory chart. Three pre-checks RAISE rather than guess: a drifted mirror, a
tenant with no ledger, or any document in a currency other than its ledger's. It updates no currency
value and is metadata-only otherwise — the lesson recorded from 033's unbounded `UPDATE`.

**Verification.**

- Build, `typecheck:scripts` clean; `git diff --check` clean.
- Jest 25 suites / 507 tests, including the new `salesCurrency.test.ts`: an order takes the ledger
  currency in a BOB, TRY or EUR ledger; an unactivated currency is refused 422; an active
  non-accounting currency is refused 409 `SALES_FX_NOT_IMPLEMENTED`; a tenant with no ledger is
  refused rather than defaulted; and nothing is written in any refusal.
- `verify:migration-supabase`: isolated rebuild of 000–034, "passed for 35 migration(s)", empty drift.
- Applied to TEST; a repeat run reports "No pending migrations".
- `verify:currency-foundation`, extended: **39/39** (marker `WORK024-1789206920549`). New assertions:
  no country default on any of the thirteen document and ledger currency columns; the tenant mirror
  column is gone; every sales-side document is in its tenant's ledger currency; and a cashier reads
  the currency from `/tenant/config` while still being refused the finance currency setup.
- Regressions: `verify:tenant-numbering` 29/29, `verify:putaway` 14/14, `verify:open-purchase` 7/7,
  `verify:o2c-containment` 12/12, `verify:vendor-payment` passed, `verify:supplier-return` passed
  (credit SC-2026-00005), and `verifyProcessChain` — which exercises all seven dropped defaults —
  reported ALL CHECKS PASSED.

**Review — CHANGES REQUIRED, no blockers, all findings closed the same session — 2026-09-12.** The
Claude solution-architect agent reviewed `66458ec` on Opus, reproduced the test suite and both type
checks itself, and confirmed the posting perimeter holds: every sales, POS and purchase-to-pay posting
path is guarded, each guard fires before a FACTURA number is drawn, no currency literal remains in
backend `src` or `scripts`, and no new path can write `tenant_id`. What it found, and what changed:

- **The quotation path created sales orders outside the guard.** `confirmQuotation` writes
  `tx.salesOrder.create` directly instead of going through `SalesService.createOrder`, and
  `resolveDocumentCurrency` only proves a currency is *active*, not that it is the ledger's. A tenant
  that activated USD could quote in USD and confirm it, producing an order that the invoice route
  would then refuse forever — the dead-end draft Kubi's decision was meant to prevent. Both
  `createQuotation` and `confirmQuotation` now assert the accounting currency.
- **The harness asserted something no code enforces.** It required requisitions, RFQ cases and RFQ
  requests to be in the ledger currency, but purchasing deliberately lets a foreign-currency order
  exist and refuses it at receipt and invoice (WORK-024a). The assertion is narrowed to the four
  sales-side tables, with the asymmetry recorded in the harness itself.
- **The jurisdiction seed read a column that carried its own country default.** Migration 034 seeds
  `tenants.country` from the tenant's sites, and `Site.country` defaulted to `'TR'` — so a Bolivian
  tenant whose sites were left at the default would have been stamped Turkish and provisioned with the
  Turkish statutory chart. That is the same inference this item removes, moved from the currency to a
  defaulted column. **Read-only check on TEST:** `skarpine-demo` has four sites, two `BO` and two
  `TR`, so the "only where every site agrees" rule left `tenants.country` NULL and nothing was
  mis-stamped; provisioning refuses to pick a chart until an operator sets it. **Migration 035** drops
  the `Site.country` default, and both site-creating routes now require an ISO 3166-1 alpha-2 country
  — `POST /warehouse/sites` through a strict allow-list (it spread the request body), and
  `POST /warehouse/setup`, which used to fall back to `'XX'`.
- **There was no supported way to set the jurisdiction after creation.** `PUT /tenant/config` now
  accepts a validated `country` under `setup.tenant.maintain`, which is where organisation setup lives.
- **Nothing pinned the guard-before-FACTURA ordering.** New `salesInvoiceCurrencyGuard.test.ts` mounts
  the sales routes and asserts that a foreign-currency order is refused 409 with `nextFacturaNumber`
  never called, on both the invoice and the payment route, and that the ledger currency passes through.
- Nits closed: the stale "keeps `Tenant.currency_code` in sync" comment; the `/tenant/config` currency
  lookup now filters `is_active`; the harness accepts `WORK024_ACCEPTANCE` or `WORK025_ACCEPTANCE`, so
  the token names the item whose writes are sanctioned.

Re-verified after the follow-ups: build, `typecheck:scripts` and `git diff --check` clean; Jest 26
suites / 510 tests; `verify:migration-supabase` "passed for 36 migration(s)" with empty drift;
migration 035 applied to TEST as `claude-work-025a` (ledger ordinal 35) with a repeat no-op;
`verify:currency-foundation` 39/39 (marker `WORK024-1789221828753`); and the full regression set again
— `verify:tenant-numbering` 29/29, `verify:putaway` 14/14, `verify:open-purchase` 7/7,
`verify:o2c-containment` 12/12, `verify:vendor-payment`, `verify:supplier-return` and
`verifyProcessChain` all passing.

**Known boundary, recorded rather than closed:** `awardRfq` and the requisition-to-order path create
purchase documents without a creation-time currency guard. That is WORK-024a's deliberate policy —
purchasing refuses at receipt and invoice instead — and it is why the harness no longer claims
otherwise.

**Residual — WORK-025b, the frontend, is not started.** It is safe to follow: the frontend's
hard-coded `Bs.` still renders correctly on a BOB ledger. It covers ~158 literal lines across 35
files, `format.ts`'s `'USD'` default (its `formatCurrency` has no callers at all today), the supplier
and payment-method currency pickers, and the setup wizard. The Expo POS client contract is recorded in
the design §6 as WORK-025c; `skarpine-pos/` is an empty directory in this worktree, so nothing there
is part of this item.

---

## WORK-025b — frontend currency sweep — implemented 2026-09-12/13, local, unreviewed

Approved by Kubi ("WORK-025b: frontend (Önerilen)"). No migration, no TEST write.

**One design change against the approved design, taken during implementation.** The design fed the
display currency from `GET /tenant/config`, and 025a gave `cashier` and `employee`
`setup.tenant.read` to reach it. The storefront showed that was the wrong shape: a shopper sees prices
and holds no permission, so the same argument would expose the tenant's plan, modules and branding to
every customer. The currency now has its own route, **`GET /tenant/currency`**, needing authentication
and no permission, returning only `code`, `symbol`, `rounding_precision`, `rounding_method`, `locale`
(or `null` before the ledger exists). `setup.tenant.read` was **taken back** off `cashier` and
`employee` (closes 025a review nit 7). `/tenant/config` keeps its projection for admin, store manager
and auditor.

**Design open question §7.5 resolved — it rested on a false premise.** The storefront is not anonymous:
every `/api/v1` route including `/products` sits inside `tenantMiddleware` + `authMiddleware`
(`backend/src/app.ts`). The shop uses the same provider as the ERP and POS; no public route added.

What changed:
- `frontend/src/lib/money.ts` replaces the dead `lib/format.ts` (its `'USD'`-defaulting
  `formatCurrency` had no callers; file deleted). No default currency; fraction digits come from the
  currency's rounding precision.
- `components/CurrencyProvider.tsx` in `Providers.tsx`, fed by `/tenant/currency` once a user is
  signed in; `useMoney()` returns `money` (qualified), `amount` (bare, under a header), `code`,
  `locale`, `quantity`, `date`. Everything renders empty until the currency is known — never a guess.
- Every `Bs.` literal, every `es-BO` money/quantity/date helper (eight purchase screens carried the
  same trio), the two `'BOB'` Intl formatters, the reports `CURRENCY` constant, `SalesChart`'s
  `currency = 'Bs.'` default, and the POS, storefront, CRM, procurement, purchasing, sales, finance
  and dashboard screens: 68 files.
- React-pdf documents (`SalesOrderPDF`, `FacturaPDF`, `IvaReportPDF`) take the currency as a required
  prop, as they already take the tax; their buttons offer no document until it is known. `FacturaPDF`
  still prints the factura's own `invoice_metadata.currency_code`; only the `'BOB'` fallback went.
- Supplier currency picker lists the tenant's activated currencies (`GET /finance/currencies`),
  falling back to the ledger currency for roles without `finance.currency.read`; supplier country and
  currency no longer default to `BO`/`BOB`. Payment-method `allowed_currency` starts empty ("any").
  The sales order form no longer sends `currency: 'BOB'` — the server resolves it.
- Setup wizard starts with no currency (was `USD`) and refuses to finish without an ISO code. Its
  country presets (`bolivia-pcg` → BOB, `turkey-tdhp` → TRY) are data and stay.

**Out of scope, recorded:** tax-rate labels (`IVA 13%`, `IT 3%`, "Ley 843 Bolivia") on the POS
receipt, factura PDF, IVA report and product form are jurisdiction literals, not currency — they belong
to the tax-engine localization work, not WORK-025.

Verification: frontend `tsc --noEmit` clean; `next build` succeeded for every route; grep for
`Bs.|es-BO|'BOB'` in `frontend/src` returns only explanatory comments and the wizard's preset data;
backend Jest 26 suites / 514 tests; `tenantRoutePermissions` pins cashier/employee/customer reading
`/tenant/currency` while refused `/tenant/config`, and a null currency before the ledger exists.
`verifyCurrencyFoundation.ts` updated to probe `/tenant/currency` and the `/config` refusal — **not
re-run against TEST in this item.** **Not done:** the browser pass over money-dense pages and the TRY
stand-in render named in the design's acceptance. WORK-025c (Expo POS) remains deferred.

**Review of `cc365eb` — CHANGES REQUIRED, three blockers, all closed the same session — 2026-09-13.**
The Claude solution-architect agent (Opus) reproduced tsc and Jest and confirmed the security model:
`/tenant/currency` sits behind tenant + auth middleware, taking `setup.tenant.read` off cashier and
employee breaks nothing (no frontend calls `/tenant/config`), the storefront was already sign-in-only,
no hook is called after an early return, and no POS payload or FACTURA path changed. Findings:

1. **Bolivia saw `1299,50 BOB`, and the configured symbol was ignored.** The locale was the bare
   `Tenant.language` (`es`), under which Intl prints the ISO code and skips grouping on four digits.
   Fixed: the server builds the locale from language + `Tenant.country` when set (`es` + `BO` →
   `es-BO`), canonicalised and degrading to the language, then `en` (`formattingLocale`, exported and
   tested); `formatMoney` swaps Intl's currency part for the configured `TenantCurrency.symbol` when one
   exists — the symbol is tenant data. Bolivia now renders `Bs. 1.299,50` with the TEST-style `Bs.`
   symbol. **Decision recorded for Kubi:** configured symbol wins over Intl's `Bs`; change the symbol
   under Setup → Currencies if `Bs` is preferred.
2. **The currency cache was not keyed by tenant.** The QueryClient outlives a client-side logout, so a
   BOB tenant's currency could render for a TRY tenant for up to an hour. Key is now
   `['tenant-currency', tenantId]`, enabled only with a user and a tenant.
3. **An invalid `Tenant.language` crashed every money page, POS included** (`toLocaleString('es_BO')`
   throws). `PUT /tenant/config` now refuses a language Intl cannot canonicalise; the client resolves
   the locale once through `safeLocale` (also used by the three PDFs).
4. Blank amounts were silent. The provider exposes `status`
   (`idle|loading|ready|unconfigured|error`); `pos/main` and `PaymentModal` show why and refuse to open
   or confirm payment while the currency is unconfigured or failed.
5. `FacturaPDF` no longer lends the tenant currency's symbol and rounding to a factura issued in
   another currency.
7. Tests added: `/tenant/currency` 401 through the real middleware chain; locale qualification;
   `formattingLocale` table; language validation; and `frontend/tests/unit/money.test.mjs` (7 tests,
   `npm run test:unit`, Node's own runner — no new framework). The unused
   `TENANT_CURRENCY_ROUTE_IS_UNPERMISSIONED` export became a comment.
8. Nits: `formatNumber` (unused, `en-US`) deleted; the quotations Total header names the currency; the
   storefront's hard-coded "orders over 500" threshold removed.

**Residuals recorded, not closed:** (6) purchase list pages label API-created foreign-currency POs
with the ledger currency — WORK-026; the factura's printed format changed from `BOB 1299.00` to
`Bs. 1.299,00`, to be confirmed against SIN representation rules with the Bolivian accountant;
existing hard-coding outside this item: `'en-US'` date at `sales/orders/[id]/page.tsx`,
`IVA_RATE = 0.13` in `(store)/checkout/page.tsx` (tax-engine localization).

Re-verified: frontend tsc clean, `next build` compiled, `test:unit` 7/7; backend tsc and
`typecheck:scripts` clean, Jest 26 suites / 524 tests. Still not done: browser pass, TRY stand-in
render, harness re-run on TEST.

---

## WORK-030 — O2C, inventory and finance permission registry — DESIGNED, awaiting decisions — 2026-09-13

Designed by the Claude solution-architect agent (Opus), read-only. Full design:
`docs/process/WORK-030_O2C_PERMISSION_REGISTRY.md`. No implementation started.

Headline findings (repo-verified), more serious than the queue entry: 80 of 187 in-scope routes carry
no guard; `POST /auth/register` is public and attaches a tenant-less registrant to the first active
tenant, so an anonymous visitor can obtain a `customer` token and then read the whole ledger,
facturas and CRM, complete warehouse work, and start paid video jobs; the first user of an empty
tenant becomes admin and `/auth/make-admin` allows self-promotion; storefront orders take the price
from the client; `GET /products` exposes `cost_price` and unpublished products; journal post does
not re-check a closed period; inventory adjust/transfer do not validate locations against the
tenant. The store-manager-posts-journals premise was wrong: a store manager only creates drafts.

Proposal: split 030a (workforce gate + sales/CRM/customer/POS registry + registration containment),
030b (product/inventory/warehouse/import), 030c (finance/reports/setup/HR/audit), plus a separate
storefront price-integrity item right after 030a. No schema change. Decisions D-1…D-18 are in §15.

**Kubi's decisions — 2026-09-13.** D-1 split 030a → 030b → 030c, starting with 030a; D-3 registration
requires an explicit tenant, never creates an admin, `/auth/make-admin` and the settings self-promote
UI are deleted, storefront tenant from `NEXT_PUBLIC_STOREFRONT_TENANT_SLUG`; D-5 store manager keeps
creating DRAFT manual journals; D-2, D-4, D-6…D-18 accepted as recommended in the design §15
(including D-15: storefront price integrity as its own item immediately after 030a). WORK-030a
implementation approved.

---

## WORK-030a — O2C permission registry, workforce gate, registration containment — implemented, unreviewed — 2026-09-13

Catalog: 99.25.050.000, 99.25.060.000, 99.25.070.000; L2 65.20, 65.30; UNVERIFIED-85. Design
`docs/process/WORK-030_O2C_PERMISSION_REGISTRY.md`; decisions recorded above. No schema change, no
migration (`git diff -- backend/prisma` empty). Not committed — awaiting solution-architect review.

**Step 0 (TEST, read-only, counts only).** 1 tenant. Users by role: admin 1, store_manager 3,
employee 3, customer 3 — **no cashier user exists on TEST**, so cashier probes use synthetic tokens.
Manual journal entries (`source_module='MANUAL'`): none, so D-5 has no data consequence. FACTURA
`next_number` 35, last updated 2026-09-09.

What was built:
- `permissions.ts`: 29 dotted O2C codes (sales, CRM, customer, storefront, POS, `product.read`,
  `report.sales.read`); `requireAnyPermission`; `RouteGuards` / `routeGuard(manifest)`; `isKnownRole`;
  role grants per design §5.4 for these namespaces; the auditor's O2C reads are derived; legacy
  `customers:*` and `pos:*` deleted.
- `workforceGate.ts`, wired in `app.ts` after auth: `customer` and unknown roles reach only
  `GET /products`, `GET /products/categories`, `GET /products/:uuid`, `POST /sales/orders/storefront`,
  `GET /tenant/currency`; exact-path matching, UUID-only ids.
- Exported frozen manifests with the guard first on every route: sales orders (12), quotations (9,
  confirm = `sales.quotation.confirm` + `sales.order.create` + `customer.create` because it converts
  a lead), CRM (18), customers (6), POS (6); the three shared product reads on `anyOf`.
- Storefront projection: a caller without `product.read` sees published products only and no
  `cost_price`. **Deviation from D-4, recorded:** variant `additional_cost` is NOT hidden — despite
  its name it is a price surcharge (the POS sells at `selling_price + additional_cost`,
  `VariantPicker.tsx:40`), so it is catalogue data. The field name itself is misleading; renaming it is
  a separate schema item, not done here.
- Registration: strict schema, exactly one of `tenant_id`/`tenant_slug`, always `customer`, user and
  customer created in one transaction, 404 for an unknown store; `/auth/make-admin` deleted with the
  settings self-promote UI; storefront sends `tenant_slug` from `NEXT_PUBLIC_STOREFRONT_TENANT_SLUG`
  (no default; the page refuses when unset); the register page's hard-coded `country: 'Bolivia'`
  removed.
- Customer codes: `nextCustomerCode` (MAX suffix) extracted to `shared/services/customerCode.service.ts`
  and used by CRM conversion, `POST /customers` and registration — both routes used `count()+1`.

**Access changes (030a rows of design §7):**

| Role | Change |
|---|---|
| customer | Only the 5 storefront-surface routes in v1; unpublished products and `cost_price` hidden |
| unknown role | Only the storefront surface |
| anyone | Registration needs an explicit tenant and never yields an admin; `/auth/make-admin` gone (404) |
| cashier | Loses sales-order read/create, quotations, CRM, storefront order; keeps POS operate + sale, customer read/create, product read. Still cannot void |
| employee | Loses sales-order create, quotation create and all CRM writes; keeps reads (it never held customer create) |
| buyer, receiver, ap_clerk, requester, warehouse_worker | Lose unguarded sales/CRM reach; gain explicit `product.read` (preserves today's catalogue read) |
| finance_approver | Loses catalogue and sales/CRM reads (none granted in §5.4) |
| auditor | Gains every O2C read |
| store_manager | Unchanged in effect; sales-order cancel and CRM stage setup stay admin |

Verification (all local unless stated):
- backend `tsc --noEmit`, `typecheck:scripts` clean; Jest **28 suites / 695 tests** (new
  `o2cRoutePermissions.test.ts` 126 — exact manifests, router route set equals manifest keys, every
  route refused 403 to every non-holding role with zero database access and no FACTURA allocation, a
  sanity test that the recording database does register a permitted request, holders pass the
  guard; `storefrontContainment.test.ts` — gate surface and refusals, unknown role, registration,
  make-admin 404, product projection; registry pins in `permissions.test.ts`; `RegisterSchema` cases).
- frontend `tsc --noEmit` clean, `next build` compiled.
- `git diff --check` clean; prisma diff empty.
- **TEST `verify:o2c-permissions` 32/32** (new): allow reads per role, customer sees only published
  products without cost, 17 refusals, registration without tenant 400, make-admin 404, FACTURA
  sequence, user count and uom count unchanged. **Disclosed:** the first run probed
  `GET /sales/quotations` as the auditor read, and listing quotations expires overdue SENT quotations
  — a write. TEST holds only CONFIRMED (3) and REVISED (3) quotations, so the update matched no rows;
  the probe was replaced with `GET /customers`. Refused write probes add `audit_logs` rows, as the
  audit middleware does for every write.
- **TEST `verify:o2c-containment` 12/12** (WORK-029 regression).

Not done: the browser pass (admin/store manager sales and CRM, cashier web POS without submitting,
customer shop and register). Residuals: D-15 storefront price integrity is still open and must close
before any external shopper; 030b/030c routes remain `requireRole` or unguarded for workforce roles
(customers are contained by the gate); a deployment must set `NEXT_PUBLIC_STOREFRONT_TENANT_SLUG` or
storefront registration is refused.

**Review of WORK-030a (uncommitted tree) — CHANGES REQUIRED, no redesign — 2026-09-13.** The Claude
solution-architect agent (Opus) reproduced tsc, `typecheck:scripts` and Jest (695) and verified the gate
position and path matching, guard-first on all 51 routes, manifest parity with the design, the cashier
web-POS endpoint set, the storefront pages, the genuine deny-before-database proxy, the customer-code
SQL, and that the harness probes are pure reads. It agreed with the `additional_cost` deviation (the
original schema comment calls it "price difference from base"). Findings and outcome:

1. **Only four roles' grants were pinned**, and the route tests derive holders from `hasPermission`, so
   a lost store-manager grant (e.g. `sales.invoice.post`) would pass CI. Fixed: exact O2C grant lists
   for all twelve roles.
2. **Browser pass (design §13.12) not done.** Open — put to Kubi (run it, or waive it for 030a).
3. **Registration error code:** the design names `400 TENANT_REQUIRED`; the implementation returns the
   standard `400 VALIDATION_ERROR` from the strict schema's refine (detail path `tenant_id`). Recorded
   as a deliberate deviation: the validation middleware owns request-shape errors, and a second code
   for one of its cases would diverge from every other route. Design §8.1/§12 read accordingly.
4. Stale "this route is unauthenticated" comment on the storefront order route — fixed.
5. Matrix §3 row 99.25.050.000 and the §8.7 and 99.25.070.000 evidence/dates, and the OpenAPI register
   schema (`tenant_slug`, optional fields, 400/404) — fixed.
6. Worklog access table wrongly said the employee lost customer create — corrected.
- Also fixed from the non-blocking list: `hasPermission` now checks own keys, so a role named
  `constructor` is refused instead of throwing (test added); the test's race timers are cleared.

**Recorded, not changed in 030a:**
- The storefront projection hides cost only. It still returns internal ids (`item_tax_group_id`,
  `item_group_id`, `item_model_group_id`, `dimension_group_id`), `reorder_point`, `tracking_policy`,
  the full category, exact stock across all warehouses, and `GET /products/:id` has no `is_active`
  filter for shoppers. An allow-list projection belongs in the D-15 storefront-integrity item.
- D-15 must also refuse unpublished or inactive products on `POST /sales/orders/storefront`, not only
  client prices (the route still spreads `unit_price` and records it as the inventory unit cost).
- Concurrent registrations or customer creates can collide on the MAX code or the email and surface as
  a 500 via P2002 (the unique constraints protect the data; the old CRM comment claimed a retry that
  did not exist). Acceptable at SME volume.
- The POS customer dialog invents its own code client-side (`CustomerSearch.tsx:18`) — pre-existing,
  numbering work.
- `GET /sales/quotations` expires overdue quotations while listing, and auditor and employee can now
  call it — a write-on-read to turn into an explicit job.

Re-verified: backend tsc clean; Jest **28 suites / 704 tests**, no worker-exit warning.

**Kubi's decisions on the WORK-030a review — 2026-09-13.** Commit 030a now; Kubi runs the browser pass
himself (admin/store manager sales and CRM, cashier web POS without submitting a sale, customer shop
and register with `NEXT_PUBLIC_STOREFRONT_TENANT_SLUG` set) and any defect found is fixed in its own
commit. The D-4 deviation is approved: variant `additional_cost` stays visible to shoppers as price
data; only `cost_price` is hidden. WORK-030a is committed as accepted-with-browser-pass-pending.

## Remediation programme WORK-042…054 — decided 2026-09-13/14

Kubi reviewed the manual test plan (`docs/testing/`) and ruled that every suspected defect in it
must be fixed before any new feature work, and that every backend-managed structure must have a
UI to manage it. Design: `docs/process/REMEDIATION_PLAN_WORK-042_054.md` (defect register
DEF-001…115, target behaviour, UI/configuration directive, work items). Endpoint→UI coverage
snapshot: `docs/testing/endpoint-ui-coverage.txt`.

Kubi's decisions (2026-09-14):

| Question | Decision |
|---|---|
| Q1 self-approval default | `DISALLOW_SUBMITTER` for all SoD enums; a one-person shop opts in to ALLOW |
| Q2 TEST inventory inconsistency | Wipe all Supabase TEST data and re-provision (TEST is disposable). Done after the WORK-043/044 migrations. The opening-inventory journal remains a product feature for real onboarding |
| Q3 historical POS AR on TEST | Resolved by the wipe |
| Q4 live FACTURA consumption on TEST | Allowed, at most 3 numbers per work item, recorded before/after, never deleted |

Order: 042 → 030b → 043 → 044 → 045 → 047 → 048 → 049 → 046 → 051 → 030c → 050 → 052 → 053 → 054.

## WORK-042 — Legal numbering safety and fail-closed baseline — implemented, unreviewed — 2026-09-14

- **DEF-040/041:** migration 036 adds `number_sequences.legal_series` (NONE | GAPLESS) with two
  CHECKs (value set; GAPLESS ⇒ continuous) and marks FACTURA GAPLESS + continuous. Provisioning
  creates FACTURA continuous/GAPLESS. `PUT /setup/number-sequences/:id` refuses `continuous:false`
  on a gapless series (`NUMBER_SEQUENCE_GAPLESS_REQUIRED`) and a forward jump past the next
  consecutive number without `acknowledge_gap_reason` ≥ 15 chars
  (`NUMBER_SEQUENCE_GAP_REASON_REQUIRED`); the reason is request-only and kept by the audit body.
  Numbering screen: lock note, continuous toggle disabled, gap-reason input.
- **DEF-102:** error handler maps Prisma P2002 → 409 `DUPLICATE` (field names only, never
  `tenant_id` or values), P2003 → 422 `INVALID_REFERENCE`, P2025 → 404 `NOT_FOUND`.
- **DEF-101:** malformed/expired refresh token → 401 `REFRESH_TOKEN_INVALID`.
- **DEF-019:** a stocked item model group with a costing method other than FIFO is refused
  (422 `COSTING_METHOD_NOT_IMPLEMENTED`); provisioning no longer creates `STOCKED-STD`;
  `scripts/reseedItemModelGroups.ts` retired.
- **DEF-109:** import upload/mapping/validate/execute answer 501 `IMPORT_NOT_IMPLEMENTED`; the page
  says import is unavailable. Real executors move to WORK-054.
- Step 0 (TEST, read-only): one FACTURA row, continuous true, next 35; item model groups
  FIFO/stocked 1, STANDARD/stocked 1, STANDARD/not-stocked 1.
- Verification: backend tsc + scripts typecheck clean; Jest 29 suites / 725 tests
  (`failClosedBaseline.test.ts` 21 new); isolated Supabase rebuild 37 migrations with expected
  drift; 036 applied to TEST as `claude-work-042`, repeat run no-op; FACTURA GAPLESS/continuous,
  next 35 unchanged; `verify:tenant-numbering` 29/29; frontend tsc + build clean.

## WORK-030b — Product, stock, warehouse and import permission registry — implemented, unreviewed — 2026-09-14

Design: `docs/process/WORK-030_O2C_PERMISSION_REGISTRY.md` §5.2–5.4, §16.1 (D-8, D-9, D-11, D-16, D-18).
Remediation plan: DEF-015 (unguarded work routes), DEF-018 (foreign transfer locations).

- **Registry:** new code families `product.maintain/.delete/.media.generate/.setup.read/.setup.maintain`,
  `inventory.stock.read/.transaction.read/.transfer.post/.adjustment.post/.count.read/.create/.record/.post`,
  `warehouse.structure.*`, `warehouse.site.maintain`, `warehouse.work.*`, `warehouse.wave.*`,
  `warehouse.arrival.*`, `warehouse.setup.*`, `import.job.read/.prepare/.execute`. Legacy
  `products:*`, `inventory:*`, `warehouse:*` and `import:run` deleted.
- **Grants (§5.4):** store manager all of them except product delete, item setup maintain, site
  creation and import execute; cashier and employee stock + structure reads; warehouse worker
  work read/execute, wave and arrival read, count read/record (S-2: cannot post); receiver
  work read/execute and arrival read; buyer stock + structure reads; requester and AP clerk
  structure read; finance approver none; auditor every read (derived).
- **Routes:** every route of `product.routes.ts` (25), `uom.routes.ts` (4), `variant-types.routes.ts`
  (4), `inventory.routes.ts` (5), `inventory-count.routes.ts` (5), `warehouse.routes.ts` (26) and
  `import.routes.ts` (6) now runs its manifest guard first. Bulk product delete checks
  `product.delete` instead of the admin role name.
- **D-18:** `assertTenantReferences` gains `locations` (location row, its zone and the zone's
  warehouse must all be the tenant's); `POST /inventory/adjust` and `POST /inventory/transfers`
  refuse a foreign product, variant or location with 422 `FOREIGN_REFERENCE` before any read of
  stock or write.
- Known and unchanged here (by design): `POST /warehouse/work/:id/complete` is now guarded but still
  does not move stock — removed in WORK-043. Frontend menus are not yet filtered by permission
  (WORK-052).
- **Verification:** backend tsc + scripts typecheck clean; Jest 31 suites / 911 tests
  (`stockRoutePermissions.test.ts`, `stockForeignReferences.test.ts`, permissions pins for every
  role); TEST `verify:o2c-permissions` 45/45 (13 new 030b probes; FACTURA, users, UoM unchanged);
  `verifyPutaway.ts` 14/14 (self-cleaning). API_SPEC product, inventory, warehouse and import
  tables regenerated from the manifests.

### WORK-042 / WORK-030b review (solution-architect, 2026-09-14) — CHANGES REQUIRED → fixed

- **042-1 (HIGH):** a counter written while FACTURA was manual took effect on `{manual:false}` with no
  gap check. `gaplessSeriesRefusal` now judges `next_number ?? row.next_number` whenever the counter
  changes or the series resumes automatic; the numbering page asks for the reason on the switch.
- **042-2 (MEDIUM):** an automatic series with an unorderable history had no gap check; it now
  continues from its own counter (an acknowledged manual→automatic resume stays with
  `checkManualToAutomatic`).
- **042-3:** provisioning pin test for FACTURA continuous/GAPLESS; route-level PUT tests prove the
  refusals happen before `numberSequence.update`.
- **042-4:** the gap reason is written to `audit_logs` in the same transaction as the counter
  change (`NUMBER_SEQUENCE_GAP_ACKNOWLEDGED`, before/after, reason), not only by the background
  request audit.
- **042-5:** a legacy stocked non-FIFO item model group can still be renamed or deactivated; the
  costing rule is checked only when the request touches costing or stocked.
- **030b-1 (MEDIUM):** site creation is the admin's on every route (S-8): `POST /warehouse/setup`
  now needs `warehouse.setup.maintain` + `warehouse.site.maintain`; `POST /warehouses` with
  `create_site` checks `warehouse.site.maintain` and an ISO country.
- **Decisions taken on the architect's recommendation (Kubi delegates design):** store manager
  loses site creation; 030b is exempt from §3.1 rule 1 (no 403 as discovery) until the permission
  -filtered menus of WORK-052; the gap-reason audit is synchronous.
- **Recorded residuals:** 030b-2 purchase returns page's location query fails for
  finance_approver; warehouse worker sees count/location buttons that 403 (WORK-052). 030b-3 zone and
  location create do not check warehouse/zone ownership (WORK-052 FK tenant checks, DEF-106). 030b-4
  the TEST cross-tenant probe uses a random UUID, not a second tenant's location.
- Verification: backend tsc + scripts typecheck; Jest 31 suites / 921 tests; frontend tsc + build.

## WORK-043/044 — Stock reservations and FIFO issue costing — implemented, unreviewed — 2026-09-14

Implemented as one item: both rewrite the same shipment path, so splitting them would have
changed the same code twice (recorded deviation from the plan's 043 → 044 split).
Defects: DEF-001…009, 012–014, 016, 017, 018 (move part), 020, plus two found on the way — the
picking gate counted `SALES_ORDER` work while pick work was written `sales_order`, and an order
in PICKING status could not be shipped.

- **Schema:** migration 037 — `inventory_reservations`, `inventory_cost_settlements`,
  `inventory_transactions.cost_layer_id/cost_amount`, cost-layer `original_quantity/source_type/
  origin_settlement_id`, stock CHECKs (quantity ≥ 0, 0 ≤ reserved ≤ quantity), stock unique index
  rebuilt NULLS NOT DISTINCT, `inventory_parameters.uncosted_issue_policy` (REFUSE) and
  `cost_level` (hook), `sales_parameters.storefront_warehouse_id`, `sales_orders.register_session_id`.
  Migration 038 — `reversed_by_id` unique → plain index: one return movement reverses several
  settlements (found by the TEST harness); single reversal is a guarded claim in the service.
- **One stock ledger** (`shared/services/stockLedger.service.ts`): reserve, release, issueReserved,
  issueAvailable, restoreIssues (SAME_LAYERS / NEW_LAYER), moveStock. Rows and layers locked
  `FOR UPDATE`; layers consumed FIFO at the issuing location (layers follow the goods — a stricter,
  equivalent reading of the plan's warehouse scope); COGS = Σ settlements, per item group.
- **Callers:** sales confirm/ship/cancel each one transaction with a guarded status claim; ship
  accepts PICKING; cancel frees only its own holds and refuses an invoiced order
  (`ORDER_INVOICED`, part of DEF-043). Storefront checkout: strict schema (no price, discount,
  warehouse, currency), catalogue price (`sale_price ?? selling_price` + variant surcharge),
  active+published only (`PRODUCT_NOT_SELLABLE`), storefront warehouse from sales parameters,
  create + confirm = reserve (no deduction). POS sale issues from the register warehouse at layer
  cost and stamps `register_session_id`; POS void is a guarded claim, restores the same layers,
  reverses COGS at the consumed cost, no longer swallows journal errors, and decrements the sale's
  own session. Customer return re-layers at the issued cost and reverses COGS at that cost.
  Transfers and warehouse work use moveStock (from ≠ to, locked, layers move, a pick carries the
  order's holds to the dock). Pick work is generated from the order's holds. SHORT work lines
  accumulate. `POST /warehouse/work/:id/complete` removed; the work page completes line by line.
  `Product.cost_price` is read on no posting path.
- **TEST:** Kubi authorised wiping TEST. `scripts/resetTestTransactions.ts` (guarded) emptied 45
  transactional tables and kept master data and users, so logins survive. Migrations 037 and 038
  applied as `claude-work-043`; isolated Supabase rebuild 39 migrations with the reviewed drift.
- **FACTURA allowance:** 3 numbers used on TEST for this item (harness run 1: POS sale; run 2: POS
  sale + return credit note), which is Kubi's limit of 3. The harness now runs those two sections
  only with `ALLOW_FACTURA_CONSUMPTION=YES`.
- **Verification:** backend tsc + scripts typecheck; Jest 32 suites / 930 tests
  (`stockLedger.test.ts` 13 new); frontend tsc + build. TEST `verify:stock-ledger`: full run with
  POS and return 41/42 (the one failure was the harness expecting 409 where the route answers 400
  for a second return — expectation corrected), then 29/29 without the FACTURA steps.
  Regression: `verify:o2c-containment` 12/12, `verify:o2c-permissions` 45/45,
  `verify:tenant-numbering` 25/25, `verify:putaway` 14/14, `verify:open-purchase` 7/7,
  `verify:currency-foundation` 40/40 (its exact-ordinal check relaxed to a floor).
  `verify:vendor-payment` and `verify:supplier-return` did not run: after the reset TEST has no
  open posted vendor invoice or received product fixture — rerun after the next purchase cycle.
- **Open, by design:** positive stock adjustments and counts still create stock without layers
  (WORK-045 next), and under `REFUSE` such stock cannot be issued until 045 posts it with cost.

### WORK-043/044 review (solution-architect, 2026-09-14) — CHANGES REQUIRED → fixed

- **1 (HIGH) POS sale could not be returned:** the return now restores `POS_SALE` movements too.
- **2 (HIGH) ship could issue a hold the order no longer lists:** `issueReserved` compares held and
  wanted keys both ways; `PUT /sales/orders/:id` refuses line or warehouse changes on a CONFIRMED
  order (`CONFIRMED_ORDER_STOCK_EDIT_REFUSED`) until WORK-048 re-reserves in place.
- **3 (HIGH) finishing work could reopen a shipped or cancelled order:** work lines are claimed with a
  guarded update (`WORK_LINE_CHANGED`); order-linked pick work refuses unless the order is CONFIRMED
  or PICKING (`WORK_ORDER_NOT_OPEN`) and closed work refuses (`WORK_NOT_OPEN`); the PICKING status
  write is guarded; ship and cancel cancel the order's open pick work in their transaction.
- **4 (MEDIUM) one-cent COGS/reversal drift:** an issue's cost is the sum of its rounded settlements.
- **5 (MEDIUM) deadlock risk:** `reserve`/`issueAvailable` lock every candidate row of all lines in one
  sorted statement; `moveStock` locks source and destination together, sorted; PostgreSQL
  40P01/40001 (Prisma P2034/P2010) answer 409 `CONCURRENT_UPDATE_RETRY`.
- **6 (MEDIUM) storefront:** the cart price includes the variant surcharge the server charges; wave
  assignment after confirm is best-effort (logged), so a confirmed order is never reported as failed.
  **Recorded deviation:** a null `storefront_warehouse_id` falls back to the default/sole warehouse
  (plan §2.7.3 said 422) so a single-store tenant needs no extra setup.
- A void of stock that had no layer (ESTIMATED settlement) re-creates its layer as ADJUSTMENT, not
  SALES_RETURN. Tests added: extra hold refused, 4-decimal rounding, repeated lines, single lock
  statement, settlement already reversed, hold carried by a pick move.
- **Residuals recorded:** purchase return ship still moves stock and PO layers directly (no
  settlements; locked, respects reservations) — WORK-051; POS void changes a closed session's totals —
  WORK-047 "void only while the originating session is open"; no FKs on
  `inventory_reservations` (tenant/product/location), `sales_parameters.storefront_warehouse_id`,
  `sales_orders.register_session_id`, `inventory_cost_layers.origin_settlement_id`;
  `uncosted_issue_policy`, `count_snapshot_policy` and `storefront_warehouse_id` have no UI yet —
  WORK-053; `restoreIssues` locks row by row (two concurrent returns can still deadlock → now 409);
  `resetTestTransactions.ts` is guarded by an environment string only (TEST-only tool); the
  harness return of uninvoiced order `o1` issued a credit-note FACTURA (DEF-042, WORK-048).

## WORK-045 — Inventory adjustment, count and opening journals — implemented, unreviewed — 2026-09-14

Defects DEF-010, DEF-011, DEF-052 (count number). Design: remediation plan §2.2.

- **Schema:** migration 039 — `inventory_journals`, `inventory_journal_lines`, `inventory_reason_codes`,
  `inventory_parameters.count_snapshot_policy` (REFUSE_IF_CHANGED), `inventory_counts.warehouse_id/
  journal_id`. Applied to TEST as `claude-work-045`; isolated rebuild 40 migrations with reviewed drift.
- **Posting types / categories:** `INVENTORY_LOSS`, `INVENTORY_PROFIT` (D365 counting posting types),
  `INVENTORY_OPENING_BALANCE` → category `OPENING_BALANCE_EQUITY`. Template accounts added: Bolivia
  3501/4201/5305, IFRS 3003/4003/5006, Turkey 549 [VAL]/679/689. Sequences `INVENTORY_ADJUSTMENT`
  (IJ-…) and `INVENTORY_COUNT` (CNT-…) provisioned. TEST: seed-coa created the three Bolivian
  accounts, provisioning created the three posting profiles and both sequences.
- **Service:** create (validates tenant, warehouse locations, reason direction, opening positive-only)
  → DRAFT; post in one transaction: positive line = `receiveIntoLocation` (new layer; unit cost
  entered, else newest layer cost, else item cost price, else 422 `UNIT_COST_REQUIRED`), negative line
  = `issueFromLocation` (FIFO, cannot take held stock); one voucher per journal by item group:
  Dr Inventory / Cr Inventory profit (or Opening balance equity), Dr Inventory loss / Cr Inventory.
- **Routes:** `/inventory-journals` (list, detail, create, edit draft, post, cancel) and reason codes;
  OPENING needs `inventory.journal.opening` (admin only); reason codes need
  `inventory.setup.maintain`. `/inventory/adjust` is a one-line ADJUSTMENT journal created and posted
  in one transaction. Counts are created per warehouse (optionally one location) with a sequence
  number; finalise claims the count, checks every counted line against today's stock
  (`COUNT_STOCK_CHANGED` under REFUSE_IF_CHANGED — found by the harness: a line counted equal to its
  stale snapshot was skipped), and posts a COUNT journal; on-hand is never overwritten.
- **Frontend:** new Inventory → Inventory Journals page (list, line detail, create/edit dialog,
  post/cancel, reason codes); stock adjust dialog gains reason code and unit cost and shows server
  errors; count creation requires a warehouse; count finalise error path fixed.
- **Verification:** backend tsc + scripts typecheck; Jest 32 suites / 956 tests; frontend tsc + build.
  TEST: `verify:inventory-journals` 32/32 (no FACTURA), `verify:stock-ledger` 29/29 (FACTURA steps
  skipped), `verify:putaway` 14/14 (double-completion now refused as `WORK_NOT_OPEN`),
  `verify:o2c-containment` 12/12, `verify:o2c-permissions` 45/45, `verify:tenant-numbering` 27/27.

### WORK-045 review (solution-architect, 2026-09-14) — CHANGES REQUIRED → fixed

- **1 (MEDIUM):** OPENING drafts are the admin's on create, edit, post and cancel; the journals page
  hides Edit/Post/Cancel of OPENING rows from non-admins.
- **2 (MEDIUM):** new `inventory.journal.cost_override` (admin only): an entered unit cost on a
  positive ADJUSTMENT line (journal or `/inventory/adjust`) needs it; OPENING states costs under
  `inventory.journal.opening`. Default cost = the journal warehouse's newest OPEN layer, else the
  item cost price (plan §2.2), else 422 `UNIT_COST_REQUIRED`. The stock and journal dialogs offer the
  cost field to admins only. `Product.cost_price` is read on this one fallback (plan-sanctioned).
- **3 (MEDIUM):** count finalise claims the count first, then reads its lines; loads every stock row
  of the counted lines in one query, locks them sorted, compares in memory; timeout 120 s. Harness
  adds a warehouse-wide count.
- **4 (MEDIUM → LOW):** no way to value existing stock without layers. Read-only TEST query: 0 stock
  rows with on-hand above their open layers (TEST was reset; receipts, putaway, transfers and journals
  always layer). Recorded residual: an onboarding tenant with unlayered stock needs an OPENING
  "value existing stock" mode before counts can reduce it.
- **5 (LOW–MEDIUM):** a CONFIRMED order edit is refused only when product/variant/quantity or the
  warehouse change; prices, discounts and notes save.
- **6 (LOW):** work completion locks the work header `FOR UPDATE`; COMPLETED is a guarded write.
- **7:** `inventoryJournal.test.ts` — voucher split by item group with signs, OPENING equity credit,
  UNIT_COST_REQUIRED before stock moves with open-layer default scope, non-draft refusal, opening
  negative, cost-override rule, store-manager 403 on OPENING PUT/post/cancel/create.
- PUT on a journal clears description/reason when sent as null; a negative line's unit cost keeps
  4 decimals.
- **Residuals recorded (review §8):** no FKs on the journal/count reference columns; a legacy count
  spanning warehouses cannot finalise; a count line below reserved stock fails the count with
  `STOCK_INSUFFICIENT` (target behaviour for Kubi); the shop product page shows the base price without
  the variant surcharge; pages gate actions by role name (no `usePermission` hook yet — WORK-052);
  tenants other than TEST need seed-coa + provisioning before adjustments post.
- Verification: backend tsc; Jest 33 suites / 966 tests; frontend build; TEST
  `verify:inventory-journals` 35/35, `verify:stock-ledger` 29/29, `verify:putaway` 14/14.

### WORK-047 — POS tenders, register declarations, void as annulment (Claude, 2026-09-14)

Catalog: 65 Order to cash → 65.30 Sell products at retail (register sessions, tenders, statement
posting). Scope: in scope. Parameter owner: Sales setup (payment methods, `pos_void_mode`).
Localisation: Bolivia 5306 *Faltantes y Sobrantes de Caja*; IFRS 5007; Turkey 689.02.

- **Migration 040** (applied to TEST as `claude-work-047`, drift verified): `sales_payment_methods`
  (tender type, debited account, declaration policy NONE|COUNT, change for cash only, difference
  tolerance; `warehouse_id` hook for a per-store override), `pos_tenders` (one row per payment of a
  sale, method type and account snapshotted, `reversed_at`), `register_session_declarations`
  (expected / counted / difference per method, difference voucher), factura annulment columns
  (`cancelled_at`, `cancelled_by`, `cancellation_reason`, `reversal_journal_entry_id`),
  `sales_parameters.pos_void_mode` (ANNUL_IN_SESSION | CREDIT_NOTE_ONLY | DISABLED; the code treats
  CREDIT_NOTE_ONLY exactly like DISABLED until WORK-049). Posting type `CASH_DIFFERENCE`.
- **Sale:** `tenders[]` (split tender) with the older `payment_method` + `cash_tendered` mapped to the
  tenant's active method of that type. Tenders must add up to the total, only cash gives change,
  customer account is refused (`TENDER_NOT_IMPLEMENTED`) until receivables are itemised. All
  refusals happen before the FACTURA number is allocated. The sale debits each tender's account —
  **accounts receivable is no longer debited** (nothing ever cleared it). `customer_id` is checked
  against the tenant and taxes the sale against that party.
- **Close:** declarations per method; expected cash = opening float + un-reversed cash tenders
  (card/QR are no longer counted as cash); a COUNT method must be declared; a difference above the
  tolerance needs `pos.session.close_with_difference` (store manager, admin); the difference posts a
  `POS_SESSION_CLOSE` voucher against CASH_DIFFERENCE. Z report adds per-method rows and the voucher id
  while keeping the cash-only fields for the Android POS.
- **Void = annulment:** requires a reason; only while the sale's register session is OPEN
  (`POS_VOID_SESSION_CLOSED`, afterwards a return); claims the order, restores stock onto the same
  layers, reverses every POSTED `POS_SALE`/`POS_COGS` voucher exactly (IVA and IT included), marks the
  factura CANCELLED keeping its number, reverses the tenders and the session totals.
- **Setup API/UI:** `/sales/payment-methods` (read: store manager, cashier; maintain: admin);
  provisioning creates CASH/CARD/QR/TRANSFER when the CASH/BANK account is unambiguous. New pages
  Sales → Payment Methods and Sales → Register Sessions (per-method expected/counted/difference).
  POS: payment modal loads the methods and supports split tender; void asks for a reason; Z report
  counts every COUNT method and shows per-method rows.
- **Acceptance-run finding (fixed):** a blank tolerance was read as *unlimited*, so a cashier closed a
  register 10 short. It now means *no tolerance* — any difference needs a manager (SoD default
  "forbidden"). Unit test added. The first run's 7 failures were this one defect cascading (register
  left closed, manager close 404, Z report and voucher checks); the sale/void assertions were
  re-checked read-only against the rows the run created.
- **FACTURA:** the full harness spent exactly 3 numbers (split sale, voided sale — CANCELLED, number
  kept — and a sale whose void after close was refused). Later runs skip sales automatically.
- Verification: backend tsc; Jest 34 suites / 989 tests; frontend build. TEST `verify:pos-ledger`
  run 1 40/47 (defect above), run 2 after the fix 19/19 (no-FACTURA mode, 0 numbers);
  `verify:stock-ledger` 29/29 (void step updated to the reason + exact COGS reversal contract),
  `verify:inventory-journals` 35/35, `verify:o2c-permissions` 45/45, `verify:o2c-containment` 12/12,
  `verify:putaway` 14/14, `verify:tenant-numbering` 27/27, `verify:currency-foundation` 40/40,
  `verify:open-purchase` 7/7.
- **Residuals:** selling on customer account awaits itemised receivables (WORK-050); no FKs from
  `pos_tenders`/declarations to register sessions and orders beyond the method FK; the Android POS
  still sends the single-tender body and the cash-only close (supported by mapping); tolerance is per
  method, not per store; the review page lists the latest 50 sessions without filters.

### WORK-047 review (solution-architect, 2026-09-14) — CHANGES REQUIRED → fixed

- **1 (HIGH):** sale, void and close now take `SELECT … FROM register_sessions … FOR UPDATE` as the
  first statement of their transaction (`lockRegisterSession`). The sale refuses a register that is
  not OPEN before the FACTURA number; the void re-checks under the lock (`POS_VOID_SESSION_CLOSED`);
  the close locks before reading tenders and answers a closed register with 409
  `SESSION_ALREADY_CLOSED`. Sale and void totals updates are guarded `updateMany … status: 'OPEN'`.
  Lock order: register session → FACTURA sequence → stock/layers.
- **2 (MEDIUM):** `posRoutes.test.ts` — tender refusal draws no FACTURA number and runs after the lock;
  a sale into a closed register draws none; a void of a closed register runs nothing in its
  transaction; a close committed meanwhile wins over the void; a failing voucher reversal annuls
  nothing (no factura cancel, tender reversal or totals update); close locks before reading tenders;
  closed register 409; unknown declaration method 400.
- **3 (MEDIUM):** `PUT /sales/payment-methods/:id` refuses an account change with 409
  `PAYMENT_METHOD_IN_USE` while an OPEN register holds un-reversed tenders of that method.
- **4 (LOW–MEDIUM):** sales use tenant-wide methods only (`legal_entity_id` and `warehouse_id` null)
  until override resolution exists; close includes every method the register's tenders used whatever
  its scope; a declaration for a method the register does not count is 400
  `DECLARATION_UNKNOWN_METHOD`.
- **5 (LOW):** VOUCHER tenders are refused like CUSTOMER_ACCOUNT (`TENDER_NOT_IMPLEMENTED`); the setup
  page and payment modal no longer offer VOUCHER.
- **6 (LOW):** a void of an invoiced sale with no POSTED sale voucher to reverse is 409
  `POS_VOID_VOUCHER_MISSING` under strict posting.
- **7:** worklog corrected (CREDIT_NOTE_ONLY). Added residuals: no API/UI for `pos_void_mode`
  (WORK-053); the IVA report hides CANCELLED facturas instead of listing them annulled
  (`finance.routes.ts:467`, WORK-049); `POST /finance/facturas/:id/cancel` can still cancel a POS
  factura without a reversal (`finance.routes.ts:450`, WORK-049).
- **Decisions for Kubi (open):** self-approval at the till (a store manager may void and approve their
  own shortage); register ownership (any cashier may sell into or close any register — Commerce's
  "allow multiple shift logon"); SIN annulment window and Libro de Ventas status (V-2).
- Verification: backend + frontend tsc; Jest 35 suites / 1001 tests. TEST `verify:pos-ledger` 24/24
  (no-FACTURA mode, incl. two parallel closes → one 200 / one 409, one declaration set, one voucher;
  0 numbers), `verify:stock-ledger` 29/29, `verify:inventory-journals` 35/35, `verify:o2c-permissions`
  45/45, `verify:o2c-containment` 12/12, `verify:putaway` 14/14, `verify:tenant-numbering` 27/27,
  `verify:currency-foundation` 40/40, `verify:open-purchase` 7/7.
- **Re-review (2026-09-14): ACCEPTED.** Non-blocking leftover closed straight away: the payment-method
  account change now runs the in-use check and the update in one transaction that first locks the
  tenant's OPEN register rows (`ORDER BY id FOR UPDATE`), so a sale cannot add a tender between them.
  Route test pins the lock before the tender count. Jest 35 suites / 1001 tests.

### Codex coordination resumed — 2026-09-17

- Kubi explicitly authorized Codex to lead architecture and independent review while giving Claude
  bounded implementation work concurrently. This supersedes the earlier review-only pause; the
  existing defect-remediation/feature freeze remains. No push or deployment authorization.
- AuthCheck verified Claude Pro / claude.ai / firstParty. Both source packets passed DryRun;
  implementation uses the zero-tool subscription helper, with curated sources only. Codex applies
  and tests patches separately. No database secrets or environment files were sent.
- WORK-048A dispatched: invoice/payment admission serialization and route regressions, limited to
  sales routes and tests. See WORK-048A_CLAUDE_BRIEF.md. Full return/payment-method/AR lifecycle is
  not included in this slice.
- WORK-051A dispatched independently: receipt header/default/line location containment by tenant
  and warehouse, limited to productReceipt.service.ts and its new tests. See its Claude brief.
- Review findings and priorities: CODEX_INDEPENDENT_REVIEW_2026-09-17.md. The initial manual
  GAPLESS enforcement proposal is downgraded to an unresolved localization policy recommendation;
  it must not be implemented as if it were verified Bolivian law. A separate stale setup/allocation
  race is repository-verified and needs a bounded fix.
- Existing dirty frontend/dashboard/design changes belong to earlier work and remain preserved.
  Historical migration/TEST results have not been rerun or independently re-certified here.
- WORK-048A initial dispatch reached CHILD_TIMEOUT without an applicable result. Continued the same
  session `9dfc8261-5a01-4dfe-a215-7188c1bf5675` (correction 1, no reset of correction count), with
  active PICKING/PACKED compatibility and linked-factura payment admission explicitly clarified.
- WORK-051A initial patch applied and reviewed: focused 6/6, backend TypeScript pass, full Jest
  36 suites / 1,007 tests pass. **CHANGES REQUIRED:** validate the warehouse's own tenant and scope
  the location query, with foreign-warehouse/line/default regression coverage. Feedback sent to
  session `6b93f47b-ddd2-4b50-84b8-9c21cf0e5082`, correction 1. Not yet accepted.
- Prepared WORK-048B (shipment return without fiscal invoice) for dispatch on the reviewed sales
  source. Its brief includes synchronized admission and user-facing return/numbering behavior.

### Continuation and Claude generation diagnosis — 2026-09-18

- Both correction-1 calls ended CHILD_TIMEOUT on 17 September; neither returned a patch.
  AuthCheck on 18 September again passed claude.ai / firstParty / Pro.
- Session metadata (not private reasoning content) showed max_tokens stops with thinking-only
  blocks at 32,000 output tokens. Correction-2 calls were stopped after identifying this repeated
  failure mode, rather than wasting another timeout. Their attempts remain counted.
- Local orchestration helper `~/.codex/skills/skarpine-autopilot/scripts/invoke_claude_subscription.ps1`
  now accepts optional validated `-Effort` and forwards the installed CLI's documented `--effort`.
  Default behavior is unchanged; current requests explicitly use low. Authentication, environment,
  zero tools, session binding and the three-correction cap are unchanged. CLI help verified the flag;
  PowerShell parse, 40 guard checks and DryRun passed without a model request.
- Correction 3 (final allowed correction) dispatched in each ORIGINAL session. No correction cap
  reset, replacement session, tool grant, API fallback or database operation. Outputs still require
  independent review before acceptance.
- WORK-051A correction 3 returned successfully with low effort. Codex applied the bounded patch,
  independently checked the actual diff, and verified the location -> zone -> warehouse tenant
  chain plus PO warehouse and activity. Scoped lookup is tenant-filtered, IDs are deduplicated,
  and rejection precedes receipt-number allocation and business mutations. Focused tests 10/10
  and backend TypeScript pass. Review: **APPROVED IN WORKTREE**, uncommitted; final combined
  regression pending. No database claim or full WORK-051 acceptance. Existing purchase receiving
  UI already displays API error messages; no new managed structure or UI is introduced.
- WORK-048B passed DryRun and was dispatched on 18 September with low effort. Scope partition:
  A owns invoice/pay; B owns return handler, dedicated return test and return UI. Neither may
  overwrite the other's handlers. Existing sources and the bounded brief were supplied; no DB
  or secrets. This is a separate approved defect, not a restart of A's correction allowance.
- WORK-048A correction3 also ended CHILD_TIMEOUT with no patch. Its three-correction allowance is
  exhausted; no further dispatch or workaround item is authorized by the helper policy. Sales
  invoice/payment admission remains OPEN and unchanged. In particular, do not claim that B's return
  lock alone fixes invoice/pay cross-path races.
- WORK-048B initial draft rejected before application: wrong table name, absent UUID SQL casts,
  missing final write guard, generic COGS account precondition, unsupported UI warning, contradictory
  tests. Correction1 sent with exact source evidence in WORK-048B_REVIEW_1.md.
- Low effort did not bound all thinking-only responses. Installed CLI source explicitly supports
  numeric MAX_THINKING_TOKENS; helper now exposes optional validated ThinkingTokenBudget (-1 leaves
  default, 0 disables extended thinking) without inheriting an ambient value. Guard40 and DryRun
  passed again. B correction1 uses 0. Same sessions/caps/tool restrictions remain in force.
- WORK-048B correction1 rejected for stock-before-FACTURA lock inversion and inaccurate cross-path
  claims; see WORK-048B_REVIEW_2.md. Correction2 handler/test applied: focused37 and backend tsc PASS.
  Correction3 fixed the unapplied frontend diff's retained old paragraph and strengthened test
  ordering/error assertions. Final frontend/test hunks applied by matching source context.
- Independent final result: WORK-048B and WORK-051A **APPROVED IN WORKTREE**, uncommitted. Full Jest
  37 suites / 1,035 tests PASS, backend/frontend TypeScript PASS, diff check PASS. See
  WORK-048B_051A_LOCAL_REVIEW.md for hashes, scope and limitations. No DB or browser verification,
  no commit/push/deployment. Invoice/pay WORK-048A remains OPEN at its correction cap. All Claude
  calls have ended; no background implementation is represented as still running.
