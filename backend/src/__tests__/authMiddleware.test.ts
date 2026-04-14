/**
 * AUTH MIDDLEWARE TESTS
 * Tests JWT verification and requireRole() guard without hitting the DB.
 */

import * as jwt from 'jsonwebtoken';
import { authMiddleware, requireRole } from '../shared/middleware/authMiddleware';
import { Request, Response, NextFunction } from 'express';

const SECRET = process.env.JWT_SECRET!;

function makeToken(payload: object, expiresIn = '1h') {
  return jwt.sign(payload, SECRET, { expiresIn } as any);
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    tenantId: 'tenant-abc',
    user: undefined,
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  return {} as Response;
}

// ── authMiddleware ─────────────────────────────────────────────────────────────

describe('authMiddleware', () => {
  it('calls next(AppError 401) when no Authorization header', () => {
    const req  = makeReq();
    const next = jest.fn() as NextFunction;

    authMiddleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('calls next(AppError 401) for non-Bearer token', () => {
    const req  = makeReq({ headers: { authorization: 'Basic abc123' } } as any);
    const next = jest.fn() as NextFunction;

    authMiddleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('calls next(AppError 401) for an expired token', () => {
    const token = makeToken(
      { sub: 'u1', email: 'a@a.com', role: 'admin', tenantId: 'tenant-abc' },
      '-1s' // already expired
    );
    const req  = makeReq({ headers: { authorization: `Bearer ${token}` } } as any);
    const next = jest.fn() as NextFunction;

    authMiddleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('calls next(AppError 401) for wrong tenant', () => {
    const token = makeToken({
      sub: 'u1', email: 'a@a.com', role: 'admin', tenantId: 'DIFFERENT-TENANT',
    });
    const req  = makeReq({ headers: { authorization: `Bearer ${token}` } } as any);
    const next = jest.fn() as NextFunction;

    authMiddleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('populates req.user and calls next() for valid token', () => {
    const token = makeToken({
      sub: 'user-123', email: 'admin@test.com', role: 'admin', tenantId: 'tenant-abc',
    });
    const req  = makeReq({ headers: { authorization: `Bearer ${token}` } } as any);
    const next = jest.fn() as NextFunction;

    authMiddleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(); // no error arg
    expect((req as any).user).toMatchObject({
      id:    'user-123',
      email: 'admin@test.com',
      role:  'admin',
    });
  });

  it('fills req.tenantId from token when header is absent', () => {
    const token = makeToken({
      sub: 'u1', email: 'a@a.com', role: 'admin', tenantId: 'token-tenant',
    });
    const req  = makeReq({
      headers:  { authorization: `Bearer ${token}` },
      tenantId: undefined,
    } as any);
    const next = jest.fn() as NextFunction;

    authMiddleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith();
    expect((req as any).tenantId).toBe('token-tenant');
  });
});

// ── requireRole() ──────────────────────────────────────────────────────────────

describe('requireRole()', () => {
  function reqWithRole(role: string): Request {
    return {
      user: { id: 'u1', email: 'a@a.com', role, tenantId: 'tenant-abc' },
    } as unknown as Request;
  }

  it('calls next() when user has matching role', () => {
    const next = jest.fn() as NextFunction;
    requireRole('admin')(reqWithRole('admin'), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() when user matches one of several roles', () => {
    const next = jest.fn() as NextFunction;
    requireRole('admin', 'store_manager')(reqWithRole('store_manager'), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(AppError 403) when role not in allowed list', () => {
    const next = jest.fn() as NextFunction;
    requireRole('admin')(reqWithRole('cashier'), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('calls next(AppError 403) when req.user is missing', () => {
    const req  = { user: undefined } as unknown as Request;
    const next = jest.fn() as NextFunction;
    requireRole('admin')(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});
