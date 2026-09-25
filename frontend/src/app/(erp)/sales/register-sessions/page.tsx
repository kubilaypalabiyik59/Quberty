'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/components/erp/Dialog';
import { EmptyRow, LoadingRows, PageHeader, TableShell, Td, Th } from '@/components/erp/PageHeader';
import { useMoney } from '@/components/CurrencyProvider';

/**
 * Register sessions (WORK-047): a manager's review of the tills. Each closed session
 * shows what every counted payment method was expected to hold, what was counted and
 * the difference — a difference posted a cash difference voucher.
 */
export default function RegisterSessionsPage() {
  const { money } = useMoney();
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: sessions, isLoading, error } = useQuery({
    queryKey: ['pos-sessions'],
    queryFn: () => api.get('/pos/sessions').then((r) => r.data.data),
  });
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['pos-session', expanded],
    queryFn: () => api.get(`/pos/sessions/${expanded}`).then((r) => r.data.data),
    enabled: !!expanded,
  });

  const when = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');

  return <div>
    <PageHeader title="Register sessions" subtitle="Opened and closed tills, with each payment method's expected, counted and difference amounts." />
    {error && <p className="mb-3 text-body text-danger">{apiErrorMessage(error, 'Could not load the register sessions.')}</p>}
    <TableShell><thead><tr><Th>Terminal</Th><Th>Opened</Th><Th>Closed</Th><Th>Status</Th><Th className="text-right">Opening float</Th><Th className="text-right">Sales</Th><Th className="text-right">Transactions</Th><Th className="text-right">Cash counted</Th></tr></thead>
      <tbody className="divide-y divide-border">
        {isLoading && <LoadingRows cols={8} />}
        {!isLoading && !(sessions ?? []).length && <EmptyRow colSpan={8}>No register has been opened yet.</EmptyRow>}
        {(sessions ?? []).map((s: any) => <Fragment key={s.id}>
          <tr className="cursor-pointer hover:bg-surface-sunken" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
            <Td className="font-mono">{s.terminal_name}</Td><Td>{when(s.opened_at)}</Td><Td>{when(s.closed_at)}</Td>
            <Td>{s.status === 'OPEN' ? 'Open' : 'Closed'}</Td>
            <Td className="text-right">{money(Number(s.opening_float))}</Td>
            <Td className="text-right">{money(Number(s.total_sales))}</Td>
            <Td className="text-right">{s.transaction_count}</Td>
            <Td className="text-right">{s.closing_float == null ? '—' : money(Number(s.closing_float))}</Td>
          </tr>
          {expanded === s.id && <tr><td colSpan={8} className="bg-surface-sunken px-4 py-3">
            {detailLoading && <p className="text-caption text-fg-muted">Loading…</p>}
            {detail && !detail.declarations?.length && <p className="text-caption text-fg-muted">{s.status === 'OPEN' ? 'The register is still open; nothing is declared yet.' : 'This session was closed before declarations were recorded.'}</p>}
            {detail?.declarations?.length > 0 && <table className="w-full text-body">
              <thead><tr className="text-caption text-fg-muted"><th className="text-left py-1">Method</th><th className="text-right">Expected</th><th className="text-right">Counted</th><th className="text-right">Difference</th><th className="text-left pl-4">Difference voucher</th></tr></thead>
              <tbody>{detail.declarations.map((d: any) => {
                const diff = Number(d.difference);
                return <tr key={d.id}>
                  <td className="py-1">{d.payment_method?.code} — {d.payment_method?.name}</td>
                  <td className="text-right">{money(Number(d.expected))}</td>
                  <td className="text-right">{money(Number(d.counted))}</td>
                  <td className={`text-right font-semibold ${diff < 0 ? 'text-danger' : diff > 0 ? 'text-success' : ''}`}>{diff > 0 ? '+' : ''}{money(diff)}</td>
                  <td className="pl-4 font-mono text-caption">{d.journal_entry_id ? d.journal_entry_id.slice(0, 8) : '—'}</td>
                </tr>;
              })}</tbody>
            </table>}
          </td></tr>}
        </Fragment>)}
      </tbody></TableShell>
  </div>;
}
