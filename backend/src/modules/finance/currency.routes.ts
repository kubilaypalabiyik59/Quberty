import { Hono } from 'hono';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { ok, created } from '../../shared/response';
import { requirePermission, hasPermission, type Permission } from '../../shared/middleware/permissions';
import { validate } from '../../shared/middleware/validate';
import {
  UpdateLedgerCurrenciesSchema,
  CreateTenantCurrencySchema,
  UpdateTenantCurrencySchema,
  CreateExchangeRateTypeSchema,
  UpdateExchangeRateTypeSchema,
  CreateExchangeRateSchema,
  UpdateExchangeRateSchema,
} from '../../shared/schemas';
import {
  getLedgerCurrencies, setLedgerCurrencies, hasLedgerActivity, type LedgerCurrencyInput,
} from '../../shared/services/currency/ledgerCurrency.service';
import {
  addExchangeRate, updateExchangeRate, resolveRate, translate, type AddRateInput,
} from '../../shared/services/currency/exchangeRate.service';
import { precisionForMinorUnit } from '../../shared/services/currency/currencyRounding';
import type { AppEnv } from '../../shared/context';
import type { z } from 'zod';

/**
 * Currencies, the ledger's currencies, exchange-rate types and rates (WORK-024a).
 * Mounted under `/finance`.
 *
 * Segregation of duties:
 *   - the ledger's currencies, activating a currency and the rate types are
 *     accounting setup: `finance.setup.maintain` (admin only);
 *   - adding a dated rate is operational: `finance.exchange_rate.maintain`
 *     (admin, store manager, finance approver);
 *   - correcting an existing rate is accounting setup again, so the people who
 *     enter rates cannot silently rewrite the one a document was valued at.
 * Every write is recorded by the audit middleware.
 */

type RoutePermissions = Record<string, [Permission, ...Permission[]]>;

export const CURRENCY_ROUTE_PERMISSIONS = Object.freeze({
  'GET /ledger-currencies':       ['finance.currency.read'],
  'PUT /ledger-currencies':       ['finance.setup.maintain'],
  'GET /currencies':              ['finance.currency.read'],
  'GET /currencies/iso':          ['finance.currency.read'],
  'POST /currencies':             ['finance.setup.maintain'],
  'PUT /currencies/:code':        ['finance.setup.maintain'],
  'GET /exchange-rate-types':     ['finance.currency.read'],
  'POST /exchange-rate-types':    ['finance.setup.maintain'],
  'PUT /exchange-rate-types/:id': ['finance.setup.maintain'],
  'GET /exchange-rates':          ['finance.currency.read'],
  'GET /exchange-rates/resolve':  ['finance.currency.read'],
  'POST /exchange-rates':         ['finance.exchange_rate.maintain'],
  'PUT /exchange-rates/:id':      ['finance.setup.maintain'],
} satisfies RoutePermissions);

const guard = (route: keyof typeof CURRENCY_ROUTE_PERMISSIONS) => {
  const [first, ...rest] = CURRENCY_ROUTE_PERMISSIONS[route] as [Permission, ...Permission[]];
  return requirePermission(first, ...rest);
};

const CODE = /^[A-Z]{3}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const app = new Hono<AppEnv>();

/* ───────────────────────────── ledger currencies ───────────────────────────── */

app.get('/ledger-currencies', guard('GET /ledger-currencies'), async (c) => {
  const tenantId = c.get('tenantId');
  const ledger = await getLedgerCurrencies(tenantId);
  const [locked, rateTypes] = await Promise.all([
    hasLedgerActivity(tenantId),
    db.exchangeRateType.findMany({
      where: { tenant_id: tenantId, id: { in: [ledger.accountingRateTypeId, ledger.reportingRateTypeId] } },
      select: { id: true, code: true, name: true },
    }),
  ]);
  return ok(c, {
    ...ledger,
    accountingRateType: rateTypes.find((t) => t.id === ledger.accountingRateTypeId) ?? null,
    reportingRateType: rateTypes.find((t) => t.id === ledger.reportingRateTypeId) ?? null,
    // D365 refuses to change either currency once anything has posted; here that
    // includes cost layers and payables, which carry the currency too.
    locked,
  });
});

app.put('/ledger-currencies', guard('PUT /ledger-currencies'), validate(UpdateLedgerCurrenciesSchema), async (c) => {
  // The strict schema has validated every required field.
  const body = c.get('body') as LedgerCurrencyInput;
  return ok(c, await setLedgerCurrencies(c.get('tenantId'), body));
});

/* ─────────────────────────────── currencies ─────────────────────────────── */

app.get('/currencies', guard('GET /currencies'), async (c) => {
  const rows = await db.tenantCurrency.findMany({
    where: { tenant_id: c.get('tenantId') },
    include: { currency: true },
    orderBy: { currency_code: 'asc' },
  });
  return ok(c, rows);
});

/** The ISO list a currency can be activated from. */
app.get('/currencies/iso', guard('GET /currencies/iso'), async (c) => {
  return ok(c, await db.currency.findMany({ orderBy: { code: 'asc' } }));
});

app.post('/currencies', guard('POST /currencies'), validate(CreateTenantCurrencySchema), async (c) => {
  const tenantId = c.get('tenantId');
  const body = c.get('body') as z.infer<typeof CreateTenantCurrencySchema>;
  const iso = await db.currency.findUnique({ where: { code: body.currency_code } });
  if (!iso) throw new AppError(`${body.currency_code} is not an ISO 4217 currency code.`, 422, 'CURRENCY_UNKNOWN');
  if (iso.minor_unit > 2) {
    throw new AppError(`${iso.code} has ${iso.minor_unit} decimals; amounts are stored with two.`, 422, 'CURRENCY_PRECISION_UNSUPPORTED');
  }
  const existing = await db.tenantCurrency.findFirst({ where: { tenant_id: tenantId, currency_code: iso.code }, select: { id: true } });
  if (existing) throw new AppError(`${iso.code} is already set up for this tenant.`, 409, 'CURRENCY_EXISTS');

  const row = await db.tenantCurrency.create({
    data: {
      tenant_id: tenantId,
      currency_code: iso.code,
      symbol: body.symbol ?? null,
      rounding_precision: body.rounding_precision ?? precisionForMinorUnit(iso.minor_unit),
      rounding_method: body.rounding_method ?? 'NEAREST',
    },
    include: { currency: true },
  });
  return created(c, row);
});

app.put('/currencies/:code', guard('PUT /currencies/:code'), validate(UpdateTenantCurrencySchema), async (c) => {
  const tenantId = c.get('tenantId');
  const code = c.req.param('code').toUpperCase();
  const body = c.get('body') as z.infer<typeof UpdateTenantCurrencySchema>;

  if (body.is_active === false) {
    const inLedger = await db.financeParameters.count({
      where: { tenant_id: tenantId, OR: [{ accounting_currency_code: code }, { reporting_currency_code: code }] },
    });
    if (inLedger > 0) {
      throw new AppError(`${code} is a ledger currency and cannot be deactivated.`, 409, 'CURRENCY_IN_USE_BY_LEDGER');
    }
  }
  const result = await db.tenantCurrency.updateMany({ where: { tenant_id: tenantId, currency_code: code }, data: body });
  if (result.count === 0) throw new AppError(`${code} is not set up for this tenant.`, 404, 'CURRENCY_NOT_FOUND');
  return ok(c, await db.tenantCurrency.findFirst({ where: { tenant_id: tenantId, currency_code: code }, include: { currency: true } }));
});

/* ─────────────────────────── exchange-rate types ─────────────────────────── */

app.get('/exchange-rate-types', guard('GET /exchange-rate-types'), async (c) => {
  return ok(c, await db.exchangeRateType.findMany({ where: { tenant_id: c.get('tenantId') }, orderBy: { code: 'asc' } }));
});

app.post('/exchange-rate-types', guard('POST /exchange-rate-types'), validate(CreateExchangeRateTypeSchema), async (c) => {
  const tenantId = c.get('tenantId');
  const body = c.get('body') as z.infer<typeof CreateExchangeRateTypeSchema>;
  const existing = await db.exchangeRateType.findFirst({ where: { tenant_id: tenantId, code: body.code }, select: { id: true } });
  if (existing) throw new AppError(`Rate type ${body.code} already exists.`, 409, 'RATE_TYPE_EXISTS');
  return created(c, await db.exchangeRateType.create({
    data: { tenant_id: tenantId, code: body.code, name: body.name, description: body.description ?? null },
  }));
});

app.put('/exchange-rate-types/:id', guard('PUT /exchange-rate-types/:id'), validate(UpdateExchangeRateTypeSchema), async (c) => {
  const tenantId = c.get('tenantId');
  const id = c.req.param('id');
  if (!UUID.test(id)) throw new AppError('Rate type not found.', 404, 'RATE_TYPE_NOT_FOUND');
  const body = c.get('body') as z.infer<typeof UpdateExchangeRateTypeSchema>;

  if (body.is_active === false) {
    const inLedger = await db.financeParameters.count({
      where: { tenant_id: tenantId, OR: [{ accounting_rate_type_id: id }, { reporting_rate_type_id: id }] },
    });
    if (inLedger > 0) throw new AppError('The ledger uses this rate type; it cannot be deactivated.', 409, 'RATE_TYPE_IN_USE_BY_LEDGER');
  }
  const result = await db.exchangeRateType.updateMany({ where: { id, tenant_id: tenantId }, data: body });
  if (result.count === 0) throw new AppError('Rate type not found.', 404, 'RATE_TYPE_NOT_FOUND');
  return ok(c, await db.exchangeRateType.findFirst({ where: { id, tenant_id: tenantId } }));
});

/* ─────────────────────────────── exchange rates ─────────────────────────────── */

app.get('/exchange-rates', guard('GET /exchange-rates'), async (c) => {
  const tenantId = c.get('tenantId');
  const rateTypeId = c.req.query('rate_type_id');
  if (rateTypeId !== undefined && !UUID.test(rateTypeId)) throw new AppError('rate_type_id must be a uuid.', 400);
  const rates = await db.exchangeRate.findMany({
    where: { tenant_id: tenantId, ...(rateTypeId ? { pair: { rate_type_id: rateTypeId } } : {}) },
    include: { pair: { include: { rate_type: { select: { id: true, code: true, name: true } } } } },
    orderBy: [{ valid_from: 'desc' }, { created_at: 'desc' }],
    take: 500,
  });
  return ok(c, rates);
});

/** Preview which rate a posting on `date` would use. */
app.get('/exchange-rates/resolve', guard('GET /exchange-rates/resolve'), async (c) => {
  const q = { type: c.req.query('rate_type_id') ?? '', from: c.req.query('from') ?? '', to: c.req.query('to') ?? '', date: c.req.query('date') ?? '' };
  if (!UUID.test(q.type) || !CODE.test(q.from) || !CODE.test(q.to) || !DATE.test(q.date)) {
    throw new AppError('rate_type_id (uuid), from, to (currency codes) and date (YYYY-MM-DD) are required.', 400);
  }
  const resolved = await resolveRate({
    tenantId: c.get('tenantId'), rateTypeId: q.type, from: q.from, to: q.to, date: new Date(`${q.date}T00:00:00.000Z`),
  });
  return ok(c, {
    kind: resolved.kind,
    rate: resolved.rate.toString(),
    conversion_factor: resolved.conversionFactor.toString(),
    valid_from: resolved.validFrom,
    one_unit: translate(1, resolved).toDecimalPlaces(8).toString(),
  });
});

app.post('/exchange-rates', guard('POST /exchange-rates'), validate(CreateExchangeRateSchema), async (c) => {
  const body = c.get('body') as AddRateInput;
  const user = c.get('user');
  // Only accounting setup may insert a rate before the latest one: doing so
  // changes which rate later dates resolve to, which is a correction.
  const canBackdate = hasPermission(user.role, 'finance.setup.maintain');
  return created(c, await addExchangeRate(c.get('tenantId'), user.id, body, { canBackdate }));
});

app.put('/exchange-rates/:id', guard('PUT /exchange-rates/:id'), validate(UpdateExchangeRateSchema), async (c) => {
  const id = c.req.param('id');
  if (!UUID.test(id)) throw new AppError('Exchange rate not found.', 404, 'EXCHANGE_RATE_NOT_FOUND');
  const body = c.get('body') as { rate: number };
  return ok(c, await updateExchangeRate(c.get('tenantId'), c.get('user').id, id, body));
});

export default app;
