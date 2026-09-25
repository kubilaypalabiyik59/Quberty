'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { StatusPill } from '@/components/erp/StatusPill';
import { Dialog } from '@/components/erp/Dialog';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows } from '@/components/erp/PageHeader';
import { useMoney } from '@/components/CurrencyProvider';

export default function SupplierReturnsPage() {
  const { date: day } = useMoney();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const initialInvoiceId = searchParams.get('invoice_id') ?? '';
  const [creating, setCreating] = useState(Boolean(initialInvoiceId));
  const [form, setForm] = useState({
    invoice_id: initialInvoiceId, reason: '', receipt_line_id: '', quantity: '', source_location_id: '',
  });
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-returns'],
    queryFn: () => api.get('/purchase/returns').then(r => r.data),
  });

  const { data: invoicesData } = useQuery({
    queryKey: ['vendor-invoices-posted'],
    queryFn: () => api.get('/purchase/invoices', { params: { status: 'POSTED' } }).then(r => r.data),
  });
  const { data: invoiceData } = useQuery({
    queryKey: ['vendor-invoice', form.invoice_id],
    queryFn: () => api.get(`/purchase/invoices/${form.invoice_id}`).then(r => r.data),
    enabled: Boolean(form.invoice_id),
  });
  const invoice = invoiceData?.data;
  const { data: locationsData } = useQuery({
    queryKey: ['warehouse-locations'],
    queryFn: () => api.get('/warehouse/locations').then(r => r.data),
  });

  const create = useMutation({
    mutationFn: (body: any) => api.post('/purchase/returns', body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase-returns'] }); setCreating(false); setError(''); },
    onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Could not create the return.'),
  });

  const rows: any[] = data?.data ?? [];
  const invoices: any[] = invoicesData?.data ?? [];
  const locations: any[] = locationsData?.data ?? [];
  const selectedLocation = locations.find((location: any) => location.id === form.source_location_id);
  const warehouseId = selectedLocation?.zone?.warehouse_id ?? '';
  const receiptOptions = (invoice?.lines ?? []).flatMap((line: any) =>
    (line.matches ?? []).map((match: any) => ({ line, match, receipt: match.receipt_line })),
  );
  const selectedReceipt = receiptOptions.find((option: any) => option.receipt?.id === form.receipt_line_id);

  const blocked = !form.invoice_id ? 'Select the source invoice.'
    : !form.receipt_line_id ? 'Select a matched product receipt line.'
    : !form.source_location_id ? 'Select the stock location to return from.'
    : !warehouseId ? 'The selected location has no warehouse.'
    : !(Number(form.quantity) >= 1) ? 'Enter a positive integer quantity.'
    : null;

  return (
    <div>
      <PageHeader
        title="Supplier returns"
        subtitle="Physical movement back to the supplier. Creates a ship voucher (Dr PURCHASE_ACCRUAL / Cr INVENTORY) when posted in separate receipt-ledger mode."
        actions={
          <button
            onClick={() => { setCreating(true); setError(''); setForm({ invoice_id: '', reason: '', receipt_line_id: '', quantity: '', source_location_id: '' }); }}
            className="h-8 rounded-control border border-accent bg-accent-soft px-3 text-caption font-medium text-accent-onSoft hover:opacity-90"
          >
            Create from invoice
          </button>
        }
      />

      <TableShell>
        <thead>
          <tr>
            <Th>Return #</Th>
            <Th>Supplier</Th>
            <Th>Source invoice</Th>
            <Th>Lines</Th>
            <Th>Requested</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading && <LoadingRows cols={7} />}
          {!isLoading && rows.length === 0 && (
            <EmptyRow colSpan={7}>No supplier returns yet. Start from a posted vendor invoice.</EmptyRow>
          )}
          {rows.map((r: any) => (
            <tr key={r.id} className="hover:bg-surface-sunken">
              <Td className="font-mono text-caption">
                <Link href={`/purchase/returns/${r.id}`} className="text-accent hover:underline">{r.return_number}</Link>
              </Td>
              <Td>{r.supplier?.name ?? '-'}</Td>
              <Td className="font-mono text-caption text-fg-muted">{r.original_invoice?.invoice_number ?? '-'}</Td>
              <Td>{r.lines?.length ?? 0}</Td>
              <Td className="text-caption text-fg-muted">{day(r.requested_date)}</Td>
              <Td><StatusPill status={r.status} /></Td>
              <Td>
                {r.status === 'DRAFT' && (
                  <Link href={`/purchase/returns/${r.id}`} className="text-caption text-accent hover:underline">Ship →</Link>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      {creating && (
        <Dialog
          title="Create return from invoice"
          description="Only a posted vendor invoice in the ledger currency, with a matched product receipt, is eligible. Select the received item and the location holding the stock."
          onClose={() => setCreating(false)}
          error={error}
          blockedReason={blocked}
          submitLabel={create.isPending ? 'Creating…' : 'Create return'}
          submitting={create.isPending}
          onSubmit={() =>
            create.mutate({
              invoice_id: form.invoice_id,
              warehouse_id: warehouseId,
              reason: form.reason || null,
              lines: [{
                invoice_line_id: selectedReceipt?.line.id,
                receipt_line_id: form.receipt_line_id,
                quantity: Math.round(Number(form.quantity)),
                source_location_id: form.source_location_id,
              }],
            })
          }
        >
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-caption text-fg-muted">Source posted invoice *</span>
              <select
                className="h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg"
                value={form.invoice_id}
                onChange={e => setForm({ ...form, invoice_id: e.target.value, receipt_line_id: '', source_location_id: '' })}
              >
                <option value="">Select invoice</option>
                {invoices.map((i: any) => (
                  <option key={i.id} value={i.id}>{i.invoice_number} – {i.supplier?.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-caption text-fg-muted">Matched receipt line *</span>
              <select className="h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg" value={form.receipt_line_id} onChange={e => setForm({ ...form, receipt_line_id: e.target.value })}>
                <option value="">Select received item</option>
                {receiptOptions.map((option: any) => (
                  <option key={option.receipt.id} value={option.receipt.id}>
                    {option.line.product?.sku ?? 'Item'} · {option.receipt.receipt?.receipt_number} · matched {option.match.quantity}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-caption text-fg-muted">Quantity *</span>
              <input type="number" min="1" step="1" className="h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-caption text-fg-muted">Stock location *</span>
              <select className="h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg" value={form.source_location_id} onChange={e => setForm({ ...form, source_location_id: e.target.value })}>
                <option value="">Select location</option>
                {locations.map((location: any) => <option key={location.id} value={location.id}>{location.code} · {location.zone?.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-caption text-fg-muted">Reason</span>
              <input className="h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
            </label>
          </div>
        </Dialog>
      )}
    </div>
  );
}
