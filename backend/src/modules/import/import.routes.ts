import { Hono }    from 'hono';
import { routeGuard, type RouteGuards } from '../../shared/middleware/permissions';
import { ImportService } from './import.service';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { ok, created } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

/** Import jobs: preparing a job and running it are separate duties (WORK-030b). */
export const IMPORT_ROUTE_PERMISSIONS = Object.freeze({
  'POST /upload': ['import.job.prepare'],
  'POST /jobs/:id/mapping': ['import.job.prepare'],
  'POST /jobs/:id/validate': ['import.job.prepare'],
  'POST /jobs/:id/execute': ['import.job.execute'],
  'GET /jobs': ['import.job.read'],
  'GET /jobs/:id': ['import.job.read'],
} satisfies RouteGuards);

const guard = routeGuard(IMPORT_ROUTE_PERMISSIONS);
const importService = new ImportService();
const IMPORT_ENABLED = false as boolean;

/**
 * WORK-042: the executors only log. Every job reached COMPLETED without writing
 * a single row, which told the user their data was loaded when it was not. Until
 * real executors exist (WORK-054), every step that would create, validate or run
 * a job refuses instead of pretending. The job history stays readable.
 */
function importNotImplemented(): never {
  throw new AppError(
    'Data import is not available yet: no rows would be written. Create the records from their own screens for now.',
    501,
    'IMPORT_NOT_IMPLEMENTED',
  );
}

app.post('/upload', guard('POST /upload'), async (c) => {
  if (IMPORT_ENABLED === false) importNotImplemented();
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

app.post('/jobs/:id/mapping', guard('POST /jobs/:id/mapping'), async (c) => {
  if (IMPORT_ENABLED === false) importNotImplemented();
  const { mapping } = await c.req.json();
  const job = await importService.saveColumnMapping(c.get('tenantId'), c.req.param('id'), mapping);
  return ok(c, job);
});

app.post('/jobs/:id/validate', guard('POST /jobs/:id/validate'), async (c) => {
  if (IMPORT_ENABLED === false) importNotImplemented();
  const result = await importService.validateJob(c.get('tenantId'), c.req.param('id'));
  return ok(c, result);
});

app.post('/jobs/:id/execute', guard('POST /jobs/:id/execute'), async (c) => {
  if (IMPORT_ENABLED === false) importNotImplemented();
  await importService.executeImport(c.get('tenantId'), c.req.param('id'), c.get('user').id);
  return ok(c, null);
});

app.get('/jobs', guard('GET /jobs'), async (c) => {
  const jobs = await db.importJob.findMany({
    where: { tenant_id: c.get('tenantId') },
    orderBy: { created_at: 'desc' },
    take: 50,
  });
  return ok(c, jobs);
});

app.get('/jobs/:id', guard('GET /jobs/:id'), async (c) => {
  const job = await db.importJob.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
  });
  return ok(c, job);
});

export default app;
