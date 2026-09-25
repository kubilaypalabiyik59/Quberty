# WORK-048B / WORK-051A — Independent local review

2026-09-18. Reviewer: Codex. Implementation author: Claude CLI, subscription-only, zero tools.

## Decision

**APPROVED IN WORKTREE** for these bounded slices. Uncommitted; not ACCEPTED_LOCAL at a commit,
not deployed, and not acceptance of complete WORK-048/051 or the ERP. Base HEAD `1aa6d83` on
`codex/rebuild-2026-09-07`. Existing dashboard and proxy edits are preserved.

Catalog, parameter ownership, schema-hook and localization decisions remain those in the two
Claude briefs. No schema changes; no new parameters; no change to Bolivia tax configuration or
manual fiscal numbering policy. Exact lower-level catalog IDs remain unverified as recorded.

## Repo-verified result

- `backend/src/modules/purchase/productReceipt.service.ts:183`: before allocation or receipt
  mutations, validates deduplicated header/default and effective line locations, including activity,
  tenant, zone tenant, PO warehouse and warehouse tenant. Stable 422 refusal. No new receive-bin
  policy. Quantity concurrency is outside this slice.
- `backend/src/modules/sales/sales.routes.ts:591`: tenant/order row lock before reload and admission.
  Returned and terminal states refuse before effects. Uninvoiced returns restore shipment cost and
  COGS without fiscal tax/accounts, FACTURA allocation, credit document or payment/invoice journals.
  A supplied fiscal number and paid-without-invoice inconsistency refuse explicitly. Invoiced
  returns retain legacy posting behavior, with transactional reads and order -> FACTURA -> stock
  ordering. Final order claim and customer statistics are tenant-scoped in the transaction.
- `frontend/src/app/(erp)/sales/orders/[id]/page.tsx:101`: sequence query, manual input, payload,
  errors and submit gate depend on invoice presence. Hooks remain unconditional before early
  returns. Copy distinguishes shipment reversal from a fiscal credit note and avoids promising
  exact reversal of every journal. Existing pending/error handling remains.

## Independent checks

- Focused pre-final run: 37/37 (24 return, 10 receipt location, 3 existing sales currency).
- Final full backend Jest: **37 suites / 1,035 tests PASS** after final test corrections.
- Backend TypeScript PASS after handler application; final correction changes tests only and
  ts-jest compiled them during the full suite. Frontend TypeScript PASS after final UI patch.
- `git diff --check` PASS. Actual route diff changes only the return handler.
- No DB connection/write, migration, fiscal-number consumption, server startup, push or deployment.
- Mocked tests verify branching, lock/read/number/stock call ordering and failure propagation.
  They do not prove real PostgreSQL contention or rollback. No browser/runtime UI pass performed.

Reviewed file blob hashes (not commits):

| File | Git blob |
|---|---|
| sales.routes.ts | c32aed41a5e6ce39d15ae5aab5f0adf0e1532644 |
| salesReturnLifecycle.test.ts | 16d89c60ed0cf68ea62199d523f487d2e2dc825b |
| productReceipt.service.ts | 10a22d3380a38a80ef0997036b3e02fdf5726d80 |
| productReceiptLocation.test.ts | bef047a4d5d4377b96118adbae66a0df8a61de46 |
| sales/orders/[id]/page.tsx | 4160c3c8d843dbc58e145b723b8a1765b5d9572a |

## Remaining work and coordination state

WORK-048A is unchanged and OPEN: initial plus three correction attempts yielded no applicable
patch. The skarpine-autopilot skill requires stopping this item at that cap; do not restart it
under another session/name. No Claude process remains active after these results.

The return lock serializes competing returns; it does not make invoice/pay admission safe.
Historical invoice-tax and actual payment-account reversal remain unresolved. General factura
cancellation still needs accounting reversal. Receipt over-quantity races and receipt/invoice
transaction composition remain separate WORK-051 work. See the independent architecture review
for the remaining prioritized queue. Preserve these limits when reporting readiness.
