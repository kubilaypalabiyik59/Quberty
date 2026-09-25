# WORK-048B — Correction 1 review

2026-09-18. CHANGES REQUIRED before application.

- [REPO-VERIFIED] POS sale allocates FACTURA before issuing stock (`pos.routes.ts:259`).
  The proposed return handler restores stock before acquiring FACTURA. Opposite lock ordering
  introduces a deadlock opportunity for different sales sharing stock and the tenant's sequence.
  Preserve order -> FACTURA -> stock ordering on invoiced returns. Uninvoiced returns must not
  consult the fiscal sequence, tax or fiscal posting-account configuration.
- Add ordering and allocation-failure-before-stock regressions.
- Remove the claim that this return lock serializes invoice/pay admission: WORK-048A has not
  landed, and those handlers still read state outside their transactions.
- Mocked route tests are not PostgreSQL integration/concurrency evidence.
- Use actual minimal frontend context and describe the return as recorded in accounting,
  without claiming exact reversal of all historical journals.

Correction 2 dispatched in the original session, with low effort and thinking budget 0.
No patch from the initial response or correction 1 has been applied.
