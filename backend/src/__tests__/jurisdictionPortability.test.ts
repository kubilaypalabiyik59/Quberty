import { calculateTax, TaxCodeSpec } from '../shared/services/tax.service';
import { splitPurchaseMoney } from '../shared/services/documentTax.service';

/**
 * THE PARAMETRIC CLAIM, TESTED RATHER THAN ASSERTED.
 *
 * Fixing the Bolivian tax basis meant teaching the engine an arithmetic almost
 * nobody else uses (13% OF the invoiced amount). The fair question is whether
 * that broke the country-independence the configuration foundation exists for.
 *
 * These tests answer it by running **one code path** over four jurisdiction
 * configurations that differ only in TaxCode ROWS, and asserting each produces
 * the figures its own law requires:
 *
 *   Bolivia today       IVA por dentro, 13% of gross, IT 3% of gross
 *   Bolivia post-1733   IVA por fuera, 13% on the net, added on top
 *   Turkey              KDV 20% on the net, added on top
 *   Germany             USt 19% on the net, added on top
 *
 * If any of these ever needs an `if (country === …)` to pass, the foundation has
 * regressed and this file is where it shows up first.
 */

const spec = (over: Partial<TaxCodeSpec>): TaxCodeSpec => ({
  id: over.code ?? 'x',
  code: 'X',
  name: 'X',
  tax_type: 'VAT',
  rate: 0,
  is_inclusive: false,
  base_kind: 'NET',
  is_recoverable: true,
  reverse_charge: false,
  is_exempt: false,
  exempt_reason: null,
  withholding_share: null,
  withholding_threshold: null,
  posting_type_payable: 'VAT_OUTPUT',
  posting_type_receivable: 'VAT_INPUT',
  ...over,
});

/** Every jurisdiction below is DATA. Nothing here is a code path. */
const JURISDICTIONS = {
  // Ley 843 art. 5/7 — tax inside the price, rate applied to that price.
  BOLIVIA_TODAY: [
    spec({ code: 'IVA13', rate: 0.13, is_inclusive: true, base_kind: 'GROSS' }),
    spec({
      code: 'IT3', rate: 0.03, tax_type: 'TURNOVER', base_kind: 'GROSS',
      is_recoverable: false,
      posting_type_payable: 'TAX_TURNOVER_PAYABLE', posting_type_receivable: 'TAX_TURNOVER_EXPENSE',
    }),
  ],
  // Ley 1733 — same 13%, now on the net and added on top.
  BOLIVIA_POST_1733: [
    spec({ code: 'IVA13F', rate: 0.13, is_inclusive: false, base_kind: 'NET' }),
    spec({
      code: 'IT3', rate: 0.03, tax_type: 'TURNOVER', base_kind: 'GROSS',
      is_recoverable: false,
      posting_type_payable: 'TAX_TURNOVER_PAYABLE', posting_type_receivable: 'TAX_TURNOVER_EXPENSE',
    }),
  ],
  TURKEY: [spec({ code: 'KDV20', rate: 0.20, is_inclusive: false, base_kind: 'NET' })],
  GERMANY: [spec({ code: 'UST19', rate: 0.19, is_inclusive: false, base_kind: 'NET' })],
};

describe('one engine, four jurisdictions — sales side', () => {
  it('Bolivia today: the customer pays the quoted price, IVA is 13% of it', () => {
    const r = calculateTax(1000, JURISDICTIONS.BOLIVIA_TODAY);
    const iva = r.lines.find(l => l.code === 'IVA13')!;
    expect(iva.amount).toBeCloseTo(130, 2);
    expect(r.total).toBeCloseTo(1000, 2);      // nothing added — it was inside
    expect(r.subtotal).toBeCloseTo(870, 2);
  });

  it('Bolivia post-1733: same 13%, now added on top and the effective rate is really 13%', () => {
    const r = calculateTax(1000, JURISDICTIONS.BOLIVIA_POST_1733);
    const iva = r.lines.find(l => l.code === 'IVA13F')!;
    expect(r.subtotal).toBeCloseTo(1000, 2);
    expect(iva.amount).toBeCloseTo(130, 2);
    expect(r.total).toBeCloseTo(1130, 2);
    expect((iva.amount / r.subtotal) * 100).toBeCloseTo(13, 6);
  });

  it('Turkey: KDV 20% added on top', () => {
    const r = calculateTax(1000, JURISDICTIONS.TURKEY);
    expect(r.subtotal).toBeCloseTo(1000, 2);
    expect(r.total).toBeCloseTo(1200, 2);
  });

  it('Germany: USt 19% added on top', () => {
    const r = calculateTax(1000, JURISDICTIONS.GERMANY);
    expect(r.total).toBeCloseTo(1190, 2);
  });

  it('the SAME input produces four different, each-correct answers', () => {
    const totals = Object.fromEntries(
      Object.entries(JURISDICTIONS).map(([k, codes]) => [k, calculateTax(1000, codes).total]),
    );
    expect(totals).toEqual({
      BOLIVIA_TODAY: 1000,      // inclusive
      BOLIVIA_POST_1733: 1130,  // exclusive
      TURKEY: 1200,
      GERMANY: 1190,
    });
  });
});

describe('one engine, four jurisdictions — purchase side', () => {
  /** Exactly what the purchase paths do: agree a figure, then split it. */
  const purchase = (agreed: number, codes: TaxCodeSpec[]) => {
    const calc = calculateTax(agreed, codes);
    return splitPurchaseMoney({
      subtotal: calc.subtotal,
      vat: calc.lines.filter(l => l.tax_type === 'VAT').reduce((s, l) => s + l.amount, 0),
      turnover: calc.lines.filter(l => l.tax_type === 'TURNOVER').reduce((s, l) => s + l.amount, 0),
      total: calc.total,
      lines: calc.lines,
      source: 'ENGINE',
    });
  };

  it('Bolivia: AP owes the invoiced amount, 13% of it is recoverable, the rest capitalises', () => {
    const m = purchase(2500, JURISDICTIONS.BOLIVIA_TODAY);
    expect(m.total).toBeCloseTo(2500, 2);            // nothing added on top
    expect(m.recoverable_tax).toBeCloseTo(325, 2);   // 13% of the gross
    expect(m.net).toBeCloseTo(2175, 2);              // inventory, net of reclaimable tax
  });

  it('Turkey: AP owes MORE than the agreed price, because KDV is added', () => {
    const m = purchase(2500, JURISDICTIONS.TURKEY);
    expect(m.total).toBeCloseTo(3000, 2);            // 2500 + 20%
    expect(m.recoverable_tax).toBeCloseTo(500, 2);
    expect(m.net).toBeCloseTo(2500, 2);              // inventory is the agreed price
  });

  it('Germany: same shape, different rate', () => {
    const m = purchase(2500, JURISDICTIONS.GERMANY);
    expect(m.total).toBeCloseTo(2975, 2);
    expect(m.net).toBeCloseTo(2500, 2);
  });

  it('Bolivia post-1733 behaves like Turkey, from a data change alone', () => {
    const before = purchase(2500, JURISDICTIONS.BOLIVIA_TODAY);
    const after = purchase(2500, JURISDICTIONS.BOLIVIA_POST_1733);

    // The whole point: the transition is a TaxCode row, and the arithmetic
    // flips without a line of code changing.
    expect(before.total).toBeCloseTo(2500, 2);
    expect(after.total).toBeCloseTo(2825, 2);
    expect(before.recoverable_tax).toBeCloseTo(after.recoverable_tax, 2); // 325 either way
  });

  it('a non-recoverable tax stays inside the capitalised cost, never in VAT_INPUT', () => {
    // Bolivia's IT is a cost, not a receivable. It must not be split out as
    // reclaimable — doing so would understate stock value.
    const m = purchase(2500, JURISDICTIONS.BOLIVIA_TODAY);
    expect(m.non_recoverable_tax).toBeCloseTo(75, 2);   // 3% of gross
    expect(m.recoverable_tax).toBeCloseTo(325, 2);      // IVA only
    expect(m.net + m.recoverable_tax).toBeCloseTo(m.total, 2);
  });
});

describe('the foundation rule this protects', () => {
  it('adding a jurisdiction is adding rows, not adding branches', () => {
    // A country that taxes the gross at 5% with no other tax. Never coded for.
    const invented = [spec({ code: 'X5', rate: 0.05, is_inclusive: true, base_kind: 'GROSS' })];
    const r = calculateTax(1000, invented);
    expect(r.lines[0].amount).toBeCloseTo(50, 2);
    expect(r.subtotal).toBeCloseTo(950, 2);
    expect(r.total).toBeCloseTo(1000, 2);
  });
});
