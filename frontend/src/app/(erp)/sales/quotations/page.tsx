'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { StatusPill } from '@/components/erp/StatusPill';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows } from '@/components/erp/PageHeader';

/**
 * Quotations — the last document before the order.
 *
 * Listing them also expires the overdue ones: this product has no job runner,
 * so a SENT quotation past its validity date is moved to EXPIRED when somebody
 * looks. For an offer, "soon enough" genuinely is soon enough.
 */
const money = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2 });
const STATUSES = ['', 'DRAFT', 'SENT', 'CONFIRMED', 'REVISED', 'LOST', 'EXPIRED', 'CANCELLED'];

export default function QuotationsPage() {
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['quotations', status],
    queryFn: () =>
      api.get('/sales/quotations', { params: { ...(status && { status }), limit: 50 } }).then((r) => r.data),
  });

  const rows = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Quotations"
        subtitle="A priced offer. Confirming one creates the sales order and links the two."
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
            <Th>Rev.</Th>
            <Th>Quoted to</Th>
            <Th>Opportunity</Th>
            <Th className="text-right">Lines</Th>
            <Th className="text-right">Total</Th>
            <Th>Valid until</Th>
            <Th>Status</Th>
            <Th>Became</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading && <LoadingRows cols={9} />}
          {!isLoading && rows.length === 0 && (
            <EmptyRow colSpan={9}>
              No quotations. Raise one from an opportunity, or directly for a customer or a lead.
            </EmptyRow>
          )}
          {rows.map((q: any) => (
            <tr key={q.id} className="hover:bg-surface-sunken">
              <Td>
                <Link href={`/sales/quotations/${q.id}`} className="font-mono text-caption text-accent hover:underline">
                  {q.quotation_number}
                </Link>
              </Td>
              <Td className="font-mono text-caption text-fg-muted">{q.revision}</Td>
              <Td>
                {q.customer ? (
                  <span>{q.customer.first_name} {q.customer.last_name}</span>
                ) : q.lead ? (
                  <span>
                    {q.lead.company_name ?? q.lead.first_name}
                    <span className="ml-1.5 rounded-control border border-warning/25 bg-warning-soft px-1.5 py-0.5 text-micro font-medium uppercase text-warning">
                      prospect
                    </span>
                  </span>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </Td>
              <Td className="text-caption text-fg-muted">{q.opportunity?.opportunity_number ?? '—'}</Td>
              <Td className="text-right font-mono text-caption text-fg-muted">{q._count?.lines ?? 0}</Td>
              <Td className="text-right font-mono text-caption">{money(q.total_amount)}</Td>
              <Td className="text-caption text-fg-muted">
                {q.valid_until ? new Date(q.valid_until).toLocaleDateString() : '—'}
              </Td>
              <Td><StatusPill status={q.status} /></Td>
              <Td className="text-caption">
                {q.converted_order ? (
                  <Link href={`/sales/orders/${q.converted_order.id}`} className="font-mono text-accent hover:underline">
                    {q.converted_order.order_number}
                  </Link>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}
