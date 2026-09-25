# WORK-048A — Invoice/payment flow validation

2026-09-18. Codex architecture review requested by Kubi. Research: direct Microsoft Learn MCP
search and fetch, plus current repository. This is a design validation, not implementation or
concurrency-test evidence. Earlier WORK-048A implementation attempts remain stopped at their cap.

## Verdict

The stale admission defect is confirmed by repository inspection. The proposed transactional
containment is valid, but order-level invoice_id/paid_at must not become the permanent AR model.
Duplicate execution, legitimate partial invoicing, and legitimate partial payments are different
cases. A locked invoice/payment handler alone does not close every order edit/cancel/return race.

## Official documentation

1. Customer invoices can precede delivery, or use packing slips. Invoiced remainder permits
   subsequent invoices for remaining quantities. Quantity and summary-update settings control
   posting; one invoice per order is not a universal D365 rule.
   https://learn.microsoft.com/dynamics365/finance/accounts-receivable/configure-customer-invoices
2. Customer payment and settlement are distinct. Payments may be posted before allocation to an
   invoice; settlement can accompany posting or occur afterwards. Invoice/payment balances track
   the remaining amounts. AR parameters own automatic settlement and settlement priority.
   https://learn.microsoft.com/dynamics365/finance/cash-bank-management/settlement-overview
3. Partial payments leave the invoice open with a remaining balance. Cash-discount treatment is
   parameterized; this is not equivalent to a single paid_at flag.
   https://learn.microsoft.com/dynamics365/finance/accounts-receivable/customer-payments-partial-amount
4. X++ forUpdate and ttsLevel enforce update selection and same-transaction scope; exceptions
   abort the transaction. This supports atomic read/validate/write design. It does NOT document
   PostgreSQL lock semantics or prove that X++ forUpdate equals SQL SELECT FOR UPDATE.
   https://learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/dev-ref/xpp-data/xpp-transaction

## Repo-verified failure paths

- sales.routes.ts:197/202 reads the order and checks invoice_id before transaction at :271.
  Two requests can both pass; the sequence lock assigns distinct numbers but cannot refresh the
  stale order. :317 unconditionally overwrites the order invoice link. Line quantities read later
  do not make the earlier header total/admission safe.
- sales.routes.ts:411/417 reads paid_at before transaction at :443; :444 unconditionally marks
  paid. Two requests can each post the full payment. There is no terminal-order or linked-factura
  status validation in this route.
- sales.routes.ts:590 now locks and reloads for return. Invoice/pay still do not follow this
  admission contract, so the return fix alone cannot prevent posting after a return winner.
- sales.routes.ts:473 and :537 edit mutable order/line data without the shared transaction
  contract. Invoice locking alone does not prevent line replacement racing with posting.
- finance.routes.ts:449 cancels an ISSUED factura by status update only. A payment lock could
  reject a previously cancelled invoice, but cannot prevent this route cancelling after payment
  commits without reversal. That lifecycle defect remains WORK-049.
- schema.prisma:2010 has SalesOrderLine.invoiced_qty; FacturaLine at :4430 supplies invoice-line
  provenance. These hooks must survive containment. Full customer open transactions/settlement
  remain the separately documented schema gap; no claim that paid_at provides that foundation.

## Architectural recommendation: bounded containment contract

Current endpoint behavior is whole-order invoice / full payment. Preserve that limited behavior
while fixing duplicate execution; do not add a unique order-to-invoice constraint that blocks
future partial invoicing. Do not call this completion of partial invoicing or itemized AR.

Invoice: begin TX -> lock tenant/order -> reload header and lines -> validate active state and
no existing invoice under current endpoint contract -> apply configured deduction/currency guards
-> resolve tax/accounts through tx -> allocate FACTURA -> create header/lines and journal -> guarded
order link -> commit. Preserve CONFIRMED/PICKING/PACKED/SHIPPED/COMPLETED compatibility and the
existing item-model deduction requirement; do not impose a universal ship-before-invoice rule.

Payment: begin TX -> lock tenant/order -> reload -> validate active state, invoice link, unpaid
state -> lock/reload tenant factura -> require valid ISSUED source -> currency/account checks ->
post payment journal and guarded paid marker -> commit. Failure aborts the complete unit. The
current invoice-required payment endpoint is not a prohibition on future customer prepayments.

Use the same order lock before return admission. Payment/return then see each other's committed
state: return first means payment refuses; payment first means return handles the paid branch.
The correctness of that branch's historical amounts/accounts is still a separate open defect.

Order edits and cancellation must obey compatible locking or atomic guarded claims. Full
cross-path acceptance must include them and the finance-cancel boundary; do not silently enlarge
the first patch and call all these cases fixed. Lock order must stay consistent: order before
linked factura/sequence, FACTURA before stock on invoiced return. Review all participants for
inversions; one local order is not a proof of global deadlock freedom.

HTTP retries after an unknown commit are a separate idempotency concern. The current narrow
contract can refuse a repeated completed action with 409 and require reload; this prevents another
posting but does not return the original success result. Durable replay-safe request identifiers
need a separately designed tenant-scoped operation record, not a claim of exactly-once delivery.

## Acceptance evidence required

1. Two invoice requests: one successful invoice, one conflict; one journal and order link; no
   extra committed automatic FACTURA increment from the loser.
2. Two full-payment requests: one successful payment, one conflict; one payment journal.
3. Return/payment and return/invoice, both winner orders: loser revalidates committed state.
4. Missing/foreign order, cancelled/missing/foreign linked factura, repeated and terminal states
   refuse before posting. Keep positive PICKING/PACKED and deduction/currency coverage.
5. Inject journal failure: no committed invoice, payment marker, lines or automatic counter change.
6. Edit/invoice and cancel/payment scenarios must either be proven under the shared contract or
   remain explicitly open; payment versus general factura cancellation remains WORK-049.
7. Mocked route tests establish call order/error handling; a controlled PostgreSQL concurrency
   harness with two transactions and a synchronization barrier is required for real race/rollback
   acceptance. Offline Jest/TypeScript alone cannot prove it. No DB test was run in this review.

## Scope, taxonomy, ownership and localization

- L1: 65 Order to cash; L2: 65.30 Manage accounts receivable.
- L3: existing UNVERIFIED-65.30-A/C/D placeholders (invoice/payment/settlement).
- L4: duplicate posting and competing lifecycle action scenarios; exact workbook IDs UNVERIFIED.
- L5: transactional posting/admission system processes; exact workbook IDs UNVERIFIED.
- L6: seven local acceptance groups above; exact workbook test IDs UNVERIFIED.
- Scope: CORE_NOW containment; broader partial invoicing/AR remains required follow-up, not waived.
- Parameter owner: Sales/AR; Finance owns accounts and posting/period controls. Concurrency safety
  is an invariant, not an optional parameter. Existing 1102 payment default is architectural debt;
  selection via SalesPaymentMethod stays in the full WORK-048 queue.
- Schema hook: NONE_REQUIRED for bounded serialization. Preserve existing line provenance and
  invoiced_qty. Missing AR settlement/payment schema remains explicitly open; do not represent it
  as NONE_REQUIRED for the full target flow.
- Bolivia: preserve configured IVA/IT, manual number contract and transactional automatic series.
  Microsoft global documentation does not validate Bolivian cancellation windows/credit-note law.

Implementation status: unchanged by this document. The flow is validated; the defect is not fixed.
