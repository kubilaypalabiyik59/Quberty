---
name: skarpine-second-opinion
description: Get a bounded, zero-tool second opinion from the OneProvider fallback (claude-sonnet-5) on a Skarpine design, schema plan, migration plan, or posting design — the role OneProvider played in WORK-017. Also covers the Claude-quota fallback for small implementation drafts. Uses Kubi's existing Codex router scripts; never touches key values.
---

# Skarpine second opinion (OneProvider)

Claude-side entry point to the existing router built during the Codex period. The authoritative
policy stays in `C:\Users\Nieuw\.codex\skills\skarpine-hybrid-model-router\` (`SKILL.md` and
`references/provider-policy.md`). Read both before first use in a session. This skill does not
change that policy; it only replaces "Codex applies and verifies" with "the main Claude session
applies and verifies, and the solution-architect agent reviews".

## When to use

- **Second opinion** on a schema plan, migration plan, posting/accounting design, or tenant/security
  design before it goes to Kubi. This is the proven use case (WORK-017 found real defects).
- **Quota fallback** for a small, bounded implementation draft only when Kubi explicitly selects
  it or the Claude subscription reports a capacity limit.
- NVIDIA NIM is **not** used by default: its only recorded call (WORK-020) failed. Use it only when
  Kubi explicitly asks, and only for the `LowRiskDraft` class.

## Rules

- Never read, print, copy, or ask for a key. Never set `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`,
  or any provider key as an environment variable — doing so would override the Claude
  subscription login.
- OneProvider is a third-party gateway, not Anthropic direct. Send only a curated, secret-free
  packet: the design text and the minimal relevant code excerpts. Never customer data, TEST data
  rows, `.env` contents, or connection strings.
- Output is an untrusted proposal. Nothing is applied without the main session verifying it against
  the repository; the solution-architect agent still performs the independent review.
- No silent fallback between providers. If the call fails, report the failure and continue without it.
- Record in the worklog that a provider was invoked, what it was asked, and whether any of its
  output was accepted.

## How to call

1. Check that a credential is present (reports presence only, never the value):

   ```powershell
   & "C:\Users\Nieuw\.codex\skills\skarpine-hybrid-model-router\scripts\provider_secret_status.ps1"
   ```

2. Write the curated packet to a file in the session scratchpad. Frame it as a review request:
   the design, the invariants it must hold (tenant isolation, Bolivia regression protection, posting
   balance, reversal/audit), and "list concrete defects with the failure scenario; do not restate
   the design".

3. Send it over stdin (never as an argument). Second opinions and drafts both use the
   `ImplementationPatch` class, the only class OneProvider accepts:

   ```powershell
   Get-Content -Raw "<scratchpad>\packet.md" | & "C:\Users\Nieuw\.codex\skills\skarpine-hybrid-model-router\scripts\invoke_bounded_model.ps1" -Provider OneProvider -TaskClass ImplementationPatch -MaxOutputTokens 4096 -TimeoutSec 120
   ```

   The script rejects prompts that look like they contain credentials and returns JSON with
   `content`, or `success: false` with an HTTP status.

4. Treat the returned findings like any reviewer's: verify each against the code before acting.
   Large patch requests have timed out before (WORK-016 HTTP 504); keep packets focused.
