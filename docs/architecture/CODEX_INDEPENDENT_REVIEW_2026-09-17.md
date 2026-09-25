# Codex independent remediation review — 2026-09-17

## Review status

**Update 2026-09-18:** bounded WORK-048B return/UI and WORK-051A location containment are now
approved in the uncommitted worktree; see `../collaboration/WORK-048B_051A_LOCAL_REVIEW.md`.
Final offline regression: 37 suites / 1,035 tests PASS. WORK-048A is unchanged and open at the
Claude correction cap. The findings table below records the review baseline, not current claims
that these two contained defects are still unfixed. Cross-path invoice/pay concurrency and full
historical reversal are not fixed by WORK-048B. No database or browser verification was performed.

**Scope:** Independent re-review of the Claude-directed remediation checkpoint. Kubi's subsequent
2026-09-17 instruction explicitly authorizes bounded Claude implementation concurrently with
Codex review. The earlier blanket pause is superseded; the feature freeze remains.

**Evidence completed:** the current backend Jest run passes 35 suites / 1,001 tests; frontend
TypeScript and the production build pass. This is verification evidence, not a substitute for a
design review or acceptance decision.

## WORK-042 — legal number sequence safety

**Catalog:** 99.20.040.000 / 65.30. Scope: legal numbering and platform setup.

**Initial decision (superseded below): CHANGES REQUIRED — HIGH.**

**Review correction:** the following manual-policy proposal is an architectural recommendation,
not verified Bolivian law or an established acceptance requirement. Manual preprinted numbers are
an explicit existing contract. Do not implement automatic consecutive-number enforcement for
manual stock without resolving its jurisdictional policy. WORK-042 is not independently accepted,
but this uncertainty does not block unrelated, already-authorized lifecycle corrections.

### Finding CR-042-1 — manual GAPLESS FACTURA numbers bypass sequentiality control

- **Repo-verified:** migration `036_number_sequence_legal_series.sql` correctly marks FACTURA as
  `GAPLESS` and database-checks that such a sequence is continuous.
- **Repo-verified:** `backend/src/shared/services/numberSequence.service.ts:184-194` returns a
  user-supplied manual number after trimming it. It does not inspect issued FACTURAs, compare the
  candidate against the sequence, require a gap reason, or write a synchronous gap acknowledgement.
- **Repo-verified:** the unit test at
  `backend/src/__tests__/numberSequence.manual.test.ts:84-120` makes this behaviour explicit: a
  continuous manual sequence accepts arbitrary text and does not advance the counter. The baseline
  test at `backend/src/__tests__/failClosedBaseline.test.ts:91` explicitly excludes manual entry
  from gapless policing.
- **Repo-verified:** `Factura` only supplies tenant-plus-number uniqueness
  (`backend/prisma/schema.prisma`, `Factura` model); uniqueness prevents duplication, not skipped
  legal numbers.

**Why it matters:** Quberty's standing Bolivia rule is that factura numbering must retain legal
sequentiality. A `GAPLESS` declaration must not protect automatic allocation while letting manual
entry silently skip from, for example, `000034` to `000042`. Pre-printed stock can require a
non-consecutive action, but that action needs an explicit reason, audit evidence, and a defined
legal policy; it cannot be an unrecorded bypass.

**Architectural recommendation:** keep manual support, but introduce one shared validation path for
any `GAPLESS` FACTURA allocation. Where the supplied number is comparable to the configured
numeric format, it must be the next legal number or carry a recorded exception reason in the same
transaction as the factura. Where it is not comparable, refuse by default until the jurisdiction's
manual-stock policy is explicitly configured and audited. The design must also state the behaviour
for pre-printed, voided, lost and externally-issued stock before implementation.

**Schema hook decision:** none is required merely to validate comparable manual numbers. A later
manual-stock register or authority-document model would need an explicit design; do not add a
generic table before the legal policy is agreed.

**Localization effect:** high. This is a Bolivia FACTURA legal-series control and needs an explicit
Bolivia regression covering consecutive manual issue, rejected silent jump, and recorded authorized
exception.

**Acceptance evidence required:** route-level tests proving the three cases above, a rollback-safe
audit record for an authorized exception, full Jest, isolated migration verification only if the
policy needs schema, and a TEST run only if it can avoid consuming an unapproved legal number.

## Next review sequence

Continue the independent review of WORK-030b, WORK-043/044, WORK-045 and WORK-047 alongside the
authorized WORK-048A invoice/payment serialization patch. The preceding all-work gate is
superseded by Kubi's explicit instruction on 2026-09-17.

## Cross-process review and implementation queue

Evidence below is static repository verification, not a claim of fresh TEST execution. Catalog
placeholders are preserved from CORE_ERP_COMPLETION_MATRIX; lower-level scenario/system/test IDs
remain unverified where that matrix has not mapped them. Each slice must supply local regression
cases rather than treating the catalog as executable coverage.

| Priority / process | Repository evidence | Architectural action / acceptance |
|---|---|---|
| P1, 65 / UNVERIFIED-65.30-A,C | sales.routes.ts invoice/pay load mutable order state before transaction | WORK-048A dispatched to Claude: lock order, reload in transaction, refuse terminal/repeated operations before numbering/posting; mocked route regression plus backend build |
| P1, 65 / UNVERIFIED-65.30-B,E | sales.routes.ts return draws FACTURA unconditionally, recomputes tax, refunds current BANK, and updates order at the end | WORK-048B next: synchronize return admission with invoice/pay; uninvoiced return restores shipment without fiscal document. Then separately design exact stored invoice/payment reversal; tests for no FACTURA allocation and race refusal |
| P1, 65 / UNVERIFIED-65.30-A,B | finance.routes.ts:449 cancel only updates status; :467 IVA excludes cancelled documents entirely | WORK-049: atomic reversal/audit and POS-specific refusal; annulled-document visibility with totals exclusion. Legal cancellation windows remain validation items |
| P1, 99.20.040.000 / 65 | setup.routes.ts:478 reads sequence and later :581 starts transaction after history validation | Number setup can overwrite a counter based on stale history. Design serialization/CAS with allocation before modifying manual policy; deterministic concurrent allocation/setup regression |
| P1, 75.40 / 75.50.020.000 | purchase.routes.ts:669 receive-and-invoice calls receipt, invoice-create, invoice-post as separate operations | WORK-051: transaction composition; failed invoice must leave no receipt/stock/accrual. Existing services and public calls must keep transaction ownership explicit |
| P1, 60.30 / 75.40 | productReceipt.service.ts:174,275,301 uses supplied location without a tenant/warehouse lookup | WORK-051: validate header and per-line receiving locations before mutation; foreign-tenant/wrong-warehouse tests |
| P1, 90 / UNVERIFIED-90.60-A | finance.routes.ts:249 draft-post changes status directly | WORK-050: period and posting validation at final posting; close/post concurrency and maker/checker policy. Do not infer that draft-creation validation remains valid later |
| P2, 65.20 | sales.routes.ts PUT deletes/recreates lines outside one transaction | WORK-048 follow-up: strict edit schema, order admission lock, atomic replacement and monetary recomputation; coordinate with invoice lock |
| P1, 99.25 | hr.routes.ts:89 spreads arbitrary employee update fields; auth.routes.ts refresh verifies JWT and active user but never checks stored refresh-token revocation | WORK-052: strict HR allowlist and refresh rotation/revocation. Deactivation is already checked at refresh, so do not falsely report that specific check as missing |

Parameter ownership: Sales owns invoice/return/payment admission; Finance owns reversal/periods;
Setup owns sequence maintenance; Purchase and Inventory own receipt location validation. These
containment fixes need no new schema hook (NONE_REQUIRED). Existing documented AR itemization,
credit-note linkage and lifecycle-policy hooks remain separate design work, not silently waived.
Localization: retain configured Bolivia IVA/IT and existing numbering; never recompute historical
fiscal amounts as part of a reversal. No new legal interpretation is introduced here.

### Previous fixes: verified mechanisms, bounded confidence

- [REPO-VERIFIED] sales.service.ts:416 cancellation uses tenant/status/invoice-null guarded claim
  before releasing reservations. This protects cancellation against an invoice winner; do not
  replace it with an unconditional write.
- [REPO-VERIFIED] stockLedger.service.ts:68,73 locks stock/layers; :624 claims settlement reversal.
  POS void uses exact journal reversal (pos.routes.ts:565), unlike the still-legacy sales return.
  This difference is the reason to reuse established reversal services rather than invent a second
  accounting implementation.
- [REPO-VERIFIED] POS sale, close and void use register-session locking. This is not evidence that
  the general sales-return or finance-cancel routes share those protections.
- Historical TEST results and migration 040 deployment remain reported evidence from the handover;
  no fresh shared TEST or fiscal numbering run has been performed in this review.

### Source and taxonomy qualification

[OFFICIAL, Learn MCP 2026-09-17]
https://learn.microsoft.com/dynamics365/guidance/business-processes/order-to-cash-invoice-sales-orders-overview
connects sales invoices, credits, payments, refunds and settlements. It supports the process
boundary, not a claim that D365 prescribes our SQL lock implementation or Bolivia's legal policy.
The current plan's WORK-050 means finance controls, whereas older notes used a future AR work
number. Until reconciled, refer to the deferred capability as **itemized customer receivables**,
not as a reliably numbered implementation item.

### Current bounded review conclusion

Additional concurrency risk found during this review: productReceipt.service.ts reads outstanding
PO line quantity and later increments received_qty without a row lock, guarded quantity update,
or explicit serializable isolation. Two receipts can validate against the same outstanding
quantity. This is a repository-verified missing synchronization mechanism; an over-receipt race
still needs a deterministic reproduction before acceptance. Track separately from WORK-051A's
location validation so that passing its tests does not imply quantity concurrency is fixed.

Identity qualification: authMiddleware.ts trusts the access-token role until token expiry and
does not query current user activation. Refresh does check activation, but does not check the
stored refreshToken record. WORK-052 must define immediate versus expiry-bounded access-token
revocation explicitly; do not confuse these two lifetimes.

The stock/costing and POS improvements have substantive implementation evidence, but they do not
make the complete ERP ready for general release. The remaining risk concentrates at process
boundaries: sale versus invoice versus refund; receipt versus vendor invoice; draft versus posted
journal; role change versus session/token lifecycle. Resolve these with shared transaction and
authorization contracts, not further dashboard work. This is a risk-based architecture assessment,
not a claim to have exhaustively audited every route or independently replayed every migration.
