# WORK-048A — Atomic sales invoice and payment admission

Date: 2026-09-17. Owner: Codex architecture/review; Claude CLI implementation.

2026-09-18 validation addendum: read
`docs/architecture/WORK-048A_LEARN_FLOW_VALIDATION_2026-09-18.md` before further implementation.
Its distinction between bounded duplicate-posting containment and full AR/partial-invoice design
supersedes any suggestion that invoice_id/paid_at is the final target model. The reference below
to itemized receivables as WORK-050 is obsolete: WORK-050 in the remediation plan is finance
controls. Refer to the capability by name until its work-item mapping is reconciled.
Authorization: Kubi explicitly resumed implementation and requested concurrent Claude work while Codex reviews the remaining defects. This supersedes the review-only pause in CODEX_RESUME. The feature freeze remains: remediate existing behavior.

## Evidence and scope

- [REPO-VERIFIED] WORK-048 in REMEDIATION_PLAN_WORK-042_054 requires invoice/payment admission inside the transaction. Current sales.routes.ts reads invoice_id and paid_at before its transaction, allowing duplicate postings.
- Catalog: 65 Order to cash; existing matrix placeholders UNVERIFIED-65.30-A (Issue sales invoices), UNVERIFIED-65.30-C (Process customer payments). Exact lower-level workbook IDs remain unverified; do not invent scenario/system/test IDs. Local scenarios: duplicate invoice/payment, terminal-state refusal, foreign tenant, rollback.
- [OFFICIAL] Microsoft Learn MCP checked 2026-09-17: https://learn.microsoft.com/dynamics365/guidance/business-processes/order-to-cash-invoice-sales-orders-overview describes invoicing, payment, credit, and settlement as connected receivables processes. This does not prescribe our locking implementation.
- [ARCHITECTURAL RECOMMENDATION] Use a tenant-scoped order row lock, then reload and validate the order through the transaction client before any number or voucher. Resolve related order data and supported service calls using that transaction client.
- Scope CORE_NOW; partial WORK-048 remediation, not full lifecycle acceptance.
- Parameter owner: Sales / receivables; no new parameter. Schema hook: NONE_REQUIRED for serialization; existing order/invoice/paid fields suffice. Itemized receivables remain WORK-050, existing documented model gap is not closed here.
- Localization: preserve IVA 13% inclusive, sales-only IT 3%, current continuous FACTURA transaction, and manual numbering contract; no change to legal policy or series.

## Implementation contract

Base branch codex/rebuild-2026-09-07, base commit 1aa6d83. You are not alone in the workspace. Preserve all existing dashboard, next.config, design and review-note edits. Codex will apply and test your returned patch; you have no tools.

Allowed files: backend/src/modules/sales/sales.routes.ts (invoice/pay handlers and a small shared local lock helper only), backend/src/__tests__/salesInvoiceCurrencyGuard.test.ts, new backend/src/__tests__/salesLifecycleAdmission.test.ts.

1. Invoice and pay must start a transaction, acquire a parameterized tenant/id-scoped sales_orders FOR UPDATE lock, and reload the order inside it. A missing or other-tenant order is 404.
2. Invoice accepts only CONFIRMED, SHIPPED, COMPLETED. Existing invoice is 409; RETURNED/CANCELLED/unknown status must be refused before allocation. Preserve deduction requirement and currency guards before allocation.
3. Payment accepts only CONFIRMED, SHIPPED, COMPLETED with invoice and no paid_at; other states or repeat payment are 409. All mutable admission reads belong to the same transaction. Preserve existing request/response shape, accounting and account-code contract in this slice.
4. Pass tx to supported currency, policy, tax, posting and order/line reads. Tenant-scoped guarded final writes remain desirable even under the row lock; verify their count. Do not move allocation outside the transaction. No stale pretransaction order values drive posting.
5. Add meaningful mocked route tests: duplicate requests after a winner commits allocate/post once; invalid terminal states; foreign tenant; lock precedes read and allocation; failed journal escapes the transaction and does not return success. Clearly distinguish mocked serialization from real PostgreSQL concurrency proof. Existing currency guard tests must still pass.
6. No unrelated refactor, schema/migration, DB access, frontend, payment-method selection or return rewrite. Return/pay and edit/invoice cross-path synchronization remain explicit next-slice work, not claimed fixed by this item.

Return ONE unified diff, assumptions, unexecuted checks, and remaining risks. If necessary source is missing, return NEEDS_CONTEXT rather than invent APIs. Do not execute anything. Codex will run reviewed offline Jest and backend TypeScript; no database, network test, commit or push is authorized to Claude.

## Architect review clarification (after initial dispatch)

The status list in points 2/3 must also retain PICKING and PACKED: sales.service.ts and the frontend INVOICEABLE_STATUSES explicitly recognize these active fulfillment states. Refusing them would be an unintended regression. Add positive coverage for both while preserving the deduction gate. Payment must also read and lock its tenant-scoped linked factura and refuse a missing/cancelled invoice before posting, as already specified by the full WORK-048 design. Lock order: order -> factura. This does not claim to fix the separate finance-cancel semantics. These corrections will be sent to the same Claude session with review feedback.
