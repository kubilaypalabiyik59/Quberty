'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { StatusPill } from '@/components/erp/StatusPill';
import { PageHeader, TableShell, Th, Td } from '@/components/erp/PageHeader';
import { useMoney } from '@/components/CurrencyProvider';

const today = () => new Date().toISOString().slice(0, 10);

function Field({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div>
      <div className="text-micro uppercase tracking-wide text-fg-muted">{label}</div>
      <div className={`text-body text-fg ${mono ? 'font-mono text-caption' : ''}`}>{value ?? '-'}</div>
    </div>
  );
}

export default function ReturnDetailPage() {
  const { amount: money, quantity: qty, date: day } = useMoney();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [shipRef, setShipRef] = useState('');
  const [banner, setBanner] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-return', id],
    queryFn: () => api.get(`/purchase/returns/${id}`).then(r => r.data),
  });
  const ret = data?.data;

  const refresh = () => qc.invalidateQueries({ queryKey: ['purchase-return', id] });
  const fail = (e: any) => setBanner({ tone: 'bad', text: e?.response?.data?.error?.message ?? 'Action failed.' });

  const ship = useMutation({
    mutationFn: () => api.post(`/purchase/returns/${id}/ship`, { shipped_date: today(), shipment_reference: shipRef || null }).then(r => r.data),
    onSuccess: (r) => { refresh(); setBanner({ tone: 'ok', text: r.data?.journal_entry_id ? 'Shipped and voucher posted.' : 'Shipped. No voucher (no physical lines).' }); },
    onError: fail,
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/purchase/returns/${id}/cancel`).then(r => r.data),
    onSuccess: () => { refresh(); setBanner({ tone: 'ok', text: 'Return cancelled.' }); },
    onError: fail,
  });

  if (isLoading) return <div className="text-caption text-fg-muted">Loading…</div>;
  if (!ret) return <div className="text-caption text-danger">Return not found.</div>;

  const draft = ret.status === 'DRAFT';

  return (
    <div>
      <PageHeader
        title={`Return ${ret.return_number}`}
        subtitle={`${ret.supplier?.name ?? ''} · source ${ret.original_invoice?.invoice_number ?? ''}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill status={ret.status} />
            {draft && (
              <>
                <input
                  value={shipRef}
                  onChange={e => setShipRef(e.target.value)}
                  placeholder="Shipment reference (optional)"
                  className="h-8 rounded-control border border-border bg-surface px-2.5 text-caption text-fg w-52"
                />
                <button
                  onClick={() => ship.mutate()}
                  disabled={ship.isPending}
                  className="h-8 rounded-control border border-accent bg-accent-soft px-3 text-caption font-medium text-accent-onSoft hover:opacity-90 disabled:opacity-50"
                >
                  {ship.isPending ? 'Shipping…' : 'Ship goods'}
                </button>
                <button
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                  className="h-8 rounded-control border border-border bg-surface px-3 text-caption text-fg-muted hover:bg-surface-sunken disabled:opacity-50"
                >
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
        <Field label="Reason" value={ret.reason} />
        <Field label="Requested" value={day(ret.requested_date)} />
        <Field label="Shipped" value={day(ret.shipped_date)} />
        <Field label="Shipment ref" value={ret.shipment_reference} mono />
      </div>

      <h2 className="mb-2 text-body font-semibold text-fg">Lines</h2>
      <TableShell>
        <thead>
          <tr><Th>Item</Th><Th className="text-right">Qty</Th><Th className="text-right">Gross unit</Th><Th className="text-right">Net unit</Th><Th className="text-right">Gross total</Th><Th>Receipt</Th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {ret.lines.map((l: any) => (
            <tr key={l.id} className="hover:bg-surface-sunken">
              <Td><div>{l.original_invoice_line?.product?.name ?? l.original_invoice_line?.description ?? '-'}</div><div className="font-mono text-micro text-fg-muted">{l.original_invoice_line?.product?.sku}</div></Td>
              <Td className="text-right tabular-nums">{qty(l.quantity)}</Td>
              <Td className="text-right tabular-nums">{money(l.frozen_gross_unit_cost)}</Td>
              <Td className="text-right tabular-nums">{money(l.frozen_net_unit_cost)}</Td>
              <Td className="text-right tabular-nums">{money(l.gross_amount)}</Td>
              <Td className="font-mono text-caption text-fg-muted">{l.original_receipt_line?.receipt?.receipt_number ?? '-'}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      <div className="mt-4">
        <Link href="/purchase/returns" className="text-caption text-accent hover:underline">← All supplier returns</Link>
      </div>
    </div>
  );
}
