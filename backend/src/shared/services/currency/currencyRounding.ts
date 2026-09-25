import { Prisma } from '@prisma/client';
import { AppError } from '../../errors/AppError';

/**
 * Round an amount by its currency's own rule.
 *
 * **[OFFICIAL]** rounding precision and method are set per currency:
 *   learn.microsoft.com/dynamics365/business-central/finance-set-up-currencies#rounding-currencies
 *
 * The tax engine keeps its own `round2`; this function is for currency
 * translation, so it cannot move a Bolivian IVA or IT figure.
 */

export const ROUNDING_METHODS = ['NEAREST', 'UP', 'DOWN'] as const;
export type RoundingMethod = typeof ROUNDING_METHODS[number];

export interface CurrencyRoundingRule {
  rounding_precision: Prisma.Decimal | number | string;
  rounding_method: string;
}

const MODE: Record<RoundingMethod, Prisma.Decimal.Rounding> = {
  NEAREST: Prisma.Decimal.ROUND_HALF_UP,
  UP: Prisma.Decimal.ROUND_UP,     // away from zero
  DOWN: Prisma.Decimal.ROUND_DOWN, // toward zero
};

export function roundAmount(
  value: Prisma.Decimal | number | string,
  rule: CurrencyRoundingRule,
): Prisma.Decimal {
  const precision = new Prisma.Decimal(rule.rounding_precision);
  if (precision.lte(0)) throw new Error('A rounding precision must be greater than zero.');
  const mode = MODE[rule.rounding_method as RoundingMethod];
  if (mode === undefined) throw new Error(`Unknown rounding method ${rule.rounding_method}.`);
  return new Prisma.Decimal(value).div(precision).toDecimalPlaces(0, mode).mul(precision);
}

/** The default precision for a currency: 10^-minor_unit (2 → 0.01, 0 → 1). */
export function precisionForMinorUnit(minorUnit: number): Prisma.Decimal {
  return new Prisma.Decimal(10).pow(-minorUnit);
}

/**
 * The only precision a ledger currency may post at today.
 *
 * Every document path computes to two decimals — the tax engine, the receipt
 * accrual, the invoice totals — so a ledger rounding to whole units (a 0-decimal
 * currency such as JPY or CLP) would leave those documents unbalanced by up to
 * half a unit and the general ledger disagreeing with the AP subledger. Refusing
 * is the fail-closed answer until the document paths are precision-aware.
 */
export const POSTABLE_PRECISION = '0.01';

export function assertPostablePrecision(code: string, precision: Prisma.Decimal | number | string): void {
  if (!new Prisma.Decimal(precision).equals(POSTABLE_PRECISION)) {
    throw new AppError(
      `${code} rounds to ${new Prisma.Decimal(precision).toString()}, and amounts are posted to ` +
        `${POSTABLE_PRECISION}. A ledger currency must round to ${POSTABLE_PRECISION} today.`,
      422,
      'CURRENCY_PRECISION_UNSUPPORTED',
    );
  }
}
