# Bolivian tax basis — the decision, and the law behind it

**Decided 2026-08-16.** Kubi asked me to read the legislation and decide rather than hand the
question back. This is the decision, the evidence, and what changed.

---

## 1. The question that was asked

Purchase computed tax incoherently: it decomposed IVA *out of* the subtotal and then added the
result back *on top*.

```
Bs 2 500  →  tax = 2500 − 2500/1,13 = 287,61  →  total 2 787,61      effective 11,50%
```

Either the subtotal is gross and nothing should be added, or it is net and the tax should be 325,00.
It cannot be both.

## 2. The larger question the legislation exposed

Answering it required reading how the IVA base is defined at all — and the sales side turned out to
be wrong too, in the same way and for the same reason.

### Ley 843, art. 5 — the tax is *inside* the price

> "El impuesto de este Título **forma parte integrante del precio neto de la venta**, el servicio o
> prestación gravada y se facturará juntamente con éste, es decir, **no se mostrará por separado**."

### Ley 843, art. 7 — the rate applies to those totals

> "A los importes totales de los precios netos de las ventas, contratos de obras y de prestación de
> servicios […] se aplicará la alícuota establecida en el artículo 15°."

Read together: a Bolivian factura shows **one** amount, that amount already contains the IVA, and
the 13% is applied **to it**. This is the regime Bolivians call **IVA por dentro**, and it is why the
country quotes two rates — nominal **13%**, effective **13/(1−0,13) = 14,9425%** of the true net.

The standard illustration: to keep Bs 100 net, a merchant must invoice `100 / 0,87 = Bs 114,94`.

### Ley 843, art. 74 — IT is on gross income

> "El impuesto se determinará sobre la base de los **ingresos brutos devengados** durante el período
> fiscal […] Se considera ingreso bruto el **valor o monto total** […] devengados en concepto de
> venta de bienes […]"

So IT's 3% is on the invoiced amount, not on what is left after IVA.

### What the engine was doing

`gross − gross/1,13`, i.e. **11,50%** of the invoiced amount for IVA, and 3% of the *post-IVA net*
for IT. That is the EXTRACT arithmetic — correct wherever a tax-inclusive price means "net plus tax,
quoted together", which is most of the world and **not** Bolivia.

| On a factura of Bs 1 299,00 | Engine (before) | Ley 843 | Difference |
|---|---:|---:|---:|
| IVA débito fiscal | 149,44 | **168,87** | +19,43 |
| IT | 34,49 | **38,97** | +4,48 |

---

## 3. Ley 1733 — Bolivia is mid-transition, and that shaped the design

**Ley N° 1733 of 27 May 2026** ("Alivio Tributario, Condonación y Regularización Tributaria")
rewrites art. 5 and moves Bolivia to **IVA por fuera** — 13% on the net, shown separately, so the
effective rate really becomes 13%. SIN's own announcement frames it as fixing the 14,94% versus 13%
gap.

**It is not yet in force.** The law is in effect from 28 May 2026, *except* the IVA provisions, which
apply "desde el primer día del mes siguiente a la publicación de su decreto reglamentario". Whether
that Decreto Supremo has been published could not be confirmed from an authoritative source at the
time of writing — **verify before relying on it.**

This is the single most important design input: **the correct answer changes within the year.** So
the arithmetic must be data, not code.

---

## 4. The decision

**One new column: `TaxCode.base_kind` — `NET` | `GROSS` — meaning "what the rate multiplies".**

Orthogonal to the existing `is_inclusive`, which answers a different question ("does the quoted price
already contain this tax?"). The two are genuinely independent:

| | `is_inclusive` | `base_kind` | tax on 1 000 |
|---|---|---|---|
| Bolivia IVA, pre-1733 | true | **GROSS** | 130,00 (13% of 1 000) |
| Bolivia IT | false* | **GROSS** | 30,00 |
| Bolivia IVA, post-1733 | false | NET | 130,00, invoice becomes 1 130 |
| Turkey KDV, Germany USt | false | NET | 130,00 added on top |
| Tax-inclusive pricing elsewhere | true | NET | 115,04 extracted |

\* IT is not added to what the customer pays — it is a cost to the seller — which is already handled
by `tax_type = TURNOVER`.

**Migration 007** adds the column with default `NET`, the correct default for a new jurisdiction.
`scripts/reportTaxBasisImpact.ts` sets Bolivia's two codes to `GROSS` and prints what it is doing.

### Why this, and not just fixing the formula

Because Ley 1733 makes both answers correct at different dates, and `TaxCode` is already
date-effective. When the reglamentary decree lands, the transition is a **new row**:

```
code IVA13F · is_inclusive false · base_kind NET · valid_from <first day of the month>
```

No migration. No code change. No redeploy. That is the whole point of having built the tax engine
this way.

### The purchase side, specifically

A supplier's factura carries one amount with the IVA inside it, and the buyer's crédito fiscal is 13%
of that invoiced amount. So the figure a buyer agrees with a vendor **is the gross**:

```
gross           what we owe the supplier         → AP
13% × gross     recoverable input tax            → VAT_INPUT
gross − tax     what capitalises into stock      → Inventory
```

Inventory is now debited **net of the recoverable tax**. Capitalising IVA that will be reclaimed
overstates stock value and therefore every COGS figure that flows from it — a real defect that the
old `Dr Inventory(subtotal) + Dr VAT_INPUT(tax) = Cr AP(subtotal+tax)` posting was hiding by
inflating both sides.

All three purchase paths — direct PO, requisition → PO, RFQ award → PO — go through one helper,
`computePurchaseMoney`, so they cannot drift apart again.

---

## 4b. Does this break the parametric configuration? — Kubi's question, answered by test

The fair worry: teaching the engine an arithmetic almost nobody else uses could smuggle Bolivia back
into the code that the configuration foundation exists to keep country-independent.

**Audited.** `grep -rE "0\.13|1\.13|0\.03"` over `src/`, excluding tests, returns **one comment line**
and `config/tax.ts`. There is no hardcoded rate in the tax engine, in `documentTax.service.ts`, or in
any posting path. `base_kind` is a column read at runtime, not a branch.

**Proven, not asserted.** `src/__tests__/jurisdictionPortability.test.ts` runs **one code path** over
four configurations that differ only in `TaxCode` rows:

| Same input: 1 000 | Sales total | Purchase, agreed 2 500 → AP owes | recoverable |
|---|---:|---:|---:|
| Bolivia today (inclusive, GROSS) | 1 000 | 2 500 | 325 |
| Bolivia post-1733 (exclusive, NET) | 1 130 | 2 825 | 325 |
| Turkey KDV 20% | 1 200 | 3 000 | 500 |
| Germany USt 19% | 1 190 | 2 975 | 475 |

Four different, each-correct answers, no jurisdiction branch. The suite also invents a country that
was never coded for — 5% on the gross — and gets the right answer, which is the actual test of
"adding a jurisdiction is adding rows".

The pure derivation was extracted as `splitPurchaseMoney` precisely so this could be tested without a
database.

### The two honest holes

1. **`config/tax.ts` is hardcoded Bolivia *and* still contains the old, wrong formula.** It is the
   legacy fallback for a tenant with no tax setup, and `documentTax.service.ts` logs a warning
   whenever it fires. It should be deleted once every tenant is provisioned — that was already true
   before this change; it is now also *wrong*, not merely inflexible.
2. **`reportTaxBasisImpact.ts` originally hardcoded 13% and 3%.** Fixed in the same pass: it now runs
   the real engine over the tenant's own codes and produces the identical Bs 637,47, which is what
   demonstrates the generalisation is behaviour-preserving. The only jurisdiction-shaped thing left
   in it is a currency→reason lookup table, stated on screen before anything is written.

---

## 5. What was deliberately NOT done

**No posted document was restated.** The 27 issued facturas keep the amounts they were issued with.
Recomputing them would be restating filed periods, and that is a decision for the Finance co-founder,
not for a refactor.

`scripts/reportTaxBasisImpact.ts` sizes it instead — against the test database:

```
27 issued facturas, invoiced total          Bs 34 632,00
IVA débito as issued (≈11,50%)                  3 984,20
IVA débito per Ley 843 (13,00%)                 4 502,16
UNDERSTATED IVA                                   517,96
IT as issued (3% of net)                          919,45
IT per art. 74 (3% of gross)                    1 038,96
UNDERSTATED IT                                    119,51
TOTAL TAX UNDERSTATED                             637,47
```

**These are test-database figures.** Whether a real correction is owed depends on what a production
instance, if any, has actually filed — still unrecorded in this repo.

---

## 6. Open questions for the Finance co-founder

1. **Has the Ley 1733 reglamentary Decreto Supremo been published?** If yes, add the `NET` row with
   the right `valid_from` and the system switches on that date.
2. **Under IVA por fuera, what is IT's base?** Art. 74 says gross income. Once IVA is shown
   separately, collected IVA is arguably not income, which would make the base the net. The law has
   not been tested on this; `base_kind` makes it a configuration choice either way.
3. **Do the historical facturas need correcting**, and does the anchor customer's production
   instance share this defect?
4. **Is the purchase unit cost entered gross or net by the buyer?** The code now treats it as the
   supplier's invoiced (gross) figure, which is the natural reading for a Bolivian buyer. If the
   business negotiates in net terms, that is a UI labelling change, not an engine change.

---

## 7. Verification

```
backend/src/__tests__/tax.service.test.ts     33 tests, asserting the LAW
backend/scripts/reportTaxBasisImpact.ts       backfill + historical quantification
backend/scripts/verifyProcessChain.ts         end-to-end, now asserting 13% and 14,9425%
```

The old suite asserted equivalence with `config/tax.ts` and passed for months. It was faithfully
protecting the defect. `config/tax.ts` is now only the legacy fallback for unprovisioned tenants and
should be deleted once every tenant is provisioned.

## Sources

- [Ley 843, texto ordenado (Lexivox)](https://www.lexivox.org/norms/BO-L-843.html)
- [Reglamento del IVA, DS 21530 (Lexivox)](https://www.lexivox.org/norms/BO-DS-21530R1.html)
- [Ley N° 1733, 27 May 2026 — PDF on impuestos.gob.bo](https://www.impuestos.gob.bo/wp-content/uploads/2026/05/L17332051NCPP.pdf)
- [SIN: "Proyecto de Ley transparenta el IVA y fija tasa efectiva real del 13%"](https://www.impuestos.gob.bo/index.php/nota_prensa/proyecto-de-ley-transparenta-el-iva-y-fija-tasa-efectiva-real-del-13/)
- [Gaceta Oficial del Estado Plurinacional de Bolivia](http://www.gacetaoficialdebolivia.gob.bo/normas/verGratis_gob/12300)
