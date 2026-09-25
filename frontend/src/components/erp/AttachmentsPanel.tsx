'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { can } from '@/lib/access';
import { apiErrorMessage } from '@/components/erp/Dialog';

export type AttachmentEntity =
  | 'LEAD' | 'OPPORTUNITY' | 'SALES_QUOTATION' | 'SALES_ORDER'
  | 'PURCHASE_ORDER' | 'VENDOR_INVOICE' | 'CUSTOMER' | 'SUPPLIER';

/** The permission that lets a user add or remove files on each document (mirrors the API). */
const WRITE_PERMISSION: Record<AttachmentEntity, string> = {
  LEAD: 'crm.lead.maintain',
  OPPORTUNITY: 'crm.opportunity.maintain',
  SALES_QUOTATION: 'sales.quotation.update',
  SALES_ORDER: 'sales.order.update',
  PURCHASE_ORDER: 'purchase.order.update',
  VENDOR_INVOICE: 'purchase.vendor_invoice.create',
  CUSTOMER: 'customer.update',
  SUPPLIER: 'purchase.supplier.maintain',
};

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg';
const MAX_MB = 10;

function size(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Files kept on a business document — the quotation as it was sent, a
 * contract, a signed delivery note. Stored privately; opening one fetches a
 * link that works for a minute.
 */
export function AttachmentsPanel({ entityType, entityId }: { entityType: AttachmentEntity; entityId: string }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const permissions = useAuthStore((s) => s.user?.permissions);
  const canWrite = can(permissions, WRITE_PERMISSION[entityType]);
  const [error, setError] = useState('');
  const key = ['attachments', entityType, entityId];

  const { data, isLoading } = useQuery<Array<{ id: string; file_name: string; mime_type: string; size_bytes: number; uploaded_at: string }>>({
    queryKey: key,
    queryFn: () => api.get('/attachments', { params: { entity_type: entityType, entity_id: entityId } }).then((r) => r.data.data),
    retry: false,
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('entity_type', entityType);
      form.append('entity_id', entityId);
      form.append('file', file);
      return api.post('/attachments', form);
    },
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: key }); },
    onError: (e: any) => setError(apiErrorMessage(e, 'Could not attach the file.')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/attachments/${id}`),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: key }); },
    onError: (e: any) => setError(apiErrorMessage(e, 'Could not remove the file.')),
  });
  const open = async (id: string) => {
    try {
      const { data: r } = await api.get(`/attachments/${id}/download`);
      window.open(r.data.url, '_blank', 'noopener');
    } catch (e: any) {
      setError(apiErrorMessage(e, 'Could not open the file.'));
    }
  };

  const onPick = (file?: File) => {
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) { setError(`The file is larger than ${MAX_MB} MB.`); return; }
    upload.mutate(file);
  };

  const files = data ?? [];
  return (
    <section aria-label="Attachments" className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-body font-semibold text-fg">
          <Paperclip className="h-4 w-4 text-fg-muted" aria-hidden /> Attachments
          <span className="rounded bg-surface-sunken px-1.5 text-micro text-fg-muted">{files.length > 9 ? '9+' : files.length}</span>
        </h2>
        {canWrite && (
          <>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              className="hidden"
              aria-label="Attach a file"
              onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }}
            />
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={upload.isPending}
              className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface px-2.5 py-1 text-caption font-medium text-fg hover:bg-surface-sunken disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden /> {upload.isPending ? 'Uploading…' : 'Attach file'}
            </button>
          </>
        )}
      </div>
      {error && <p role="alert" className="mb-2 text-caption text-danger">{error}</p>}
      <div className="rounded-surface border border-border bg-surface">
        {isLoading && <p className="px-3 py-3 text-caption text-fg-muted">Loading…</p>}
        {!isLoading && files.length === 0 && (
          <p className="px-3 py-3 text-caption text-fg-muted">
            No files yet.{canWrite ? ` PDF, Word, Excel, text or images up to ${MAX_MB} MB.` : ''}
          </p>
        )}
        <ul className="divide-y divide-border">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
              <button type="button" onClick={() => open(f.id)} className="min-w-0 flex-1 truncate text-left text-caption font-medium text-accent hover:underline">
                {f.file_name}
              </button>
              <span className="text-micro text-fg-subtle">{size(f.size_bytes)} · {new Date(f.uploaded_at).toLocaleDateString()}</span>
              <button type="button" aria-label={`Download ${f.file_name}`} onClick={() => open(f.id)} className="rounded p-1 text-fg-muted hover:bg-surface-sunken">
                <Download className="h-3.5 w-3.5" />
              </button>
              {canWrite && (
                <button
                  type="button"
                  aria-label={`Remove ${f.file_name}`}
                  disabled={remove.isPending}
                  onClick={() => { if (window.confirm(`Remove ${f.file_name}?`)) remove.mutate(f.id); }}
                  className="rounded p-1 text-fg-muted hover:bg-surface-sunken hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
