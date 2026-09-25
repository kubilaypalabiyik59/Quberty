# Vendor payment and settlement foundation

**Decision date:** 2026-09-09
**Catalog scope:** `75.50.090.000 Issue and settle supplier payments`; scenarios
`75.50.090.200`, `75.50.090.600`, `75.50.110.200`, and `75.50.120.100`
**Status:** Analysis and design only. No schema, migration, route, UI, or database change is
authorized by this document.

## 1. Decision

**[ARCHITECTURAL RECOMMENDATION]** Build the first AP settlement capability around three layers:

1. `VendorPayment` is the operational payment document.
2. `VendorOpenTransaction` is the AP subledger transaction created by an invoice, payment, supplier
   credit, or payment reversal.
3. `VendorSettlement` is an immutable allocation between two opposite-side AP open transactions.

This is narrower than a D365 payment-journal implementation and deeper than a direct
`payment_id -> invoice_id` join. The open-transaction layer is required because supplier credits are
already `CORE_NOW` in the purchasing matrix. A payment-only join would require another settlement
schema when credits arrive. This is a normal relational subledger table, not an EAV framework.

**[REPO-VERIFIED]** The current shortcut posts payment against `PurchaseOrder` and writes
`PurchaseOrder.paid_at`, even though the payable is created by `VendorInvoice`
([purchase.routes.ts:395](../../backend/src/modules/purchase/purchase.routes.ts#L395),
[schema.prisma:904](../../backend/prisma/schema.prisma#L904),
[schema.prisma:1126](../../backend/prisma/schema.prisma#L1126)). It cannot represent partial payment,
one payment across invoices, several payments against one invoice, supplier credits, or settlement
reversal.

## 2. Official process evidence

- **[OFFICIAL]** Issue and settle supplier payments sits under Manage accounts payable. Its process
  includes identifying, preparing, reviewing, approving, and issuing payments:
  <https://learn.microsoft.com/dynamics365/guidance/business-processes/source-to-pay-issue-and-settle-vendor-payments-overview>.
- **[OFFICIAL]** Settlement applies payment and credit transactions to invoice transactions and
  leaves the unallocated side open when amounts differ:
  <https://learn.microsoft.com/dynamics365/finance/cash-bank-management/settlement-overview>.
- **[OFFICIAL]** D365's `VendSettlement` relates vendor transactions, not invoice lines:
  <https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/finance/bank/transaction/vendsettlement>.
- **[OFFICIAL]** Partial supplier payment and later final settlement are supported:
  <https://learn.microsoft.com/dynamics365/finance/accounts-payable/vendor-payments-partial-amount>.
- **[OFFICIAL]** Reversing a posted payment reverses the bank voucher and undoes its settlements so
  the affected invoice transactions reopen:
  <https://learn.microsoft.com/dynamics365/finance/accounts-payable/reverse-vendor-payment#results-of-posting-a-reversal>.
- **[OFFICIAL]** Vendor posting profiles resolve the AP summary account by vendor, vendor group, or
  all vendors:
  <https://learn.microsoft.com/dynamics365/finance/accounts-payable/vendor-posting-profiles>.
- **[OFFICIAL]** Microsoft recommends separating vendor maintenance, goods receipt, and vendor
  payment duties:
  <https://learn.microsoft.com/dynamics365/guidance/implementation-guide/security-strategy-product-oa#security-diagnostics-for-task-recordings>.

The official model establishes the accounting semantics. It does not require Skarpine to copy
D365's batch journal UI, payment proposal engine, check/EFT generation, or full parameter surface.

## 3. CORE_NOW behavior

**[ARCHITECTURAL RECOMMENDATION]** The first sellable behavior is:

1. Create one draft payment for one supplier, amount, currency, payment date, and configured payment
   method.
2. Post it through the existing journal engine: debit the resolved AP summary account and credit the
   configured bank/cash offset account.
3. Allocate all or part of the posted payment transaction to one or more posted supplier invoices.
4. Allow several payments to settle one invoice over time.
5. Derive invoice and payment open balances from original AP transactions and immutable settlement
   allocations.
6. Reject an allocation that exceeds either open balance. No tolerance write-off is performed in
   CORE_NOW.
7. Reverse a posted payment with a linked reversing payment, reversing journal, and linked negating
   settlements. Original posted rows remain unchanged.
8. Correct a payment by reversing it and posting a new payment. **[UNVERIFIED]** Microsoft Learn
   exposes the catalog scenario but the research did not locate a dedicated correction mechanics
   page; reverse-and-repost is therefore a product recommendation, not an official claim.

Settlement can be entered with the draft payment, but allocations become effective only inside the
same transaction that posts the payment. A separately posted, still-unallocated payment remains an
open AP debit transaction that can be allocated later.

## 4. Data anatomy

Names below are design-level identifiers. Exact Prisma relations and indexes require implementation
review against the complete schema.

### 4.1 `VendorPayment`

| Field | Requirement |
|---|---|
| `id`, `tenant_id`, `legal_entity_id` | UUID identity; row-level tenancy; nullable legal-entity hook consistent with current foundations |
| `payment_number` | Internal AP number sequence; unique by tenant and legal entity, never governed by FACTURA rules |
| `supplier_id` | One supplier per payment |
| `payment_date`, `posting_date` | Business and accounting dates |
| `currency`, `amount`, `exchange_rate`, `amount_functional` | Immutable transaction and functional-currency snapshots; BOB remains the default |
| `payment_method_id` | FK to module-owned payment method configuration |
| `offset_account_id` | Resolved bank/cash/ledger account snapshot; no account-code default |
| `journal_entry_id` | Existing posted journal voucher; null while draft |
| `status` | `DRAFT` or `POSTED`; reversed state is derived from a posted row whose `reverses_payment_id` points here |
| `reverses_payment_id` | Set only on the new reversing payment; original payment is never mutated |
| `created_by`, `posted_by`, `created_at`, `posted_at`, `notes` | Audit evidence |

One row represents one actual disbursement. A batch header/line structure is unnecessary for
CORE_NOW. A later payment proposal can group many payments without changing this document.

### 4.2 `VendorOpenTransaction`

| Field | Requirement |
|---|---|
| `id`, `tenant_id`, `legal_entity_id`, `supplier_id` | AP account and tenancy boundary |
| `source_type`, `source_id` | `INVOICE`, `PAYMENT`, `SUPPLIER_CREDIT`, or `PAYMENT_REVERSAL`; one unique transaction per source document |
| `reverses_transaction_id` | Nullable FK set only on a new reversal transaction; points to the original AP transaction, which remains unchanged |
| `direction` | `CREDIT` for invoice liability; `DEBIT` for payment or supplier credit |
| `transaction_date`, `posting_date` | Immutable dates |
| `currency`, `amount`, `exchange_rate`, `amount_functional` | Immutable original amount snapshots |
| `journal_entry_id` | Voucher that created the AP transaction |

`open_amount` is derived as the original amount less signed settlement allocations. It is not a
mutable `paid_at` or `balance` column. A reporting view or service query may expose it.

**[ARCHITECTURAL RECOMMENDATION]** Use a constrained source discriminator plus source ID because the
set of AP document types is intentionally open and Prisma cannot express one FK to several tables.
The source service must prove tenant, supplier, posting state, and source uniqueness before creating
the transaction. This is the same bounded polymorphic provenance pattern already used by purchase
orders.

### 4.3 `VendorSettlement`

| Field | Requirement |
|---|---|
| `id`, `tenant_id`, `legal_entity_id`, `supplier_id` | Both sides must share these values |
| `debit_transaction_id`, `credit_transaction_id` | FKs to opposite-direction `VendorOpenTransaction` rows |
| `amount`, `amount_functional`, `exchange_rate` | Positive allocation and immutable settlement-date snapshots |
| `settlement_date` | Accounting date |
| `journal_entry_id` | Nullable; settlement needs a voucher only for dimension/currency differences |
| `reverses_settlement_id` | Set on a new negating settlement; the original row remains unchanged |
| `created_by`, `created_at` | Audit evidence |

The database must reject same-direction settlement, cross-tenant/cross-supplier allocation,
non-positive normal allocation, double reversal, and allocation above either open amount. The final
open-balance check and settlement creation must share one database transaction with row locking.

### 4.4 Existing `VendorInvoice`

**[REPO-VERIFIED]** It has `currency` and monetary totals but no exchange-rate or functional-currency
snapshot ([schema.prisma:1158](../../backend/prisma/schema.prisma#L1158)). The eventual migration must
add nullable/backfillable `exchange_rate` and `amount_functional`, create one
`VendorOpenTransaction` for each posted invoice, and deprecate `paid_at` only after every reader uses
derived settlement state. No historical value may be guessed.

## 5. Posting and reversal contract

### Payment posting

- **[OFFICIAL]** Resolve the AP summary account through vendor posting-profile specificity.
- **[ARCHITECTURAL RECOMMENDATION]** Resolve the bank/cash offset from `PurchasePaymentMethod`; never
  accept a raw GL account code as a default request value.
- Post `Dr AP summary / Cr configured offset` through the current journal service.
- Create `VendorOpenTransaction(direction = DEBIT, source_type = PAYMENT)` in the same transaction.
- Create requested settlements only after the payment voucher and open transaction succeed.
- Fail the entire operation if posting profiles, payment method, number sequence, tenant scope,
  period, or allocation validation fails.

### Reversal

- **[OFFICIAL]** A closed/on-hold period blocks reversal; settlement must be undone as part of the
  payment reversal:
  <https://learn.microsoft.com/troubleshoot/dynamics-365/finance/general-ledger/cant-reverse-transactions>.
- Create a new `VendorPayment` whose `reverses_payment_id` points to the original.
- Post `Dr configured offset / Cr AP summary` using the same resolved-account snapshots as the
  original payment.
- Create the opposite AP open transaction and one reversing settlement for each active allocation.
- Do not update or delete the original payment, open transaction, settlement, or journal entry.

## 6. Parameter ownership

| Configuration | Owner | CORE_NOW |
|---|---|---|
| Payment method and offset account | Purchase / Accounts payable Setup | Required; new tenant/legal-entity-scoped table |
| Default payment method | `PurchaseParameters` | Required nullable FK; user may override with another active method |
| AP summary account | Existing posting profiles | Required; extend existing most-specific-first resolver, do not add account literals |
| Payment number sequence | Purchase / Accounts payable Setup through shared allocator | Required new document type |
| Settlement mode | `PurchaseParameters` | `MANUAL` or `SELECTED_INVOICES`; no priority engine in CORE_NOW |
| Overpayment policy | `PurchaseParameters` | Enum with default `REJECT`; retain future `WRITE_OFF_WITHIN_TOLERANCE` value as a schema hook but do not implement it |
| Over/underpayment tolerances and write-off profiles | Purchase / Accounts payable Setup | Nullable hooks, unused while policy is `REJECT` |
| Reversal approval policy | Security/Accounts payable design | Deferred behavior; enum-ready hook rather than a boolean |

`PurchasePaymentMethod` should minimally carry tenant/legal-entity scope, stable code/name, offset
account FK, active flag, allowed currency or null, and a `BANK | CASH | LEDGER` account type. Bank
statement import and reconciliation identifiers are nullable hooks; no bank integration is built.

## 7. Security boundary

**[OFFICIAL]** Vendor maintenance, goods receipt, and payment processing are candidate conflicting
duties. **[ARCHITECTURAL RECOMMENDATION]** The payment surface needs separate permissions for draft
maintenance, posting, settlement allocation, reversal, and inquiry. Exact role names and approval
rules depend on the 99.25 audit.

The current `admin`/`store_manager` checks must not be copied into a new payment route as the final
authorization model. The 99.25 route/permission audit remains an implementation gate.

## 8. Deferred behavior and hooks

| Deferred capability | Current hook decision |
|---|---|
| Supplier credit settlement | `VendorOpenTransaction.source_type = SUPPLIER_CREDIT`; credit document remains a separate future item |
| Foreign-currency gain/loss | Currency, exchange-rate, and functional-amount snapshots on invoice, payment, open transaction, and settlement; posting behavior deferred |
| Over/underpayment write-off | `overpayment_policy` enum plus nullable tolerances/profile hooks; CORE_NOW rejects excess |
| Payment approval workflow | Enum-ready approval status and optional approval-event relation; exact workflow behavior waits for 99.25 design |
| Automatic settlement priority | `NONE_REQUIRED` for current documents; a future tenant policy can select open transactions without changing settlement anatomy |
| Payment proposals and batches | Existing standalone payments can later be grouped by a new proposal/batch join; no FK is required today |
| Check/EFT export and printing | Payment method is the attachment point; format/configuration tables are additive |
| Cash discounts | `VendorSettlement` can later reference a separate discount transaction; no nullable amount column is invented now |
| Promissory notes and centralized/intercompany payments | `NONE_REQUIRED`; excluded from the product promise and independently additive if later justified |
| Journal-level mass reversal | Existing `JournalEntry` relationship is the attachment point; payment-level reversal ships first |

## 9. Bolivia decisions

- **[REPO-VERIFIED]** The current product behavior applies configured IT 3% on the sales side and
  excludes it from purchase-side tax resolution; supplier-payment arithmetic therefore must not
  reuse IT as a withholding
  ([taxPreviewRoute.test.ts:101](../../backend/src/__tests__/taxPreviewRoute.test.ts#L101),
  [taxPreviewRoute.test.ts:119](../../backend/src/__tests__/taxPreviewRoute.test.ts#L119),
  [documentTax.service.ts:170](../../backend/src/shared/services/documentTax.service.ts#L170)).
- **[ASSUMPTION NEEDING VALIDATION]** Determine whether supplier-payment withholding is required for
  the anchor business. If yes, it is a separate configured tax/withholding transaction, not IT.
- **[ASSUMPTION NEEDING VALIDATION]** Confirm whether supplier payments may use cash as well as bank
  accounts.
- **[ASSUMPTION NEEDING VALIDATION]** Confirm whether foreign-currency supplier payments are needed
  now. BOB remains the default; snapshots exist so later FX does not rewrite history.
- **[ASSUMPTION NEEDING VALIDATION]** Confirm how supplier credits participate in settlement and
  which fiscal identifiers they carry.
- **[ASSUMPTION NEEDING VALIDATION]** Confirm reversal-date rules after a fiscal period closes.

Internal payment and settlement numbers are ordinary configured document numbers. Bolivia's legal
FACTURA sequentiality rule does not automatically apply to them.

## 10. Acceptance contract for a future implementation item

1. Full BOB payment: one payment and AP debit transaction settle one posted invoice; derived open
   balances become zero; voucher is `Dr AP / Cr configured offset`.
2. Partial payment: the payment reaches zero open amount and the invoice retains its remainder.
3. Many-to-many: one payment settles several invoices, and a later payment finishes one of them.
4. Excess allocation: any amount above payment or invoice open balance fails without partial writes.
5. Unallocated payment: a posted payment can retain an open AP debit for later allocation.
6. Reversal: a new payment, open transaction, journal, and negating settlements restore every
   affected invoice balance; original rows remain byte-for-byte unchanged.
7. Closed period, cross-tenant, cross-supplier, same-direction, duplicate reversal, inactive payment
   method, unresolved posting profile, and raw account-code fallback all fail closed.
8. Two tenants may use the same payment number without collision.
9. Changing payment method/account configuration affects only later payments; posted rows retain
   their account and currency evidence.
10. `VendorInvoice.paid_at` is no longer authoritative; every read derives settlement state.
11. Existing journal balancing, purchase invoice, IVA input, sales IVA/IT, number-sequence, and
   tenant-isolation tests remain green.
12. No payment implementation is accepted until the migration ledger/lock/schema-drift gate and the
   99.25 permission audit are resolved or explicitly re-scoped by Kubi.

## 11. Implementation stop line

The design is ready for review. Implementation remains blocked by the repository's unfinished P0
migration ledger/lock/schema-drift controls, the purchasing-route 99.25 permission audit, and the
Bolivia decisions that materially affect the first payment posting. Do not create a migration or
Claude patch prompt from this document until those gates are resolved or explicitly re-scoped.
