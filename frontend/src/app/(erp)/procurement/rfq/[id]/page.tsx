'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Send, UserPlus, Gavel, Ban } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/erp/StatusPill';
import { DocumentChain } from '@/components/erp/DocumentChain';
import { PageHeader, TableShell, Th, Td, ErrorNote } from '@/components/erp/PageHeader';
import { cn } from '@/lib/utils';

const money = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2 });

/**
 * The comparison matrix.
 *
 * One row per demand line, one column per vendor. The cheapest received bid per
 * line is marked — as a hint, not a decision, which is why score and lead time
 * sit in the vendor header next to the total. The cheapest bid is routinely not
 * the one a buyer takes.
 */
export default function RfqDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [bidding, setBidding] = useState<string | null>(null);

  const { data: cmp, isLoading } = useQuery({
    queryKey: ['rfq-compare', id],
    queryFn: () => api.get(`/procurement/rfq/${id}/compare`).then((r) => r.data.data),
  });
  const { data: rfq } = useQuery({
    queryKey: ['rfq-case', id],
    queryFn: () => api.get(`/procurement/rfq/${id}`).then((r) => r.data.data),
  });
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-lookup'],
    queryFn: () => api.get('/purchase/suppliers').then((r) => r.data.data),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['rfq-compare', id] });
    qc.invalidateQueries({ queryKey: ['rfq-case', id] });
    qc.invalidateQueries({ queryKey: ['rfq'] });
    setError('');
  };
  const fail = (e: any) => setError(e.response?.data?.error?.message ?? 'Action failed');

  const invite = useMutation({
    mutationFn: (supplier_id: string) => api.post(`/procurement/rfq/${id}/vendors`, { supplier_ids: [supplier_id] }),
    onSuccess: refresh, onError: fail,
  });
  const send = useMutation({ mutationFn: () => api.post(`/procurement/rfq/${id}/send`, {}), onSuccess: refresh, onError: fail });
  const award = useMutation({
    mutationFn: (request_id: string) =>
      api.post(`/procurement/rfq/${id}/award`, { request_id, reject_others: true, reason_code: 'Selected on comparison' }),
    onSuccess: refresh, onError: fail,
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => api.post(`/procurement/rfq/${id}/cancel`, { reason }),
    onSuccess: refresh, onError: fail,
  });

  if (isLoading || !cmp) return <div className="text-caption text-fg-muted">Loading…</div>;

  const invited = new Set(cmp.vendors.map((v: any) => v.supplier_id));
  const open = cmp.status === 'DRAFT' || cmp.status === 'SENT';
  const awardedPo = rfq?.requests?.find((r: any) => r.status === 'ACCEPTED')?.generated_po_id;

  return (
    <div>
      <PageHeader
        title={`RFQ ${cmp.rfq_number}`}
        subtitle={`${cmp.title} · ${cmp.purchase_type.replace(/_/g, ' ').toLowerCase()}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={cmp.status} />
            {cmp.lowest_status && (
              <span className="text-micro text-fg-subtle">
                bids {cmp.lowest_status.toLowerCase()} → {cmp.highest_status.toLowerCase()}
              </span>
            )}
            {open && (
              <select
                className="h-8 rounded-control border border-border bg-surface px-2 text-caption text-fg focus:outline-none focus:ring-1 focus:ring-ring"
                defaultValue=""
                onChange={(e) => { if (e.target.value) { invite.mutate(e.target.value); e.target.value = ''; } }}
              >
                <option value="">Invite vendor…</option>
                {(suppliers ?? []).filter((s: any) => !invited.has(s.id)).map((s: any) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
            )}
            {open && cmp.vendors.length > 0 && (
              <Button size="sm" variant="secondary" disabled={send.isPending} onClick={() => send.mutate()}>
                <Send className="h-3.5 w-3.5" /> Send
              </Button>
            )}
            {open && (
              <Button
                size="sm" variant="ghost"
                onClick={() => { const r = window.prompt('Cancel this tender — reason?'); if (r !== null) cancel.mutate(r); }}
              >
                <Ban className="h-3.5 w-3.5" /> Cancel
              </Button>
            )}
          </div>
        }
      />

      <ErrorNote message={error} />

      <DocumentChain
        className="mb-5"
        steps={[
          {
            label: 'Requisition',
            value: rfq?.requisition?.requisition_number,
            href: rfq?.requisition ? `/procurement/requisitions/${rfq.requisition.id}` : null,
          },
          { label: 'RFQ', value: cmp.rfq_number, current: true },
          {
            label: 'Purchase order',
            value: awardedPo ? 'awarded' : null,
            href: awardedPo ? `/purchase/orders/${awardedPo}` : null,
          },
        ]}
      />

      {cmp.vendors.length === 0 && (
        <div className="rounded-surface border border-border bg-surface px-4 py-8 text-center text-caption text-fg-muted">
          No vendors invited yet. Invite at least two — a tender with one bid is just a purchase order
          with extra steps.
        </div>
      )}

      {cmp.vendors.length > 0 && (
        <>
          <h2 className="mb-2 text-body font-semibold text-fg">Comparison</h2>
          <TableShell className="mb-5">
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>Product</Th>
                <Th className="text-right">Qty</Th>
                {cmp.vendors.map((v: any) => (
                  <Th key={v.request_id} className="text-right">
                    <div className="text-fg">{v.supplier_name}</div>
                    <div className="font-mono font-normal normal-case tracking-normal text-fg-muted">
                      {money(v.total_amount)}
                    </div>
                    <div className="font-normal normal-case tracking-normal text-fg-subtle">
                      {v.score !== null ? `score ${v.score}` : 'unscored'}
                      {v.lead_time_days !== null ? ` · ${v.lead_time_days}d` : ''}
                    </div>
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cmp.lines.map((l: any) => (
                <tr key={l.case_line_id} className="hover:bg-surface-sunken">
                  <Td className="font-mono text-caption">{l.sku}</Td>
                  <Td>{l.name}</Td>
                  <Td className="text-right font-mono text-caption">{l.quantity}</Td>
                  {cmp.vendors.map((v: any) => {
                    const bid = l.bids.find((b: any) => b.request_id === v.request_id);
                    const best = l.best_request_id === v.request_id;
                    return (
                      <Td key={v.request_id} className="text-right">
                        {bid?.unit_price ? (
                          <span
                            className={cn(
                              'inline-flex flex-col items-end rounded-control px-1.5 py-0.5 font-mono text-caption',
                              best && 'bg-success-soft text-success font-semibold',
                              bid.status === 'ACCEPTED' && 'ring-1 ring-accent',
                            )}
                            title={best ? 'Cheapest bid on this line' : undefined}
                          >
                            <span>{money(bid.unit_price)}</span>
                            <span className="text-micro font-normal text-fg-subtle">
                              {money(bid.line_total)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-caption text-fg-subtle">—</span>
                        )}
                      </Td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </TableShell>

          <h2 className="mb-2 text-body font-semibold text-fg">Bids</h2>
          <TableShell>
            <thead>
              <tr>
                <Th>Vendor</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Score</Th>
                <Th className="text-right">Lead time</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cmp.vendors.map((v: any) => (
                <tr key={v.request_id} className="hover:bg-surface-sunken">
                  <Td className="font-medium">{v.supplier_name}</Td>
                  <Td><StatusPill status={v.status} /></Td>
                  <Td className="text-right font-mono text-caption">{money(v.total_amount)}</Td>
                  <Td className="text-right font-mono text-caption text-fg-muted">{v.score ?? '—'}</Td>
                  <Td className="text-right font-mono text-caption text-fg-muted">
                    {v.lead_time_days !== null ? `${v.lead_time_days}d` : '—'}
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {(v.status === 'SENT' || v.status === 'RECEIVED') && (
                        <Button size="sm" variant="secondary" onClick={() => setBidding(v.request_id)}>
                          {v.status === 'RECEIVED' ? 'Edit bid' : 'Enter bid'}
                        </Button>
                      )}
                      {v.status === 'RECEIVED' && (
                        <Button size="sm" disabled={award.isPending} onClick={() => award.mutate(v.request_id)}>
                          <Gavel className="h-3.5 w-3.5" /> Award
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </>
      )}

      {bidding && (
        <BidDialog
          caseLines={cmp.lines}
          existing={cmp.vendors.find((v: any) => v.request_id === bidding)}
          requestId={bidding}
          onClose={() => setBidding(null)}
          onSaved={refresh}
          onError={fail}
        />
      )}
    </div>
  );
}

function BidDialog({
  caseLines, existing, requestId, onClose, onSaved, onError,
}: {
  caseLines: any[]; existing: any; requestId: string;
  onClose: () => void; onSaved: () => void; onError: (e: any) => void;
}) {
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      caseLines.map((l) => {
        const bid = l.bids.find((b: any) => b.request_id === requestId);
        return [l.case_line_id, bid?.unit_price ? String(bid.unit_price) : ''];
      }),
    ),
  );
  const [score, setScore] = useState(existing?.score != null ? String(existing.score) : '');
  const [leadTime, setLeadTime] = useState(existing?.lead_time_days != null ? String(existing.lead_time_days) : '');

  const save = useMutation({
    mutationFn: () =>
      api.post(`/procurement/rfq/bids/${requestId}`, {
        ...(score !== '' && { score: Number(score) }),
        ...(leadTime !== '' && { lead_time_days: Number(leadTime) }),
        lines: caseLines
          .filter((l) => prices[l.case_line_id] !== '')
          .map((l) => ({ case_line_id: l.case_line_id, unit_price: Number(prices[l.case_line_id]) })),
      }),
    onSuccess: () => { onSaved(); onClose(); },
    onError,
  });

  const field = 'h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-surface border border-border bg-surface p-4 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lead font-semibold text-fg">Bid from {existing?.supplier_name}</h2>
        <p className="mb-3 text-caption text-fg-muted">
          Registering a bid marks it received — only a received bid can be awarded.
        </p>

        <div className="space-y-2">
          {caseLines.map((l) => (
            <div key={l.case_line_id} className="flex items-center gap-2">
              <div className="flex-1 truncate text-caption">
                <span className="font-mono text-fg-muted">{l.sku}</span> {l.name}
                <span className="ml-1.5 text-fg-subtle">× {l.quantity}</span>
              </div>
              <input
                className={`${field} w-28`} type="number" min="0" step="0.01" placeholder="unit price"
                value={prices[l.case_line_id]}
                onChange={(e) => setPrices({ ...prices, [l.case_line_id]: e.target.value })}
              />
            </div>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <label className="text-caption text-fg-muted">
            Score (0–100)
            <input className={field} type="number" min="0" max="100" value={score} onChange={(e) => setScore(e.target.value)} />
          </label>
          <label className="text-caption text-fg-muted">
            Lead time (days)
            <input className={field} type="number" min="0" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save bid</Button>
        </div>
      </div>
    </div>
  );
}
