'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Trophy, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/erp/StatusPill';
import { DocumentChain } from '@/components/erp/DocumentChain';
import { PageHeader, TableShell, Th, Td, EmptyRow, ErrorNote } from '@/components/erp/PageHeader';

const money = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2 });

export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [error, setError] = useState('');

  const { data: opp, isLoading } = useQuery({
    queryKey: ['opportunity', id],
    queryFn: () => api.get(`/crm/opportunities/${id}`).then((r) => r.data.data),
  });
  const { data: stages } = useQuery({
    queryKey: ['stages'],
    queryFn: () => api.get('/crm/stages').then((r) => r.data.data),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['opportunity', id] });
    qc.invalidateQueries({ queryKey: ['pipeline'] });
    setError('');
  };
  const fail = (e: any) => setError(e.response?.data?.error?.message ?? 'Action failed');

  const move = useMutation({
    mutationFn: (stage_id: string) => api.post(`/crm/opportunities/${id}/stage`, { stage_id }),
    onSuccess: refresh,
    onError: fail,
  });
  const close = useMutation({
    mutationFn: ({ outcome, reason }: { outcome: string; reason?: string }) =>
      api.post(`/crm/opportunities/${id}/close`, { outcome, reason }),
    onSuccess: refresh,
    onError: fail,
  });

  if (isLoading) return <div className="text-caption text-fg-muted">Loading…</div>;
  if (!opp) return <div className="text-caption text-fg-muted">Opportunity not found.</div>;

  const quote = opp.quotations?.[0];

  return (
    <div>
      <PageHeader
        title={opp.name}
        subtitle={`${opp.opportunity_number} · ${opp.customer ? `${opp.customer.code} ${opp.customer.first_name}` : opp.lead?.company_name ?? ''}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill status={opp.status} />
            {opp.status === 'OPEN' && (
              <>
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => close.mutate({ outcome: 'WON' })}
                  title="Marks the deal won. It does NOT create an order — that comes from confirming a quotation."
                >
                  <Trophy className="h-3.5 w-3.5" /> Won
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const reason = window.prompt('Why was this lost?');
                    if (reason !== null) close.mutate({ outcome: 'LOST', reason });
                  }}
                >
                  <XCircle className="h-3.5 w-3.5" /> Lost
                </Button>
              </>
            )}
          </div>
        }
      />

      <ErrorNote message={error} />

      <DocumentChain
        className="mb-5"
        steps={[
          {
            label: 'Lead',
            value: opp.lead?.lead_number ?? opp.originating_lead?.lead_number,
            href: opp.lead_id || opp.originating_lead_id ? `/crm/leads/${opp.lead_id ?? opp.originating_lead_id}` : null,
          },
          { label: 'Opportunity', value: opp.opportunity_number, current: true },
          {
            label: 'Quotation',
            value: quote?.quotation_number,
            href: quote ? `/sales/quotations/${quote.id}` : null,
          },
          {
            label: 'Sales order',
            value: quote?.converted_order_id ? 'created' : null,
            href: quote?.converted_order_id ? `/sales/orders/${quote.converted_order_id}` : null,
          },
        ]}
      />

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <div className="rounded-surface border border-border bg-surface p-3">
          <div className="mb-2 text-micro font-semibold uppercase tracking-wide text-fg-muted">Value</div>
          <div className="font-mono text-title text-fg">{money(opp.estimated_amount)}</div>
          <div className="mt-0.5 text-micro text-fg-subtle">
            weighted {money((Number(opp.estimated_amount) * opp.probability) / 100)} at {opp.probability}%
          </div>
        </div>

        <div className="rounded-surface border border-border bg-surface p-3">
          <div className="mb-2 text-micro font-semibold uppercase tracking-wide text-fg-muted">Stage</div>
          {opp.status === 'OPEN' ? (
            <select
              value={opp.stage_id ?? ''}
              onChange={(e) => e.target.value && move.mutate(e.target.value)}
              className="h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— unstaged —</option>
              {(stages ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          ) : (
            <div className="text-body text-fg">{opp.stage?.name ?? '—'}</div>
          )}
          <div className="mt-1.5 text-micro text-fg-subtle">
            Moving stage resets probability to the stage default.
          </div>
        </div>

        <div className="rounded-surface border border-border bg-surface p-3">
          <div className="mb-2 text-micro font-semibold uppercase tracking-wide text-fg-muted">Dates</div>
          <dl className="space-y-1.5 text-caption">
            <Row k="Expected close" v={opp.expected_close_date ? new Date(opp.expected_close_date).toLocaleDateString() : null} />
            <Row k="Closed" v={opp.closed_at ? new Date(opp.closed_at).toLocaleDateString() : null} />
            <Row k="Outcome" v={opp.outcome_reason} />
          </dl>
        </div>
      </div>

      <h2 className="mb-2 text-body font-semibold text-fg">Quotations</h2>
      <TableShell>
        <thead>
          <tr>
            <Th>Number</Th>
            <Th>Rev.</Th>
            <Th className="text-right">Total</Th>
            <Th>Valid until</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {(opp.quotations ?? []).length === 0 && (
            <EmptyRow colSpan={5}>
              No quotation yet. A quotation is what turns this estimate into a priced offer — and
              confirming it is what creates the sales order.
            </EmptyRow>
          )}
          {(opp.quotations ?? []).map((q: any) => (
            <tr key={q.id} className="hover:bg-surface-sunken">
              <Td>
                <Link href={`/sales/quotations/${q.id}`} className="font-mono text-caption text-accent hover:underline">
                  {q.quotation_number}
                </Link>
              </Td>
              <Td className="font-mono text-caption text-fg-muted">{q.revision}</Td>
              <Td className="text-right font-mono text-caption">{money(q.total_amount)}</Td>
              <Td className="text-caption text-fg-muted">
                {q.valid_until ? new Date(q.valid_until).toLocaleDateString() : '—'}
              </Td>
              <Td><StatusPill status={q.status} /></Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-fg-muted">{k}</dt>
      <dd className="text-right text-fg">{v || <span className="text-fg-subtle">—</span>}</dd>
    </div>
  );
}
