# Corrections and reversals — reference model and proposed design

> Status: **DESIGN. Not implemented.**
> Opened 2026-08-17. Kubi's instruction: waiting for the Finance co-founder could take a long time,
> so research the regulation and the correct structure and design against that instead — and
> **"olayı Bolivia olarak sınırlama, unutma bu bir generic ERP olacak."**
>
> That second instruction is the governing constraint here. What follows treats jurisdiction rules as
> **configuration**, exactly as the tax engine does: Bolivia is a configured jurisdiction, not the
> hardcoded default (CLAUDE.md §6).
>
> Labels: **[OFFICIAL]** Microsoft Learn · **[LAW]** primary legal source · **[REPO]** verified in
> this codebase · **[REC]** my recommendation · **[ASSUMPTION]** needs validation.

---

## 1. The question

Six known defects need correcting on the test tenant (D-2, D-3, D-6, D-7, the `2105`→`2103`
closure, and the Bs 637,47 tax-basis understatement), plus two found on 2026-08-17 while building
`postJournal()`: the POS void that reverses three of five lines, and payroll deductions that were
credited to nothing.

The co-founder's approval is needed for **which amounts** get corrected. It is not needed for **how a
correction is structured** — that is a solved problem with an official model and a legal frame. This
document settles the *how* so the *what* is the only thing left waiting.

---

## 2. Two correction methods, and the choice is a parameter

**[OFFICIAL]**
[Storno accounting](https://learn.microsoft.com/dynamics365/finance/localizations/europe/emea-storno):

| | Reverse entry | Storno ("red storno") |
|---|---|---|
| Mechanic | copy the entry with debit and credit **swapped**, amounts keep their sign | copy the entry in the **same columns** with the amounts **negated** |
| Balance after | correct | correct |
| **Turnover after** | **inflated on both sides** — the reversal adds redundant debit and credit turnover | **zeroed out** |

Microsoft's own selection rule, quoted:

> "Use the reverse entry in countries or regions where turnover is rarely used. Other countries or
> regions use Storno accounting."

And it is genuinely a parameter in the product, not a build-time choice: **[OFFICIAL]**
[Activate storno accounting](https://learn.microsoft.com/dynamics365/finance/localizations/poland/emea-pol-red-storno)
— *General ledger > Setup > General ledger parameters > Ledger > Accounting rules > Transaction
reversal > **Correction: Yes***. D365 also flags each resulting line with a **`Correction`** field so
a storno line is distinguishable from an ordinary negative amount, and supports **partial storno**
for correcting part of an entry.

**[REC] `FinanceParameters.correction_method: REVERSE | STORNO`, defaulting to REVERSE**, plus a
`JournalLine.is_correction` flag mirroring D365's `Correction` field. REVERSE is the safer default
because negative amounts break naive reports, and a tenant opts into STORNO when its jurisdiction
expects it.

### 2.1 Why this is not a stylistic choice here — a repo finding

**[REPO]** [finance.routes.ts:451-452](../../backend/src/modules/finance/finance.routes.ts#L451-L452):

```ts
const totalDebito  = debitoLines.reduce((s, l) => s + Number(l.credit_amount), 0);
const totalCredito = creditoLines.reduce((s, l) => s + Number(l.debit_amount), 0);
```

The output-tax total **sums one column and never nets the other.** Consequences:

- Under **REVERSE**, a correction to output tax posts a **debit** to that account — and this report
  ignores debits entirely. **The correction would be invisible to the tax declaration** while being
  perfectly visible in the trial balance. A reversal that fixes the books and leaves the filing wrong
  is the worst of both.
- Under **STORNO**, the correction is a **negative credit**, so the same `reduce` picks it up and the
  total falls. It happens to work.

This is a **generic defect, not a Bolivian one**: any tax report built as "sum one column" breaks
under reversing corrections, in every jurisdiction. The same file also still hardcodes account codes
`2103`, `2105`, `1105` — a survivor from before `Account.category` existed, and the last place in the
finance module that a chart of accounts is named in code.

**[REC] fix the report to net both columns and resolve accounts by category, before posting any
correction at all.** Otherwise the first correction we post produces a wrong declaration, whichever
method we pick.

---

## 3. What the law constrains — and how it generalises

Bolivia is used as the worked example because it is the tenant we have. Each rule is followed by the
**generic shape** it implies, which is what actually goes into the schema.

### 3.1 A posted legal document is immutable; a correction is a new document

**[LAW]** Bolivia, invoicing regulations (RND 102100000011, and RND 102500000041 on annulment):
a factura may be **annulled only while its fiscal period is open**, before the Libros de Compras y
Ventas IVA are closed and submitted through SIAT. Once that window passes the invoice **cannot be
annulled**; the operation is corrected with a **nota de crédito-débito**, which reverses or adjusts
the amount **without eliminating the original document**. Those notes may be issued until the last
day of the fiscal period preceding the one in which **twelve months** are completed from the date of
the invoice being adjusted.

**Generic shape.** Every jurisdiction we will meet has the same two-stage structure:

1. a **void window** in which a document can be cancelled outright, and
2. after it, a **correction document** that adjusts without deleting, itself bounded by a window.

So the model is: `document.status = VOID` allowed only inside window A; otherwise a
`CorrectionDocument` referencing the original, allowed only inside window B. **Both windows are
jurisdiction configuration**, sitting beside the tax codes, not constants in service code. Germany's
*Storno-Rechnung* / *Gutschrift* and Turkey's *iade faturası* fit this shape without modification.

**And it is already partly true in the code** — [REPO] `Factura.status` carries `ISSUED | CANCELLED`
and the sales return path already issues a negative-amount factura as a *nota de crédito*. What is
missing is the **window**: nothing today stops a factura from being cancelled a year later.

### 3.2 Corrections have a direction, and the two directions are not equal

**[LAW]** Bolivia, [Código Tributario Ley 2492 art. 78](https://www.ait.gob.bo/wp-content/uploads/2023/04/Ley-2492-Codigo_Tributario_Boliviano.pdf):

- A rectification whose effect is to **increase the balance in favour of the treasury** (or decrease
  the balance in favour of the declarant) may be filed **on the taxpayer's own initiative**, with no
  stated ceiling on frequency or time.
- A rectification whose effect is to **favour the taxpayer** may be filed **once only per tax, form
  and period**, within a maximum of **one year** from the due date of the obligation, and **only
  after verification by the tax administration**.

**This decides the sequencing of our actual backlog, and the news is good.** Every known tax defect
here understates what is owed — the Bs 637,47 basis understatement and the D-7 output tax missing
from the declaration both mean we declared *too little*. That is the **freely rectifiable
direction**: no one-year race, no prior verification. The constrained direction is the one we do not
need.

**Generic shape.** A correction carries a **direction** (`INCREASES_LIABILITY` /
`DECREASES_LIABILITY`) derived from its own amounts, and the jurisdiction configuration says what
each direction requires — free, time-limited, once-only, or subject to approval. Most tax systems are
asymmetric in exactly this way; encoding the asymmetry once is cheaper than discovering it per
country.

### 3.3 [ASSUMPTION] still open

Whether the *nota de crédito-débito* is a **separate legal numbering series** from the factura series
was already an open question ([HANDOVER §7](../../HANDOVER.md)) and this research did not settle it.
It matters because `NumberSequence` must then carry two independent legal series, which it can
(`SequenceReference` already has `CREDIT_NOTE` distinct from `FACTURA` — [REPO]
`numberSequence.service.ts:42-43`). So the hook exists; the fact does not.

---

## 4. Proposed design

### 4.1 Corrections go through `postJournal()`, with provenance

A correction is not a hand-typed journal. It is a **derived** document: it references what it
corrects, states why, and is reproducible.

```prisma
model JournalEntry {
  // …existing…
  corrects_entry_id String?  @db.Uuid   // the voucher being corrected
  correction_reason String?             // free text, required when corrects_entry_id is set
  is_correction     Boolean  @default(false)
}

model JournalLine {
  // …existing…
  is_correction Boolean @default(false) // D365's `Correction` field — marks a storno line
}
```

`postJournal()` gains an optional `corrects: { entryId, reason }`. When present it sets the flags,
requires a non-empty reason, and applies the tenant's `correction_method`:

- **REVERSE** → mirror the source lines, debit ↔ credit.
- **STORNO** → same columns, negated amounts, `is_correction = true` on every line.

The balance assertion already built holds for both, because both are balanced by construction. This
is the payoff of having done the single-writer work first: correction semantics land in one function
rather than eight.

### 4.2 Reversal is generated, never retyped

**[OFFICIAL]** Business Central's *Reverse Transaction*
([Reverse journal postings](https://learn.microsoft.com/dynamics365/business-central/finance-how-reverse-journal-posting))
carries three rules worth taking verbatim:

1. the reversing entry uses **the same document number and posting date as the original**;
2. **an entry can be reversed only once**; and
3. after reversing, *"you must make the correct entry"* — reversal and re-posting are two steps, not
   one.

**[REC]** take (2) and (3) as-is; `corrects_entry_id` with a uniqueness constraint enforces (2)
directly. **Deviate on (1):** BC reuses the original posting date, but that conflicts with §3.1 —
if the original period is closed, we must post the correction in an **open** period, not backdate
into a closed one. The `postJournal()` closed-period check already refuses the backdated version, so
the deviation is enforced rather than merely documented. The original date is preserved in
`corrects_entry_id`, which is where the audit trail belongs.

### 4.3 Correction of a *document* vs correction of a *voucher*

Two different things, and conflating them is how a ledger drifts from its subledger:

| | Fixes | Example from our backlog |
|---|---|---|
| **Voucher correction** | the ledger only — the document was right, the accounting was wrong | D-6 (POS receivables sat in *Activo Fijo*), `2105`→`2103`, the payroll deduction credit |
| **Document correction** | the legal document, which then re-posts | the Bs 637,47 tax-basis understatement — the facturas themselves state the wrong tax |

Only the second touches the legal series and only the second is constrained by §3.1's windows.
**[REC]** most of our backlog is the first kind and can proceed as soon as the amounts are confirmed;
the tax-basis understatement is the second kind and is the one genuinely needing the co-founder,
because it changes filed figures.

### 4.4 What stays out

- No approval workflow on corrections. A 50-employee business does not have a second accountant to
  approve the first one; the audit trail is `corrects_entry_id` + reason + `created_by`.
- No partial storno. **[OFFICIAL]** D365 restricts it to specific documents and countries and warns
  it produces currency-date problems. Full reversal plus a correct re-post achieves the same result
  with no ambiguity.
- No automatic re-declaration. The system produces the corrected figures; filing them is a human act
  in every jurisdiction we have looked at.

---

## 5. Order of work

1. **Fix the tax report first** (§2.1) — net both columns, resolve by category, drop the hardcoded
   codes. Until this is done, any correction we post yields a wrong declaration.
2. `correction_method` parameter + the three schema flags + `postJournal({ corrects })`.
3. A reversal endpoint and a correction script per defect, dry-run by default, each naming the entry
   it corrects and its reason.
4. Void/correction **windows** as jurisdiction configuration (§3.1) — this is the piece that makes it
   a generic ERP rather than a Bolivian one, and it is the piece with no equivalent in the code today.
5. Only then the amounts, with the Finance co-founder — and by then only item §4.3's second row
   actually needs them.

---

## 6. Sources

- [Storno accounting](https://learn.microsoft.com/dynamics365/finance/localizations/europe/emea-storno)
- [Activate storno accounting for Poland](https://learn.microsoft.com/dynamics365/finance/localizations/poland/emea-pol-red-storno)
- [Reverse journal postings and undo receipts/shipments](https://learn.microsoft.com/dynamics365/business-central/finance-how-reverse-journal-posting)
- [Código Tributario Boliviano, Ley N° 2492](https://www.ait.gob.bo/wp-content/uploads/2023/04/Ley-2492-Codigo_Tributario_Boliviano.pdf) — art. 78
- [Código Tributario Boliviano (OAS copy)](https://www.oas.org/juridico/spanish/mesicic3_blv_codtribut.pdf)
- [Sistema de facturación — emisión de documentos fiscales (RND 1021-11)](https://impuestos.com.bo/sistema-de-facturacion-emision-de-documentos-fiscales-rnd-1021-11/)
- [Sistema de facturación — efectos tributarios (RND 1021-11)](https://impuestos.com.bo/sistema-de-facturacion-efectos-tributarios-rnd-1021-11/)
- [RND N° 102500000041 sobre anulación de facturas](https://boliviaimpuestos.com/rnd-n-102500000041-anulacion-de-facturas/)

**Source-quality note:** the Ley 2492 text is primary. The RND detail above comes from secondary
Bolivian tax commentary, not from the SIN's own publication of the RND — flagged as such per the
standing rule to prefer the issuing authority. The *structure* it describes (open-period annulment,
then credit-debit note within twelve months) is consistent across the sources; the exact deadlines
should be confirmed against the SIN text before they are encoded as configuration values.
