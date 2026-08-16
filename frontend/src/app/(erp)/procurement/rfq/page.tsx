'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { StatusPill } from '@/components/erp/StatusPill';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows } from '@/components/erp/PageHeader';

const money = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2 });
const STATUSES = ['', 'DRAFT', 'SENT', 'AWARDED', 'CLOSED', 'CANCELLED'];

/**
 * Requests for quotation.
 *
 * The bid column is the point of the whole document: several vendors answering
 * the same demand lines, so their prices are actually comparable.
 */
export default function RfqListPage() {
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['rfq', status],
    queryFn: () => api.get('/procurement/rfq', { params: { ...(status && { status }), limit: 50 } }).then((r) => r.data),
  });

  const rows = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Requests for quotation"
        subtitle="Ask several vendors to price the same lines, compare, then award. Awarding raises the purchase order."
      />

      <div className="mb-3 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
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
            <Th>Title</Th>
            <Th>From requisition</Th>
            <Th className="text-right">Lines</Th>
            <Th>Bids</Th>
            <Th>Deadline</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading && <LoadingRows cols={7} />}
          {!isLoading && rows.length === 0 && (
            <EmptyRow colSpan={7}>
              No tenders. Start one from an approved requisition, or raise a standalone RFQ.
            </EmptyRow>
          )}
          {rows.map((r: any) => (
            <tr key={r.id} className="hover:bg-surface-sunken">
              <Td>
                <Link href={`/procurement/rfq/${r.id}`} className="font-mono text-caption text-accent hover:underline">
                  {r.rfq_number}
                </Link>
              </Td>
              <Td className="max-w-xs truncate">{r.title}</Td>
              <Td className="text-caption text-fg-muted">
                {r.requisition ? (
                  <Link href={`/procurement/requisitions/${r.requisition.id}`} className="font-mono text-accent hover:underline">
                    {r.requisition.requisition_number}
                  </Link>
                ) : '—'}
              </Td>
              <Td className="text-right font-mono text-caption text-fg-muted">{r._count?.lines ?? 0}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {(r.requests ?? []).length === 0 && <span className="text-caption text-fg-subtle">none invited</span>}
                  {(r.requests ?? []).map((q: any) => (
                    <span
                      key={q.id}
                      title={`${q.supplier?.name} — ${money(q.total_amount)}`}
                      className="inline-flex items-center gap-1 rounded-control border border-border bg-surface-sunken px-1.5 py-0.5 text-micro text-fg-muted"
                    >
                      {q.supplier?.name?.split(' ')[0]}
                      <span className="font-mono">{q.status === 'RECEIVED' || q.status === 'ACCEPTED' ? money(q.total_amount) : q.status.toLowerCase()}</span>
                    </span>
                  ))}
                </div>
              </Td>
              <Td className="text-caption text-fg-muted">
                {r.bid_deadline ? new Date(r.bid_deadline).toLocaleDateString() : '—'}
              </Td>
              <Td><StatusPill status={r.status} /></Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}
