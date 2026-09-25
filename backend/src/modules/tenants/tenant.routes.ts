import { Hono }    from 'hono';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { ok } from '../../shared/response';
import { requirePermission, type Permission } from '../../shared/middleware/permissions';
import { validate } from '../../shared/middleware/validate';
import { UpdateTenantConfigSchema, UpdateTenantSetupSchema } from '../../shared/schemas';
import type { AppEnv } from '../../shared/context';
import type { z } from 'zod';

/**
 * Administration of the caller's own tenant. Mounted inside the authenticated,
 * tenant-scoped v1 router as `/tenant`.
 *
 * There is deliberately no tenant id in the path: every handler acts on
 * `c.get('tenantId')`, which the tenant and auth middleware have already bound
 * to the caller's token. Cross-tenant access is impossible by construction.
 *
 * Tenant creation is not an HTTP operation. Tenants are created by the platform
 * operator after an implementation decision — see `scripts/createTenant.ts`.
 */

type RoutePermissions = Record<string, [Permission, ...Permission[]]>;

export const TENANT_ROUTE_PERMISSIONS = Object.freeze({
  'GET /config':  ['setup.tenant.read'],
  'PUT /config':  ['setup.tenant.maintain'],
  'PUT /setup':   ['finance.setup.maintain'],
} satisfies RoutePermissions);

// `GET /currency` carries no permission on purpose — a decision, not an
// omission. Every screen that renders an amount needs to know which currency it
// is in — the POS for a cashier, the shop for a customer, every ERP list — and
// those roles have no business reading the tenant's plan, modules or branding,
// nor the finance currency setup. Being authenticated in the tenant is the whole
// check; the payload is the ledger's currency and its rounding, nothing else.

const guard = (route: keyof typeof TENANT_ROUTE_PERMISSIONS) => {
  const [first, ...rest] = TENANT_ROUTE_PERMISSIONS[route] as [Permission, ...Permission[]];
  return requirePermission(first, ...rest);
};

const app = new Hono<AppEnv>();

/**
 * The formatting locale: the tenant's language, qualified by its country when one
 * is set (`es` + `BO` -> `es-BO`). The country matters — Intl formats BOB as
 * `1299,50 BOB` under bare `es` and `Bs 1.299,50` under `es-BO` — but it is never
 * guessed: without a country the bare language is used. A value Intl rejects
 * degrades to the language alone, then to `en`, rather than reaching a client
 * that would throw while rendering (WORK-025b review).
 */
export function formattingLocale(language: string | null | undefined, country: string | null | undefined): string {
  const candidates = [
    language && country ? `${language.split(/[-_]/)[0]}-${country}` : null,
    language ? language.replace('_', '-') : null,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const [canonical] = Intl.getCanonicalLocales(candidate);
      if (canonical) return canonical;
    } catch { /* try the next one */ }
  }
  return 'en';
}

/** The ledger's currency and how to round it, for any authenticated caller. */
async function displayCurrency(tenantId: string) {
  const ledger = await db.financeParameters.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: null },
    select: { accounting_currency_code: true },
  });
  if (!ledger) return null;
  const activated = await db.tenantCurrency.findFirst({
    where: { tenant_id: tenantId, currency_code: ledger.accounting_currency_code, is_active: true },
    select: { currency_code: true, symbol: true, rounding_precision: true, rounding_method: true },
  });
  if (!activated) return null;
  return {
    code: activated.currency_code,
    symbol: activated.symbol,
    rounding_precision: activated.rounding_precision,
    rounding_method: activated.rounding_method,
  };
}

/**
 * What currency to render money in — the one thing every screen needs and the
 * only tenant fact this route exposes.
 *
 * A read-only projection of the ledger (`FinanceParameters`) and the tenant's own
 * currency record: Finance owns the value and it changes only through
 * `PUT /finance/ledger-currencies`. Null while the tenant has no ledger, and a
 * client must then render no amounts rather than inventing a symbol (WORK-025).
 */
app.get('/currency', async (c) => {
  const tenantId = c.get('tenantId');
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { language: true, country: true } });
  const currency = await displayCurrency(tenantId);
  return ok(c, currency ? { ...currency, locale: formattingLocale(tenant?.language, tenant?.country) } : null);
});

/**
 * The caller's own tenant, plus the currency every screen renders money in.
 *
 * The currency is a **read-only projection** of the ledger (`FinanceParameters`)
 * and the tenant's own currency record: Finance owns the value and it is changed
 * only through `PUT /finance/ledger-currencies`. It is served here rather than
 * from the finance routes because a cashier deliberately has no
 * `finance.currency.read` and the POS renders money on every screen. Null while
 * the tenant has no ledger yet — a client must then render no amounts rather than
 * inventing a symbol (WORK-025).
 */
app.get('/config', guard('GET /config'), async (c) => {
  const tenantId = c.get('tenantId');
  const tenant = await db.tenant.findUnique({
    where:  { id: tenantId },
    select: { id: true, name: true, slug: true, plan: true, modules: true, branding: true, language: true, timezone: true, country: true },
  });
  if (!tenant) throw new AppError('Tenant not found', 404);

  const currency = await displayCurrency(tenantId);
  return ok(c, { ...tenant, currency: currency ? { ...currency, locale: formattingLocale(tenant.language, tenant.country) } : null });
});

app.put('/config', guard('PUT /config'), validate(UpdateTenantConfigSchema), async (c) => {
  const body = c.get('body') as z.infer<typeof UpdateTenantConfigSchema>;
  const tenant = await db.tenant.update({
    where: { id: c.get('tenantId') },
    data: {
      ...(body.branding !== undefined ? { branding: body.branding as object } : {}),
      ...(body.language !== undefined ? { language: body.language } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.country  !== undefined ? { country: body.country }   : {}),
    },
    select: { id: true, name: true, slug: true, plan: true, modules: true, branding: true, language: true, timezone: true, country: true },
  });
  return ok(c, tenant);
});

/**
 * Accounting setup: the legacy tax fallback.
 *
 * The accounting currency is no longer set here. It belongs to the ledger and is
 * set through PUT /finance/ledger-currencies (WORK-024), which locks it once
 * anything has posted. Since WORK-025 the ledger is the only place the currency
 * lives — the mirror on `Tenant` is gone. A `currency_code` in this body is
 * refused by the strict schema.
 */
app.put('/setup', guard('PUT /setup'), validate(UpdateTenantSetupSchema), async (c) => {
  const body = c.get('body') as z.infer<typeof UpdateTenantSetupSchema>;
  const updated = await db.tenant.update({
    where: { id: c.get('tenantId') },
    data: { tax_config: body.tax_config },
    select: { id: true, tax_config: true },
  });
  return ok(c, updated);
});

export default app;
