import { Prisma } from '@prisma/client';
import { db } from '../../../infrastructure/database/client';
import { AppError } from '../../errors/AppError';

/**
 * Exchange-rate lookup and maintenance.
 *
 * **[OFFICIAL]** a currency pair exists once per rate type and the reciprocal
 * pair is refused; the rate used is the latest start date on or before the
 * transaction date; a change is entered as a new dated row:
 *   learn.microsoft.com/training/modules/configure-currencies-dyn365-finance/3-currency-exchange-rate
 *
 * No triangulation and no provider import (WORK-024 scope). All arithmetic is
 * decimal, never float.
 */

type Client = Prisma.TransactionClient | typeof db;

export interface ResolvedRate {
  /** IDENTITY: same currency; DIRECT: the stored pair; RECIPROCAL: the stored reverse pair. */
  kind: 'IDENTITY' | 'DIRECT' | 'RECIPROCAL';
  rate: Prisma.Decimal;
  conversionFactor: Prisma.Decimal;
  validFrom: Date | null;
  exchangeRateId: string | null;
}

export interface ResolveRateInput {
  tenantId: string;
  rateTypeId: string;
  from: string;
  to: string;
  date: Date;
  client?: Client;
}

const dateOnly = (value: Date) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

async function assertActive(client: Client, tenantId: string, codes: string[]) {
  const active = await client.tenantCurrency.findMany({
    where: { tenant_id: tenantId, currency_code: { in: codes }, is_active: true },
    select: { currency_code: true },
  });
  const found = new Set(active.map((row) => row.currency_code));
  const missing = codes.filter((code) => !found.has(code));
  if (missing.length) {
    throw new AppError(`Currency ${missing.join(', ')} is not active for this tenant.`, 422, 'CURRENCY_INACTIVE');
  }
}

async function latestRate(client: Client, tenantId: string, rateTypeId: string, from: string, to: string, date: Date) {
  const pair = await client.exchangeRateCurrencyPair.findFirst({
    where: { tenant_id: tenantId, rate_type_id: rateTypeId, from_currency_code: from, to_currency_code: to },
    select: { id: true, conversion_factor: true },
  });
  if (!pair) return null;
  const rate = await client.exchangeRate.findFirst({
    where: { tenant_id: tenantId, currency_pair_id: pair.id, valid_from: { lte: dateOnly(date) } },
    orderBy: { valid_from: 'desc' },
    select: { id: true, rate: true, valid_from: true },
  });
  return rate ? { pair, rate } : null;
}

export async function resolveRate(input: ResolveRateInput): Promise<ResolvedRate> {
  if (input.from === input.to) {
    return { kind: 'IDENTITY', rate: new Prisma.Decimal(1), conversionFactor: new Prisma.Decimal(1), validFrom: null, exchangeRateId: null };
  }
  const client = input.client ?? db;
  await assertActive(client, input.tenantId, [input.from, input.to]);

  const direct = await latestRate(client, input.tenantId, input.rateTypeId, input.from, input.to, input.date);
  if (direct) {
    return {
      kind: 'DIRECT', rate: direct.rate.rate, conversionFactor: direct.pair.conversion_factor,
      validFrom: direct.rate.valid_from, exchangeRateId: direct.rate.id,
    };
  }
  const reverse = await latestRate(client, input.tenantId, input.rateTypeId, input.to, input.from, input.date);
  if (reverse) {
    return {
      kind: 'RECIPROCAL', rate: reverse.rate.rate, conversionFactor: reverse.pair.conversion_factor,
      validFrom: reverse.rate.valid_from, exchangeRateId: reverse.rate.id,
    };
  }
  throw new AppError(
    `No ${input.from}→${input.to} exchange rate is valid on ${dateOnly(input.date).toISOString().slice(0, 10)} for this rate type.`,
    422,
    'EXCHANGE_RATE_MISSING',
  );
}

/**
 * Translate an amount with a resolved rate. A reciprocal rate is applied by
 * dividing, never through a rounded reciprocal. The result is unrounded: the
 * caller rounds by the target currency's rule.
 */
export function translate(amount: Prisma.Decimal | number | string, resolved: ResolvedRate): Prisma.Decimal {
  const value = new Prisma.Decimal(amount);
  switch (resolved.kind) {
    case 'IDENTITY': return value;
    case 'DIRECT': return value.mul(resolved.rate).div(resolved.conversionFactor);
    case 'RECIPROCAL': return value.mul(resolved.conversionFactor).div(resolved.rate);
  }
}

/* ───────────────────────────── maintenance ───────────────────────────── */

export interface AddRateInput {
  rate_type_id: string;
  from_currency_code: string;
  to_currency_code: string;
  valid_from: string;
  rate: number | string;
  conversion_factor?: number;
}

/**
 * Add one dated rate, creating the pair on first use. Adding is the only write
 * operational roles may make; correcting an existing row is `updateExchangeRate`,
 * which is accounting setup (admin only).
 */
export async function addExchangeRate(
  tenantId: string,
  userId: string,
  input: AddRateInput,
  options: { canBackdate: boolean },
) {
  if (input.from_currency_code === input.to_currency_code) {
    throw new AppError('A currency pair needs two different currencies.', 400, 'INVALID_CURRENCY_PAIR');
  }
  const rate = new Prisma.Decimal(input.rate);
  if (!rate.isFinite() || rate.lte(0)) throw new AppError('An exchange rate must be greater than zero.', 400, 'INVALID_EXCHANGE_RATE');
  const factor = new Prisma.Decimal(input.conversion_factor ?? 1);
  if (!factor.isInteger() || factor.lte(0)) throw new AppError('The conversion factor must be a positive whole number.', 400, 'INVALID_CONVERSION_FACTOR');
  const validFrom = new Date(`${input.valid_from}T00:00:00.000Z`);
  // The round trip also catches 2026-02-30, which JavaScript rolls into March.
  if (Number.isNaN(validFrom.getTime()) || validFrom.toISOString().slice(0, 10) !== input.valid_from) {
    throw new AppError('valid_from must be a real date (YYYY-MM-DD).', 400, 'INVALID_DATE');
  }

  return db.$transaction(async (tx) => {
    // Serialise pair creation per rate type, so a pair and its reciprocal cannot
    // both be created by two concurrent requests.
    const locked = await tx.$queryRaw<Array<{ id: string; is_active: boolean }>>`
      SELECT id, is_active FROM exchange_rate_types
       WHERE id = ${input.rate_type_id}::uuid AND tenant_id = ${tenantId}::uuid
         FOR UPDATE`;
    if (!locked.length || !locked[0].is_active) {
      throw new AppError('The exchange rate type is not an active rate type of this tenant.', 422, 'RATE_TYPE_NOT_FOUND');
    }
    await assertActive(tx, tenantId, [input.from_currency_code, input.to_currency_code]);

    let pair = await tx.exchangeRateCurrencyPair.findFirst({
      where: {
        tenant_id: tenantId, rate_type_id: input.rate_type_id,
        from_currency_code: input.from_currency_code, to_currency_code: input.to_currency_code,
      },
    });
    if (!pair) {
      const reciprocal = await tx.exchangeRateCurrencyPair.findFirst({
        where: {
          tenant_id: tenantId, rate_type_id: input.rate_type_id,
          from_currency_code: input.to_currency_code, to_currency_code: input.from_currency_code,
        },
        select: { id: true },
      });
      if (reciprocal) {
        throw new AppError(
          `This rate type already quotes ${input.to_currency_code}→${input.from_currency_code}; ` +
            'enter the rate in that direction. The reverse is computed when needed.',
          409,
          'RECIPROCAL_PAIR_EXISTS',
        );
      }
      pair = await tx.exchangeRateCurrencyPair.create({
        data: {
          tenant_id: tenantId, rate_type_id: input.rate_type_id,
          from_currency_code: input.from_currency_code, to_currency_code: input.to_currency_code,
          conversion_factor: factor,
        },
      });
    } else if (input.conversion_factor !== undefined && !pair.conversion_factor.equals(factor)) {
      throw new AppError(
        `This pair is quoted per ${pair.conversion_factor.toString()} units; the conversion factor cannot change.`,
        409,
        'CONVERSION_FACTOR_MISMATCH',
      );
    }

    if (!options.canBackdate) {
      const latest = await tx.exchangeRate.findFirst({
        where: { tenant_id: tenantId, currency_pair_id: pair.id },
        orderBy: { valid_from: 'desc' },
        select: { valid_from: true },
      });
      if (latest && validFrom <= latest.valid_from) {
        throw new AppError(
          `The latest ${input.from_currency_code}→${input.to_currency_code} rate starts on ` +
            `${latest.valid_from.toISOString().slice(0, 10)}. A rate on or before that date would change the ` +
            'rate already in force for later dates, which is a correction for an administrator.',
          409,
          'EXCHANGE_RATE_BACKDATED',
        );
      }
    }

    const duplicate = await tx.exchangeRate.findFirst({
      where: { tenant_id: tenantId, currency_pair_id: pair.id, valid_from: validFrom },
      select: { id: true },
    });
    if (duplicate) {
      throw new AppError(
        'A rate for this pair already starts on that date. Correcting it is an administrator action.',
        409,
        'EXCHANGE_RATE_EXISTS',
      );
    }

    return tx.exchangeRate.create({
      data: {
        tenant_id: tenantId, currency_pair_id: pair.id, valid_from: validFrom, rate,
        source: 'MANUAL', created_by: userId, updated_by: userId,
      },
      include: { pair: true },
    });
  });
}

/** Correct an existing rate (admin only). Posted vouchers keep the rate they were posted with. */
export async function updateExchangeRate(tenantId: string, userId: string, id: string, input: { rate: number | string }) {
  const rate = new Prisma.Decimal(input.rate);
  if (!rate.isFinite() || rate.lte(0)) throw new AppError('An exchange rate must be greater than zero.', 400, 'INVALID_EXCHANGE_RATE');
  // Read-then-write in one transaction, with the before and after values audited
  // in the same transaction: the request log alone keeps only the new value, and
  // fire-and-forget.
  return db.$transaction(async (tx) => {
    const before = await tx.exchangeRate.findFirst({ where: { id, tenant_id: tenantId }, include: { pair: true } });
    if (!before) throw new AppError('Exchange rate not found.', 404, 'EXCHANGE_RATE_NOT_FOUND');
    const after = await tx.exchangeRate.update({
      where: { id: before.id },
      data: { rate, updated_by: userId },
      include: { pair: true },
    });
    await tx.auditLog.create({
      data: {
        tenant_id: tenantId,
        user_id: userId,
        method: 'PUT',
        path: `exchange_rates/${before.id}`,
        status_code: 200,
        body: {
          action: 'EXCHANGE_RATE_CORRECTED',
          pair: `${before.pair.from_currency_code}->${before.pair.to_currency_code}`,
          valid_from: before.valid_from.toISOString().slice(0, 10),
          before: before.rate.toString(),
          after: rate.toString(),
        },
      },
    });
    return after;
  });
}
