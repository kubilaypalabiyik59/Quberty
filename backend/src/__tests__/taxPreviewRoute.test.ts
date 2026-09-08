/**
 * GET /finance/tax/preview
 *
 * The preview exists so that a till, a PDF and the general ledger cannot
 * describe one sale differently — every customer-facing surface asks the same
 * engine that will post the journal. That makes its INPUT VALIDATION the part
 * worth pinning: a preview computed on the wrong amount, the wrong party or the
 * wrong side is not a display bug, it is a wrong number shown to a customer.
 *
 * The earlier implementation of this route had two specific holes, and both are
 * regression-tested below:
 *
 *   · it checked only `Number.isFinite(value)`, so `?amount=0` and
 *     `?amount=-500` reached the tax engine;
 *   · it read `side === 'PURCHASE' ? 'PURCHASE' : 'SALES'`, so any typo became a
 *     SALES preview. Ley 843 art. 74 puts IT on sales only, so that silently
 *     added a turnover tax that must not appear on a purchase — or removed one
 *     that must.
 *
 * No database: the Prisma client and the tax engine are both mocked, and the
 * router is mounted under a tiny app that supplies the context the real
 * tenant/auth middleware would have set.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../shared/context';
import { errorHandler } from '../shared/middleware/errorHandler';

// The finance router imports the Prisma client at module load. Nothing in these
// tests touches a table, but the import must not open a connection.
jest.mock('../infrastructure/database/client', () => ({ db: {} }));

const computeDocumentTax = jest.fn();
jest.mock('../shared/services/documentTax.service', () => ({
  computeDocumentTax: (...args: any[]) => computeDocumentTax(...args),
}));

// Pulled in by the router but never exercised here.
jest.mock('../shared/services/journal.service', () => ({ postJournal: jest.fn() }));
jest.mock('../shared/services/numberSequence.service', () => ({ nextFacturaNumber: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const financeRoutes = require('../modules/finance/finance.routes').default;

const TENANT_ID  = '11111111-1111-4111-8111-111111111111';
const PARTY_ID   = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const LEGACY_CONFIG = { iva_rate: 0.13, it_rate: 0.03 };

const ENGINE_RESULT = {
  subtotal: 1130.13,
  vat: 168.87,
  turnover: 38.97,
  total: 1299,
  lines: [
    { tax_code_id: 'a', code: 'IVA13', tax_type: 'VAT',      base: 1299, rate: 0.13, amount: 168.87 },
    { tax_code_id: 'b', code: 'IT3',   tax_type: 'TURNOVER', base: 1299, rate: 0.03, amount: 38.97 },
  ],
  source: 'ENGINE' as const,
};

/**
 * The router behind the same envelope the real app uses, with the tenant and tax
 * config the upstream middleware would have resolved from the request.
 */
function buildApp() {
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('tenantId', TENANT_ID);
    c.set('taxConfig', LEGACY_CONFIG);
    await next();
  });
  app.route('/finance', financeRoutes);
  return app;
}

function get(query: string) {
  return buildApp().request(`/finance/tax/preview${query}`);
}

beforeEach(() => {
  computeDocumentTax.mockReset();
  computeDocumentTax.mockResolvedValue(ENGINE_RESULT);
});

// ── Accepted requests ─────────────────────────────────────────────────────────

describe('a valid request', () => {
  it('returns the engine result unchanged, lines and source included', async () => {
    const res  = await get('?amount=1299');
    const json = await res.json();

    expect(res.status).toBe(200);
    // Returned verbatim: the route contributes no arithmetic of its own, so a
    // client can label a row from the code that actually applied.
    expect(json).toEqual({ success: true, data: ENGINE_RESULT });
  });

  it('passes the AUTHENTICATED tenant and the validated context to the engine', async () => {
    await get(`?amount=1299&party_id=${PARTY_ID}&product_id=${PRODUCT_ID}&side=SALES`);

    expect(computeDocumentTax).toHaveBeenCalledTimes(1);
    expect(computeDocumentTax).toHaveBeenCalledWith(TENANT_ID, 1299, {
      partyId:      PARTY_ID,
      productId:    PRODUCT_ID,
      side:         'SALES',
      legacyConfig: LEGACY_CONFIG,
    });
  });

  it('never takes the tenant from the query string', async () => {
    // A caller must not be able to preview another tenant's configuration.
    await get('?amount=1299&tenant_id=99999999-9999-4999-8999-999999999999');

    expect(computeDocumentTax).toHaveBeenCalledWith(TENANT_ID, 1299, expect.anything());
  });

  it('previews the PURCHASE side when asked', async () => {
    const res = await get(`?amount=2500&side=PURCHASE&party_id=${PARTY_ID}`);

    expect(res.status).toBe(200);
    expect(computeDocumentTax).toHaveBeenCalledWith(TENANT_ID, 2500, {
      partyId:      PARTY_ID,
      productId:    null,
      side:         'PURCHASE',
      legacyConfig: LEGACY_CONFIG,
    });
  });

  it('defaults to SALES when side is ABSENT', async () => {
    const res = await get('?amount=1299');

    expect(res.status).toBe(200);
    expect(computeDocumentTax).toHaveBeenCalledWith(
      TENANT_ID, 1299, expect.objectContaining({ side: 'SALES' }),
    );
  });

  it('treats omitted identifiers as null rather than inventing a filter', async () => {
    await get('?amount=1299');

    expect(computeDocumentTax).toHaveBeenCalledWith(
      TENANT_ID, 1299, expect.objectContaining({ partyId: null, productId: null }),
    );
  });

  it('treats an EMPTY identifier parameter as absent', async () => {
    // A query string cannot say "absent" and "empty" differently, so a client
    // that always appends `&party_id=` must not get a 400.
    const res = await get('?amount=1299&party_id=&product_id=');

    expect(res.status).toBe(200);
    expect(computeDocumentTax).toHaveBeenCalledWith(
      TENANT_ID, 1299, expect.objectContaining({ partyId: null, productId: null }),
    );
  });

  it('accepts a decimal amount', async () => {
    const res = await get('?amount=1299.55');

    expect(res.status).toBe(200);
    expect(computeDocumentTax).toHaveBeenCalledWith(TENANT_ID, 1299.55, expect.anything());
  });

  it('preserves a LEGACY source without relabelling it as ENGINE', async () => {
    // An unprovisioned tenant falls back to Tenant.tax_config, and the caller has
    // to be able to see that it did — the figure is still a real answer, but it
    // did not come from the configured engine.
    const legacy = { ...ENGINE_RESULT, lines: [], source: 'LEGACY' as const };
    computeDocumentTax.mockResolvedValue(legacy);

    const res  = await get('?amount=1299');
    const json = await res.json() as { data: typeof legacy };

    expect(res.status).toBe(200);
    expect(json.data.source).toBe('LEGACY');
    expect(json.data.lines).toEqual([]);
  });
});

// ── Refusals ──────────────────────────────────────────────────────────────────

/** Every refusal is a 400 in the shared envelope, and reaches no engine. */
async function expectRefused(query: string, expected: RegExp) {
  const res  = await get(query);
  const json = await res.json() as { success: boolean; error: { message: string; code: string } };

  expect(res.status).toBe(400);
  expect(json.success).toBe(false);
  expect(json.error.code).toBe('VALIDATION_ERROR');
  expect(json.error.message).toMatch(expected);
  // The point of refusing: the engine must never be asked the question.
  expect(computeDocumentTax).not.toHaveBeenCalled();
}

describe('amount', () => {
  it('is required', async () => {
    await expectRefused('', /amount is required/);
  });

  it('is refused when empty', async () => {
    await expectRefused('?amount=', /amount is required/);
  });

  it('is refused at ZERO', async () => {
    // The earlier route checked only Number.isFinite, so this reached the engine.
    await expectRefused('?amount=0', /greater than zero/);
  });

  it('is refused when negative', async () => {
    await expectRefused('?amount=-500', /greater than zero/);
  });

  it('is refused when non-numeric', async () => {
    await expectRefused('?amount=abc', /finite number/);
  });

  it('is refused when not finite', async () => {
    await expectRefused('?amount=Infinity', /finite number/);
    await expectRefused('?amount=NaN', /finite number/);
  });

  it('is refused when it overflows to Infinity', async () => {
    await expectRefused('?amount=1e999', /finite number/);
  });
});

describe('side', () => {
  it('refuses an unsupported value instead of defaulting to SALES', async () => {
    // The exact regression: `side === 'PURCHASE' ? 'PURCHASE' : 'SALES'` turned
    // this typo into a sales preview carrying IT.
    await expectRefused('?amount=1299&side=PURCHSE', /side/);
  });

  it('refuses an empty side rather than treating it as absent', async () => {
    // Unlike an identifier, an empty side is not "no filter" — it is a caller
    // that thinks it chose one.
    await expectRefused('?amount=1299&side=', /side/);
  });

  it('is case-sensitive', async () => {
    await expectRefused('?amount=1299&side=sales', /side/);
  });
});

describe('identifiers', () => {
  it('refuses a malformed party_id', async () => {
    await expectRefused('?amount=1299&party_id=not-a-uuid', /party_id must be a UUID/);
  });

  it('refuses a malformed product_id', async () => {
    await expectRefused('?amount=1299&product_id=12345', /product_id must be a UUID/);
  });
});
