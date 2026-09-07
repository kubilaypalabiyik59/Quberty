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
