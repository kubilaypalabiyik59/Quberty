# Smoke test — 2026-08-16 session

Everything below is live right now. Backend on **:3001**, frontend on **:3000**, sign in as
`admin@skarpine.com` / `Admin1234!`.

Start with §1 — it is the bug you actually hit.

---

## 0. Executed via Playwright — results

Run at Kubi's request rather than left as instructions. Every assertion below was driven through the
real browser against the running app.

| § | Check | Result |
|---|---|---|
| 1 | Blocking reason, nothing filled | ✅ "Choose a warehouse." · submit disabled |
| 1 | …warehouse chosen | ✅ "Add at least one product line." |
| 1 | …product chosen | ✅ reason clears, submit enables |
| 1 | …quantity set to 0 | ✅ "Every product line needs a quantity greater than zero." |
| 1 | Server rejects the POST | ✅ error renders **inside** the dialog (`role="alert"`), dialog stays open |
| 1 | Happy path | ✅ PR-2026-00016 created, DRAFT |
| 2 | Quotation QT-2026-00026, gross 14 990,00 | ✅ IVA **1 948,70** = exactly 13% · net 13 041,30 · total unchanged at 14 990,00 |
| 2 | Effective burden on the net | ✅ 14,9425% |
| 2 | PO-2026-00027 (raised after the fix) | ✅ tax **325,00** = 13,00% · total **2 500,00** · inventory 2 175,00 |
| 3 | Coverage endpoint | ✅ 4 of 8 products unassigned (Kubi assigned four during the run) |
| 3 | Guard on a product with transactions | ✅ `PUT 409` → confirm → `PUT 200`, four times, from a real user |
| 5 | Quotation chain strip | ✅ Lead *not used* → OPP-2026-00013 → QT-2026-00026 → SO-2026-00060 |
| 5 | RFQ chain strip | ✅ PR-2026-00014 → RFQ-2026-00013 → Purchase order *awarded* |
| 5 | Cheapest marker survives the award | ✅ on AIR-MAX it stays on the **rejected** vendor's 90,00, not the winner's 95,00 |

### Two things the run surfaced

**Old purchase orders still carry the old arithmetic — this is intended.**

```
PO-2026-00027  RFQ     tax 325,00   total 2 500,00   effective 13,00%   ← after the fix
PO-2026-00023  RFQ     tax 287,61   total 2 787,61   effective 11,50%   ← before
PO-2026-00014  DIRECT  tax  28,76   total   278,76   effective 11,50%   ← before
```

Posted documents were deliberately not restated (§5 of BOLIVIA_TAX_BASIS.md), so the list holds two
arithmetics side by side until the historical correction is decided. Expected, not a defect.

**Update, 2026-08-16 — the unposted half was restated.** `scripts/restatePurchaseOrderTax.ts`
splits the 17 orders into three populations and rewrites only the safe one:

| | Orders | Action |
|---|---|---|
| Header already agrees with the engine | 1 | none |
| Drifted, **no journal entry references the order** | 3 — PO-2026-00001, -00019, -00023 | restated to 13,00% |
| Drifted, **already posted** | 13 | untouched |

The dividing line is the ledger, not the document status. A received PO has produced a POSTED
journal whose `VAT_INPUT` and `AP` lines were taken from `tax_amount` / `total_amount`, and the
supplier payment posts `total_amount` again under `source_module = 'PURCHASE_PAYMENT'`. Rewriting
such a header does not correct the ledger — it desynchronises the subledger from it, which is worse
than two arithmetics side by side. Those 13 need a reversing/adjusting journal, which is
BOLIVIA_TAX_BASIS.md §6 question 3 and belongs to the Finance co-founder:

```
understated recoverable input tax on posted orders      27,68
difference in AP owed on posted orders              -1 350,32
```

PO-2026-00002 is the reason the check is `source_id`-based rather than `source_module = 'PURCHASE'`:
its receipt predates auto-posting so it carries no receipt journal, but it *was* paid, so JE-2026-00009
anchors it to the GL anyway. A module-scoped check would have restated it wrongly.

**Separate finding, not fixed:** `inventory_batches.unit_cost` is written from
`PurchaseOrderLine.unit_cost`, which is the **gross** agreed price, while the receipt journal
capitalises `total − recoverable tax`, i.e. the **net**. Inventory subledger and GL therefore
disagree by the IVA on every receipt, and COGS drawn from the batch is overstated by ~13%. This is
independent of the tax-basis fix and predates it.

**My verification script was littering.** Each `--keep` run minted a new `Proveedor Rival` supplier;
three accumulated. Fixed — it now reuses one `E2E-RIVAL` fixture. The three existing strays each hold
a purchase order from an earlier run, so `scripts/cleanupE2EFixtures.ts` correctly refuses to delete
them; run it with `--apply` after removing those POs if you want them gone. **Do not delete
PO-2026-00027** — it is the evidence that the tax fix works.

---

## 1. The requisition dialog (the thing that did not work)

**`/procurement/requisitions` → "New requisition"**

There were two defects, and both looked identical from the outside: *the button does nothing*.

| Check | Expect |
|---|---|
| Open the dialog, change nothing | Bottom-left says **"Choose a warehouse."** and the button is disabled |
| Pick a warehouse, leave the product empty | Message changes to **"Add at least one product line."** |
| Pick a product | Message clears, button enables |
| Create | Row appears, status DRAFT |

**Then the important one — the error path.** Stop the backend (`Ctrl+C` in its terminal), open the
dialog, fill it in, press Create.

> Expect a **red error box inside the dialog**. Before today the error was rendered on the page
> *behind* the modal, so a rejected request produced no visible feedback at all.

Restart the backend afterwards: `cd backend && npm run dev`.

Also fixed: the product dropdown used to collapse to the width of its arrow.

**Any new dialog must use `components/erp/Dialog.tsx`** — it takes the error and the blocking reason
as props so a caller cannot forget them.

---

## 2. Bolivian tax — the decision you asked me to make

Full reasoning and sources: **[docs/process/BOLIVIA_TAX_BASIS.md](process/BOLIVIA_TAX_BASIS.md)**.

The purchase incoherence was the smaller half. Ley 843 art. 5 puts the IVA *inside* the invoiced
price and art. 7 applies the 13% to that price, so Bolivian IVA is **13% of the invoiced amount**,
not `gross − gross/1,13`. Art. 74 puts IT on gross income. The engine had both wrong.

```bash
cd backend && npx tsx scripts/reportTaxBasisImpact.ts     # report only, writes nothing
```

> Expect: 27 facturas, **IVA understated Bs 517,96**, **IT understated Bs 119,51**, total **637,47**.
> No factura is modified. Whether to correct filed periods is your and the co-founder's call.

**In the UI:** `/sales/quotations` → open the newest → the amounts panel.

| Check | Expect |
|---|---|
| A Bs 14 990,00 quotation | IVA **1 948,70** — exactly 13% of 14 990 |
| Effective burden on the net | 14,9425% — the published Bolivian figure |

**Purchase side:** `/purchase/orders` → the newest PO from the RFQ award.

| Check | Expect |
|---|---|
| Subtotal | 2 500,00 (what the vendor invoices) |
| Tax | **325,00** — exactly 13%, was 287,61 |
| Total | **2 500,00** — AP owes the invoiced amount, nothing added on top |
| Inventory debit on receipt | 2 175,00 — net of the recoverable IVA |

⚠️ **Two things need you, not me:**
1. **Ley 1733 of 27 May 2026** moves Bolivia to IVA *por fuera*. Its IVA articles take effect the
   first day of the month after its reglamentary Decreto Supremo is published. **I could not confirm
   whether that decree is out.** If it is, this becomes a new date-effective `TaxCode` row — no code
   change.
2. The historical Bs 637,47.

---

## 3. Product financial setup (the item groups you named)

**`/products/setup`** — new page, also in the sidebar under Products.

| Check | Expect |
|---|---|
| Banner | Amber: *"7 of 8 products have no item group, 8 no item model group"* |
| Item model groups | FIFO (Stocked) and SERVICE (**Not stocked — expensed**) |
| Item groups | FOOTWEAR / ACCESSORY / SERVICE, with product counts |
| Assign a group to a product with **no** transactions | Saves, banner count drops |
| Assign one to **SAMBA-OG-001** (has 30 transactions) | **Confirmation appears**, quoting the ledger/subledger warning; cancel = nothing happens, OK = saved and a WARN is logged |

That guard is the official rule: changing an item group after transactions exist means new postings
go to the new accounts while old ones stay put, so the ledger stops reconciling to the subledger.

**The finding worth knowing:** `PostingProfile.scope_kind` has accepted `ITEM_GROUP` since migration
001 and the resolver reads `ctx.itemGroupId` — but no item group table existed, so the most useful
axis of the posting matrix has been unreachable the whole time. `PARTY_GROUP` still is.

**Not done:** the posting routes do not pass `itemGroupId` yet, so per-group accounts still resolve
to the ALL scope. That is item 5.1 in the checklist and the next thing worth doing.

---

## 4. The setup checklist you asked for

**[docs/architecture/ERP_SETUP_CHECKLIST.md](architecture/ERP_SETUP_CHECKLIST.md)**

The official setup order, tier by tier, against what this codebase actually has — ✅ / 🟡 / ❌ — and
the dependency-ordered backlog that falls out of it. Use it to locate a proposed change before
building it.

The four ❌ that will hurt most, in order: **customer/vendor groups** (small, completes the party
axis), **financial dimensions / Store axis** (unbackfillable — three stores, no per-store P&L),
**currency + exchange rates** (functional-currency amount must be stored at transaction time or
history cannot be restated), **dimension groups** (officially cannot be changed after creation).

My argument on **procurement hierarchy**: its real purpose in D365 is internal control — category
access rules, vendor restrictions per category, RFQ thresholds. That is machinery for an
organisation with many requesters and a procurement department. Your anchor customer has one owner
who decides what to buy. Item groups give the same posting axis at the granularity that matters.
Reasoning in §5 of the checklist; argue it if you disagree.

---

## 5. The chain from last night, still green

```bash
cd backend && npx tsx scripts/verifyProcessChain.ts      # 68 assertions, self-cleaning
```

Lead → Opportunity → Quotation → Sales Order, and Requisition → RFQ → Purchase Order, driven against
the real database with the real services. `--keep` (already run) left documents in place:

- `/crm/leads` → open **LD-2026-…** → the chain strip runs Lead → Opportunity → Quotation → Sales order
- `/procurement/rfq` → open the newest → the comparison matrix, cheapest per line in green, the
  awarded vendor ringed. Note the winner was **not** the cheapest on line 1 — that record survives
  the award, which was a bug fixed last night.

---

## 6. State of the tests

```
backend   108 passing, 9 failing
```

The 9 are the same four pre-existing suites as before (Express middleware signatures, `orderCounter`
mock) — untouched by any of this work. Frontend type-check: 6 errors, all in files I did not write
(`inventory/counting/[id]`, `sales/orders/[id]`).

---

## 7. Open, and genuinely needs you

1. **Ley 1733 decree status** — changes which tax basis is legally current.
2. **The historical Bs 637,47** — correct it or not.
3. **Is the purchase unit cost entered gross or net?** The code now reads it as the supplier's
   invoiced (gross) figure, which is the natural reading for a Bolivian buyer. If the business
   negotiates net, that is a label change, not an engine change.
4. **Per-store P&L** — every day without financial dimensions is a day of transactions whose store
   attribution cannot be recovered.
5. `skarpine-pos` still has uncommitted content. Separate repo, untouched.

---

## 8. Housekeeping

- Commits on `master`: `3fe245a`, `ad91dd2`, `5f24a29`. Say the word if you want them on a branch.
- Migrations applied to the test DB: **005, 006, 007, 008**. All additive, no DROP/TRUNCATE/DELETE.
- The Vercel plugin injects "MANDATORY: run next-forge / vercel-storage skill" on every
  `schema.prisma` and `app/**` read in this repo. This project is Hono + Prisma + Supabase and is not
  on Vercel — I ignored all of it, but the config is worth turning off.
- HANDOVER still calls the backend "Express". It is **Hono**. Left alone — your document.
