/**
 * DOCUMENT ATTACHMENTS (migration 041)
 *
 *   - listing and attaching follow the parent document's read / maintain permission;
 *   - the parent must exist in the caller's tenant;
 *   - only allowed file types up to 10 MB; the storage path carries ids, never the file name;
 *   - a download is a short-lived signed URL;
 *   - an attachment on a posted vendor invoice cannot be removed; removal is soft.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import attachmentRoutes, { cleanFileName } from '../modules/attachments/attachment.routes';
import { db } from '../infrastructure/database/client';
import { errorHandler } from '../shared/middleware/errorHandler';
import type { AppEnv } from '../shared/context';

jest.mock('../infrastructure/database/client', () => ({
  db: {
    salesQuotation: { findFirst: jest.fn() },
    vendorInvoice: { findFirst: jest.fn() },
    documentAttachment: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
  },
}));

const mdb = db as any;
const T = 'tenant-1';
const Q = '11111111-1111-4111-8111-111111111111';
const VI = '22222222-2222-4222-8222-222222222222';
const fetchMock = jest.fn();

function mount(role = 'store_manager') {
  const app = new Hono<AppEnv>();
  const identity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'user-1', email: 'u@t.com', role, tenantId: T });
    c.set('tenantId', T);
    await next();
  };
  return app.use('*', identity).route('/', attachmentRoutes).onError(errorHandler);
}

function upload(fields: Record<string, string>, file?: { name: string; body: string; type?: string }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (file) form.append('file', new File([file.body], file.name, { type: file.type ?? 'application/octet-stream' }));
  return { method: 'POST', body: form };
}

beforeAll(() => {
  process.env.STORAGE_URL = 'https://storage.test';
  process.env.SUPABASE_SERVICE_KEY = 'service-key';
  (global as any).fetch = fetchMock;
});

beforeEach(() => {
  jest.clearAllMocks();
  mdb.salesQuotation.findFirst.mockImplementation(({ where }: any) =>
    Promise.resolve(where.id === Q && where.tenant_id === T ? { id: Q } : null));
  mdb.documentAttachment.create.mockImplementation(({ data }: any) => Promise.resolve({ id: data.id, file_name: data.file_name }));
  mdb.documentAttachment.updateMany.mockResolvedValue({ count: 1 });
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ signedURL: '/object/sign/attachments/x?token=abc' }) });
});

it('attaches an allowed file to a quotation, storing it under ids only', async () => {
  const res = await mount().request('/', upload({ entity_type: 'SALES_QUOTATION', entity_id: Q }, { name: 'Oferta final.pdf', body: '%PDF-1.4' }));
  expect(res.status).toBe(201);
  const data = mdb.documentAttachment.create.mock.calls[0][0].data;
  expect(data).toMatchObject({ tenant_id: T, entity_type: 'SALES_QUOTATION', entity_id: Q, file_name: 'Oferta final.pdf', mime_type: 'application/pdf' });
  expect(data.storage_path).toBe(`${T}/SALES_QUOTATION/${Q}/${data.id}`);
  expect(data.storage_path).not.toContain('Oferta');
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`https://storage.test/storage/v1/object/attachments/${data.storage_path}`);
  expect(init.headers['content-type']).toBe('application/pdf');
});

it('refuses a disallowed file type and an oversized file', async () => {
  const exe = await mount().request('/', upload({ entity_type: 'SALES_QUOTATION', entity_id: Q }, { name: 'tool.exe', body: 'MZ' }));
  expect(exe.status).toBe(415);
  const big = await mount().request('/', upload({ entity_type: 'SALES_QUOTATION', entity_id: Q }, { name: 'big.pdf', body: 'x'.repeat(10 * 1024 * 1024 + 1) }));
  expect(big.status).toBe(413);
  expect(mdb.documentAttachment.create).not.toHaveBeenCalled();
});

it("refuses a document of another tenant, and a role without the parent's permission", async () => {
  const foreign = await mount().request('/', upload({ entity_type: 'SALES_QUOTATION', entity_id: VI }, { name: 'a.pdf', body: 'x' }));
  expect(foreign.status).toBe(422);
  // A cashier may not maintain quotations.
  const cashier = await mount('cashier').request('/', upload({ entity_type: 'SALES_QUOTATION', entity_id: Q }, { name: 'a.pdf', body: 'x' }));
  expect(cashier.status).toBe(403);
  const unknownType = await mount().request(`/?entity_type=PAYSLIP&entity_id=${Q}`);
  expect(unknownType.status).toBe(400);
});

it('lists only live attachments of the document', async () => {
  mdb.documentAttachment.findMany.mockResolvedValue([]);
  const res = await mount().request(`/?entity_type=SALES_QUOTATION&entity_id=${Q}`);
  expect(res.status).toBe(200);
  expect(mdb.documentAttachment.findMany.mock.calls[0][0].where).toEqual({
    tenant_id: T, entity_type: 'SALES_QUOTATION', entity_id: Q, deleted_at: null,
  });
});

it('hands out a download as a signed URL that expires', async () => {
  mdb.documentAttachment.findFirst.mockResolvedValue({ id: 'a-1', entity_type: 'SALES_QUOTATION', entity_id: Q, storage_path: `${T}/SALES_QUOTATION/${Q}/a-1`, file_name: 'Oferta.pdf' });
  const res = await mount().request('/a-1/download');
  const body: any = await res.json();
  expect(res.status).toBe(200);
  expect(body.data.expires_in).toBe(60);
  expect(body.data.url).toContain('token=abc');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ expiresIn: 60 });
});

it('keeps the attachments of a posted vendor invoice, and removes others softly', async () => {
  mdb.vendorInvoice.findFirst.mockResolvedValue({ id: VI, status: 'POSTED' });
  mdb.documentAttachment.findFirst.mockResolvedValue({ id: 'a-2', entity_type: 'VENDOR_INVOICE', entity_id: VI });
  const locked = await mount('ap_clerk').request('/a-2', { method: 'DELETE' });
  expect(locked.status).toBe(409);
  expect(mdb.documentAttachment.updateMany).not.toHaveBeenCalled();

  mdb.documentAttachment.findFirst.mockResolvedValue({ id: 'a-3', entity_type: 'SALES_QUOTATION', entity_id: Q });
  const removed = await mount().request('/a-3', { method: 'DELETE' });
  expect(removed.status).toBe(200);
  expect(mdb.documentAttachment.updateMany.mock.calls[0][0].data).toMatchObject({ deleted_by: 'user-1' });
});

it('cleans file names without losing them', () => {
  expect(cleanFileName('C:\\fakepath\\Oferta: v2?.pdf')).toBe('Oferta_ v2_.pdf');
  expect(cleanFileName('../../etc/passwd')).toBe('passwd');
});
