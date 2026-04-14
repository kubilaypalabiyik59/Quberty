import { Hono }    from 'hono';
import { ImportService } from './import.service';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { ok, created } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();
const importService = new ImportService();

app.post('/upload', requireRole('admin', 'store_manager'), async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) throw new AppError('No file uploaded', 400);

  const buffer       = Buffer.from(await file.arrayBuffer());
  const import_type  = formData.get('import_type') as string;

  const result = await importService.uploadFile(
    c.get('tenantId'),
    import_type as any,
    file.name,
    buffer,
    c.get('user').id
  );
  return ok(c, result);
});

app.post('/jobs/:id/mapping', requireRole('admin', 'store_manager'), async (c) => {
  const { mapping } = await c.req.json();
  const job = await importService.saveColumnMapping(c.get('tenantId'), c.req.param('id'), mapping);
  return ok(c, job);
});

app.post('/jobs/:id/validate', requireRole('admin', 'store_manager'), async (c) => {
  const result = await importService.validateJob(c.get('tenantId'), c.req.param('id'));
  return ok(c, result);
});

app.post('/jobs/:id/execute', requireRole('admin'), async (c) => {
  await importService.executeImport(c.get('tenantId'), c.req.param('id'), c.get('user').id);
  return ok(c, null);
});

app.get('/jobs', requireRole('admin', 'store_manager'), async (c) => {
  const jobs = await db.importJob.findMany({
    where: { tenant_id: c.get('tenantId') },
    orderBy: { created_at: 'desc' },
    take: 50,
  });
  return ok(c, jobs);
});

app.get('/jobs/:id', requireRole('admin', 'store_manager'), async (c) => {
  const job = await db.importJob.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
  });
  return ok(c, job);
});

export default app;
