# Go-to-Market Strategy: From One Customer to a Subscription Business

**Date:** 2026-09-05
**Audience:** Founders
**Companion documents:** [SAAS_READINESS_ASSESSMENT.md](./SAAS_READINESS_ASSESSMENT.md) ·
[SAAS_READINESS_BRIEFING.md](./SAAS_READINESS_BRIEFING.md)

Commercial strategy only. The technical readiness work is covered in the companion documents
and is not repeated here.

**Evidence labels:** `[VERIFIED]` checked against a source, cited
`[RECOMMENDATION]` my judgement `[ASSUMPTION]` needs confirmation — do not act on it as fact

---

## 0. An objection to the sequence

The stated goal is to build a strategy for selling on a monthly subscription. But the ordering
is wrong: **we should not be building a SaaS company yet. We should be building a
five-customer company.**

The distinction matters. Building the SaaS machinery — billing, self-service signup, plan
tiers, automated provisioning — means building infrastructure for customers who do not exist
yet. It is the most common failure mode for product companies: converting a sales problem into
an engineering problem and mistaking that for progress.

We have **one** customer. The unanswered question is: *can a second customer use this product
without custom code written for the first one?* Until that is known, every pricing model is a
guess.

---

## 1. The go/no-go ahead of everything: SIN authorisation

Electronic invoicing in Bolivia is regulated by the SIN (Servicio de Impuestos Nacionales),
and there is an existing market of SIN-approved providers — GuruSoft, Signature, EERPBO among
them. Systems operate through points of sale approved by the SIN `[VERIFIED — see sources]`.

The question this raises is not technical, it is a **licensing question**: is our factura
module authorised in the eyes of the SIN? A system written for a company's own use and a
invoicing product *sold to third parties* may not sit in the same legal category.

`[ASSUMPTION — and not something I can verify]` This must be settled with a Bolivian
accountant or lawyer. If the answer is "yes, authorisation is required," that is not a
blocker, but it is **a work item that sits ahead of the product** — and its timeline shapes
the entire strategy.

It is first on this list because pricing, marketing and roadmap work done before this question
is answered may all be wasted.

---

## 2. The assets we are undervaluing

Three, in order of importance:

**1. A working reference customer that came off paper.** A three-store retailer that ran on
paper now runs an ERP and a POS. That is a before/after story. In SME ERP sales there is no
more valuable asset — what sells is not a feature list, it is *someone else like me already
running this.*

**2. Bolivia-specific tax compliance.** IVA 13% "por dentro", IT 3% on sales only, legally
sequential facturas. Regional players such as Alegra, Siigo and Defontana are focused on
Colombia, Mexico and Chile `[VERIFIED — see sources]`. Bolivia is a small market, which makes
it **unattractive to the large players** — and defensible for us for exactly that reason.

**3. Kubi's consulting background.** This looks like a distraction from product work. It is
not. **ERP is not bought, it is sold.** The buyer cannot evaluate it alone; someone has to
understand their process and tell them how their business should run. That is the natural work
of a supply-chain consultant with eight years in D365.

---

## 3. Three strategic decisions

### Decision 1 — Stay vertical, do not go horizontal

`CLAUDE.md` defines the target market as "businesses up to roughly 50 employees." **That is
not a market, it is a demographic.** It does not tell us who to sell to.

`[RECOMMENDATION]` **Footwear and apparel retail in Bolivia.** Because:

- Onboarding becomes templated — size/colour variants, seasons, inter-store transfers are the
  same problem every time
- References talk to each other; in a small market, word of mouth is a working distribution
  channel
- We can be number one in a niche. In "SME ERP" we would be number fifty

Expansion should come from geography, not from adding verticals: Bolivia retail first, then
the same vertical in neighbouring countries. The country-independent tax engine already built
is the foundation for that.

### Decision 2 — Who does the selling?

The most critical and most commonly skipped question.

| Channel | Assessment |
|---|---|
| **Us, directly** | The only correct answer for the first 5–10 customers. Does not scale, but it teaches |
| **Accountants** | In LatAm, the person who recommends a system to an SME is their accountant. Strongest long-term channel, on a commission model |
| **Reference customer network** | Retailers know each other. Cheapest channel available |

`[ASSUMPTION — needs confirmation]` **Is the co-founder in Bolivia?** Kubi is in Europe. If
there is nobody doing on-the-ground sales and support in Bolivia, this strategy has no
channel — and then it does not matter how good the product is. This is a larger risk than any
technical debt in the codebase.

### Decision 3 — Hybrid, not pure SaaS

Pure subscription does not work in SME ERP, because per-customer onboarding cost is real and
high: product data, customer data, opening stock and balances, training.

`[RECOMMENDATION]` **One-time implementation fee + monthly subscription.**

Bolivian SMEs already expect this; local ERP vendors work this way. The benefit runs both
ways: it pulls cash forward (funding product development) and it stops a "free
implementation" promise from eating the margin. It also matches the hybrid consulting +
product model already described in `CLAUDE.md` §2.

---

## 4. Pricing

**The value metric should be stores, not users.** In retail, many people touch the POS —
per-user pricing penalises exactly our use case. Store count, by contrast, tracks the
customer's own growth: as they grow we grow, which produces natural net revenue retention.

`[RECOMMENDATION]` **Structure:** a base fee plus a per-store fee, with module tiers. The
`Tenant.modules` field already in the schema is the correct hook for this.

**Watch what we are pricing against.** Not SAP, not D365 — **paper, Excel and an external
accountant.** That is the comparison in the buyer's head.

Simple arithmetic, to see which game we are playing: at $150/month, **$100k ARR needs ~55
customers**; $500k ARR needs ~280. Consider those numbers against the Bolivian retail market.
If they are reachable, the strategy holds. If not, either the price is too low or the market is
too narrow — and we need to know which, now.

**The real unit-economics question:** how many hours does it take to onboard one customer? At
40 hours and $150/month, payback is two years — that is not a business. This single number
determines whether the model is alive. **It cannot be known without measuring it on the anchor
customer.**

---

## 5. "Safe" in commercial terms

Technical security is covered in the companion documents. On the commercial side, in order of
urgency, these are the things that can end the company:

**1. Who owns the code?** This product was written for a three-store retailer. If that
customer funded the development, they may have a claim on it. Selling to a second customer
before this is settled creates a problem that is very expensive to unwind retroactively.
**Settle it in writing — this is the most urgent item on the list.**

**2. Founder agreement and vesting.** There is a finance-consultant co-founder. Equity split,
vesting schedule and departure scenarios must be written down **while none of it is worth
anything**. Held until it is worth something, this conversation ends partnerships.

**3. Contract template.** Liability cap (if a bug misstates a customer's tax position, who
pays the fine?), guaranteed data export, retention period, SLA, price-change notice.

**4. Customer concentration.** One hundred percent of revenue comes from a single customer. If
they leave, the company ends. A second customer is not a growth target — it is **existential
risk reduction.**

**5. Which legal entity invoices?** Kubi is in Europe, the customers are in Bolivia, payment
is in BOB. This is not an accounting detail — it determines the payment rail, the tax
treatment and the currency exposure. It connects directly to the Stripe question raised in the
readiness assessment (§3.3).

---

## 6. The concrete plan — five customers, not a SaaS

### Phase 0 — Validation (now, ~3 months)

1. Answer the SIN authorisation question. Before anything else.
2. Get code ownership in writing.
3. **Convert the anchor customer into a paying subscriber.** This single event tells us more
   than anything else. If they will not pay monthly, everything downstream is theoretical.
4. **Measure onboarding in hours.**
5. Close §1.1 — the unauthenticated tenant routes — before a second customer exists.

### Phase 1 — Does it repeat? (~6 months)

Three more retailers from the anchor customer's network. We sell, we invoice by hand, we
collect by bank transfer. **Build no billing infrastructure.** The only thing being measured:
how much custom code did each new customer require?

- Close to none → we have a product; proceed to Phase 2
- Every customer needs serious custom work → this is a consulting business, not a product.
  Learning that early is good news, not bad

### Phase 2 — Build the machine

Only here do billing, self-service provisioning and plan tiers become meaningful — because by
then we know what we are selling, to whom, and at what price.

---

## 7. Stop signals

Define these now, because they are invisible from inside:

- The anchor customer refuses to pay monthly
- The second customer needs more than two weeks of custom development
- Onboarding will not come below 40 hours
- SIN authorisation turns out to take more than six months, or is unpredictable
- There is nobody in Bolivia to sell and support on the ground

---

## 8. Three questions that gate the next step

The strategy cannot be detailed further without these, because the answers point in different
directions:

1. **Who owns the code?** Did the anchor customer fund the development, and is there a written
   agreement?
2. **Is the co-founder in Bolivia?** Is there on-the-ground sales and support capacity?
3. **Is Bolivia the target market or a beachhead?** Long term, is this LatAm, or a different
   geography entirely?

---

## 9. A note against our own stated goal

`CLAUDE.md` §23 sets the long-term aim as reducing dependence on selling Kubi's own consulting
hours. That is the right goal — but **the first ten customers of this product will absolutely
be sold with those hours.** Consulting is not the opposite of product at this stage; it is the
distribution channel. Trying to skip it means finding no customers at all.

---

## Sources

- [EDICOM — How e-invoicing in Bolivia works (SIN regulations)](https://edicomgroup.com/blog/how-einvoicing-in-bolivia-works)
- [GuruSoft — Facturación Electrónica Bolivia](https://guru-soft.com/facturacion-electronica-bolivia/)
- [Alegra profile — Software Advice](https://www.softwareadvice.com/accounting/alegra-profile/)
- [Siigo profile — Capterra](https://www.capterra.com/p/209269/Siigo/)
- [Top accounting software in Latin America (2026)](https://satvasolutions.com/blog/top-8-accounting-software-in-latin-america-2026)
