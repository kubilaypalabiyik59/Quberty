/**
 * VALIDATE MIDDLEWARE TESTS
 * Verifies the Zod validation middleware returns the correct 400 response
 * and hands parsed data to the next handler.
 *
 * The middleware is Hono middleware: it reads the body with `await c.req.json()`,
 * stores the parsed result on `c.set('body')`, and on failure RETURNS a 400 JSON
 * response itself rather than throwing or calling an Express `next(error)`. The
 * previous version of this file drove it as `(req, res, next)` with a `res.status`
 * spy, which is why it stopped compiling once the backend moved to Hono.
 *
 * Driving a real one-route app is also what makes the "empty body" case honest:
 * the middleware's `try/catch` around `c.req.json()` only runs against a real
 * request that has no parsable body.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '../shared/middleware/validate';
import type { AppEnv } from '../shared/context';

const TestSchema = z.object({
  name:  z.string().min(1, 'Name is required'),
  age:   z.number().int().positive('Age must be positive'),
  email: z.string().email('Invalid email'),
});

/** What the route saw after the middleware ran, if it ran at all. */
function buildValidateApp() {
  const captured: { handlerRan: boolean; body?: Record<string, any> } = {
    handlerRan: false,
  };
  const app = new Hono<AppEnv>();

  app.post('/thing', validate(TestSchema), (c) => {
    captured.handlerRan = true;
    captured.body       = c.get('body');
    return c.json({ ok: true });
  });

  return { app, captured };
}

/** Posts a JSON body; omit `body` entirely to send a request with none. */
function post(app: Hono<AppEnv>, body?: unknown) {
  const init: RequestInit = {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return app.request('/thing', init);
}

describe('validate() middleware', () => {
  it('passes a valid body through to the handler', async () => {
    const { app, captured } = buildValidateApp();

    const res = await post(app, { name: 'Carlos', age: 30, email: 'carlos@test.com' });

    expect(res.status).toBe(200);
    expect(captured.handlerRan).toBe(true);
  });

  it('stores the parsed data on the context for the handler', async () => {
    const { app, captured } = buildValidateApp();

    await post(app, { name: 'Ana', age: 25, email: 'ana@test.com' });

    // The Hono equivalent of the old "replaces req.body": the handler reads the
    // schema's OUTPUT from c.get('body'), never the raw request body.
    expect(captured.body).toMatchObject({ name: 'Ana', age: 25 });
  });

  it('returns 400 with error details for an invalid body', async () => {
    const { app, captured } = buildValidateApp();

    const res  = await post(app, { name: '', age: -1, email: 'bad' });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      error: expect.objectContaining({
        code:    'VALIDATION_ERROR',
        details: expect.any(Array),
      }),
    });
    // The handler must never run on an invalid body.
    expect(captured.handlerRan).toBe(false);
  });

  it('includes field-level error details', async () => {
    const { app } = buildValidateApp();

    const res  = await post(app, { name: '', age: -1, email: 'bad' });
    const json = await res.json() as { error: { details: { field: string }[] } };
    const fields = json.error.details.map((d) => d.field);

    expect(fields).toContain('name');
    expect(fields).toContain('age');
    expect(fields).toContain('email');
  });

  it('returns 400 for a completely empty body', async () => {
    const { app, captured } = buildValidateApp();

    const res = await post(app);

    expect(res.status).toBe(400);
    expect(captured.handlerRan).toBe(false);
  });
});
