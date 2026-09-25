# Implementer ledger

This ledger records every task given to the local implementer (Ornith-1.5-9B via Aider) and its
outcome. It serves two purposes:

1. **Measuring whether the setup pays off.** It shows the rounds each task needed and whether each
   failure came from the model or from the harness.
2. **Building a fine-tuning dataset.** Accepted rows are training pairs of the form "task file →
   final accepted diff", which can be rebuilt from git with
   `git diff <base>..<accepted> -- <files>`. A LoRA fine-tune can be evaluated once there are about
   100–200 accepted rows. Rejected rounds are kept as negative examples.

The feedback loop runs in three layers, from strongest to weakest:

1. **Gate** (`docs/ai/check.mjs`, Aider's test-cmd). A defect pattern that can be detected
   mechanically becomes a check. The model gets the violation back as its next prompt and fixes it
   in the same run, before review.
2. **Conventions** (`docs/ai/IMPLEMENTER_CONVENTIONS.md`, read on every run). This layer is for
   patterns that cannot be checked mechanically.
3. **Task files.** Every task includes a "What already exists" import map, and it shows critical
   patterns as code, not as prose.

When a review finds a new failure pattern: add a gate check if the pattern is detectable,
otherwise add a convention rule, and in both cases cite the ledger row.

| Task | Task file | Base | Model commits | Rounds | Verdict | Failure causes | Notes |
|---|---|---|---|---|---|---|---|
| Landing T1 | `docs/design/landing-tasks/T1.md`, `T1-fix1.md` | `cd4e4ec` | `f23f4e4`, `79c8b7e` | 3 | ACCEPTED 2026-09-25 | R1 harness: numbered path headings in the task file caused an edit-format failure. R2 harness: a bare `npx tsc` downloaded the npm package "tsc". R2 model: omitted all imports in `getLocale.ts`. | Logic was correct from R1. Behaviour tests: 19/19 pass. |
| Landing T2 | `docs/design/landing-tasks/T2.md`, `T2-fix1.md` | `a7c3462` | `3573a75` (committed by architect), `c2f50da` | 2 | ACCEPTED 2026-09-25 | R1 harness: target dir `_components/` did not exist, so Aider ran with "Git repo: none" (no commit; test-cmd ran from the wrong cwd). R1 model: `Reveal` dropped `className` on the animated branch; `hidden md:flex` on an inner div left an empty `<nav>` landmark on phones. | No import errors (first task with the conventions file). The client/server boundary was right first time. Fixed by `docs/ai/run-task.sh`. |
| Landing T3 (spec T3-T5) | `docs/design/landing-tasks/T3.md`, `T3-fix1.md` | `c8d0aaa` | `ab62d27`, `e42142b` (self-fix attempt), `c6c7a5b` | 2 (R1 used all 3 auto-test reflections) | ACCEPTED 2026-09-25 | R1 architect: the task said "pick the icon with `ICONS[i]`" without showing the JSX form. R1 model: wrote `<ICONS[i] />` (TS1003) and could not diagnose it across 3 reflections. It also omitted doc comments. | First real model limit: it cannot debug an unfamiliar syntax error from the compiler message alone. It fixed the error first time once shown the exact pattern. Lesson: show critical patterns as code, not prose. |
| Landing T4 (spec T6-T8) | `docs/design/landing-tasks/T4.md` | `9c34ab5` | `d52e6a2` | 1 | ACCEPTED 2026-09-25 (two nits carried into T5) | None blocking. Nits: `Foundation.tsx` used a value `import` for a type, and its doc comment was inaccurate. | First single-round acceptance. The task showed every render pattern as code and pointed at the model's own accepted `OneSystem.tsx` as reference. |
| Landing T5 (spec T9-T10) | `docs/design/landing-tasks/T5.md`, `T5-fix1.md` | `70a021f` | `8b343ef`, `5a0ecfe`, `ae8b4c8` (moved into place by architect) | 2 | ACCEPTED 2026-09-25 | R1 architect: the task omitted the "What already exists" import map. R1 model: guessed a wrong import path for `CtaLink` and **fabricated `DEMO_EMAIL = 'demo@quberty.dev'`**. R2 model: correct content, but the path line held only the basename, so Aider wrote the file at the repo root. | The fabricated constant compiles and looks plausible; only line-by-line review catches it. This is why posting, tax and numbering code stays out of the implementer's scope. `page.tsx` was given nearly verbatim. |
| Landing T6 (integration) | `docs/design/landing-tasks/T6.md` | `460a0a5` | `dfc1809` | 1 | ACCEPTED 2026-09-25 | Both defects came from the architect's spec, found in the browser: (1) `Reveal` branched on `useReducedMotion()`, which left reduced-motion users with content stuck at opacity 0 after hydration; (2) the header nav at `md` overflowed by 51 px in Spanish at 768 px. | The fix code was given verbatim; the implementer applied it cleanly. Browser acceptance: 9/9 language x width combinations with 0 px overflow, the switcher persists via cookie, and reduced-motion content is visible. |
