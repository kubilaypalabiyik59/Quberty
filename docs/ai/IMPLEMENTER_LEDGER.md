# Implementer ledger

This ledger records every task given to the local implementer (Ornith-1.5-9B via Aider) and its
outcome. It serves two purposes:

1. **Measuring whether the setup pays off.** It shows the rounds each task needed and whether each
   failure came from the model or from the harness.
2. **Building a fine-tuning dataset.** Accepted rows are training pairs of the form "task file →
   final accepted diff", which can be rebuilt from git with
   `git diff <base>..<accepted> -- <files>`. A LoRA fine-tune can be evaluated once there are about
   100–200 accepted rows. Rejected rounds are kept as negative examples.

Conventions every task inherits: `docs/ai/IMPLEMENTER_CONVENTIONS.md`. When a review finds a new
failure pattern, add a rule there and cite the ledger row.

| Task | Task file | Base | Model commits | Rounds | Verdict | Failure causes | Notes |
|---|---|---|---|---|---|---|---|
| Landing T1 | `docs/design/landing-tasks/T1.md`, `T1-fix1.md` | `cd4e4ec` | `f23f4e4`, `79c8b7e` | 3 | ACCEPTED 2026-09-25 | R1 harness: numbered path headings in the task file caused an edit-format failure. R2 harness: a bare `npx tsc` downloaded the npm package "tsc". R2 model: omitted all imports in `getLocale.ts`. | Logic was correct from R1. Behaviour tests: 19/19 pass. |
| Landing T2 | `docs/design/landing-tasks/T2.md`, `T2-fix1.md` | `a7c3462` | `3573a75` (committed by architect), `c2f50da` | 2 | ACCEPTED 2026-09-25 | R1 harness: target dir `_components/` did not exist, so Aider ran with "Git repo: none" (no commit; test-cmd ran from the wrong cwd). R1 model: `Reveal` dropped `className` on the animated branch; `hidden md:flex` on an inner div left an empty `<nav>` landmark on phones. | No import errors (first task with the conventions file). The client/server boundary was right first time. Fixed by `docs/ai/run-task.sh`. |
