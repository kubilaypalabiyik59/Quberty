'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { StatusPill } from '@/components/erp/StatusPill';
import { DocumentChain } from '@/components/erp/DocumentChain';
import { PageHeader, TableShell, Th, Td, EmptyRow } from '@/components/erp/PageHeader';

/**
 * One lead, and everything downstream of it.
 *
 * `originated` is the list that matters after qualification: those opportunities
 * are addressed to the CUSTOMER now, and would be invisible from here if the
 * origin were not recorded in its own column (migration 006).
 */
export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', id],
    queryFn: () => api.get(`/crm/leads/${id}`).then((r) => r.data.data),
  });

  if (isLoading) return <div className="text-caption text-fg-muted">Loading…</div>;
  if (!lead) return <div className="text-caption text-fg-muted">Lead not found.</div>;

  const opportunities = [...(lead.originated ?? []), ...(lead.opportunities ?? [])];
  const firstOpp = opportunities[0];

  // A quotation raised BEFORE qualification is addressed to the lead; one raised
  // after is addressed to the customer and hangs off the opportunity. The chain
  // has to follow both routes or it under-reports what actually happened.
  const oppQuotes = opportunities.flatMap((o: any) => o.quotations ?? []);
  const allQuotes = [...(lead.quotations ?? []), ...oppQuotes];
  const firstQuote = allQuotes[0];
  const orderId = allQuotes.find((q: any) => q.converted_order_id)?.converted_order_id;

  return (
    <div>
      <PageHeader
        title={lead.company_name || `${lead.first_name} ${lead.last_name ?? ''}`.trim()}
        subtitle={`${lead.lead_number} · ${lead.source} · ${lead.rating}`}
        actions={<StatusPill status={lead.status} />}
      />

      <DocumentChain
        className="mb-5"
        steps={[
          { label: 'Lead', value: lead.lead_number, current: true },
          {
            label: 'Opportunity',
            value: firstOpp?.opportunity_number,
            href: firstOpp ? `/crm/opportunities/${firstOpp.id}` : null,
          },
          {
            label: 'Quotation',
            value: firstQuote?.quotation_number,
            href: firstQuote ? `/sales/quotations/${firstQuote.id}` : null,
          },
          {
            label: 'Sales order',
            value: orderId ? 'created' : null,
            href: orderId ? `/sales/orders/${orderId}` : null,
          },
        ]}
      />

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <Facts
          title="Contact"
          rows={[
            ['Name', [lead.first_name, lead.last_name].filter(Boolean).join(' ')],
            ['Email', lead.email],
            ['Phone', lead.phone],
            ['City', [lead.city, lead.country].filter(Boolean).join(', ')],
          ]}
        />
        <Facts
          title="Qualification"
          rows={[
            ['Status', lead.status],
            ['Qualified', lead.qualified_at ? new Date(lead.qualified_at).toLocaleDateString() : null],
            ['Disqualified', lead.disqualified_at ? new Date(lead.disqualified_at).toLocaleDateString() : null],
            ['Reason', lead.disqualify_reason],
          ]}
        />
        <Facts
          title="Conversion"
          rows={[
            ['Customer', lead.converted_customer ? `${lead.converted_customer.code}` : null],
            ['Estimated', lead.estimated_amount ? Number(lead.estimated_amount).toLocaleString('es-BO', { minimumFractionDigits: 2 }) : null],
            ['Currency', lead.currency],
            ['Created', new Date(lead.created_at).toLocaleDateString()],
          ]}
        />
      </div>

      <h2 className="mb-2 text-body font-semibold text-fg">Opportunities from this lead</h2>
      <TableShell className="mb-5">
        <thead>
          <tr>
            <Th>Number</Th>
            <Th>Name</Th>
            <Th>Addressed to</Th>
            <Th className="text-right">Estimated</Th>
            <Th className="text-right">Probability</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {opportunities.length === 0 && <EmptyRow colSpan={6}>No opportunities yet.</EmptyRow>}
          {opportunities.map((o: any) => (
            <tr key={o.id} className="hover:bg-surface-sunken">
              <Td>
                <Link href={`/crm/opportunities/${o.id}`} className="font-mono text-caption text-accent hover:underline">
                  {o.opportunity_number}
                </Link>
              </Td>
              <Td>{o.name}</Td>
              <Td className="text-caption text-fg-muted">
                {o.customer ? `${o.customer.code} ${o.customer.first_name}` : 'this lead'}
              </Td>
              <Td className="text-right font-mono text-caption">
                {Number(o.estimated_amount).toLocaleString('es-BO', { minimumFractionDigits: 2 })}
              </Td>
              <Td className="text-right font-mono text-caption">{o.probability}%</Td>
              <Td><StatusPill status={o.status} /></Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      <h2 className="mb-2 text-body font-semibold text-fg">Quotations</h2>
      <TableShell>
        <thead>
          <tr>
            <Th>Number</Th>
            <Th className="text-right">Total</Th>
            <Th>Valid until</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {allQuotes.length === 0 && <EmptyRow colSpan={4}>No quotations raised for this lead.</EmptyRow>}
          {allQuotes.map((q: any) => (
            <tr key={q.id} className="hover:bg-surface-sunken">
              <Td>
                <Link href={`/sales/quotations/${q.id}`} className="font-mono text-caption text-accent hover:underline">
                  {q.quotation_number}
                </Link>
              </Td>
              <Td className="text-right font-mono text-caption">
                {Number(q.total_amount).toLocaleString('es-BO', { minimumFractionDigits: 2 })}
              </Td>
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

function Facts({ title, rows }: { title: string; rows: [string, any][] }) {
  return (
    <div className="rounded-surface border border-border bg-surface p-3">
      <div className="mb-2 text-micro font-semibold uppercase tracking-wide text-fg-muted">{title}</div>
      <dl className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 text-caption">
            <dt className="text-fg-muted">{k}</dt>
            <dd className="text-right text-fg">{v || <span className="text-fg-subtle">—</span>}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
