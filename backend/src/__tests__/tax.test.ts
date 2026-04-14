/**
 * TAX CONFIG TESTS
 * Covers Bolivia IVA 13% (price-inclusive) and IT 3% logic.
 * These are pure functions — no DB, no mocks needed.
 */

import { TAX } from '../config/tax';

const PRECISION = 5; // decimal places for rounding checks

describe('TAX constants', () => {
  it('has correct IVA rate', () => {
    expect(TAX.IVA_RATE).toBe(0.13);
  });

  it('has correct IT rate', () => {
    expect(TAX.IT_RATE).toBe(0.03);
  });
});

describe('TAX.subtotal()', () => {
  it('extracts net subtotal from price-inclusive total', () => {
    // 113 total → 100 subtotal (IVA is inside the price)
    expect(TAX.subtotal(113)).toBeCloseTo(100, PRECISION);
  });

  it('returns 0 for zero input', () => {
    expect(TAX.subtotal(0)).toBe(0);
  });

  it('handles real-world Bolivian amounts', () => {
    // Bs. 100 total → Bs. 88.496... subtotal
    expect(TAX.subtotal(100)).toBeCloseTo(88.496, 3);
  });
});

describe('TAX.iva()', () => {
  it('extracts IVA from price-inclusive total', () => {
    // 113 total → 13 IVA
    expect(TAX.iva(113)).toBeCloseTo(13, PRECISION);
  });

  it('returns 0 for zero input', () => {
    expect(TAX.iva(0)).toBe(0);
  });

  it('IVA + subtotal equals total', () => {
    const total = 250;
    expect(TAX.subtotal(total) + TAX.iva(total)).toBeCloseTo(total, PRECISION);
  });

  it('handles real-world amount', () => {
    // Bs. 100 → IVA = 11.504...
    expect(TAX.iva(100)).toBeCloseTo(11.504, 3);
  });
});

describe('TAX.it()', () => {
  it('calculates IT on net subtotal', () => {
    // 113 total → 100 subtotal → IT = 3
    expect(TAX.it(113)).toBeCloseTo(3, PRECISION);
  });

  it('returns 0 for zero input', () => {
    expect(TAX.it(0)).toBe(0);
  });

  it('handles real-world amount', () => {
    // Bs. 100 total → IT = 88.496 * 0.03 = 2.655...
    expect(TAX.it(100)).toBeCloseTo(2.655, 3);
  });
});

describe('TAX.breakdown()', () => {
  it('returns all three components', () => {
    const result = TAX.breakdown(113);
    expect(result.subtotal).toBeCloseTo(100,  PRECISION);
    expect(result.iva     ).toBeCloseTo(13,   PRECISION);
    expect(result.it      ).toBeCloseTo(3,    PRECISION);
  });

  it('subtotal + iva equals the original total', () => {
    const total = 500;
    const { subtotal, iva } = TAX.breakdown(total);
    expect(subtotal + iva).toBeCloseTo(total, PRECISION);
  });

  it('all values are non-negative for positive input', () => {
    const { subtotal, iva, it } = TAX.breakdown(300);
    expect(subtotal).toBeGreaterThan(0);
    expect(iva     ).toBeGreaterThan(0);
    expect(it      ).toBeGreaterThan(0);
  });

  it('handles zero correctly', () => {
    const { subtotal, iva, it } = TAX.breakdown(0);
    expect(subtotal).toBe(0);
    expect(iva     ).toBe(0);
    expect(it      ).toBe(0);
  });

  it('it is exactly subtotal * 0.03', () => {
    const total = 750;
    const { subtotal, it } = TAX.breakdown(total);
    expect(it).toBeCloseTo(subtotal * 0.03, PRECISION);
  });
});
