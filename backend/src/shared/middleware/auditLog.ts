import { db } from '../../infrastructure/database/client';
import { logger } from '../logger';
import type { AppContext, AppNext } from '../context';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SENSITIVE     = new Set(['password', 'password_hash', 'token', 'access_token', 'secret', 'pin']);

function sanitize(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const out: any = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = SENSITIVE.has(k.toLowerCase())
      ? '***'
      : typeof v === 'object' && v !== null
        ? sanitize(v)
        : v;
  }
  return out;
}

/**
 * Hono audit logging middleware.
 * Records every write operation (POST/PUT/PATCH/DELETE) to audit_logs.
 * Fire-and-forget — never blocks the response.
 */
export async function auditLog(c: AppContext, next: AppNext) {
  if (!WRITE_METHODS.has(c.req.method)) {
    return next();
  }

  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  // Capture body from context (validate middleware stores it) or skip
  const body = c.get('body') ?? null;

  db.auditLog.create({
    data: {
      tenant_id:   c.get('tenantId')  ?? null,
      user_id:     c.get('user')?.id  ?? null,
      user_email:  c.get('user')?.email ?? null,
      user_role:   c.get('user')?.role  ?? null,
      method:      c.req.method,
      path:        c.req.path,
      status_code: c.res.status,
      body:        body ? sanitize(body) : undefined,
      ip:          c.req.header('x-forwarded-for') ?? (c.env as any)?.remoteAddr ?? null,
      user_agent:  c.req.header('user-agent') ?? null,
      duration_ms: duration,
    },
  }).catch((err) => logger.error({ err }, 'Failed to write audit log'));
}
