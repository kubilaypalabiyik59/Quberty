# Quberty ERP: Manual Test Cases for Finance & Reporting

**How this was built:** I only read code. Nothing was run, no files were changed, and no `.env` values were opened. Expected results describe what the code does today, not what it should do. Where the code breaks a stated requirement, the step says **"(suspected defect)"** and the defect is listed at the end.

**Main files read:** `backend/src/modules/finance/finance.routes.ts`, `currency.routes.ts`, `backend/src/modules/reporting/*`, `backend/src/shared/services/journal.service.ts`, `exchangeRate.service.ts`, `documentCurrency.ts`, `backend/src/shared/schemas/index.ts`, `backend/src/shared/middleware/permissions.ts`, `errorHandler.ts`, `validate.ts`, `app.ts`, `tenant.routes.ts`, `docs/process/BOLIVIA_TAX_BASIS.md`, all pages under `frontend/src/app/(erp)/finance/*`, `reports/*`, `dashboard`, `CurrencyProvider.tsx`, `lib/money.ts`, `Sidebar.tsx`, `TopBar.tsx`.

**Facts every tester needs first:**
- **Access to finance endpoints**
  - Every `GET /finance/*` endpoint (trial balance, P&L, balance sheet, journals, facturas, aging, periods, bank reconciliation) is open to any logged-in staff role. There is no permission check on these reads.
  - Writes are limited by role:
    - **Accounts, posting journals, closing or reopening periods, cancelling facturas:** `admin` only.
    - **Creating a journal draft or a manual factura:** `admin` or `store_manager`.
- **Access to reports:** every `/reports/*` endpoint allows only `admin` or `store_manager`. The auditor gets 403.
- **Exchange rates:**
  - Adding a rate needs `finance.exchange_rate.maintain` (admin, store_manager, finance_approver).
  - Correcting a rate needs `finance.setup.maintain` (admin only).
  - Reading rates needs `finance.currency.read` (auditor, ap_clerk, buyer, and the roles above).
- **Reversal and revaluation:**
  - There is **no endpoint or button to reverse a manual journal**. `reverseJournal` is only called by vendor payment reversal.
  - There is **no FX revaluation**.
  - Documents in a currency other than the ledger currency are refused with 409.
- **Tax figures, Bolivia (IVA included in the price, 13% and IT 3% both taken on the gross):**
  - A factura of **Bs 1.299,00** gives IVA **168,87**, subtotal **1.130,13** and IT **38,97**.
  - If the tenant was never tax-provisioned, the old fallback runs instead and gives 149,44 and 34,49. That counts as a defect.

---

## A. Chart of accounts

### FIN-001 — Create a new account
- **Priority:** P1  | **Role:** admin  | **Type:** happy
- **Preconditions:** Logged in as admin. The tenant has a chart of accounts. Code `5999` does not exist yet.
- **Test data:** Code `5999`, Name `Gastos de prueba QA`, Type `EXPENSE`.

| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /finance/accounts → click **New Account** | A form opens with Code, Name, Type and Normal Balance. Type defaults to ASSET and Normal Balance to DEBIT. |
| 2 | Enter code and name. Select Type `EXPENSE`. | Normal Balance stays DEBIT. Choosing REVENUE, LIABILITY or EQUITY would switch it to CREDIT automatically. |
| 3 | Clear Name | **Save** is disabled because code and name are both required. |
| 4 | Re-enter name → **Save** | The form closes. `5999 Gastos de prueba QA` appears in the EXPENSE group with normal balance DEBIT. |
| 5 | /finance/journal → New Entry → open the account dropdown | `5999 — Gastos de prueba QA` can be selected. |

- **Post-conditions / data checks:**
  - `GET /finance/accounts` returns the row with `is_active=true` and `category=null`. The form cannot set a category.
  - Trial balance is unchanged because the account has no lines.

### FIN-002 — Duplicate account code is refused
- **Priority:** P1  | **Role:** admin  | **Type:** negative
- **Preconditions:** Account `1101` exists.
- **Test data:** Code `1101`, Name `Duplicado QA`, Type ASSET.

| # | Step | Expected result |
|---|---|---|
| 1 | /finance/accounts → New Account → enter the data → Save | Save is refused because the database has a unique rule on tenant + code. |
| 2 | Read the error message in the form | Per the code, the message is the generic **"Internal server error"** (HTTP 500), not a clear "code already exists" message **(suspected defect)**. |
| 3 | Refresh the list | Only one `1101` exists and it keeps its original name. |
| 4 | Edit an existing account (for example `5999`) → change its code to `1101` → Save | Same generic 500 error. `5999` keeps its code. |

- **Post-conditions:** Account count is unchanged. Trial balance is unchanged.

### FIN-003 — Deactivate an account that already has postings
- **Priority:** P1  | **Role:** admin  | **Type:** negative / reconciliation
- **Preconditions:**
  - Account `5999` has a POSTED journal: Dr 5999 100,00 / Cr 1101 100,00 (from FIN-010).
  - Note the trial balance totals before starting.
- **Test data:** `PUT /finance/accounts/{id-of-5999}` with body `{ "is_active": false }`. The screen has no deactivate control, so use an API client with the admin token.

| # | Step | Expected result |
|---|---|---|
| 1 | Look for a deactivate or inactive control on the Edit form | There is none. The form only sends code, name, type, normal_balance and parent_id **(gap)**. |
| 2 | Send the PUT through the API | HTTP 200 with `data: null`. Nothing checks whether the account has postings **(suspected defect: D365 blocks this or requires a balance of zero)**. |
| 3 | Reload /finance/accounts | `5999` is gone. There is no way to list inactive accounts, so it cannot be reactivated from the screen. |
| 4 | Journal → New Entry → account dropdown | `5999` is not offered. |
| 5 | Add up `GET /finance/trial-balance` | The 5999 row is gone. Total debits are now 100,00 lower than total credits, so the trial balance **no longer balances** **(suspected defect)**. |
| 6 | /finance/p-and-l for that month | Expenses drop by 100,00 and net income rises by 100,00. |
| 7 | /finance/balance-sheet | The 1101 credit is still counted, 5999 is not. The badge shows **"Out of balance"** with Diff 100,00. |
| 8 | Clean-up: PUT `{ "is_active": true }` | The account returns. The trial balance and balance sheet balance again. |

- **Post-conditions:** After reactivation, total debits equal total credits again.

### FIN-004 — Changing type or code on an account that has postings
- **Priority:** P2  | **Role:** admin  | **Type:** negative
- **Preconditions:** `5999` (EXPENSE) has 100,00 posted.
- **Test data:** Change Type to ASSET.

| # | Step | Expected result |
|---|---|---|
| 1 | Accounts → Edit 5999 → Type ASSET → Save | Saved with no warning. Normal balance stays DEBIT. |
| 2 | P&L for that month | The 100,00 expense disappears. Net income goes up. |
| 3 | Balance sheet | 5999 now appears under Assets with 100,00. Current Year Earnings goes up by 100,00, so the sheet still balances. |
| 4 | Revert the Type to EXPENSE | Both reports return to their earlier figures. |

- **Post-conditions:** Past postings were reclassified silently. Record as a design gap: nothing locks the type once an account has postings.

### FIN-005 — Only admin can change the chart of accounts
- **Priority:** P1  | **Role:** store_manager, auditor, finance_approver  | **Type:** permission
- **Preconditions:** One user for each role.
- **Test data:** New account `5998`.

| # | Step | Expected result |
|---|---|---|
| 1 | As store_manager: /finance/accounts | The list loads. The **New Account** and **Edit** buttons are still shown. The screen does not hide them by role. |
| 2 | New Account → Save | Error "Insufficient permissions" (403). Nothing is created. |
| 3 | Edit any account → Save | 403 "Insufficient permissions". |
| 4 | Repeat as auditor and finance_approver | Same 403 on both. |
| 5 | As store_manager with an empty tenant: click **Seed Default Accounts** | Browser alert "Failed to seed accounts". The server returned 403. |

- **Post-conditions:** No new accounts. The audit log shows the refused attempts, if the audit middleware records failures.

### FIN-006 — Seed accounts from a template, including the collision guard
- **Priority:** P2  | **Role:** admin (happy), store_manager (permission)  | **Type:** happy / negative
- **Preconditions:** A tenant that already has the Bolivian chart (for example 1103 = ACCOUNTS_RECEIVABLE).
- **Test data:** Pick a template other than Bolivia's from /finance/coa-templates, if one exists.

| # | Step | Expected result |
|---|---|---|
| 1 | Admin: /finance/coa-templates | Each template card shows name, country and currency. The page is not in the sidebar, so type the URL. |
| 2 | Seed the **same** Bolivian template again | Green message "✓ …: 0 accounts created, N skipped (already exist)". |
| 3 | Seed a different country template | Red message starting "Error: This template would create accounts that duplicate the meaning…". It lists each clash by category and code. Nothing is created (409 COA_CATEGORY_COLLISION). |
| 4 | Store_manager: seed any template | "Error: Permission denied: finance.setup.maintain" (403). |

- **Post-conditions:** Account count is unchanged. No account category ends up used twice.

---

## B. General journal

### FIN-010 — Balanced manual journal: save as draft, then post
- **Priority:** P1  | **Role:** admin  | **Type:** happy
- **Preconditions:**
  - The current month is OPEN.
  - Accounts 5999 (EXPENSE) and 1101 (Bank) exist.
  - Neither account's category has a required dimension rule. If one does, see the defects section.
- **Test data:**
  - Date: today.
  - Description: `QA ajuste gasto`.
  - Line 1: Dr 5999 100,00, line description "gasto".
  - Line 2: Cr 1101 100,00, line description "banco".
  - **Fill in both line descriptions.** See FIN-011 for why.

| # | Step | Expected result |
|---|---|---|
| 1 | /finance/journal → New Entry | Two empty lines. Column headers read "Debit (BOB)" and "Credit (BOB)". |
| 2 | Line 1: account 5999, debit 100 | Typing a debit clears any credit on the same line. |
| 3 | Line 2: account 1101, credit 100 | The footer totals 100.00 / 100.00 in green. |
| 4 | **Save as Draft** | The form closes. A new entry appears with an entry number and status **DRAFT** (grey) and a **Post** button. |
| 5 | Expand the entry | Two lines show `Bs. 100,00` in the debit and credit columns. |
| 6 | Trial balance (API or the table at the bottom of the IVA Report page) | No change yet. Drafts are left out. |
| 7 | Click **Post** | Status becomes **POSTED** (green). The Post button disappears. |
| 8 | Trial balance and P&L for the month | 5999 shows debit 100,00. 1101 credit rises by 100,00. P&L expenses rise by 100,00. |

- **Post-conditions:** Total debits equal total credits. `posted_at` is set. `source_module=MANUAL`.

### FIN-011 — Journal line with an empty description
- **Priority:** P1  | **Role:** admin  | **Type:** negative
- **Preconditions:** Same as FIN-010.
- **Test data:** The same entry, but both line descriptions left empty.

| # | Step | Expected result |
|---|---|---|
| 1 | New Entry → fill the lines with no line descriptions → Save as Draft | The screen sends `description: null`. The server's schema only accepts text or nothing, so it rejects null. Error **"Validation failed"** (400) and no entry is created **(suspected defect: the everyday path of leaving descriptions blank cannot be saved)**. |
| 2 | Add a description to line 1 only → Save | Still "Validation failed" because line 2 is null. |
| 3 | Add descriptions to both lines → Save | The draft is created. |

- **Post-conditions:** A refused save creates no draft and uses up no entry number.

### FIN-012 — Unbalanced journal is refused
- **Priority:** P1  | **Role:** admin  | **Type:** negative
- **Preconditions:** Current month OPEN.
- **Test data:** Dr 5999 100,00 / Cr 1101 90,00.

| # | Step | Expected result |
|---|---|---|
| 1 | Enter the lines | Footer totals turn red. Message: "Entry is not balanced. Difference: Bs. 10,00". |
| 2 | Look at Save as Draft | Disabled. |
| 3 | Change the credit to 99,99 | The difference is 0,01 and Save stays disabled. The screen allows less than 0,01 only. |
| 4 | API: POST `/finance/journal-entries` with debit 100 and credit 90 (descriptions filled) | 400 "Validation failed", detail "Journal entry must balance: total debits must equal total credits". |
| 5 | API: debit 100.004 and credit 100.00 | Passes the check (difference under 0,01). Each amount is rounded to 2 decimals, so the draft is created balanced at 100,00 / 100,00. |

- **Post-conditions:** No unbalanced voucher exists in the database.

### FIN-013 — API edge cases for journal lines
- **Priority:** P2  | **Role:** admin  | **Type:** boundary
- **Preconditions:** Current month OPEN. An API client.
- **Test data:** See each step.

| # | Step | Expected result |
|---|---|---|
| 1 | Only one line | 400 "At least 2 lines required for a journal entry". |
| 2 | One line with debit 50 **and** credit 50, plus a second line with 0 / 0 | Passes validation. Posting then fails with **500** JOURNAL_LINE_TWO_SIDED, "…carries both a debit… Split it into two lines." A 400 would be the right code here. |
| 3 | Two lines, both 0 / 0 | 500 JOURNAL_EMPTY "every journal line was zero". |
| 4 | A line with a made-up `account_id` in valid UUID form | Refused. Expect a generic 500 from the database foreign key. Record the exact message. |
| 5 | A `dimensions` object on a line | It is silently dropped by the schema. If the account needs a dimension, the draft is refused (see the defects section). |

- **Post-conditions:** No partial entries are left behind.

### FIN-014 — Store manager can create drafts but cannot post
- **Priority:** P1  | **Role:** store_manager  | **Type:** permission
- **Preconditions:** Current month OPEN.
- **Test data:** The balanced entry from FIN-010, with descriptions.

| # | Step | Expected result |
|---|---|---|
| 1 | Store_manager: /finance/journal → New Entry → Save as Draft | A DRAFT is created. `created_by` is the store manager. |
| 2 | Click **Post** on it | Browser alert **"Failed to post"**. The server returned 403 "Insufficient permissions", but the screen reads the wrong field so that text never shows **(suspected defect, UI)**. Status stays DRAFT. |
| 3 | API: POST `/finance/journal-entries/{id}/post` with the store_manager token | 403 `{"error":{"message":"Insufficient permissions"}}`. |
| 4 | Admin posts the same draft | Now POSTED. |
| 5 | Admin creates a draft and posts it himself | Allowed. Nothing stops the same person from creating and posting. Record as a separation-of-duties observation. |

- **Post-conditions:** The trial balance only changes after the admin posts.

### FIN-015 — Posting an entry that is already posted
- **Priority:** P2  | **Role:** admin  | **Type:** negative
- **Preconditions:** A POSTED entry exists.
- **Test data:** Its id.

| # | Step | Expected result |
|---|---|---|
| 1 | API: POST `/journal-entries/{id}/post` again | 400 "Entry not found or already posted". |
| 2 | Same call with a random UUID | Same 400. |
| 3 | Same call with an entry id belonging to another tenant | Same 400. The query is filtered by tenant. |

- **Post-conditions:** `posted_at` is not overwritten.

### FIN-016 — Reversing a manual journal
- **Priority:** P1  | **Role:** admin  | **Type:** negative / reconciliation
- **Preconditions:** The POSTED manual entry from FIN-010.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | /finance/journal → expand the posted entry → look for Reverse | **No Reverse action exists.** |
| 2 | API: look for a reverse route (for example POST `/finance/journal-entries/{id}/reverse`) | 404. No such route is registered. |
| 3 | Workaround: create and post the mirror entry by hand (Dr 1101 100 / Cr 5999 100) | It posts, but as an ordinary entry, not a correction. It is not linked to the original, and the original can be "reversed" this way again. |
| 4 | Record | **Gap:** manual journals cannot be reversed. The database has the fields for it (`corrects_entry_id`, `is_correction`) and the service exists, but no route uses them. |

- **Post-conditions:** After step 3, the 5999 balance is back to its value before FIN-010 and the trial balance still balances.

### FIN-017 — Checking the reversal mechanism through vendor payment reversal
- **Priority:** P2  | **Role:** finance_approver  | **Type:** reconciliation
- **Preconditions:** A POSTED vendor payment of Bs 1.000,00 that has not been settled. Its period is OPEN.
- **Test data:** Reversal reason "QA reverse".

| # | Step | Expected result |
|---|---|---|
| 1 | /purchase/payments → reverse the payment | Succeeds. |
| 2 | /finance/journal → find the new entry | Its description starts "Reversal of <original entry number> — …". Status POSTED. Each line is the mirror of the original, since the tenant's correction method defaults to REVERSE. |
| 3 | Reverse the same payment again | Refused. Service code JOURNAL_ALREADY_REVERSED, "has already been reversed by …". |
| 4 | Trial balance | Both AP and bank movements net to 0 for this pair. Total debits equal total credits. |

- **Post-conditions:** The reversal entry is flagged as a correction and points to the original.

### FIN-018 — Journal link in the top bar
- **Priority:** P3  | **Role:** admin  | **Type:** negative
- **Preconditions:** —
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | Top bar → Create menu → **New Journal Entry** | Opens `/finance/journal/new`, which has no page, so a Next.js 404 appears **(suspected defect)**. |

---

## C. Fiscal periods

### FIN-020 — Close a period
- **Priority:** P1  | **Role:** admin  | **Type:** happy
- **Preconditions:** Use the previous month, for example Aug 2026, in the test tenant.
- **Test data:** Aug 2026.

| # | Step | Expected result |
|---|---|---|
| 1 | /finance/periods | Shows the last 12 months, newest first, all "Open" unless a period record says otherwise. There is an amber warning banner. |
| 2 | Aug 2026 → **Close Period** | A confirmation asks "Close Aug 2026? This will block manual entries for this period." |
| 3 | Confirm | The badge becomes "Closed" with today's date under Closed At. The button changes to **Reopen**. |
| 4 | Read the warning banner | It says "Auto-generated entries (from PO/SO) bypass this lock". That is **out of date**: the period check now runs for every posting (see FIN-023) **(suspected defect, documentation text)**. |
| 5 | API: close Aug 2026 again | 409 "Period is already closed". |

- **Post-conditions:** A period record exists for 2026/08 with status CLOSED and `closed_by` set to the admin.

### FIN-021 — A manual draft dated in a closed period is refused
- **Priority:** P1  | **Role:** admin, store_manager  | **Type:** negative
- **Preconditions:** Aug 2026 is CLOSED (FIN-020).
- **Test data:** Entry date 2026-08-15, balanced 50 / 50 with descriptions.

| # | Step | Expected result |
|---|---|---|
| 1 | Journal → New Entry → date 2026-08-15 → Save as Draft | Refused (400). Message: "MANUAL QA … cannot be posted: period 2026/08 is closed. Reopen the period, or change the voucher date." |
| 2 | Change the date to 2026-09-10 (open) → Save | The draft is created. |
| 3 | Store_manager repeats step 1 | Same refusal. |

- **Post-conditions:** Nothing is added to August. If the tenant has `allow_posting_to_closed_period=true`, step 1 succeeds and only a warning is logged. Check that setting first.

### FIN-022 — Known gap: a draft created while open can still be posted after the period closes
- **Priority:** P1  | **Role:** admin  | **Type:** negative
- **Preconditions:** The target month is OPEN. Use a spare month such as Jul 2026, reopened if needed.
- **Test data:** A balanced 75 / 75 draft dated 2026-07-20.

| # | Step | Expected result |
|---|---|---|
| 1 | Create the draft dated 2026-07-20 while July is open | DRAFT is created. |
| 2 | /finance/periods → close Jul 2026 | Closed. |
| 3 | /finance/journal → **Post** the July draft | Per the code, the post **succeeds**: status becomes POSTED. The post route only changes the status and does not check the period. **Record as a suspected defect.** The expected behaviour is a PERIOD_CLOSED refusal. |
| 4 | P&L for July | Changed by 75, even though July is closed. |
| 5 | Clean-up | Reopen July, post the mirror entry, close July again. |

- **Post-conditions:** Write down the before and after July P&L figures as evidence.

### FIN-023 — Sales and purchase postings into a closed period are refused
- **Priority:** P1  | **Role:** store_manager (sales), ap_clerk (purchase), admin (close)  | **Type:** negative
- **Preconditions:**
  - Test environment only.
  - Close the **current** month (Sep 2026), because sales and purchase documents post with today's date.
  - Have one confirmed order ready to invoice and one vendor invoice ready to post.
- **Test data:** Any sales order. A vendor invoice for Bs 2.500.

| # | Step | Expected result |
|---|---|---|
| 1 | Admin closes Sep 2026 | Closed. |
| 2 | Store_manager: invoice the sales order | Refused with 400 PERIOD_CLOSED, "Sales … cannot be posted: period 2026/09 is closed…". No factura number is used up, because it all runs in one transaction. |
| 3 | POS: complete a sale | Refused with PERIOD_CLOSED. |
| 4 | ap_clerk: post the vendor invoice | Refused with PERIOD_CLOSED. |
| 5 | Admin reopens Sep 2026 and repeats steps 2–4 | All succeed. |

- **Post-conditions:**
  - Facturas register: no gap in numbers around the refused attempts. This matters because Bolivian factura numbers must be consecutive.
  - Trial balance still balances.

### FIN-024 — Who can reopen a period
- **Priority:** P1  | **Role:** admin, store_manager, finance_approver, auditor  | **Type:** permission
- **Preconditions:** Aug 2026 is CLOSED.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | Store_manager: /finance/periods → Aug → **Reopen** | Red banner "Insufficient permissions". The period stays Closed. The button is shown even though the user cannot use it. |
| 2 | Same as finance_approver, then as auditor | Same 403. |
| 3 | Store_manager: **Close Period** on an open month | 403 "Insufficient permissions". |
| 4 | Admin: Reopen Aug | Reopens immediately. **There is no confirmation**, while closing does ask. `closed_at` is cleared. |
| 5 | Admin: API reopen Aug again | 400 "Period is not closed". |
| 6 | Admin: API reopen a month that never had a record (for example 2025/01) | 400 "Period is not closed". |

- **Post-conditions:** Only the admin's actions changed anything.

### FIN-025 — Month boundaries and invalid periods
- **Priority:** P2  | **Role:** admin  | **Type:** boundary
- **Preconditions:** Aug 2026 CLOSED, Sep 2026 OPEN. Ask DevOps for the backend server's timezone.
- **Test data:** Entry dates 2026-08-31 and 2026-09-01.

| # | Step | Expected result |
|---|---|---|
| 1 | Draft dated 2026-08-31 | Refused as period 2026/08 closed. |
| 2 | Draft dated 2026-09-01 | Should be allowed. **If the server runs behind UTC (for example America/La_Paz), it is refused as "period 2026/08 is closed".** The date is read as UTC midnight but the month is taken in server time. Record as a defect if that happens. |
| 3 | API: POST `/finance/periods/2026/13/close` | Per the code it **succeeds** and stores a period 2026/13. Nothing checks the month range **(suspected defect)**. |
| 4 | API: POST `/finance/periods/abc/1/close` | Year becomes NaN. Expect a 500. Record the result. |
| 5 | /finance/periods: try to close a month older than 12 months | Not possible on screen. The list only shows the last 12 months. |

- **Post-conditions:** Remove the invalid period records (13, NaN) through an admin data fix.

---

## D. Trial balance, P&L, balance sheet

Worked example for section D. Start from a tenant with no postings, or record a before snapshot and compare the change. All postings in Sep 2026.
- **O2C:** a sales invoice for an order of **Bs 1.299,00**. The tax engine is set to IVA 13% on the gross and IT 3% on the gross. The posting is:
  - Dr AR 1.299,00
  - Dr IT expense 38,97
  - Cr Revenue 1.130,13
  - Cr IVA output 168,87
  - Cr IT payable 38,97
  - Totals: Dr 1.337,97 = Cr 1.337,97
- **P2P:** vendor invoice for **Bs 2.500,00** gross. The net effect on the ledger is:
  - Dr Inventory 2.175,00
  - Dr IVA input 325,00
  - Cr AP 2.500,00
  - If receipts go through a purchase accrual account, that account should net to 0 after the invoice.
- **Manual journal:** Dr 5999 expense 100,00 / Cr 1101 Bank 100,00.
- **Customer payment:** Dr Bank 1.299,00 / Cr AR 1.299,00.

### FIN-030 — Trial balance: total debits equal total credits after sales and purchase activity
- **Priority:** P1  | **Role:** admin  | **Type:** reconciliation
- **Preconditions:** The worked example above is posted. Take a before snapshot of `GET /finance/trial-balance`.
- **Test data:** As above.

| # | Step | Expected result |
|---|---|---|
| 1 | API: GET `/finance/trial-balance` (or the table at the bottom of /finance/iva-report) | One row per active account that has posted lines. The endpoint gives no grand total and no date filter. |
| 2 | Add up total_debit and total_credit in a spreadsheet | The two sums are equal to the cent. |
| 3 | Compare with the before snapshot | Debits rose by 1.337,97 + 2.500,00 + 100,00 + 1.299,00 = **5.236,97**. Credits rose by the same. |
| 4 | Check each account's change | AR +1.299 Dr and +1.299 Cr, so balance 0. Revenue credit 1.130,13. IVA output credit 168,87. IT payable credit 38,97. IT expense debit 38,97. Inventory +2.175. IVA input +325. AP credit 2.500. Bank debit 1.299 and credit 100, so balance +1.199. 5999 debit 100. |
| 5 | Check the balance sign rule | Accounts with a CREDIT normal balance show credit minus debit. For example, Revenue balance is +1.130,13. |
| 6 | Include one DRAFT entry | Not counted. |

- **Post-conditions:** Keep the spreadsheet as evidence. If the sums differ, look for an inactive account with postings (FIN-003).

### FIN-031 — P&L for one month
- **Priority:** P1  | **Role:** admin  | **Type:** reconciliation
- **Preconditions:** The worked example is in Sep 2026. No COGS, or record COGS if shipping posts it.
- **Test data:** Sep 2026.

| # | Step | Expected result |
|---|---|---|
| 1 | /finance/p-and-l → September, 2026 | The screen requests 2026-09-01 to 2026-09-30. |
| 2 | Revenue table | The revenue account shows `Bs. 1.130,13`. |
| 3 | Expenses table | IT expense `Bs. 38,97` and 5999 `Bs. 100,00`, plus COGS if posted. |
| 4 | Summary cards | Total Revenue 1.130,13. Total Expenses 138,97. **Net Income 991,16 ▲ Profit**, less COGS if any. |
| 5 | Select August | Nothing from September is included. |
| 6 | Year dropdown | Offers only 2024–2026. 2027 cannot be chosen **(P3 defect)**. |

- **Post-conditions:** Net income equals revenue minus expenses from the trial balance rows of type REVENUE and EXPENSE, for entries dated in the month.

### FIN-032 — Balance sheet balances and includes current-year earnings
- **Priority:** P1  | **Role:** admin  | **Type:** reconciliation
- **Preconditions:** Same data.
- **Test data:** As-of date 2026-09-30.

| # | Step | Expected result |
|---|---|---|
| 1 | /finance/balance-sheet → date 2026-09-30 | Badge shows **Balanced**. |
| 2 | Assets | Bank +1.199,00, Inventory 2.175,00, IVA input 325,00, AR not shown because its balance is 0. |
| 3 | Liabilities | AP 2.500,00, IVA output 168,87, IT payable 38,97. |
| 4 | Equity | An extra row "Current Year Earnings (Net Income)" shows 991,16 on a green background. |
| 5 | Totals | Assets 3.699,00. Liabilities + Equity = 2.707,84 + 991,16 = 3.699,00. Diff Bs. 0,00. |
| 6 | Set the date to 2026-08-31 | September activity is excluded. |

- **Post-conditions:** Assets = Liabilities + Equity. Note: "Current Year Earnings" is actually **all-time** net income up to the date, because there is no year-end close. Check this with the Finance co-founder.

### FIN-033 — Reconcile P&L and balance sheet across a period
- **Priority:** P1  | **Role:** admin  | **Type:** reconciliation
- **Preconditions:** Postings in at least two months.
- **Test data:** Balance sheet on 2026-08-31 and on 2026-09-30. P&L for September.

| # | Step | Expected result |
|---|---|---|
| 1 | Balance sheet 2026-08-31: note net income (E1) | — |
| 2 | Balance sheet 2026-09-30: note net income (E2) | — |
| 3 | P&L for September: note net income (P) | **E2 − E1 = P** to the cent. |
| 4 | Repeat after posting a manual expense dated 2026-09-30 | E2 and P both change by the same amount. |

- **Post-conditions:** Any difference points to an inactive account (FIN-003) or a date boundary issue (FIN-025).

### FIN-034 — Draft entries never appear in reports
- **Priority:** P2  | **Role:** admin  | **Type:** negative
- **Preconditions:** One DRAFT of Dr 5999 500 / Cr 1101 500 in September.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | Trial balance, P&L for Sep, balance sheet, IVA net, bank reconciliation for Sep | None of them includes the 500. All use POSTED entries only. |
| 2 | Post the draft, then reload each report | All change by 500. |

---

## E. Facturas and IVA

### FIN-040 — Sales invoice creates a factura with the correct included-IVA split
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy
- **Preconditions:** A confirmed or shipped sales order totalling Bs 1.299,00 in the ledger currency. Tax codes set to IVA included, taken on the gross.
- **Test data:** Order total 1.299,00.

| # | Step | Expected result |
|---|---|---|
| 1 | Sales order → Invoice | A factura is issued. |
| 2 | /finance/facturas | New row. Number is the next in sequence (for example `000028`). Source is a "Sales Order" link. Subtotal `Bs. 1.130,13`, IVA 13% `Bs. 168,87`, IT 3% `Bs. 38,97`, Total `Bs. 1.299,00`, status ISSUED. |
| 3 | If IVA shows 149,44 and IT 34,49 | **Defect:** the old fallback calculation is running (the tenant has no tax setup, or the tax codes are not set to take tax on the gross). |
| 4 | /finance/journal → entry "Sales Invoice: SO-… — Factura #…" | Lines match the section D example. The entry balances. |
| 5 | PDF button on the factura row | The PDF shows the same stored amounts. |

- **Post-conditions:** IVA + subtotal = total (168,87 + 1.130,13 = 1.299,00). IT = 3% × 1.299,00.

### FIN-041 — Manual factura: tax preview and numbering
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy / reconciliation
- **Preconditions:** The factura number sequence is automatic.
- **Test data:** Customer "QA Cliente", NIT 1234567, total 500,00, today's date.

| # | Step | Expected result |
|---|---|---|
| 1 | /finance/facturas → New Factura → total 500 | The preview shows "calculating…", then Subtotal `Bs. 435,00`, IVA `Bs. 65,00`, IT `Bs. 15,00`, Total `Bs. 500,00`. Tax labels come from the tax codes. |
| 2 | Clear Customer Name | Issue is disabled. |
| 3 | **Issue Factura** | The row appears with the next consecutive number and status ISSUED, Source "Manual". |
| 4 | /finance/journal | **No journal is created** for a manual factura. The IVA in the register now differs from the IVA in the ledger by 65,00 **(suspected defect, see FIN-043)**. |
| 5 | If the sequence is set to manual | A number field appears. A number in the wrong format shows an inline error and Issue stays disabled. |

- **Post-conditions:** Numbers are consecutive with no gap.

### FIN-042 — Cancelling a factura
- **Priority:** P1  | **Role:** admin (allowed), store_manager (refused)  | **Type:** permission / reconciliation
- **Preconditions:** The ISSUED factura from FIN-040 (1.299,00).
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | Store_manager → Cancel on the row | Alert "Failed to cancel". The server returned 403 but the screen reads the wrong field. Status stays ISSUED. |
| 2 | Admin → Cancel | Status CANCELLED in red. The Cancel button disappears. **There is no confirmation.** |
| 3 | Admin → cancel the same factura again through the API | 200 OK. Nothing checks whether anything changed, so the call looks successful. |
| 4 | /finance/iva-report for the month | The cancelled factura is no longer listed and totals drop by 1.299 / 168,87 / 38,97. |
| 5 | Journal and trial balance | The sales invoice entry is **not reversed**. Revenue, IVA output and IT payable still include the amount **(suspected defect)**. |

- **Post-conditions:** The sales IVA book and the ledger disagree by 168,87.

### FIN-043 — IVA report for a month matches the facturas register
- **Priority:** P1  | **Role:** admin  | **Type:** reconciliation
- **Preconditions:** In Sep 2026, and nowhere else in September:
  - F1: sales invoice for 1.299,00.
  - F2: manual factura for 500,00.
  - F3: a factura for 200,00 that was cancelled.
- **Test data:** Expected ISSUED totals: Subtotal 1.565,13, IVA 233,87, IT 53,97, Total 1.799,00.

| # | Step | Expected result |
|---|---|---|
| 1 | /finance/iva-report → September 2026 | The table lists F1 and F2 in number order (the numbers sort as text). F3 is not listed. Header says "2 facturas". |
| 2 | Summary cards | Subtotal Neto **Bs. 1.565,13**. IVA Débito Fiscal (13%) **Bs. 233,87**. IT (3% sobre neto) **Bs. 53,97**. Total Facturado **Bs. 1.799,00**. |
| 3 | /finance/facturas: add up the ISSUED rows dated in September | Same four totals. |
| 4 | "IVA Net Payable" section → Débito Fiscal | Shows **168,87**. This is read from the ledger (VAT_PAYABLE accounts), and the manual factura F2 posted nothing. It differs from the card's 233,87 by 65,00 **(suspected defect)**. |
| 5 | Read the IT card label | It says "3% sobre neto", but the figure is 3% of the **gross**, per Ley 843 art. 74 **(label defect)**. |

- **Post-conditions:** The register total must equal the sum of ISSUED facturas. Compare it to the ledger débito fiscal and write down any difference.

### FIN-044 — Crédito fiscal from vendor invoices and net IVA payable
- **Priority:** P1  | **Role:** ap_clerk (post), admin (report)  | **Type:** reconciliation
- **Preconditions:** In Sep 2026 there is a POSTED vendor invoice for Bs 2.500,00 gross, and F1 (FIN-043).
- **Test data:** Expected crédito fiscal = 13% × 2.500 = **325,00**.

| # | Step | Expected result |
|---|---|---|
| 1 | /finance/iva-report → Sep 2026 → IVA Net section | Débito Fiscal (Sales) `Bs. 168,87`. Crédito Fiscal (Purchases) `Bs. 325,00`. |
| 2 | Net IVA Payable to SIN | `Bs. -91,13`, blue, "Credit in your favour". 168,87 − 325,00 = −91,13. |
| 3 | API: GET `/finance/iva-net-report?year=2026&month=9` → `accounts` | Lists which accounts were read. If two IVA output accounts are listed (for example 2103 and 2105), that is the known duplicate-account issue. |
| 4 | Cross-check: purchase vendor invoice list, POSTED in September | Sum of their input VAT = 325,00. The report reads the **ledger**, not the vendor invoice documents. |
| 5 | Post a supplier credit that reverses 13% × 500 = 65 input VAT in the same month | Crédito drops to 260,00 because both columns are netted. Net payable becomes −26,13. |

- **Post-conditions:** Ledger crédito fiscal = sum of input VAT on vendor invoices minus credits for the month.

### FIN-045 — IT 3% figure
- **Priority:** P1  | **Role:** admin  | **Type:** reconciliation
- **Preconditions:** Data from FIN-043 (F1 and F2 issued).
- **Test data:** Expected register IT = 38,97 + 15,00 = **53,97**.

| # | Step | Expected result |
|---|---|---|
| 1 | IVA report → IT card | `Bs. 53,97`. |
| 2 | Trial balance → the IT payable account, September credits only | 38,97. Only the sales invoice posted. The 15,00 gap is the manual factura (same defect as FIN-041). |
| 3 | P&L for Sep → IT expense account | 38,97. |
| 4 | A POS sale of 100,00 | IT goes up by 3,00 in the register and in the ledger, and by 13,00 IVA. POS now posts IT (this was fixed earlier). |

- **Post-conditions:** IT = 3% × sum of ISSUED gross totals. There is no ledger-based IT declaration screen **(gap)**.

### FIN-046 — IVA report PDF
- **Priority:** P2  | **Role:** admin  | **Type:** happy
- **Preconditions:** Sep 2026 data as in FIN-043.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | IVA report → PDF button next to the period selectors | A PDF opens or downloads. |
| 2 | Compare the PDF with the screen | Same factura rows and the same subtotal, IVA, IT and total. Amounts formatted as `Bs. 1.565,13`. |
| 3 | Tenant with no ledger currency | The button shows "Loading currency…" permanently. No PDF is possible. |

### FIN-047 — IVA net section when no account is marked as IVA output
- **Priority:** P3  | **Role:** admin  | **Type:** negative
- **Preconditions:** A test tenant where no account has category VAT_PAYABLE.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | /finance/iva-report | The sales book and cards load. The **IVA Net section is simply missing**, with no error shown. |
| 2 | API: GET iva-net-report | 500 TAX_ACCOUNTS_UNCATEGORISED, "No account is categorised VAT_PAYABLE…". This is a setup problem reported as a server error. |

### FIN-048 — Facturas on the first and last day of a month
- **Priority:** P2  | **Role:** store_manager / admin  | **Type:** boundary
- **Preconditions:** Know the server timezone.
- **Test data:** Manual facturas dated 2026-08-31 (100,00) and 2026-09-01 (100,00).

| # | Step | Expected result |
|---|---|---|
| 1 | IVA report for August | Should contain the 08-31 factura. |
| 2 | IVA report for September | Should contain the 09-01 factura. **If the server runs behind UTC, the 09-01 factura is missing from September.** The date is stored at UTC midnight while the report's month starts at local midnight. Record as a defect if it happens. |

---

## F. Aging

The age is the number of whole days between the reference date and now.
- 0–30 days goes in bucket 0-30.
- 31–60 goes in 31-60.
- 61–90 goes in 61-90.
- 91 or more goes in 90+.
- **AP reference date:** the purchase order's `received_at`, or `created_at` if never received. Only POs with status RECEIVED and no `paid_at` count.
- **AR reference date:** the sales order's `created_at`, not the invoice or due date. Only orders with an invoice, no `paid_at`, and status not DRAFT or CANCELLED count.

### FIN-050 — AP aging buckets with dates
- **Priority:** P1  | **Role:** admin  | **Type:** boundary
- **Preconditions:**
  - Test date is 2026-09-13.
  - Four unpaid RECEIVED purchase orders with these receipt dates (set by the test data owner):
    - PO-A: 2026-08-14, age 30, Bs 1.000
    - PO-B: 2026-08-13, age 31, Bs 2.000
    - PO-C: 2026-06-15, age 90, Bs 3.000
    - PO-D: 2026-06-14, age 91, Bs 4.000
- **Test data:** As above.

| # | Step | Expected result |
|---|---|---|
| 1 | /finance/aging → AP Aging tab | Cards: 0-30 `Bs. 1.000,00`, 31-60 `Bs. 2.000,00`, 61-90 `Bs. 3.000,00`, 90+ `Bs. 4.000,00`. Total Outstanding AP `Bs. 10.000,00`. |
| 2 | Detail rows | Oldest first: PO-D "91d (90+)", PO-C "90d (61-90)", PO-B "31d (31-60)", PO-A "30d (0-30)". Each PO number links to the PO. |
| 3 | Time-of-day check | A receipt at 2026-08-13 15:00 viewed on 2026-09-13 at 10:00 is 30,8 days, so it shows **30d (0-30)**. |
| 4 | Pay PO-A through vendor payment and settlement | Note whether PO-A leaves the report. It only does if `paid_at` is set on the PO. See "Uncertain". |

- **Post-conditions:** Sum of the buckets = total = dashboard "AP outstanding" (FIN-052).

### FIN-051 — AR aging buckets with dates
- **Priority:** P1  | **Role:** admin  | **Type:** boundary
- **Preconditions:**
  - Invoiced, unpaid sales orders:
    - SO-A: created 2026-09-01, Bs 1.299
    - SO-B: created 2026-07-10, age 65, Bs 500
  - Plus a walk-in order with no customer.
- **Test data:** As above.

| # | Step | Expected result |
|---|---|---|
| 1 | Aging → AR Aging tab | 0-30 `Bs. 1.299,00`, 61-90 `Bs. 500,00`, and the walk-in order in its bucket. Total is their sum. |
| 2 | Customer column | Customer name, or "Walk-in" when there is none. The order number is plain text, not a link. |
| 3 | Take a customer payment on SO-A | SO-A leaves the report and the totals drop by 1.299. |
| 4 | An order invoiced on 2026-09-12 but created 2026-07-01 | Placed in **61-90**, because age is counted from order creation, not invoice date **(suspected defect)**. |
| 5 | Heading text | "Uninvoiced / Unpaid Sales Orders", but uninvoiced orders are left out. Wrong label. |

### FIN-052 — Aging totals match the dashboard
- **Priority:** P2  | **Role:** admin  | **Type:** reconciliation
- **Preconditions:** Data from FIN-050 and FIN-051.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | API: GET `/reports/dashboard` → `ar.outstanding`, `ap.outstanding` | AR equals the AR aging total. AP equals the AP aging total (same filters). |
| 2 | Compare with the trial balance AR and AP balances | They may differ: aging counts document totals, while the ledger reflects partial payments, credits and returns. Write down the difference. |

---

## G. Bank reconciliation

### FIN-055 — Monthly bank reconciliation, reconciled and not reconciled
- **Priority:** P1  | **Role:** admin  | **Type:** reconciliation
- **Preconditions:**
  - Account `1101` exists.
  - Before September, account 1101 has posted debits of 10.000 and credits of 2.000, so the opening balance is 8.000.
  - September postings: customer payment +1.299,00 and manual journal −100,00.
- **Test data:** Statement balance first 9.199,00, then 9.150,00.

| # | Step | Expected result |
|---|---|---|
| 1 | /finance/bank-reconciliation → year 2026, month September (month names in the tenant's language), statement balance empty → **Load** | Opening Balance `Bs. 8.000,00`. Book Balance `Bs. 9.199,00`. No statement or difference cards. |
| 2 | Ledger table | "Opening Balance" row, then each line in date order with Source label (Venta, Manual, …) and running balance 9.299,00 → 9.199,00. |
| 3 | Statement 9199 → Load | Difference `Bs. 0,00`, green check. |
| 4 | Statement 9150 → Load | Difference `Bs. 49,00` (book minus statement), red. |
| 5 | Change the month without clicking Load | Results disappear until Load is clicked again. |
| 6 | August | Its opening balance is everything posted before August. |

- **Post-conditions:** Book balance = trial balance debit − credit for 1101 up to the end of the month.

### FIN-056 — Matching and unmatching bank lines
- **Priority:** P2  | **Role:** admin  | **Type:** negative
- **Preconditions:** Same as FIN-055.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | Look for per-line match or unmatch controls, statement import, or a cleared flag | **None exist.** The page only compares one statement balance with the book balance, and nothing is saved. |
| 2 | Reload the page | The statement balance is lost. There is no stored reconciliation. |
| 3 | Record | **Gap:** match and unmatch cannot be tested. There are no endpoints, tables or screen for them. |

### FIN-057 — Bank reconciliation on a chart without account 1101
- **Priority:** P3  | **Role:** admin  | **Type:** negative
- **Preconditions:** A tenant whose chart has no code `1101` (a non-Bolivian template).
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | Load any month | "Error loading reconciliation data." The API says "Bank account 1101 not found. Seed the chart of accounts first." The account code is hard-coded **(suspected defect)**. |

---

## H. Exchange rates

### FIN-060 — Add a dated exchange rate
- **Priority:** P1  | **Role:** store_manager, finance_approver  | **Type:** happy
- **Preconditions:** USD and BOB are active currencies. The ledger rate type exists (for example "DEFAULT"). No USD→BOB rate yet.
- **Test data:** From USD to BOB, valid from 2026-09-13, rate 6.96, per 1.

| # | Step | Expected result |
|---|---|---|
| 1 | /finance/exchange-rates | The rate type dropdown defaults to the ledger type, labelled "(ledger)". Empty table: "No rates for this rate type yet." |
| 2 | **Add rate** → choose the same currency for From and To | Blocked: "Choose two different currencies." |
| 3 | Rate 0 | Blocked: "The rate must be greater than zero." |
| 4 | Per 1.5 | Blocked: "The factor must be a positive whole number." |
| 5 | Enter the valid data → Add rate | Row: 2026-09-13, USD, BOB, 6.96…, 1, MANUAL. |
| 6 | API: GET `/finance/exchange-rates/resolve?rate_type_id=…&from=USD&to=BOB&date=2026-09-20` | rate 6.96, valid_from 2026-09-13, one_unit "6.96". |
| 7 | resolve with from=BOB, to=USD | The reverse rate is computed, one_unit ≈ 0.14367816. |
| 8 | resolve with date 2026-09-12 | 422 EXCHANGE_RATE_MISSING. |

- **Post-conditions:** Exactly one rate row. The audit log has the write.

### FIN-061 — Exchange rate rules: backdating, duplicates, reverse pair, factor change
- **Priority:** P2  | **Role:** finance_approver, admin  | **Type:** negative
- **Preconditions:** The rate from FIN-060 exists.
- **Test data:** See each step.

| # | Step | Expected result |
|---|---|---|
| 1 | finance_approver: add USD→BOB on 2026-09-10 | 409 EXCHANGE_RATE_BACKDATED: "The latest USD→BOB rate starts on 2026-09-13…". Shown in the dialog. |
| 2 | finance_approver: add USD→BOB on 2026-09-13 | Same backdated refusal, because the date equals the latest one. |
| 3 | admin: add USD→BOB on 2026-09-13 | 409 EXCHANGE_RATE_EXISTS "A rate for this pair already starts on that date…". |
| 4 | admin: add USD→BOB on 2026-09-01 | Allowed. Admins may backdate. |
| 5 | Add BOB→USD on any date | 409: "This rate type already quotes USD→BOB; enter the rate in that direction…". |
| 6 | Add USD→BOB on 2026-09-20 with per 100 | 409 CONVERSION_FACTOR_MISMATCH. |
| 7 | Add EUR→BOB while EUR is inactive | 422 CURRENCY_INACTIVE. EUR does not appear in the dialog, so use the API. |

### FIN-062 — Correcting a rate: admin only
- **Priority:** P2  | **Role:** store_manager, finance_approver, admin  | **Type:** permission
- **Preconditions:** A rate row exists.
- **Test data:** New rate 6.97.

| # | Step | Expected result |
|---|---|---|
| 1 | store_manager → **Correct** on the row | The dialog opens. The button is shown to every role. |
| 2 | Save correction | "Permission denied: finance.setup.maintain". The rate is unchanged. |
| 3 | finance_approver: same | Same 403. |
| 4 | admin: same | Saved. The table shows 6.97. The audit log records the before and after values. |
| 5 | admin: rate 0 | Blocked on screen. The API gives 400. |

### FIN-063 — USD documents are refused, and there is no revaluation
- **Priority:** P1  | **Role:** buyer / ap_clerk / store_manager  | **Type:** negative
- **Preconditions:** Ledger currency BOB, USD active, a USD→BOB rate exists.
- **Test data:** A purchase order in USD for USD 100. A sales quotation in USD.

| # | Step | Expected result |
|---|---|---|
| 1 | Create a USD purchase order and receive it | The receipt is refused with 409 RECEIPT_FX_NOT_IMPLEMENTED: "Product receipts currently support documents in the ledger's accounting currency (BOB) only. Found USD; no exchange rate was inferred…". |
| 2 | Post a USD vendor invoice | 409 VENDOR_INVOICE_FX_NOT_IMPLEMENTED. |
| 3 | USD sales quotation, confirm, invoice | 409 SALES_FX_NOT_IMPLEMENTED. |
| 4 | Journal and trial balance | Nothing posted. No entry uses a rate other than 1. |
| 5 | Look for FX revaluation (a menu or `/finance/revaluation`) | None exists. **Gap.** |

- **Post-conditions:** A rate entered today has no effect on any document or report.

### FIN-064 — Read-only roles on exchange rates
- **Priority:** P2  | **Role:** ap_clerk, auditor, cashier  | **Type:** permission
- **Preconditions:** —
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | ap_clerk or auditor: /finance/exchange-rates | Rates are listed. |
| 2 | Add rate → submit | "Permission denied: finance.exchange_rate.maintain". |
| 3 | cashier: /finance/exchange-rates | The screen shows "Permission denied: finance.currency.read" (403). |

---

## I. Roles and access

### FIN-070 — Auditor can read every finance and report screen
- **Priority:** P1  | **Role:** auditor  | **Type:** permission
- **Preconditions:** An auditor user. The tenant has data.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | Open /finance/accounts, journal, facturas, iva-report (and PDF), p-and-l, balance-sheet, aging (AP and AR), periods, bank-reconciliation, exchange-rates, coa-templates | All load with data. The reads are not restricted. |
| 2 | /dashboard | KPIs and charts stay empty or show "—". Every `/reports/*` call returns 403 "Insufficient permissions" **(defect against the requirement that the auditor can read everything)**. |
| 3 | /reports (Analytics) | Empty charts. Monthly sales, top products and the rest all return 403. |
| 4 | /reports/ceo-dashboard | The error state shows. API 403. |
| 5 | /audit | Record the result (outside this module). |

- **Post-conditions:** List every 403 with its URL as evidence.

### FIN-071 — Auditor cannot change anything
- **Priority:** P1  | **Role:** auditor  | **Type:** permission
- **Preconditions:** An auditor user. Test objects exist: an account, a DRAFT journal, an ISSUED factura, an open period, a rate.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | Accounts → New Account → Save | 403 "Insufficient permissions". |
| 2 | Accounts → Seed Default (empty tenant) / coa-templates → Seed | 403 / "Permission denied: finance.setup.maintain". |
| 3 | Journal → New Entry → Save as Draft | 403 "Insufficient permissions". |
| 4 | Journal → Post on a draft | Alert "Failed to post" (403 from the server). |
| 5 | Facturas → Issue | 403. Cancel → alert "Failed to cancel". |
| 6 | Periods → Close or Reopen | Red banner "Insufficient permissions". |
| 7 | Exchange rates → Add or Correct | "Permission denied: finance.exchange_rate.maintain" / "…finance.setup.maintain". |
| 8 | Before and after: trial balance, facturas count, periods, rates | All unchanged. |

- **Post-conditions:** Nothing changed. Note that the screens do not hide write buttons from read-only roles (UX gap).

### FIN-072 — What non-finance roles can see in finance
- **Priority:** P1  | **Role:** cashier, warehouse_worker, employee, ap_clerk, finance_approver  | **Type:** permission
- **Preconditions:** One user per role.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | cashier: open /finance/balance-sheet directly | The page **loads with the full balance sheet**. No finance permission is checked on reads **(suspected defect)**. |
| 2 | warehouse_worker: API GET `/finance/trial-balance`, `/finance/journal-entries`, `/finance/ar-aging` | 200 with data **(suspected defect)**. |
| 3 | ap_clerk / finance_approver: journal Save as Draft, period close, account create | 403 on all. |
| 4 | finance_approver: add a rate | Allowed (FIN-060). |
| 5 | customer (storefront account): GET `/finance/trial-balance` | Refused by the staff-only gate. |

- **Post-conditions:** Write down the full table of role, endpoint and status code.

---

## J. Reports and dashboards

### FIN-080 — CEO dashboard figures match the source documents
- **Priority:** P2  | **Role:** admin  | **Type:** reconciliation
- **Preconditions:**
  - Known open sales orders: SO-1 DRAFT 500, SO-2 CONFIRMED 1.299, SO-3 CANCELLED 800.
  - Known purchase orders: PO-1 RECEIVED 2.500, PO-2 CANCELLED 1.000.
  - Fewer than 500 documents of each kind.
- **Test data:** As above.

| # | Step | Expected result |
|---|---|---|
| 1 | /reports/ceo-dashboard | Two process strips: Draft, Confirmed, Shipped, Invoiced, Paid for sales, and Draft, Confirmed, Received, Invoiced, Paid for purchasing. |
| 2 | Order to Cash value | `Bs. 1.799`. SO-1 + SO-2; cancelled and returned orders are excluded; shown rounded to a whole number. Count: SO-1 under Draft, SO-2 under Confirmed. |
| 3 | Source to Pay value | `Bs. 2.500`, under Received. |
| 4 | Revenue by site | Includes **DRAFT** SO-1 as revenue. Figures are order totals including IVA. This will **not** match P&L revenue (1.130,13 net for SO-2 once invoiced) **(suspected defect or labelling issue)**. |
| 5 | Coverage | Orders with no due date or no site are counted and stated, not hidden. |
| 6 | Map panel | Shows how many items could not be placed. Items without coordinates are not guessed. |

- **Post-conditions:** Pipeline value = sum of open order totals. It is not an accounting figure.

### FIN-081 — Main dashboard KPIs compared with reports and P&L
- **Priority:** P2  | **Role:** admin, store_manager  | **Type:** reconciliation
- **Preconditions:** In Sep 2026 only:
  - SO-2 CONFIRMED 1.299 at site A.
  - SO-4 SHIPPED 2.000 at site A.
  - SO-5 COMPLETED 1.000 at site B.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | /dashboard → Revenue KPI | "4k", from 4.299 / 1000 rounded. **No currency is shown** **(suspected defect: a bare number)**. The growth % compares with last month's order totals. |
| 2 | API GET `/reports/dashboard` → revenue.this_month | 4.299. Every order except DRAFT and CANCELLED, including IVA, by creation date. |
| 3 | P&L for September | Revenue is only what was invoiced, net of IVA. **It does not match the KPI.** Record both figures. |
| 4 | "Monthly Revenue" card | Shows `Bs. 2.000,00`, which is only the first row of the monthly sales query (shipped and completed orders, grouped by site). It is **not** the month's total of 3.000 **(suspected defect)**. |
| 5 | Daily mode, September | Sum of daily revenue = 4.299 (all non-draft, non-cancelled orders). |
| 6 | /reports Analytics, 2026-01-01 to 2026-12-31 | Monthly chart: September by site A 2.000 and site B 1.000. City pie chart matches. |
| 7 | The "Last month / Last 3 months / This year" dropdown on Overview | Does nothing. It is not wired to anything. |

### FIN-082 — Reports refused for non-manager roles
- **Priority:** P3  | **Role:** cashier, employee  | **Type:** permission
- **Preconditions:** —
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | /dashboard, /reports, /reports/ceo-dashboard | Empty or error states. APIs return 403. The legacy `reports:read` right these roles hold is not used. |
| 2 | admin: GET `/reports/trends/growth`; store_manager: the same | admin 200; store_manager 403. |

---

## K. Currency display

### FIN-090 — Bolivian tenant formatting
- **Priority:** P1  | **Role:** admin  | **Type:** happy
- **Preconditions:** Ledger currency BOB, currency symbol `Bs.`, 2 decimals, tenant language `es` and country `BO`.
- **Test data:** A manual factura of 1299.50.

| # | Step | Expected result |
|---|---|---|
| 1 | API GET `/tenant/currency` | `{ code: "BOB", symbol: "Bs.", rounding_precision: "0.01…", locale: "es-BO" }`. |
| 2 | /finance/facturas → total for the new factura | `Bs. 1.299,50`. Dot for thousands, comma for decimals. |
| 3 | Journal, P&L, balance sheet, aging, bank reconciliation, IVA report, IVA PDF, factura PDF | Every amount uses the same format. Column headers say "(BOB)". No hard-coded `Bs` label and no plain `1299.5` anywhere. |
| 4 | Journal form footer totals | Shown as `1299.50`, raw with a dot. Record as a minor inconsistency. |
| 5 | CEO dashboard | Whole numbers only: `Bs. 1.300`. |

### FIN-091 — Turkish lira tenant formatting
- **Priority:** P2  | **Role:** admin (TRY tenant)  | **Type:** happy
- **Preconditions:** A separate test tenant with ledger currency TRY, symbol `₺`, language `tr`, country `TR`.
- **Test data:** Journal entry of 1299.50.

| # | Step | Expected result |
|---|---|---|
| 1 | /finance/journal → expand the entry | `₺1.299,50`. Headers read "Debit (TRY)". |
| 2 | P&L, balance sheet, aging | `₺…` everywhere. No `Bs.` anywhere. |
| 3 | Clear the symbol (null) | Intl's own lira sign is used, e.g. `₺1.299,50`. |
| 4 | Bank reconciliation on this tenant | Fails (FIN-057) if the Turkish chart has no 1101. |

### FIN-092 — Tenant with no currency set up: expected banner is missing
- **Priority:** P1  | **Role:** admin  | **Type:** negative
- **Preconditions:** A test tenant with no ledger setup, so `GET /tenant/currency` returns `data: null`.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | /finance/p-and-l, balance-sheet, aging, facturas, journal | Amounts are **blank** and headers show "Debit ()". **No blocking banner**: finance screens do not use the banner message **(suspected defect: the requirement says a banner instead of wrong amounts)**. No wrong symbol or bare number appears. |
| 2 | /pos/main | The banner appears: "The ledger currency is not set up yet — ask Finance to configure it under Setup → Currencies. No amounts can be shown until then." |
| 3 | /finance/iva-report → PDF | "Loading currency…" never finishes. |
| 4 | Try to post a manual journal | Refused by the ledger lookup ("a tenant without a ledger cannot post"). Record the message. |
| 5 | Issue a manual factura | Refused when reading the ledger currency. No factura number is used up. |
| 6 | Make `/tenant/currency` fail (block it in DevTools) | Blanks on finance pages. The POS shows "The currency could not be loaded, so amounts are hidden…". |

---

# Suspected defects and gaps

| # | Severity | Finding | Location |
|---|---|---|---|
| D1 | High | Posting a draft journal does not check whether the period is closed, does not re-check balance or accounts, and does not separate creator from poster (FIN-022). | `backend/src/modules/finance/finance.routes.ts:249-256` |
| D2 | High | Saving a journal from the screen fails whenever a line description is blank: the screen sends null, the schema rejects null (FIN-011). | `frontend/src/app/(erp)/finance/journal/page.tsx:51` against `backend/src/shared/schemas/index.ts:137-142` |
| D3 | High | Deactivating an account that has postings is allowed, and every report then hides its balances, so trial balance and balance sheet stop balancing (FIN-003). | `finance.routes.ts:45-56`, filters at `:25`, `:485`, `:652`, `:695` |
| D4 | High | A manual factura posts no journal, so the IVA book and the ledger IVA/IT disagree (FIN-041/043/045). | `finance.routes.ts:314-369` |
| D5 | High | Cancelling a factura only changes its status: no ledger reversal, no check that anything changed, no confirmation (FIN-042). | `finance.routes.ts:449-455`, `facturas/page.tsx:284` |
| D6 | High | Every finance read is open to any staff role, including cashier and warehouse_worker. The legacy `finance:read` right is never used (FIN-072). | `finance.routes.ts:23,102,185,293,307,425,459,483,509,598,622,645,690,750,796,805`; `permissions.ts:78` |
| D7 | Medium | The auditor gets 403 on every report, dashboard and CEO dashboard (FIN-070). | `backend/src/modules/reporting/report.routes.ts:18-81` |
| D8 | Medium | Manual journals cannot be reversed: `reverseJournal` exists but has no route (FIN-016). | `journal.service.ts:728`; only caller `vendorPayment.service.ts:365` |
| D9 | Medium | A duplicate account code gives a generic 500 "Internal server error" (FIN-002). | `finance.routes.ts:31-43`; `errorHandler.ts:18-30` |
| D10 | Medium | Month boundaries use server time on dates stored as UTC. If the server runs behind UTC, entries or facturas on the 1st land in the wrong period or report (FIN-025/048). | `journal.service.ts:247-248`; `finance.routes.ts:463-464,513-514,809-810` |
| D11 | Medium | Period close and reopen accept any year or month (13, NaN). Reopen has no confirmation. | `finance.routes.ts:768-794`; `periods/page.tsx:351` |
| D12 | Medium | Finance screens never show the missing-currency banner (FIN-092). | `CurrencyProvider.tsx:112` (used only in `pos/main/page.tsx`, `PaymentModal.tsx`) |
| D13 | Medium | Bank reconciliation looks up account code `1101` by hard-coded number, and has no match/unmatch or saved reconciliation (FIN-056/057). | `finance.routes.ts:812` |
| D14 | Medium | AR aging counts age from order creation, not invoice or due date. AP aging reads PO flags rather than the vendor open-items ledger (FIN-051). | `finance.routes.ts:601-603, 625-633` |
| D15 | Medium | Dashboard revenue is order totals including IVA by creation date. The "Monthly Revenue" card shows only the first query row. The KPI shows "4k" with no currency (FIN-081). | `report.service.ts:215-223`; `dashboard/page.tsx:143-145,179` |
| D16 | Low | CEO dashboard revenue by site includes DRAFT orders. | `ceoDashboard.service.ts:283-290` |
| D17 | Low | Error text is read from the wrong field, so users only see "Failed to post / cancel / seed". | `journal/page.tsx:61`, `facturas/page.tsx:58`, `accounts/page.tsx:45` |
| D18 | Low | The periods warning says generated entries bypass the lock, which is no longer true. | `periods/page.tsx:305` |
| D19 | Low | Top bar "New Journal Entry" opens a page that does not exist (404). | `frontend/src/components/erp/TopBar.tsx:56` |
| D20 | Low | The IT card says "3% sobre neto", but the figure is 3% of gross. | `iva-report/page.tsx:367` (source ~line 367) |
| D21 | Low | The IVA net report returns 500 for a setup problem, and the screen hides the section silently. | `finance.routes.ts:539-546`; `iva-report/page.tsx:423` |
| D22 | Low | Year dropdowns are hard-coded (2024–2026 on P&L, 2023–2026 on IVA report). | `p-and-l/page.tsx:150`, `iva-report/page.tsx:49` |
| D23 | Low | The schema strips `dimensions` from journal lines, so the planned dimension support can never arrive; accounts that need a dimension can never take a manual entry. | `schemas/index.ts:137-142` against `finance.routes.ts:238` |
| D24 | Low | Account type and code can be changed after postings, silently reclassifying history (FIN-004). | `finance.routes.ts:45-56` |
| D25 | Low | "Current Year Earnings" is all-time net income; there is no year-end close. | `finance.routes.ts:730-734` |
| D26 | Low | Two-sided or imbalanced journal lines return 500 instead of 400. | `journal.service.ts:439-445, 493-499` |
| D27 | Low | Write buttons (Post, Cancel, Reopen, Correct, New Account) are shown to roles that cannot use them. | journal, facturas, periods and exchange-rates pages; `exchange-rates/page.tsx:262` |
| D28 | Gap | No FX revaluation. Foreign-currency documents are refused until WORK-026. | `documentCurrency.ts:25-29` |

# Uncertain — needs confirmation

1. **Backend server timezone.** Decides whether D10 actually happens.
2. **Tax setup on the test tenant.** Are the Bolivian IVA and IT tax codes set to take tax on the gross? If not, facturas use the old fallback and show 149,44 / 34,49 instead of 168,87 / 38,97. Also open: whether the Ley 1733 decree has been published, since that changes the correct figures.
3. **Closed-period and correction settings.** Is `allow_posting_to_closed_period` false and `correction_method` REVERSE on the test tenant? Both change what FIN-021/022/017 should show.
4. **Rounding account.** Is a rounding posting profile configured? It decides whether imbalances of 0,02 or less are absorbed or refused.
5. **When sales ledger postings happen.** The sales invoice revenue lines were assumed to equal the engine subtotal exactly, and the timing of COGS (ship vs invoice) was not checked. This affects the FIN-031/032 figures.
6. **Payment flags.** Does vendor payment settlement set the PO's `paid_at`, and does a customer payment set the order's `paid_at`? AP and AR aging depend on these flags, not on the open-items tables.
7. **Receipt posting path.** Is the purchase receipt → accrual → vendor invoice path what posts the net Dr Inventory 2.175 / Dr IVA input 325 / Cr AP 2.500?
8. **Cross-tenant account ids.** `dimension.service.ts:421-423` looks up accounts by id with no tenant filter. It is unclear whether another tenant's account id could be accepted on a journal line. Needs a targeted security test.
9. **Frontend route guard.** No role-based route guard or menu hiding was found in `Sidebar.tsx`. Confirm there is no middleware elsewhere before relying on FIN-072 steps 1–2.
10. **TRY tenant.** Does a test tenant with TRY currency, symbol `₺` and locale tr-TR exist for FIN-091?
11. **Duplicate IVA output accounts.** Does the test tenant still have two IVA output accounts (2103 and 2105)? If so, the IVA net report adds both together.
12. **Settling D4/D5.** The Finance co-founder needs to decide whether a manual factura and a factura cancellation *should* post to the ledger.
