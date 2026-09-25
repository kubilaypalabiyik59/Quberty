# Customer and supplier master — screen extension and schema proposal (2026-09-18)

Catalog: 65.10 (customer master, Order to Cash), 75.10 (vendor master, Source to Pay).
Scope status: in scope (O2C, P2P). Requested by Kubi: "the customer and supplier grids show far
fewer fields than a core ERP has, and Transactions does not show the customer's transactions".

## What was wrong

- *repo-verified* — `Transactions` on both screens opened `TransactionsModal`, which lists **stock
  movements** (`GET /inventory/transactions?customer_id=` / `supplier_id=`). A customer's or
  supplier's account is their commercial documents, not stock moves.
- *repo-verified* — `New Customer` was a button with no handler; `POST /customers` and
  `PUT /customers/:id` existed but no screen used them.
- *repo-verified* — the customer grid hid fields the model has: NIT (`tax_id`), phone, address,
  country, notes.

## What was built (no schema change)

- Customer grid: code, name, NIT/CI, email and phone, city and country, segment, orders, **open
  balance**, last order. Search also matches code and NIT. New and edit dialog on the existing API.
- `GET /customers/:id/statement` — every non-draft order with its factura number and payment state
  (`OPEN`, `PAID`, `CLOSED`, `NOT_INVOICED`) and the totals ordered / invoiced / paid / open.
  A receivable is an invoiced order whose factura is not cancelled and which is neither paid nor
  cancelled nor returned. `GET /customers` adds `open_balance` and `last_order_at` per row.
- Supplier grid: adds phone, country, currency, **open payable** (from the AP subledger) and
  status. The statement shows the AP subledger lines (vendor invoices, payments, supplier credits,
  with what is still open) and the recent purchase orders.

## Official reference

*official documentation* — a Bolivian customer in D365 carries: type (organization / person),
customer group, primary address and contact, currency, **terms of payment**, invoice account,
delivery terms, sales tax group, and the tax ID (NIT) as country document number:
<https://learn.microsoft.com/dynamics365/finance/localizations/iberoamerica/ltm-create-customer-and-vendor-bolivia>.
A credit limit sits on the customer invoice account, optionally shared by a credit group:
<https://learn.microsoft.com/dynamics365/finance/accounts-receivable/cm-customer-credit-groups>.

## Schema proposal — for WORK-054's customer migration (not applied)

*architectural recommendation.* Added to the `customers.is_active` migration WORK-054 already plans,
so the customer table changes once:

| Column | Type | Why |
|---|---|---|
| `party_type` | enum `PERSON`, `ORGANIZATION`, default `PERSON` | Persona natural / jurídica decides the tax document (CI vs NIT) and how the name is shown. |
| `payment_terms_days` | int NULL | Due date of a receivable; NULL = cash (today's behaviour). Mirrors `suppliers.payment_terms`. |
| `credit_limit` | decimal(14,2) NULL | Hook only: NULL = no check. A credit check on order confirmation is a behaviour cut. |
| `currency` | char(3) NULL | Hook only: NULL = the ledger currency. A foreign-currency customer is a behaviour cut. |

Deliberately **not** proposed: a separate customer-group table (`segment` already groups customers
for reporting; group-level posting belongs to posting profiles), and delivery terms and mode of
delivery (no shipping carrier process in scope).

## Known gap — no customer subledger

*repo-verified* — AR has no counterpart of `VendorOpenTransaction`: an order is paid whole
(`sales_orders.paid_at`), so partial payments, overpayments and credit notes cannot be shown as
open items. The statement derives receivables from orders and is the one function to re-point when
an AR subledger arrives (WORK-048 / WORK-049 lifecycle).

*repo-verified, TEST data* — 53 of 54 sales orders on TEST have no customer (walk-in POS sales), so
most statements are empty. That is normal for retail and not a defect.
