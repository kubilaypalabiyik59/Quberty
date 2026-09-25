/**
 * FAIL-CLOSED BASELINE (WORK-042)
 *
 *   - a gapless legal series never becomes non-continuous and never skips numbers
 *     without a stated reason;
 *   - Prisma's duplicate / missing-reference / not-found errors answer 409 / 422 /
 *     404 instead of 500, without echoing values;
 *   - a malformed refresh token answers 401, not 500;
 *   - a stocked item model group cannot claim a costing method that is not
 *     implemented;
 *   - data import refuses instead of reporting COMPLETED for rows it never wrote.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { Prisma } from '@prisma/client';

jest.mock('../infrastructure/database/client', () => ({
  db: {
    itemModelGroup: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    importJob:      { create: jest.fn(), update: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    user:           { findUnique: jest.fn() },
    numberSequence: { findFirst: jest.fn(), update: jest.fn() },
    factura:        { findMany: jest.fn() },
    auditLog:       { create: jest.fn() },
    site:           { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    warehouse:      { create: jest.fn() },
    $transaction:   jest.fn(),
  },
}));

import { db } from '../infrastructure/database/client';
import { errorHandler } from '../shared/middleware/errorHandler';
import { UpdateNumberSequenceSchema } from '../shared/schemas';
import {
  gaplessSeriesRefusal,
  highestIssuedNumber,
  persistedSequenceFields,
} from '../shared/services/numberSequenceRules';
import authRoutes from '../modules/auth/auth.routes';
import productRoutes from '../modules/inventory/product.routes';
import importRoutes from '../modules/import/import.routes';
import setupRoutes from '../modules/setup/setup.routes';
import warehouseRoutes from '../modules/warehouse/warehouse.routes';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AppEnv } from '../shared/context';

const mocked = db as any;
beforeEach(() => jest.clearAllMocks());

// ── Gapless legal series ──────────────────────────────────────────────────────

describe('gaplessSeriesRefusal()', () => {
  const factura = { legal_series: 'GAPLESS', continuous: true, manual: false, next_number: 35 };
  const issued34 = highestIssuedNumber(['000033', '000034']);

  it('ignores a series that is not gapless', () => {
    expect(gaplessSeriesRefusal({ ...factura, legal_series: 'NONE' }, { continuous: false }, null)).toBeNull();
    expect(gaplessSeriesRefusal({ ...factura, legal_series: 'NONE' }, { next_number: 900 }, null)).toBeNull();
  });

  it('refuses to make a gapless series non-continuous', () => {
    expect(gaplessSeriesRefusal(factura, { continuous: false }, issued34)?.code)
      .toBe('NUMBER_SEQUENCE_GAPLESS_REQUIRED');
  });

  it('allows the consecutive number and anything at or below it', () => {
    expect(gaplessSeriesRefusal(factura, { next_number: 35 }, issued34)).toBeNull();
  });

  it('refuses a forward jump without a reason, naming how many numbers it skips', () => {
    const r = gaplessSeriesRefusal(factura, { next_number: 45 }, issued34);
    expect(r?.code).toBe('NUMBER_SEQUENCE_GAP_REASON_REQUIRED');
    expect(r?.message).toContain('skips 10 number(s) after 35');
  });

  it('refuses a reason that is too short to mean anything', () => {
    expect(gaplessSeriesRefusal(factura, { next_number: 45, acknowledge_gap_reason: 'lost pad' }, issued34)?.code)
      .toBe('NUMBER_SEQUENCE_GAP_REASON_REQUIRED');
  });

  it('allows a forward jump with a stated reason', () => {
    expect(gaplessSeriesRefusal(
      factura,
      { next_number: 45, acknowledge_gap_reason: 'Pre-printed pad 35-44 was destroyed' },
      issued34,
    )).toBeNull();
  });

  it('does not police numbers a person types while the series is manual', () => {
    expect(gaplessSeriesRefusal({ ...factura, manual: true }, { next_number: 900 }, issued34)).toBeNull();
  });

  it('measures a manual → automatic switch from the highest issued, not the stale counter', () => {
    const wasManual = { ...factura, manual: true, next_number: 1 };
    expect(gaplessSeriesRefusal(wasManual, { manual: false, next_number: 35 }, issued34)).toBeNull();
    expect(gaplessSeriesRefusal(wasManual, { manual: false, next_number: 36 }, issued34)?.code)
      .toBe('NUMBER_SEQUENCE_GAP_REASON_REQUIRED');
  });

  it('uses the counter when nothing comparable has been issued', () => {
    const none = highestIssuedNumber([]);
    expect(gaplessSeriesRefusal(factura, { next_number: 35 }, none)).toBeNull();
    expect(gaplessSeriesRefusal(factura, { next_number: 36 }, none)?.code).toBe('NUMBER_SEQUENCE_GAP_REASON_REQUIRED');
  });

  it('judges the stored counter when a manual series only switches back to automatic', () => {
    // Review finding: set 900 while manual, then {manual:false} without a number.
    const manualAt900 = { ...factura, manual: true, next_number: 900 };
    expect(gaplessSeriesRefusal(manualAt900, { manual: false }, issued34)?.code)
      .toBe('NUMBER_SEQUENCE_GAP_REASON_REQUIRED');
    expect(gaplessSeriesRefusal(manualAt900, { manual: false, acknowledge_gap_reason: 'Pad 35-899 was never printed' }, issued34))
      .toBeNull();
    expect(gaplessSeriesRefusal({ ...factura, manual: true, next_number: 35 }, { manual: false }, issued34)).toBeNull();
  });

  it('keeps an already-automatic series with an unorderable history on its own counter', () => {
    const unorderable = highestIssuedNumber(['A-04-17', '000034']);
    expect(unorderable.comparable).toBe(false);
    expect(gaplessSeriesRefusal(factura, { next_number: 5000 }, unorderable)?.code)
      .toBe('NUMBER_SEQUENCE_GAP_REASON_REQUIRED');
    expect(gaplessSeriesRefusal(factura, { next_number: 35 }, unorderable)).toBeNull();
  });

  it('leaves an acknowledged resume from an unorderable history to the manual → automatic contract', () => {
    const unorderable = highestIssuedNumber(['A-04-17']);
    expect(gaplessSeriesRefusal(
      { ...factura, manual: true, next_number: 1 },
      { manual: false, next_number: 500, acknowledge_unverifiable_resume: true },
      unorderable,
    )).toBeNull();
  });

  it('provisions the legal invoice series continuous and gapless', () => {
    const source = readFileSync(join(__dirname, '../infrastructure/database/provisionConfiguration.ts'), 'utf8');
    const block = source.slice(source.indexOf("reference: 'FACTURA'"), source.indexOf("reference: 'FACTURA'") + 700);
    expect(block).toMatch(/continuous: true,/);
    expect(block).toMatch(/legal_series: 'GAPLESS',/);
  });

  it('keeps the reason out of the row', () => {
    const body = UpdateNumberSequenceSchema.parse({ next_number: 45, acknowledge_gap_reason: 'Pad 35-44 destroyed in flood' });
    expect(persistedSequenceFields(body)).toEqual({ next_number: 45 });
  });
});

describe('PUT /setup/number-sequences/:id on the legal series', () => {
  const row = {
    id: 'seq-1', tenant_id: 't1', reference: 'FACTURA', format: '{######}', scope: 'LEGAL_ENTITY',
    manual: false, continuous: true, legal_series: 'GAPLESS', next_number: 35, is_active: true,
  };

  function put(body: unknown) {
    return asAdmin(setupRoutes).request('/number-sequences/seq-1', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    mocked.numberSequence.findFirst.mockResolvedValue(row);
    mocked.factura.findMany.mockResolvedValue([{ factura_number: '000034' }]);
    mocked.$transaction.mockImplementation((fn: any) => fn(mocked));
    mocked.numberSequence.update.mockImplementation(({ data }: any) => ({ ...row, ...data }));
  });

  it('refuses a forward jump before anything is written', async () => {
    const res = await put({ next_number: 60 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe('NUMBER_SEQUENCE_GAP_REASON_REQUIRED');
    expect(mocked.numberSequence.update).not.toHaveBeenCalled();
    expect(mocked.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses making the series non-continuous', async () => {
    const res = await put({ continuous: false });
    expect(res.status).toBe(400);
    expect(mocked.numberSequence.update).not.toHaveBeenCalled();
  });

  it('writes the stated reason in the same transaction as the jump', async () => {
    const res = await put({ next_number: 60, acknowledge_gap_reason: 'Pre-printed pad 35-59 destroyed' });
    expect(res.status).toBe(200);
    expect(mocked.numberSequence.update.mock.calls[0][0].data).toEqual({ next_number: 60 });
    const audit = mocked.auditLog.create.mock.calls[0][0].data;
    expect(audit.body).toMatchObject({
      action: 'NUMBER_SEQUENCE_GAP_ACKNOWLEDGED', reference: 'FACTURA',
      before: { next_number: 35 }, after: { next_number: 60 }, reason: 'Pre-printed pad 35-59 destroyed',
    });
  });
});

// ── Prisma error mapping ──────────────────────────────────────────────────────

function throwingApp(err: Error) {
  const app = new Hono<AppEnv>();
  app.get('/', () => { throw err; });
  app.onError(errorHandler);
  return app;
}

function known(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'test', meta });
}

describe('errorHandler Prisma mapping', () => {
  it('answers a unique violation with 409 DUPLICATE and names fields, never tenant_id or values', async () => {
    const res = await throwingApp(known('P2002', { target: ['tenant_id', 'code'] })).request('/');
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('DUPLICATE');
    expect(body.error.message).toBe('A record with the same code already exists.');
  });

  it('answers a missing foreign key with 422 INVALID_REFERENCE', async () => {
    const res = await throwingApp(known('P2003')).request('/');
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.code).toBe('INVALID_REFERENCE');
  });

  it('answers a missing record with 404 NOT_FOUND', async () => {
    const res = await throwingApp(known('P2025')).request('/');
    expect(res.status).toBe(404);
  });

  it('keeps every other Prisma error a 500', async () => {
    expect((await throwingApp(known('P2010')).request('/')).status).toBe(500);
    expect((await throwingApp(new Error('bug')).request('/')).status).toBe(500);
  });
});

// ── Refresh token ─────────────────────────────────────────────────────────────

describe('POST /auth/refresh', () => {
  it('answers a malformed token with 401 and never reads the user', async () => {
    const app = new Hono<AppEnv>();
    app.route('/', authRoutes);
    app.onError(errorHandler);
    const res = await app.request('/refresh', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: 'garbage' }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe('REFRESH_TOKEN_INVALID');
    expect(mocked.user.findUnique).not.toHaveBeenCalled();
  });
});

// ── Costing method and import ─────────────────────────────────────────────────

function asAdmin(router: Hono<AppEnv>) {
  const app = new Hono<AppEnv>();
  const identity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'u1', email: 'a@a.com', role: 'admin', tenantId: 't1' });
    c.set('tenantId', 't1');
    await next();
  };
  app.use('*', identity);
  app.route('/', router);
  app.onError(errorHandler);
  return app;
}

const json = (body: unknown) => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('item model group costing method', () => {
  it('refuses a stocked group valued at anything but FIFO, before writing', async () => {
    const res = await asAdmin(productRoutes).request('/setup/item-model-groups',
      json({ code: 'STD', name: 'Standard', costing_method: 'STANDARD', stocked: true }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.code).toBe('COSTING_METHOD_NOT_IMPLEMENTED');
    expect(mocked.itemModelGroup.create).not.toHaveBeenCalled();
  });

  it('accepts FIFO for a stocked group and any method for a non-stocked one', async () => {
    mocked.itemModelGroup.create.mockResolvedValue({ id: 'g1' });
    expect((await asAdmin(productRoutes).request('/setup/item-model-groups',
      json({ code: 'FIFO', name: 'FIFO', costing_method: 'FIFO' }))).status).toBe(201);
    expect((await asAdmin(productRoutes).request('/setup/item-model-groups',
      json({ code: 'NS', name: 'Not stocked', costing_method: 'STANDARD', stocked: false }))).status).toBe(201);
  });
});

describe('site creation stays with the admin (S-8)', () => {
  function asManager(router: Hono<AppEnv>) {
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('user', { id: 'u2', email: 'm@m.com', role: 'store_manager', tenantId: 't1' });
      c.set('tenantId', 't1');
      await next();
    });
    app.route('/', router);
    app.onError(errorHandler);
    return app;
  }

  it('refuses a store manager creating a site through POST /warehouses', async () => {
    const res = await asManager(warehouseRoutes).request('/warehouses', json({
      code: 'WH-X', name: 'X', create_site: true, site_name: 'X', site_city: 'La Paz', site_country: 'BO',
    }));
    expect(res.status).toBe(403);
    expect(mocked.site.create).not.toHaveBeenCalled();
    expect(mocked.warehouse.create).not.toHaveBeenCalled();
  });

  it('refuses a store manager the quick setup, which creates a site', async () => {
    const res = await asManager(warehouseRoutes).request('/setup', json({ name: 'X', city: 'La Paz', country: 'BO' }));
    expect(res.status).toBe(403);
    expect(mocked.site.create).not.toHaveBeenCalled();
  });

  it('refuses an admin a site country that is not an ISO code', async () => {
    const res = await asAdmin(warehouseRoutes).request('/warehouses', json({
      code: 'WH-X', name: 'X', create_site: true, site_name: 'X', site_city: 'La Paz', site_country: 'Bolivia',
    }));
    expect(res.status).toBe(400);
    expect(mocked.site.create).not.toHaveBeenCalled();
  });
});

describe('data import', () => {
  it.each([
    ['/jobs/j1/mapping', { mapping: {} }],
    ['/jobs/j1/validate', {}],
    ['/jobs/j1/execute', {}],
  ])('refuses %s with 501 and touches no job', async (path, body) => {
    const res = await asAdmin(importRoutes).request(path, json(body));
    expect(res.status).toBe(501);
    expect(((await res.json()) as any).error.code).toBe('IMPORT_NOT_IMPLEMENTED');
    expect(mocked.importJob.update).not.toHaveBeenCalled();
    expect(mocked.importJob.findFirst).not.toHaveBeenCalled();
  });

  it('refuses an upload before parsing or creating a job', async () => {
    const form = new FormData();
    form.append('file', new File(['a,b\n1,2'], 'x.csv'));
    form.append('import_type', 'customers');
    const res = await asAdmin(importRoutes).request('/upload', { method: 'POST', body: form });
    expect(res.status).toBe(501);
    expect(mocked.importJob.create).not.toHaveBeenCalled();
  });
});
