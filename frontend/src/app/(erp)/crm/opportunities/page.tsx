'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { StatusPill } from '@/components/erp/StatusPill';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows } from '@/components/erp/PageHeader';

/**
 * The pipeline.
 *
 * The weighted figure is Σ(estimated × probability) over open deals. It is the
 * one number a pipeline exists to produce, and it is computable only because the
 * probability rides on the opportunity row rather than being inferred from a
 * stage name — which is also why the stages themselves are ordinary data the
 * tenant can rename.
 */
const money = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function OpportunitiesPage() {
  const [status, setStatus] = useState('OPEN');

  const { data: pipeline } = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => api.get('/crm/opportunities/pipeline').then((r) => r.data.data),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['opportunities', status],
    queryFn: () =>
      api.get('/crm/opportunities', { params: { ...(status && { status }), limit: 50 } }).then((r) => r.data),
  });

  const rows = data?.data ?? [];
  const stages = pipeline?.stages ?? [];
  const maxTotal = Math.max(1, ...stages.map((s: any) => s.total));

  return (
    <div>
      <PageHeader
        title="Opportunities"
        subtitle="Qualified deals. Stages are tenant data — rename or reorder them under Settings."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open pipeline" value={money(pipeline?.total)} hint={`${rows.length} shown`} />
        <Stat label="Weighted" value={money(pipeline?.weighted)} hint="Σ value × probability" />
        <Stat label="Stages configured" value={String(stages.length)} hint="editable, not hardcoded" />
        <Stat label="Unstaged" value={money(pipeline?.unstaged?.total)} hint={`${pipeline?.unstaged?.count ?? 0} deals`} />
      </div>

      {stages.length > 0 && (
        <div className="mb-5 rounded-surface border border-border bg-surface p-3">
          <div className="mb-2.5 text-micro font-semibold uppercase tracking-wide text-fg-muted">
            Pipeline by stage
          </div>
          <div className="space-y-2">
            {stages.map((s: any) => (
              <div key={s.stage_id} className="flex items-center gap-3">
                <div className="w-32 shrink-0 truncate text-caption text-fg">{s.name}</div>
                <div className="h-2 flex-1 overflow-hidden rounded-control bg-surface-sunken">
                  <div
                    className="h-full rounded-control bg-accent transition-all duration-base"
                    style={{ width: `${(s.total / maxTotal) * 100}%` }}
                  />
                </div>
                <div className="w-16 shrink-0 text-right font-mono text-caption text-fg-muted">{s.count}</div>
                <div className="w-28 shrink-0 text-right font-mono text-caption text-fg">{money(s.total)}</div>
                <div className="w-28 shrink-0 text-right font-mono text-caption text-fg-muted">{money(s.weighted)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        {['', 'OPEN', 'WON', 'LOST', 'CANCELLED'].map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatus(s)}
            className={`h-8 rounded-control border px-2.5 text-caption transition-colors duration-quick ${
              status === s
                ? 'border-accent bg-accent-soft text-accent-onSoft font-medium'
                : 'border-border bg-surface text-fg-muted hover:bg-surface-sunken'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      <TableShell>
        <thead>
          <tr>
            <Th>Number</Th>
            <Th>Name</Th>
            <Th>Customer</Th>
            <Th>Stage</Th>
            <Th className="text-right">Estimated</Th>
            <Th className="text-right">Prob.</Th>
            <Th className="text-right">Weighted</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading && <LoadingRows cols={8} />}
          {!isLoading && rows.length === 0 && (
            <EmptyRow colSpan={8}>No opportunities. Qualify a lead to create one.</EmptyRow>
          )}
          {rows.map((o: any) => (
            <tr key={o.id} className="hover:bg-surface-sunken">
              <Td>
                <Link href={`/crm/opportunities/${o.id}`} className="font-mono text-caption text-accent hover:underline">
                  {o.opportunity_number}
                </Link>
              </Td>
              <Td className="max-w-xs truncate">{o.name}</Td>
              <Td className="text-caption text-fg-muted">
                {o.customer ? `${o.customer.first_name} ${o.customer.last_name}` : o.lead?.company_name ?? '—'}
              </Td>
              <Td className="text-caption text-fg-muted">{o.stage?.name ?? '—'}</Td>
              <Td className="text-right font-mono text-caption">{money(o.estimated_amount)}</Td>
              <Td className="text-right font-mono text-caption">{o.probability}%</Td>
              <Td className="text-right font-mono text-caption text-fg-muted">
                {money((Number(o.estimated_amount) * o.probability) / 100)}
              </Td>
              <Td><StatusPill status={o.status} /></Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-surface border border-border bg-surface p-3">
      <div className="text-micro font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="mt-1 font-mono text-title text-fg">{value}</div>
      {hint && <div className="mt-0.5 text-micro text-fg-subtle">{hint}</div>}
    </div>
  );
}
