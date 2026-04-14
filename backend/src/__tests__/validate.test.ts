/**
 * VALIDATE MIDDLEWARE TESTS
 * Verifies the Zod validation middleware sends correct 400 responses
 * and passes valid data to the next handler.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../shared/middleware/validate';

const TestSchema = z.object({
  name:  z.string().min(1, 'Name is required'),
  age:   z.number().int().positive('Age must be positive'),
  email: z.string().email('Invalid email'),
});

function makeRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('validate() middleware', () => {
  it('calls next() with no args for valid body', () => {
    const req  = { body: { name: 'Carlos', age: 30, email: 'carlos@test.com' } } as Request;
    const res  = makeRes();
    const next = jest.fn() as NextFunction;

    validate(TestSchema)(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('replaces req.body with parsed/coerced data', () => {
    const req  = { body: { name: 'Ana', age: 25, email: 'ana@test.com' } } as Request;
    const res  = makeRes();
    const next = jest.fn() as NextFunction;

    validate(TestSchema)(req, res, next);

    expect(req.body).toMatchObject({ name: 'Ana', age: 25 });
  });

  it('returns 400 with error details for invalid body', () => {
    const req  = { body: { name: '', age: -1, email: 'bad' } } as Request;
    const res  = makeRes();
    const next = jest.fn() as NextFunction;

    validate(TestSchema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code:    'VALIDATION_ERROR',
        details: expect.any(Array),
      }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('includes field-level error details', () => {
    const req  = { body: { name: '', age: -1, email: 'bad' } } as Request;
    const res  = makeRes();
    const next = jest.fn() as NextFunction;

    validate(TestSchema)(req, res, next);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    const fields  = jsonArg.error.details.map((d: any) => d.field);
    expect(fields).toContain('name');
    expect(fields).toContain('age');
    expect(fields).toContain('email');
  });

  it('returns 400 for completely empty body', () => {
    const req  = { body: {} } as Request;
    const res  = makeRes();
    const next = jest.fn() as NextFunction;

    validate(TestSchema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
