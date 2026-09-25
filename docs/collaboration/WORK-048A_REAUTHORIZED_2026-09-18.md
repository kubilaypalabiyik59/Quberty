# WORK-048A — Explicitly reauthorized implementation

Kubi, after receiving the Microsoft Learn validation and the prior correction-cap explanation,
explicitly requested: "lutfen mimarini onerini claudeye uygulattir" (2026-09-18).
This renews the implementation instruction for the SAME item and original Claude session.
Keep corrections 1–3 recorded; allow at most three further dispatches (4–6). No manifest reset,
replacement item or auth/tool expansion. The helper's default remains three; an explicit limit
override requires an authorization reason, recorded in the same session manifest.

Design: WORK-048A_LEARN_FLOW_VALIDATION_2026-09-18.md is controlling. Catalog L1 65, L2 65.30;
L3 UNVERIFIED-65.30-A/C/D, L4 duplicate/competing posting scenarios, L5 admission/posting, L6 local
acceptance tests. Lower workbook IDs remain unverified. CORE_NOW, Sales/AR ownership, Finance
posting configuration. NONE_REQUIRED for serialization; preserve invoiced_qty/FacturaLine hooks.
No claim of a complete customer settlement schema. Bolivia defaults/numbering remain unchanged.

Current scope: invoice/pay admission and transaction-aware service reads, dedicated mocked tests,
existing currency regression adjustments. Return code from WORK-048B must remain intact.
Allowed paths: backend/src/modules/sales/sales.routes.ts (invoice/pay and local helper only),
backend/src/__tests__/salesLifecycleAdmission.test.ts (new),
backend/src/__tests__/salesInvoiceCurrencyGuard.test.ts,
backend/src/shared/services/posting.service.ts (use selected client for strictness lookup only).
Codex owns review and documentation; Claude owns implementation. Preserve all other edits.

Requirements: lock tenant/order first inside TX; reload state; active statuses CONFIRMED, PICKING,
PACKED, SHIPPED, COMPLETED only; refuse returned_at, duplicate invoice/paid state; currency and
configured deduction gate before number allocation; tx for all supported mutable reads and
service calls. Payment additionally locks tenant factura after order, reloads and validates ISSUED
status and SALE/POS_SALE source_id matches order. Guard tenant/status/invoice/paid final updates
and check count; failure rolls back all effects. Keep existing full-order/full-payment endpoint
contract; do not implement partial payments or prohibit future partial invoicing with schema.
Preserve current account-code API/default in this containment slice; SalesPaymentMethod migration
remains explicitly open debt in WORK-048. No new configuration or schema.

Return output: complete replacement invoice and payment handler blocks, any small helper/diff,
complete dedicated test file, small existing-test/service diffs. No full routes-file replacement,
no reasoning tags. Report checks not executed. Use separate DB and TX test doubles so any stale
outside-transaction admission reads fail tests. Sequential winner-state cases and mocked ordering
are not PostgreSQL proof. Cover failure propagation, terminal/tenant/factura refusals, positive
PICKING/PACKED, return winner, duplicate invoice/payment, and source/tenant/status final guards.

Approved verification: offline Jest and TypeScript, diff review; no Claude tools, DB, commits or
push. Codex may prepare a controlled PostgreSQL acceptance harness, but must inspect authorization
and environment before execution. No shared TEST change is implied by this packet.

Permanent product rule: configuration is module-owned data; existing hardcoding is tracked and
remediated within the relevant approved process scope; future behavior keeps schema hooks. This
slice is not full process acceptance. Edit/invoice and general factura cancellation races remain
explicitly open and must not be reported fixed by the invoice/pay patch alone.
