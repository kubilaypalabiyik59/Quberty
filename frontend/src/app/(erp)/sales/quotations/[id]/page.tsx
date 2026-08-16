'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Send, FilePlus2, CheckCircle2, XCircle, Ban } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/erp/StatusPill';
import { DocumentChain } from '@/components/erp/DocumentChain';
import { PageHeader, TableShell, Th, Td, ErrorNote } from '@/components/erp/PageHeader';

const money = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2 });

/**
 * One quotation.
 *
 * Confirm is the important button: it creates the sales order, links the two
 * documents in both directions, closes the opportunity as won, and — if the
 * quotation was addressed to a lead — converts that lead into a customer first.
 * Everything downstream of the order is untouched by all of this.
 */
export default function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState('');

  const { data: q, isLoading } = useQuery({
    queryKey: ['quotation', id],
    queryFn: () => api.get(`/sales/quotations/${id}`).then((r) => r.data.data),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['quotation', id] });
    qc.invalidateQueries({ queryKey: ['quotations'] });
    setError('');
  };
  const fail = (e: any) => setError(e.response?.data?.error?.message ?? 'Action failed');

  const send = useMutation({ mutationFn: () => api.post(`/sales/quotations/${id}/send`, {}), onSuccess: refresh, onError: fail });
  const revise = useMutation({
    mutationFn: () => api.post(`/sales/quotations/${id}/revise`, {}),
    onSuccess: (r) => { refresh(); router.push(`/sales/quotations/${r.data.data.id}`); },
    onError: fail,
  });
  const confirm = useMutation({
    mutationFn: () => api.post(`/sales/quotations/${id}/confirm`, {}),
    onSuccess: refresh,
    onError: fail,
  });
  const lose = useMutation({
    mutationFn: (reason: string) => api.post(`/sales/quotations/${id}/lose`, { reason }),
    onSuccess: refresh,
    onError: fail,
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => api.post(`/sales/quotations/${id}/cancel`, { reason }),
    onSuccess: refresh,
    onError: fail,
  });

  if (isLoading) return <div className="text-caption text-fg-muted">Loading…</div>;
  if (!q) return <div className="text-caption text-fg-muted">Quotation not found.</div>;

  const editable = q.status === 'DRAFT' || q.status === 'SENT';
  const net = Number(q.subtotal) - Number(q.tax_amount);

  return (
    <div>
      <PageHeader
        title={`Quotation ${q.quotation_number}`}
        subtitle={
          q.customer
            ? `${q.customer.code} · ${q.customer.first_name} ${q.customer.last_name ?? ''}`
            : q.lead
              ? `Prospect ${q.lead.lead_number} · ${q.lead.company_name ?? q.lead.first_name} — not a customer yet`
              : ''
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={q.status} />
            {q.status === 'DRAFT' && (
              <Button size="sm" variant="secondary" disabled={send.isPending} onClick={() => send.mutate()}>
                <Send className="h-3.5 w-3.5" /> Send
              </Button>
            )}
            {editable && (
              <Button size="sm" variant="secondary" disabled={revise.isPending} onClick={() => revise.mutate()}>
                <FilePlus2 className="h-3.5 w-3.5" /> Revise
              </Button>
            )}
            {editable && (
              <Button size="sm" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Confirm → order
              </Button>
            )}
            {editable && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { const r = window.prompt('Why was this lost?'); if (r !== null) lose.mutate(r); }}
                >
                  <XCircle className="h-3.5 w-3.5" /> Lost
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { const r = window.prompt('Cancel this quotation — reason?'); if (r !== null) cancel.mutate(r); }}
                >
                  <Ban className="h-3.5 w-3.5" /> Cancel
                </Button>
              </>
            )}
          </div>
        }
      />

      <ErrorNote message={error} />

      {q.lead && !q.customer && (
        <div className="mb-4 rounded-control border border-info/25 bg-info-soft px-3 py-2 text-caption text-info">
          This quotation is addressed to a <strong>prospect</strong>, not a customer. Confirming it will
          create the customer record automatically before raising the order.
        </div>
      )}

      <DocumentChain
        className="mb-5"
        steps={[
          {
            label: 'Lead',
            value: q.lead?.lead_number,
            href: q.lead ? `/crm/leads/${q.lead.id}` : null,
          },
          {
            label: 'Opportunity',
            value: q.opportunity?.opportunity_number,
            href: q.opportunity ? `/crm/opportunities/${q.opportunity.id}` : null,
          },
          { label: 'Quotation', value: q.quotation_number, current: true },
          {
            label: 'Sales order',
            value: q.converted_order?.order_number,
            href: q.converted_order ? `/sales/orders/${q.converted_order.id}` : null,
          },
        ]}
      />

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <div className="rounded-surface border border-border bg-surface p-3">
          <div className="mb-2 text-micro font-semibold uppercase tracking-wide text-fg-muted">Amounts</div>
          <dl className="space-y-1.5 text-caption">
            <Row k="Net" v={money(net)} mono />
            <Row k="IVA 13% (included)" v={money(q.tax_amount)} mono />
            <Row k="Gross" v={money(q.subtotal)} mono />
            {Number(q.discount_amount) > 0 && <Row k="Discount" v={`− ${money(q.discount_amount)}`} mono />}
            <div className="flex justify-between gap-3 border-t border-border pt-1.5 font-semibold">
              <dt className="text-fg">Total</dt>
              <dd className="font-mono text-fg">{money(q.total_amount)} {q.currency}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-surface border border-border bg-surface p-3">
          <div className="mb-2 text-micro font-semibold uppercase tracking-wide text-fg-muted">Validity</div>
          <dl className="space-y-1.5 text-caption">
            <Row k="Quoted" v={new Date(q.quotation_date).toLocaleDateString()} />
            <Row k="Valid until" v={q.valid_until ? new Date(q.valid_until).toLocaleDateString() : null} />
            <Row k="Sent" v={q.sent_at ? new Date(q.sent_at).toLocaleDateString() : null} />
            <Row k="Confirmed" v={q.confirmed_at ? new Date(q.confirmed_at).toLocaleDateString() : null} />
          </dl>
        </div>

        <div className="rounded-surface border border-border bg-surface p-3">
          <div className="mb-2 text-micro font-semibold uppercase tracking-wide text-fg-muted">Revision</div>
          <dl className="space-y-1.5 text-caption">
            <Row k="This revision" v={String(q.revision)} />
            <Row
              k="Supersedes"
              v={
                q.revised_from ? (
                  <Link href={`/sales/quotations/${q.revised_from.id}`} className="font-mono text-accent hover:underline">
                    {q.revised_from.quotation_number}
                  </Link>
                ) : null
              }
            />
            <Row
              k="Superseded by"
              v={
                q.revisions?.length ? (
                  <Link href={`/sales/quotations/${q.revisions[0].id}`} className="font-mono text-accent hover:underline">
                    {q.revisions[0].quotation_number}
                  </Link>
                ) : null
              }
            />
            <Row k="Outcome" v={q.outcome_reason} />
          </dl>
          <p className="mt-2 text-micro text-fg-subtle">
            A revision is a new document. The previous offer stays readable exactly as it was sent.
          </p>
        </div>
      </div>

      <h2 className="mb-2 text-body font-semibold text-fg">Lines</h2>
      <TableShell>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>SKU</Th>
            <Th>Product</Th>
            <Th className="text-right">Qty</Th>
            <Th className="text-right">Unit price</Th>
            <Th className="text-right">Disc.</Th>
            <Th className="text-right">Line total</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {(q.lines ?? []).map((l: any, i: number) => (
            <tr key={l.id} className="hover:bg-surface-sunken">
              <Td className="font-mono text-caption text-fg-muted">{i + 1}</Td>
              <Td className="font-mono text-caption">{l.product?.sku}</Td>
              <Td>{l.product?.name}</Td>
              <Td className="text-right font-mono text-caption">{Number(l.quantity)}</Td>
              <Td className="text-right font-mono text-caption">{money(l.unit_price)}</Td>
              <Td className="text-right font-mono text-caption text-fg-muted">
                {Number(l.discount_pct) ? `${Number(l.discount_pct)}%` : '—'}
              </Td>
              <Td className="text-right font-mono text-caption">{money(l.line_total)}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: any; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-fg-muted">{k}</dt>
      <dd className={`text-right text-fg ${mono ? 'font-mono' : ''}`}>
        {v || <span className="text-fg-subtle">—</span>}
      </dd>
    </div>
  );
}
