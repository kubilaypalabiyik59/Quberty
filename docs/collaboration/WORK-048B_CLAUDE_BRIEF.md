# WORK-048B — Shipment return without a fiscal invoice

Prepared 2026-09-17 by Codex under Kubi's ongoing remediation authorization. Dispatch clarification
2026-09-18: may run concurrently with WORK-048A because this item owns only the return handler,
its dedicated tests and return UI. Use a local parameterized order lock inside the return transaction,
without editing A's helper or invoice/pay handlers. Codex applies non-overlapping hunks and verifies
the combined result. Claude owns code, Codex review/tests.

Catalog: 65 Order to cash; 65.20.400.000 and existing UNVERIFIED-65.30-B/E placeholders from the
approved remediation plan. Exact scenario/system/test workbook IDs remain unverified. Scope
CORE_NOW. Parameter owner Sales; no new parameter. Schema hook NONE_REQUIRED for this behavior:
existing order, issue settlement and journal records support shipment reversal. Deferred customer
credit linkage/itemized receivables remain separate schema design work.

[REPO-VERIFIED] WORK-048 section 2.6 already requires uninvoiced return to reverse shipment only;
current return allocates FACTURA and creates a negative factura regardless of invoice_id.
[OFFICIAL, Learn MCP 2026-09-17]
https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/sales-returns#post-to-the-ledger
describes the importance of original sales cost/discount references to exact reversals. The choice
to suppress a credit document for an uninvoiced shipment is our approved bounded process decision.

## Contract

- Allowed: sales.routes.ts return handler ONLY, new backend/src/__tests__/salesReturnLifecycle.test.ts,
  frontend/src/app/(erp)/sales/orders/[id]/page.tsx for accurate return behavior/messages only.
- You are not alone. Preserve the existing WORK-048A invoice/pay work and every unrelated edit.
- Return acquires the same tenant/order lock FIRST and reloads order+lines inside the transaction.
  Refuse non-SHIPPED/non-COMPLETED or already-returned state before any allocation/stock mutation.
  This serializes competing returns. Invoice/pay admission remains unsafe until WORK-048A lands;
  do not claim cross-path protection from this lock alone. For invoiced returns acquire the
  FACTURA sequence after the order lock and before stock locks, consistent with POS sequence/stock
  ordering. Parameterized SQL only.
- If invoice_id is null: no nextFacturaNumber, no factura create, no invoice/payment GL reversal,
  no tax recomputation, and no manual credit-note number requirement. Reject a supplied nonempty
  factura_number with 400 (do not silently discard an operator-entered fiscal number). Refuse
  inconsistent paid_at with no invoice (409) rather than lose a payment silently.
- Restore the issue's recorded cost through restoreIssues and existing postIssueCogs reversal;
  do not introduce product-master fallback costs or require sales-tax/BANK/AR setup for this path.
  Guard final tenant/status order update and keep existing valid customer-stat reversal atomic.
- Invoiced path retains its current behavior in this slice apart from synchronized admission and
  use of tx-supported reads. Its historical-tax and original-payment-account defects remain OPEN;
  do not silently claim full WORK-048 acceptance.
- UI: only consult/gate on FACTURA mode for invoiced returns; no manual number field/request for
  uninvoiced returns. Explain shipment/stock/COGS reversal without a credit note for uninvoiced
  orders. Do not promise exact reversal of all journals for the legacy invoiced path.
- Tests: no FACTURA/tax/invoice-reversal calls for uninvoiced path; restores recorded costs;
  repeat/terminal/foreign-tenant refusal before effects; lock before read/number; concurrent winner
  reflected in reloaded state; journal failure propagates; manual supplied number rejected only
  for uninvoiced path. Mocked tests are not real PostgreSQL concurrency proof.
- Verification Codex performs: focused/full backend Jest, backend tsc, frontend tsc. No shared
  TEST writes, legal-number consumption, migrations, commit or push by Claude.

Return unified diff plus assumptions, checks not executed and residuals. NEEDS_CONTEXT for missing
source. Localization: no change to configured IVA/IT, FACTURA manual/automatic semantics for real
credit notes, or any unverified Bolivian legal requirement.
