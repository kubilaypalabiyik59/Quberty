import { Hono } from 'hono';
import { db } from '../../infrastructure/database/client';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { paginated } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

// GET /audit — paginated audit trail (admin only)
// Optional filters: method (POST|PUT|PATCH|DELETE), q (matches path or user_email)
app.get('/', requireRole('admin'), async (c) => {
  const { method, q, page = '1', limit = '50' } = c.req.query();

  const where: any = { tenant_id: c.get('tenantId') };
  if (method) where.method = method;
  if (q) {
    where.OR = [
      { path: { contains: q, mode: 'insensitive' } },
      { user_email: { contains: q, mode: 'insensitive' } },
    ];
  }

  const take = Math.min(Number(limit) || 50, 200);
  const skip = (Number(page) - 1) * take;

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take,
      select: {
        id: true, user_email: true, user_role: true,
        method: true, path: true, status_code: true,
        ip: true, duration_ms: true, created_at: true,
      },
    }),
    db.auditLog.count({ where }),
  ]);

  return paginated(c, logs, total, Number(page), take);
});

export default app;
