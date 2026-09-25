#!/usr/bin/env bash
# Run one implementer task through Aider.
# Usage: docs/ai/run-task.sh <task-file.md> <file> [file...]
# TEST_CMD="..." replaces the default gate for this run, e.g. to add a Playwright spec to the
# feedback loop: TEST_CMD="node docs/ai/check.mjs && cd frontend && npx playwright test <spec>".
# Output streams to .aider.run.log (watch it with: Get-Content .aider.run.log -Wait -Encoding UTF8).
set -u
cd "$(git rev-parse --show-toplevel)"
task="$1"; shift
# Aider looks for the git repo from each file's directory. When that directory does not exist
# yet it silently runs with "Git repo: none": no commit, and test-cmd runs from the wrong place.
for f in "$@"; do mkdir -p "$(dirname "$f")"; done
AIDER="${AIDER:-$HOME/.local/bin/aider.exe}"
extra=()
[ -n "${TEST_CMD:-}" ] && extra=(--test-cmd "$TEST_CMD")
PYTHONIOENCODING=utf-8 "$AIDER" --edit-format "${EDIT_FORMAT:-whole}" --message-file "$task" "${extra[@]}" \
  --yes-always --no-pretty "$@" > .aider.run.log 2>&1
code=$?
echo "EXIT $code" >> .aider.run.log
grep -q "Git repo: none" .aider.run.log && { echo "RUN INVALID: Aider found no git repo" >> .aider.run.log; exit 3; }
exit $code
