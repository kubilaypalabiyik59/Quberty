import { Prisma } from '@prisma/client';
import { effectiveSettledAmount } from '../modules/purchase/vendorPayment.service';

describe('vendor payment settlement arithmetic', () => {
  it('subtracts immutable reversal rows from the settled amount', () => {
    expect(effectiveSettledAmount([
      { amount: new Prisma.Decimal('80.00'), reverses_settlement_id: null },
      { amount: new Prisma.Decimal('25.50'), reverses_settlement_id: null },
      { amount: new Prisma.Decimal('80.00'), reverses_settlement_id: 'original-settlement' },
    ])).toBe(25.5);
  });

  it('rounds at the currency boundary', () => {
    expect(effectiveSettledAmount([
      { amount: '0.105', reverses_settlement_id: null },
      { amount: 0.105, reverses_settlement_id: null },
    ])).toBe(0.21);
  });
});
