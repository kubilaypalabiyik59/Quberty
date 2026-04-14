import { Hono }          from 'hono';
import { cors }          from 'hono/cors';
import { compress }      from 'hono/compress';
import { secureHeaders } from 'hono/secure-headers';
import { timing }        from 'hono/timing';
import { swaggerUI }     from '@hono/swagger-ui';
import { randomUUID }    from 'crypto';

import { config }          from './config/env';
import { errorHandler }    from './shared/middleware/errorHandler';
import { tenantMiddleware } from './shared/middleware/tenantMiddleware';
import { authMiddleware }   from './shared/middleware/authMiddleware';
import { auditLog }         from './shared/middleware/auditLog';
import { logger }           from './shared/logger';
import { db }               from './infrastructure/database/client';
import type { AppEnv }      from './shared/context';
import { openApiSpec }      from './docs/openapi';

// Route imports
import authRoutes           from './modules/auth/auth.routes';
import productRoutes        from './modules/inventory/product.routes';
import inventoryRoutes      from './modules/inventory/inventory.routes';
import warehouseRoutes      from './modules/warehouse/warehouse.routes';
import salesRoutes          from './modules/sales/sales.routes';
import purchaseRoutes       from './modules/purchase/purchase.routes';
import customerRoutes       from './modules/customers/customer.routes';
import hrRoutes             from './modules/hr/hr.routes';
import reportRoutes         from './modules/reporting/report.routes';
import importRoutes         from './modules/import/import.routes';
import tenantRoutes         from './modules/tenants/tenant.routes';
import variantTypeRoutes    from './modules/inventory/variant-types.routes';
import inventoryCountRoutes from './modules/inventory/inventory-count.routes';
import financeRoutes        from './modules/finance/finance.routes';
import posRoutes            from './modules/pos/pos.routes';

const app = new Hono<AppEnv>();

// ── Security headers (replaces helmet) ───────────────────────────────────────
app.use('*', secureHeaders());

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use('*', cors({
  origin:      config.CORS_ORIGINS,
  credentials: true,
}));

// ── Compression ──────────────────────────────────────────────────────────────
app.use('*', compress());

// ── Server timing headers (visible in browser DevTools → Network → Timing) ───
app.use('*', timing());

// ── Request correlation IDs ───────────────────────────────────────────────────
// Every request gets a unique ID — returned in X-Request-ID header and threaded
// through all log lines so you can trace a full request in production.
app.use('*', async (c, next) => {
  const requestId = c.req.header('x-request-id') ?? randomUUID();
  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);
  await next();
});

// ── HTTP request logging ──────────────────────────────────────────────────────
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  logger.info({
    requestId: c.get('requestId'),
    method:    c.req.method,
    path:      c.req.path,
    status:    c.res.status,
    duration,
  }, 'HTTP');
});

// ── In-memory rate limiter ────────────────────────────────────────────────────
const rateStore = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 15 * 60 * 1000; // 15 min

function rateLimiter(max: number) {
  return async (c: any, next: any) => {
    const key   = c.req.header('x-forwarded-for') ?? 'local';
    const now   = Date.now();
    const entry = rateStore.get(key);

    if (!entry || entry.reset < now) {
      rateStore.set(key, { count: 1, reset: now + WINDOW_MS });
    } else {
      entry.count++;
      if (entry.count > max) {
        return c.json(
          { success: false, error: { message: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' } },
          429
        );
      }
    }
    await next();
  };
}

// Strict limit on auth endpoints (10 req / 15 min)
app.use('/api/v1/auth/login',    rateLimiter(10));
app.use('/api/v1/auth/register', rateLimiter(10));

// ── Health endpoints ──────────────────────────────────────────────────────────
const startTime = Date.now();

// Liveness — is the process alive?
app.get('/api/health/live', (c) => c.json({ status: 'ok' }));

// Readiness — can the process serve traffic? (checks DB)
app.get('/api/health/ready', async (c) => {
  try {
    await db.$queryRaw`SELECT 1`;
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    return c.json({
      status:  'ready',
      version: '2.0.0',
      uptime:  `${uptime}s`,
      db:      'connected',
      memory:  `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    });
  } catch {
    return c.json({ status: 'not ready', db: 'disconnected' }, 503);
  }
});

// Legacy health check (keep for backwards compat)
app.get('/api/health', (c) => c.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() }));

// ── API Documentation ─────────────────────────────────────────────────────────
// OpenAPI 3.0 spec (machine-readable)
app.get('/api/docs/spec', (c) => c.json(openApiSpec));

// Swagger UI (human-readable, interactive)
app.get('/api/docs', swaggerUI({ url: '/api/docs/spec' }));

// ── Public routes (no tenant/auth required) ───────────────────────────────────
app.route('/api/v1/auth',    authRoutes);
app.route('/api/v1/tenants', tenantRoutes);

// ── Tenant-scoped routes ──────────────────────────────────────────────────────
const v1 = new Hono<AppEnv>();
v1.use('*', tenantMiddleware);

// Audit all write operations on authenticated routes
v1.use('*', authMiddleware, auditLog);

v1.route('/products',         productRoutes);
v1.route('/inventory',        inventoryRoutes);
v1.route('/warehouse',        warehouseRoutes);
v1.route('/sales/orders',     salesRoutes);
v1.route('/purchase',         purchaseRoutes);
v1.route('/customers',        customerRoutes);
v1.route('/hr',               hrRoutes);
v1.route('/reports',          reportRoutes);
v1.route('/import',           importRoutes);
v1.route('/variant-types',    variantTypeRoutes);
v1.route('/inventory-counts', inventoryCountRoutes);
v1.route('/finance',          financeRoutes);
v1.route('/pos',              posRoutes);

app.route('/api/v1', v1);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.notFound((c) =>
  c.json({ success: false, error: { message: `Route ${c.req.method} ${c.req.path} not found`, code: 'NOT_FOUND' } }, 404)
);

// ── Global error handler ──────────────────────────────────────────────────────
app.onError(errorHandler);

export default app;
