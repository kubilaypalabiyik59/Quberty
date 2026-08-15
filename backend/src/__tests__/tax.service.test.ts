import { calculateTax, TaxCodeSpec } from '../shared/services/tax.service';
import { resolveTax, BOLIVIA_DEFAULTS } from '../config/tax';

/**
 * The generalised tax engine must not change a single Bolivian number.
 * Bolivia is the anchor customer and files real tax returns from these figures,
 * so equivalence with the existing config/tax.ts is the acceptance criterion for
 * the whole multi-jurisdiction design.
 */

const spec = (over: Partial<TaxCodeSpec>): TaxCodeSpec => ({
  id: over.code ?? 'x',
  code: 'X',
  name: 'X',
  tax_type: 'VAT',
  rate: 0,
  is_inclusive: false,
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

const IVA13 = spec({ code: 'IVA13', rate: 0.13, is_inclusive: true, tax_type: 'VAT' });
const IT3   = spec({
  code: 'IT3', rate: 0.03, tax_type: 'TURNOVER', is_recoverable: false,
  posting_type_payable: 'TAX_TURNOVER_PAYABLE', posting_type_receivable: 'TAX_TURNOVER_EXPENSE',
});

describe('Bolivia — must match config/tax.ts exactly', () => {
  const legacy = resolveTax(BOLIVIA_DEFAULTS);
  const amounts = [100, 10, 1299, 3000, 115, 25000, 0.01, 7127];

  it.each(amounts)('gross %p produces the same subtotal, IVA and IT', gross => {
    const expected = legacy.breakdown(gross);
    const actual = calculateTax(gross, [IVA13, IT3]);

    const iva = actual.lines.find(l => l.code === 'IVA13')!;
    const it  = actual.lines.find(l => l.code === 'IT3')!;

    expect(actual.subtotal).toBeCloseTo(expected.subtotal, 2);
    expect(iva.amount).toBeCloseTo(expected.iva, 2);
    expect(it.amount).toBeCloseTo(expected.it, 2);
  });

  it('IVA is inclusive — the customer pays the gross, unchanged', () => {
    expect(calculateTax(1299, [IVA13, IT3]).total).toBeCloseTo(1299, 2);
  });

  it('IT is a turnover tax on the net, not a surcharge on the customer', () => {
    const r = calculateTax(1299, [IVA13, IT3]);
    const it = r.lines.find(l => l.code === 'IT3')!;
    expect(it.base).toBeCloseTo(r.subtotal, 2);
    expect(it.is_recoverable).toBe(false);
    expect(r.total).toBeCloseTo(1299, 2); // IT did not increase what is charged
  });
});

describe('Turkey', () => {
  const KDV20 = spec({ code: 'KDV20', rate: 0.20 });
  const KDV10 = spec({ code: 'KDV10', rate: 0.10 });

  it('applies the reduced rate when the product resolves to it', () => {
    expect(calculateTax(1000, [KDV10]).lines[0].amount).toBeCloseTo(100, 2);
    expect(calculateTax(1000, [KDV10]).total).toBeCloseTo(1100, 2);
  });

  /**
   * Threshold and behaviour per the primary source: KDV Genel Uygulama Tebliği
   * I/C-2.1.3.4.1 (Resmî Gazete 26.04.2014, No. 28983). The 2026 figure is the
   * VUK md.232 fatura düzenleme sınırı, 12.000 TL (VUK GT Sıra No: 588).
   */
  const TEV = spec({
    code: 'KDV20TEV', rate: 0.20, withholding_share: 0.5, withholding_threshold: 12000,
  });

  it('tevkifat splits the tax between seller and buyer above the threshold', () => {
    const big = calculateTax(50000, [TEV]).lines[0];
    expect(big.amount).toBeCloseTo(10000, 2);
    expect(big.amount_payable).toBeCloseTo(5000, 2);  // seller declares half
    expect(big.amount_withheld).toBeCloseTo(5000, 2); // buyer remits half
  });

  it('leaves the tax whole below the tevkifat threshold', () => {
    const small = calculateTax(1000, [TEV]).lines[0];
    expect(small.amount_withheld).toBeCloseTo(0, 2);
    expect(small.amount_payable).toBeCloseTo(200, 2);
  });

  it('tests the threshold on the KDV-INCLUSIVE amount, not the net', () => {
    // Net 10 500 is below 12 000, but KDV-inclusive it is 12 600 — over the
    // limit, so tevkifat applies. Comparing the net would wrongly exempt this.
    const line = calculateTax(10500, [TEV]).lines[0];
    expect(line.amount).toBeCloseTo(2100, 2);
    expect(line.amount_withheld).toBeCloseTo(1050, 2);
  });

  it('applies withholding to the WHOLE tax once the limit is passed, not the excess', () => {
    // "Sınırın aşılması halinde ise tutarın tamamı üzerinden tevkifat yapılır."
    const line = calculateTax(20000, [TEV]).lines[0];
    expect(line.amount).toBeCloseTo(4000, 2);
    expect(line.amount_withheld).toBeCloseTo(2000, 2); // half of 4000, not of an excess
  });

  it('KDV20 on a standard-rated product is added on top', () => {
    expect(calculateTax(1000, [KDV20]).total).toBeCloseTo(1200, 2);
  });
});

describe('Germany', () => {
  it('reverse charge computes the tax but leaves the supplier nothing to post', () => {
    const RC = spec({ code: 'RC19', rate: 0.19, reverse_charge: true, exempt_reason: '§13b UStG' });
    const line = calculateTax(1000, [RC]).lines[0];
    expect(line.amount).toBeCloseTo(190, 2);
    expect(line.amount_payable).toBeCloseTo(0, 2);
    expect(line.amount_withheld).toBeCloseTo(190, 2);
  });

  it('intra-community supply is zero but still carries its legal reference', () => {
    const EU0 = spec({ code: 'EU0', rate: 0, is_exempt: true, exempt_reason: '§6a UStG' });
    const r = calculateTax(1000, [EU0]);
    expect(r.total).toBeCloseTo(1000, 2);
    expect(r.lines[0].amount).toBe(0);
    expect(r.lines[0].exempt_reason).toBe('§6a UStG');
  });

  it('reduced rate 7% applies by product', () => {
    const UST7 = spec({ code: 'UST7', rate: 0.07 });
    expect(calculateTax(1000, [UST7]).total).toBeCloseTo(1070, 2);
  });
});

describe('guard rails', () => {
  it('no intersection means no tax, not a default rate', () => {
    const r = calculateTax(500, []);
    expect(r.lines).toHaveLength(0);
    expect(r.subtotal).toBeCloseTo(500, 2);
    expect(r.total).toBeCloseTo(500, 2);
  });

  it('refuses to guess when inclusive and exclusive codes are mixed', () => {
    const inc = spec({ code: 'INC', rate: 0.13, is_inclusive: true });
    const exc = spec({ code: 'EXC', rate: 0.20 });
    expect(() => calculateTax(1000, [inc, exc])).toThrow(/cannot be both/);
  });
});
