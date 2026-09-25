import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { ok, created } from '../../shared/response';
import { hasPermission, type Permission } from '../../shared/middleware/permissions';
import type { AppContext, AppEnv } from '../../shared/context';

/**
 * Document attachments (migration 041) — files kept on a business document:
 * the quotation as sent, a supplier's contract, a signed delivery note.
 *
 * **[OFFICIAL]** D365 document management: a record's attachments are listed
 * from the record, files live in private blob storage, the allowed file types
 * and the maximum size are parameters, and an attachment on a posted invoice
 * cannot be deleted:
 *   learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/organization-administration/configure-document-management
 *
 * Who may see or change attachments follows the document they hang on: reading
 * a quotation's attachments needs the quotation read permission, attaching or
 * removing needs its maintain permission. The file is in the PRIVATE bucket
 * and is only ever handed out as a short-lived signed URL.
 */

const BUCKET = 'attachments';
const MAX_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_SECONDS = 60;

/** Allowed file types: extension → MIME. Hook for a document-management parameter row. */
export const ALLOWED_TYPES: Readonly<Record<string, string>> = Object.freeze({
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
});

type Delegate = { findFirst: (args: any) => Promise<any> };

/**
 * What can carry attachments, the permission to see and to change them, and —
 * where D365 has one — the rule that freezes them once the document is posted.
 */
export const ENTITY_RULES: Readonly<Record<string, {
  delegate: () => Delegate;
  read: Permission;
  write: Permission;
  locked?: (row: any) => string | null;
  select?: Record<string, true>;
}>> = Object.freeze({
  LEAD: { delegate: () => db.lead, read: 'crm.lead.read', write: 'crm.lead.maintain' },
  OPPORTUNITY: { delegate: () => db.opportunity, read: 'crm.opportunity.read', write: 'crm.opportunity.maintain' },
  SALES_QUOTATION: { delegate: () => db.salesQuotation, read: 'sales.quotation.read', write: 'sales.quotation.update' },
  SALES_ORDER: { delegate: () => db.salesOrder, read: 'sales.order.read', write: 'sales.order.update' },
  PURCHASE_ORDER: { delegate: () => db.purchaseOrder, read: 'purchase.order.read', write: 'purchase.order.update' },
  VENDOR_INVOICE: {
    delegate: () => db.vendorInvoice, read: 'purchase.vendor_invoice.read', write: 'purchase.vendor_invoice.create',
    select: { status: true },
    locked: (row) => (row.status === 'POSTED' ? 'The vendor invoice is posted; its attachments are part of the record.' : null),
  },
  CUSTOMER: { delegate: () => db.customer, read: 'customer.read', write: 'customer.update' },
  SUPPLIER: { delegate: () => db.supplier, read: 'purchase.supplier.read', write: 'purchase.supplier.maintain' },
});

function storage() {
  const url = process.env.STORAGE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new AppError('Storage not configured — set STORAGE_URL and SUPABASE_SERVICE_KEY', 500);
  return { url, headers: { Authorization: `Bearer ${key}`, apikey: key } };
}

/** The document must exist in the caller's tenant, and the caller must hold the permission. */
async function authorise(c: AppContext, entityType: string, entityId: string, need: 'read' | 'write') {
  const rule = ENTITY_RULES[entityType];
  if (!rule) throw new AppError(`Attachments are not kept on ${entityType}`, 400, 'VALIDATION');
  const role = c.get('user')?.role ?? '';
  if (!hasPermission(role, need === 'read' ? rule.read : rule.write)) {
    throw new AppError(`Permission denied: ${need === 'read' ? rule.read : rule.write}`, 403);
  }
  if (!/^[0-9a-f-]{36}$/i.test(entityId)) throw new AppError('entity_id must be a uuid', 400, 'VALIDATION');
  const row = await rule.delegate().findFirst({
    where: { id: entityId, tenant_id: c.get('tenantId') },
    select: { id: true, ...(rule.select ?? {}) },
  });
  if (!row) throw new AppError('Unknown reference for this tenant: entity_id', 422, 'FOREIGN_REFERENCE');
  return { rule, row };
}

/** A file name safe to show and to send back as a download name. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[\x00-\x1f<>:"|?*]/g, '_').trim();
  return (cleaned || 'file').slice(0, 255);
}

const app = new Hono<AppEnv>();

app.get('/', async (c) => {
  const entityType = c.req.query('entity_type') ?? '';
  const entityId = c.req.query('entity_id') ?? '';
  await authorise(c, entityType, entityId, 'read');
  const rows = await db.documentAttachment.findMany({
    where: { tenant_id: c.get('tenantId'), entity_type: entityType, entity_id: entityId, deleted_at: null },
    select: { id: true, file_name: true, mime_type: true, size_bytes: true, uploaded_by: true, uploaded_at: true },
    orderBy: { uploaded_at: 'desc' },
  });
  return ok(c, rows);
});

app.post('/', async (c) => {
  const body = await c.req.parseBody();
  const entityType = String(body.entity_type ?? '');
  const entityId = String(body.entity_id ?? '');
  const file = body.file;
  await authorise(c, entityType, entityId, 'write');

  if (!(file instanceof File)) throw new AppError('No file uploaded', 400, 'VALIDATION');
  if (file.size <= 0) throw new AppError('The file is empty', 400, 'VALIDATION');
  if (file.size > MAX_BYTES) throw new AppError('The file is larger than 10 MB', 413, 'FILE_TOO_LARGE');
  const fileName = cleanFileName(file.name);
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  const mime = ALLOWED_TYPES[ext];
  if (!mime) {
    throw new AppError(`This file type is not allowed. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}`, 415, 'FILE_TYPE_NOT_ALLOWED');
  }

  const tenantId = c.get('tenantId');
  const id = randomUUID();
  // The path carries ids only — never the user's file name.
  const storagePath = `${tenantId}/${entityType}/${entityId}/${id}`;
  const { url, headers } = storage();
  const up = await fetch(`${url}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': mime, 'x-upsert': 'false' },
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!up.ok) throw new AppError(`Storage refused the upload (${up.status})`, 502, 'STORAGE_ERROR');

  const row = await db.documentAttachment.create({
    data: {
      id, tenant_id: tenantId, entity_type: entityType, entity_id: entityId,
      file_name: fileName, mime_type: mime, size_bytes: file.size, storage_path: storagePath,
      uploaded_by: c.get('user')?.id ?? null,
    },
    select: { id: true, file_name: true, mime_type: true, size_bytes: true, uploaded_by: true, uploaded_at: true },
  });
  return created(c, row);
});

async function findAttachment(c: AppContext) {
  const att = await db.documentAttachment.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId'), deleted_at: null },
  });
  if (!att) throw new AppError('Attachment not found', 404);
  return att;
}

app.get('/:id/download', async (c) => {
  const att = await findAttachment(c);
  await authorise(c, att.entity_type, att.entity_id, 'read');
  const { url, headers } = storage();
  const res = await fetch(`${url}/storage/v1/object/sign/${BUCKET}/${att.storage_path}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
  });
  const json: any = await res.json().catch(() => ({}));
  const signed = json.signedURL ?? json.signedUrl;
  if (!res.ok || !signed) throw new AppError(`Storage refused the download (${res.status})`, 502, 'STORAGE_ERROR');
  const download = `${url}/storage/v1${signed}&download=${encodeURIComponent(att.file_name)}`;
  return ok(c, { url: download, expires_in: SIGNED_URL_SECONDS, file_name: att.file_name });
});

app.delete('/:id', async (c) => {
  const att = await findAttachment(c);
  const { rule, row } = await authorise(c, att.entity_type, att.entity_id, 'write');
  const lock = rule.locked?.(row);
  if (lock) throw new AppError(lock, 409, 'ATTACHMENT_LOCKED');
  // Soft: the row keeps who attached what and who removed it; the file stays.
  await db.documentAttachment.updateMany({
    where: { id: att.id, tenant_id: c.get('tenantId'), deleted_at: null },
    data: { deleted_at: new Date(), deleted_by: c.get('user')?.id ?? null },
  });
  return ok(c, null);
});

export default app;
