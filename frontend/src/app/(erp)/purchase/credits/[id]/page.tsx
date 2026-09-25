'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { StatusPill } from '@/components/erp/StatusPill';
import { PageHeader, TableShell, Th, Td } from '@/components/erp/PageHeader';
import { useMoney } from '@/components/CurrencyProvider';

function Field({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div>
      <div className="text-micro uppercase tracking-wide text-fg-muted">{label}</div>
      <div className={`text-body text-fg ${mono ? 'font-mono text-caption' : ''}`}>{value ?? '-'}</div>
    </div>
  );
}

export default function CreditDetailPage() {
  const { amount: money, quantity: qty, date: day } = useMoney();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [banner, setBanner] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['supplier-credit', id],
    queryFn: () => api.get(`/purchase/credits/${id}`).then(r => r.data),
  });
  const credit = data?.data;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['supplier-credit', id] });
    qc.invalidateQueries({ queryKey: ['supplier-credits'] });
    qc.invalidateQueries({ queryKey: ['vendor-invoices'] });
  };
  const fail = (e: any) => setBanner({ tone: 'bad', text: e?.response?.data?.error?.message ?? 'Action failed.' });

  const post = useMutation({
    mutationFn: () => api.post(`/purchase/credits/${id}/post`).then(r => r.data),
    onSuccess: (r) => { refresh(); setBanner({ tone: 'ok', text: `Posted. Voucher ${r.data?.journal_entry_id ?? ''} created and invoice settled.` }); },
    onError: fail,
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/purchase/credits/${id}/cancel`).then(r => r.data),
    onSuccess: () => { refresh(); setBanner({ tone: 'ok', text: 'Credit cancelled.' }); },
    onError: fail,
  });

  if (isLoading) return <div className="text-caption text-fg-muted">Loading…</div>;
  if (!credit) return <div className="text-caption text-danger">Credit not found.</div>;

  const draft = credit.status === 'DRAFT';

  return (
    <div>
      <PageHeader
        title={`Credit ${credit.credit_number}`}
        subtitle={`${credit.supplier?.name ?? ''} · source ${credit.original_invoice?.invoice_number ?? ''}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill status={credit.status} />
            {draft && (
              <>
                <button onClick={() => post.mutate()} disabled={post.isPending}
                  className="h-8 rounded-control border border-accent bg-accent-soft px-3 text-caption font-medium text-accent-onSoft hover:opacity-90 disabled:opacity-50">
                  {post.isPending ? 'Posting…' : 'Post credit'}
                </button>
                <button onClick={() => cancel.mutate()} disabled={cancel.isPending}
                  className="h-8 rounded-control border border-border bg-surface px-3 text-caption text-fg-muted hover:bg-surface-sunken disabled:opacity-50">
                  Cancel
                </button>
              </>
            )}
          </div>
        }
      />

      {banner && (
        <div className={`mb-4 rounded-surface border px-3 py-2 text-caption ${banner.tone === 'ok' ? 'border-success/25 bg-success-soft text-success' : 'border-danger/25 bg-danger-soft text-danger'}`} role="alert">
          {banner.text}
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 rounded-surface border border-border bg-surface p-4 md:grid-cols-4">
        <Field label="Supplier ref" value={credit.external_credit_number} mono />
        <Field label="Credit date" value={day(credit.credit_date)} />
        <Field label="Posting date" value={day(credit.posting_date)} />
        <Field label="Linked return" value={credit.purchase_return?.return_number} mono />
        <Field label="Net" value={money(credit.net_amount)} />
        <Field label="Recoverable tax" value={money(credit.tax_amount)} />
        <Field label="Total" value={<strong>{money(credit.total_amount)}</strong>} />
        <Field label="Posted" value={day(credit.posted_at)} />
      </div>

      <h2 className="mb-2 text-body font-semibold text-fg">Lines</h2>
      <TableShell>
        <thead>
          <tr><Th>Item</Th><Th className="text-right">Qty</Th><Th className="text-right">Unit price</Th><Th className="text-right">Net</Th><Th className="text-right">Tax</Th><Th className="text-right">Gross</Th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {credit.lines.map((l: any) => (
            <tr key={l.id} className="hover:bg-surface-sunken">
              <Td><div>{l.original_invoice_line?.product?.name ?? l.description ?? '-'}</div><div className="font-mono text-micro text-fg-muted">{l.original_invoice_line?.product?.sku}</div></Td>
              <Td className="text-right tabular-nums">{qty(l.quantity)}</Td>
              <Td className="text-right tabular-nums">{money(l.unit_price)}</Td>
              <Td className="text-right tabular-nums">{money(l.net_amount)}</Td>
              <Td className="text-right tabular-nums">{money(l.tax_amount)}</Td>
              <Td className="text-right tabular-nums">{money(l.gross_amount)}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      <div className="mt-4">
        <Link href="/purchase/credits" className="text-caption text-accent hover:underline">← All supplier credits</Link>
      </div>
    </div>
  );
}
