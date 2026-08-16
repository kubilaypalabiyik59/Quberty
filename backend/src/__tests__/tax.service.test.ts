import { calculateTax, TaxCodeSpec } from '../shared/services/tax.service';
import { resolveTax, BOLIVIA_DEFAULTS } from '../config/tax';

/**
 * This suite used to assert that the engine reproduced `config/tax.ts` exactly,
 * on the grounds that Bolivia files real returns from these figures and must not
 * move.
 *
 * The premise was right and the reference was wrong. `config/tax.ts` computes
 * `gross - gross/1,13`, which is 11,50% of the invoiced amount. Bolivian law puts
 * the tax INSIDE the price and applies the 13% to that price:
 *
 *   [OFFICIAL] Ley 843 art. 5 - the tax "forma parte integrante del precio neto
 *   de la venta [...] no se mostrara por separado", with art. 7 applying the
 *   alicuota to "los importes totales de los precios netos". Nominal 13%,
 *   effective 13/(1-0,13) = 14,9425% of the true net.
 *
 *   [OFFICIAL] Ley 843 art. 74 - IT is levied on "los ingresos brutos
 *   devengados [...] el valor o monto total [...] devengados en concepto de
 *   venta de bienes": the invoiced amount, not the post-IVA net.
 *
 * So these tests now assert the LAW, and the old equivalence survives only in
 * reverse - as a record of how much the previous behaviour understated by.
 * See docs/process/BOLIVIA_TAX_BASIS.md.
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

// Bolivia BEFORE the Ley 1733 reglamentary decree: both taxes bite on the gross.
const IVA13 = spec({ code: 'IVA13', rate: 0.13, is_inclusive: true, base_kind: 'GROSS', tax_type: 'VAT' });
const IT3   = spec({
  code: 'IT3', rate: 0.03, tax_type: 'TURNOVER', is_recoverable: false, base_kind: 'GROSS',
  posting_type_payable: 'TAX_TURNOVER_PAYABLE', posting_type_receivable: 'TAX_TURNOVER_EXPENSE',
});
// Bolivia AFTER Ley 1733 takes effect: IVA por fuera, 13% on the net, added on
// top. A different TaxCode row with its own valid_from - which is the whole
// reason TaxCode is date-effective.
const IVA13_POR_FUERA = spec({ code: 'IVA13F', rate: 0.13, is_inclusive: false, base_kind: 'NET', tax_type: 'VAT' });

describe('Bolivia — IVA por dentro, per Ley 843 art. 5 and 7', () => {
  const amounts = [100, 10, 1299, 3000, 115, 25000, 0.01, 7127];

  it.each(amounts)('IVA on an invoice of %p is 13% OF THE INVOICED AMOUNT', gross => {
    const iva = calculateTax(gross, [IVA13, IT3]).lines.find(l => l.code === 'IVA13')!;
    expect(iva.amount).toBeCloseTo(Math.round(gross * 0.13 * 100) / 100, 2);
    expect(iva.base).toBeCloseTo(gross, 2);
  });

  it.each(amounts)('IT on an invoice of %p is 3% of gross income, not of the net', gross => {
    const it = calculateTax(gross, [IVA13, IT3]).lines.find(l => l.code === 'IT3')!;
    expect(it.amount).toBeCloseTo(Math.round(gross * 0.03 * 100) / 100, 2);
    expect(it.base).toBeCloseTo(gross, 2);
  });

  it('the effective IVA burden on the true net is 14,9425% — the published figure', () => {
    const r = calculateTax(1000, [IVA13]);
    const iva = r.lines.find(l => l.code === 'IVA13')!;
    expect(iva.amount).toBeCloseTo(130, 2);
    expect(r.subtotal).toBeCloseTo(870, 2);
    expect((iva.amount / r.subtotal) * 100).toBeCloseTo(14.9425, 3);
  });

  it('to keep Bs 100 net a merchant invoices Bs 114,94 — the worked example', () => {
    // 100 / 0,87 = 114,9425...  the standard Bolivian illustration.
    const r = calculateTax(114.94, [IVA13]);
    expect(r.subtotal).toBeCloseTo(100, 1);
  });

  it('the customer pays exactly the invoiced amount — IVA is inside it', () => {
    expect(calculateTax(1299, [IVA13, IT3]).total).toBeCloseTo(1299, 2);
  });

  it('IT is a cost to the seller, never a surcharge added to the invoice', () => {
    const r = calculateTax(1299, [IVA13, IT3]);
    const it = r.lines.find(l => l.code === 'IT3')!;
    expect(it.is_recoverable).toBe(false);
    expect(r.total).toBeCloseTo(1299, 2);
  });

  it('records how much the OLD arithmetic understated, for the correction decision', () => {
    // config/tax.ts is the legacy fallback and still computes gross - gross/1,13.
    // This does not endorse it; it sizes the gap so the Finance co-founder can
    // judge the historical correction.
    const legacy = resolveTax(BOLIVIA_DEFAULTS).breakdown(1299);
    const now = calculateTax(1299, [IVA13, IT3]);
    const iva = now.lines.find(l => l.code === 'IVA13')!;
    const it = now.lines.find(l => l.code === 'IT3')!;

    expect(legacy.iva).toBeCloseTo(149.44, 2);   // 11,50% of gross - understated
    expect(iva.amount).toBeCloseTo(168.87, 2);   // 13,00% of gross - the law
    expect(legacy.it).toBeCloseTo(34.49, 2);     // 3% of the net - understated
    expect(it.amount).toBeCloseTo(38.97, 2);     // 3% of gross income - the law
  });
});

describe('Bolivia after Ley 1733 — IVA por fuera, once the decree takes effect', () => {
  it('is a configuration change, not a code change: 13% on the net, added on top', () => {
    const r = calculateTax(1000, [IVA13_POR_FUERA]);
    const iva = r.lines.find(l => l.code === 'IVA13F')!;
    expect(r.subtotal).toBeCloseTo(1000, 2);
    expect(iva.amount).toBeCloseTo(130, 2);
    expect(r.total).toBeCloseTo(1130, 2);
    // The point of the reform: the effective rate really is 13%.
    expect((iva.amount / r.subtotal) * 100).toBeCloseTo(13, 6);
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
