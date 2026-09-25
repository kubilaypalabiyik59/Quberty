'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { StatusPill } from '@/components/erp/StatusPill';
import { Dialog } from '@/components/erp/Dialog';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows } from '@/components/erp/PageHeader';
import { useMoney } from '@/components/CurrencyProvider';

const today = () => new Date().toISOString().slice(0, 10);

export default function SupplierCreditsPage() {
  const { amount: money, date: day } = useMoney();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    purchase_return_id: '', credit_date: today(), external_credit_number: '',
    return_line_id: '', quantity: '',
  });
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['supplier-credits'],
    queryFn: () => api.get('/purchase/credits').then(r => r.data),
  });

  const { data: returnsData } = useQuery({
    queryKey: ['purchase-returns-shipped'],
    queryFn: () => api.get('/purchase/returns', { params: { status: 'SHIPPED' } }).then(r => r.data),
  });
  const { data: returnData } = useQuery({
    queryKey: ['purchase-return', form.purchase_return_id],
    queryFn: () => api.get(`/purchase/returns/${form.purchase_return_id}`).then(r => r.data),
    enabled: Boolean(form.purchase_return_id),
  });

  const create = useMutation({
    mutationFn: (body: any) => api.post('/purchase/credits', body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['supplier-credits'] }); setCreating(false); setError(''); },
    onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Could not create the credit.'),
  });

  const rows: any[] = data?.data ?? [];
  const returns: any[] = returnsData?.data ?? [];
  const selectedReturn = returnData?.data;
  const selectedLine = selectedReturn?.lines?.find((line: any) => line.id === form.return_line_id);

  const blocked = !form.purchase_return_id ? 'Select the shipped supplier return.'
    : !form.return_line_id ? 'Select a returned item.'
    : !form.external_credit_number.trim() ? "Enter the supplier's credit-note reference."
    : !form.credit_date ? 'Enter the credit date.'
    : !(Number.isInteger(Number(form.quantity)) && Number(form.quantity) > 0) ? 'Enter a positive integer quantity.'
    : selectedLine && Number(form.quantity) > Number(selectedLine.quantity) ? 'Quantity cannot exceed the returned quantity.'
    : null;

  return (
    <div>
      <PageHeader
        title="Supplier credits"
        subtitle="AP credit notes from suppliers. Posting creates Dr AP / Cr PURCHASE_ACCRUAL / Cr VAT_INPUT and settles the original invoice."
        actions={
          <button
            onClick={() => { setCreating(true); setError(''); setForm({ purchase_return_id: '', credit_date: today(), external_credit_number: '', return_line_id: '', quantity: '' }); }}
            className="h-8 rounded-control border border-accent bg-accent-soft px-3 text-caption font-medium text-accent-onSoft hover:opacity-90"
          >
            New credit
          </button>
        }
      />

      <TableShell>
        <thead>
          <tr>
            <Th>Credit #</Th>
            <Th>Supplier ref</Th>
            <Th>Supplier</Th>
            <Th>Source invoice</Th>
            <Th>Date</Th>
            <Th className="text-right">Total</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading && <LoadingRows cols={8} />}
          {!isLoading && rows.length === 0 && (
            <EmptyRow colSpan={8}>No supplier credits yet. Create one from a posted vendor invoice.</EmptyRow>
          )}
          {rows.map((r: any) => (
            <tr key={r.id} className="hover:bg-surface-sunken">
              <Td className="font-mono text-caption">
                <Link href={`/purchase/credits/${r.id}`} className="text-accent hover:underline">{r.credit_number}</Link>
              </Td>
              <Td className="font-mono text-caption text-fg-muted">{r.external_credit_number ?? '-'}</Td>
              <Td>{r.supplier?.name ?? '-'}</Td>
              <Td className="font-mono text-caption text-fg-muted">{r.original_invoice?.invoice_number ?? '-'}</Td>
              <Td className="text-caption text-fg-muted">{day(r.credit_date)}</Td>
              <Td className="text-right tabular-nums">{money(r.total_amount)}</Td>
              <Td><StatusPill status={r.status} /></Td>
              <Td>
                {r.status === 'DRAFT' && (
                  <Link href={`/purchase/credits/${r.id}`} className="text-caption text-accent hover:underline">Post →</Link>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      {creating && (
        <Dialog
          title="New supplier credit"
          description="Amounts are prorated from the original invoice line. The credit posts Dr AP / Cr PURCHASE_ACCRUAL / Cr VAT_INPUT and auto-settles against the source invoice."
          onClose={() => setCreating(false)}
          error={error}
          blockedReason={blocked}
          submitLabel={create.isPending ? 'Creating…' : 'Create credit'}
          submitting={create.isPending}
          onSubmit={() =>
            create.mutate({
              invoice_id: selectedReturn?.original_invoice_id,
              purchase_return_id: form.purchase_return_id,
              credit_date: form.credit_date,
              external_credit_number: form.external_credit_number || null,
              lines: [{
                invoice_line_id: selectedLine?.original_invoice_line_id,
                return_line_id: form.return_line_id,
                quantity: Number(form.quantity),
              }],
            })
          }
        >
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-caption text-fg-muted">Shipped supplier return *</span>
              <select className="h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg" value={form.purchase_return_id} onChange={e => setForm({ ...form, purchase_return_id: e.target.value, return_line_id: '' })}>
                <option value="">Select return</option>
                {returns.map((ret: any) => (<option key={ret.id} value={ret.id}>{ret.return_number} · {ret.supplier?.name} · {ret.original_invoice?.invoice_number}</option>))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-caption text-fg-muted">Supplier's credit note reference</span>
              <input className="h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg" placeholder="Their fiscal credit-note number" value={form.external_credit_number} onChange={e => setForm({ ...form, external_credit_number: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-caption text-fg-muted">Credit date *</span>
              <input type="date" className="h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg" value={form.credit_date} onChange={e => setForm({ ...form, credit_date: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-caption text-fg-muted">Returned item *</span>
              <select className="h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg" value={form.return_line_id} onChange={e => setForm({ ...form, return_line_id: e.target.value })}>
                <option value="">Select returned item</option>
                {(selectedReturn?.lines ?? []).map((line: any) => (
                  <option key={line.id} value={line.id}>{line.original_invoice_line?.product?.sku ?? 'Item'} · returned {line.quantity}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-caption text-fg-muted">Quantity *</span>
              <input type="number" min="1" step="1" className="h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
            </label>
          </div>
        </Dialog>
      )}
    </div>
  );
}
