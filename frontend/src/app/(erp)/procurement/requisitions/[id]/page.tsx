'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Send, ThumbsUp, ThumbsDown, Truck, Gavel } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/erp/StatusPill';
import { DocumentChain } from '@/components/erp/DocumentChain';
import { PageHeader, TableShell, Th, Td, EmptyRow, ErrorNote } from '@/components/erp/PageHeader';

const money = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2 });

/**
 * One requisition.
 *
 * The line table carries its own status column because that is where the real
 * decisions happen: approving four of five requested lines is ordinary, and the
 * header status is derived from what the lines say — never set directly.
 */
export default function RequisitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const { data: req, isLoading } = useQuery({
    queryKey: ['requisition', id],
    queryFn: () => api.get(`/procurement/requisitions/${id}`).then((r) => r.data.data),
  });
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-lookup'],
    queryFn: () => api.get('/purchase/suppliers').then((r) => r.data.data),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['requisition', id] });
    qc.invalidateQueries({ queryKey: ['requisitions'] });
    setSelected([]);
    setError('');
  };
  const fail = (e: any) => setError(e.response?.data?.error?.message ?? 'Action failed');

  const submit = useMutation({ mutationFn: () => api.post(`/procurement/requisitions/${id}/submit`, {}), onSuccess: refresh, onError: fail });
  const approve = useMutation({
    mutationFn: () => api.post(`/procurement/requisitions/${id}/approve`, selected.length ? { line_ids: selected } : {}),
    onSuccess: refresh, onError: fail,
  });
  const reject = useMutation({
    mutationFn: (reason: string) =>
      api.post(`/procurement/requisitions/${id}/reject`, { ...(selected.length ? { line_ids: selected } : {}), reason }),
    onSuccess: refresh, onError: fail,
  });
  const toPo = useMutation({
    mutationFn: (supplier_id: string) =>
      api.post(`/procurement/requisitions/${id}/purchase-order`, {
        supplier_id,
        ...(selected.length ? { line_ids: selected } : {}),
      }),
    onSuccess: refresh, onError: fail,
  });
  const toRfq = useMutation({
    mutationFn: () => api.post(`/procurement/requisitions/${id}/rfq`, {}),
    onSuccess: (r) => { refresh(); router.push(`/procurement/rfq/${r.data.data.id}`); },
    onError: fail,
  });

  if (isLoading) return <div className="text-caption text-fg-muted">Loading…</div>;
  if (!req) return <div className="text-caption text-fg-muted">Requisition not found.</div>;

  const lines = req.lines ?? [];
  const inReview = lines.filter((l: any) => l.status === 'IN_REVIEW');
  const approved = lines.filter((l: any) => l.status === 'APPROVED');
  const firstRfq = req.rfq_cases?.[0];
  const firstPo = req.purchase_orders?.[0];

  return (
    <div>
      <PageHeader
        title={`Requisition ${req.requisition_number}`}
        subtitle={`${req.purpose} · ${req.warehouse?.code ?? 'no warehouse'} · estimated ${money(req.estimated_total)} ${req.currency}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={req.status} />
            {req.status === 'DRAFT' && (
              <Button size="sm" disabled={submit.isPending} onClick={() => submit.mutate()}>
                <Send className="h-3.5 w-3.5" /> Submit
              </Button>
            )}
            {inReview.length > 0 && (
              <>
                <Button size="sm" variant="success" disabled={approve.isPending} onClick={() => approve.mutate()}>
                  <ThumbsUp className="h-3.5 w-3.5" />
                  Approve {selected.length ? `${selected.length} line(s)` : 'all'}
                </Button>
                <Button
                  size="sm" variant="ghost"
                  onClick={() => { const r = window.prompt('Rejection reason?'); if (r !== null) reject.mutate(r); }}
                >
                  <ThumbsDown className="h-3.5 w-3.5" /> Reject
                </Button>
              </>
            )}
            {(inReview.length > 0 || approved.length > 0) && (
              <Button size="sm" variant="secondary" disabled={toRfq.isPending} onClick={() => toRfq.mutate()}>
                <Gavel className="h-3.5 w-3.5" /> Send to tender
              </Button>
            )}
            {approved.length > 0 && (
              <select
                className="h-8 rounded-control border border-border bg-surface px-2 text-caption text-fg focus:outline-none focus:ring-1 focus:ring-ring"
                defaultValue=""
                onChange={(e) => { if (e.target.value) { toPo.mutate(e.target.value); e.target.value = ''; } }}
              >
                <option value="">Create PO from supplier…</option>
                {(suppliers ?? []).map((s: any) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
            )}
          </div>
        }
      />

      <ErrorNote message={error} />

      <DocumentChain
        className="mb-5"
        steps={[
          { label: 'Requisition', value: req.requisition_number, current: true },
          { label: 'RFQ', value: firstRfq?.rfq_number, href: firstRfq ? `/procurement/rfq/${firstRfq.id}` : null },
          { label: 'Purchase order', value: firstPo?.po_number, href: firstPo ? `/purchase/orders/${firstPo.id}` : null },
          { label: 'Receipt', value: firstPo?.status === 'RECEIVED' ? 'received' : null },
        ]}
      />

      {inReview.length > 0 && (
        <div className="mb-4 rounded-control border border-info/25 bg-info-soft px-3 py-2 text-caption text-info">
          Tick individual lines to approve or reject only those. With nothing ticked, the action
          applies to every line still in review.
        </div>
      )}

      <h2 className="mb-2 text-body font-semibold text-fg">Lines</h2>
      <TableShell className="mb-5">
        <thead>
          <tr>
            <Th className="w-8" />
            <Th>SKU</Th>
            <Th>Product</Th>
            <Th className="text-right">Qty</Th>
            <Th className="text-right">Est. unit cost</Th>
            <Th className="text-right">Line total</Th>
            <Th>Preferred supplier</Th>
            <Th>Status</Th>
            <Th>Fulfilled by</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lines.length === 0 && <EmptyRow colSpan={9}>No lines.</EmptyRow>}
          {lines.map((l: any) => (
            <tr key={l.id} className="hover:bg-surface-sunken">
              <Td>
                {(l.status === 'IN_REVIEW' || l.status === 'APPROVED') && (
                  <input
                    type="checkbox"
                    checked={selected.includes(l.id)}
                    onChange={(e) =>
                      setSelected(e.target.checked ? [...selected, l.id] : selected.filter((x) => x !== l.id))
                    }
                    className="h-3.5 w-3.5 rounded border-border accent-accent"
                  />
                )}
              </Td>
              <Td className="font-mono text-caption">{l.product?.sku}</Td>
              <Td>{l.product?.name}</Td>
              <Td className="text-right font-mono text-caption">{Number(l.quantity)}</Td>
              <Td className="text-right font-mono text-caption">{money(l.estimated_unit_cost)}</Td>
              <Td className="text-right font-mono text-caption">{money(l.line_total)}</Td>
              <Td className="text-caption text-fg-muted">{l.preferred_supplier?.name ?? '—'}</Td>
              <Td><StatusPill status={l.status} /></Td>
              <Td className="text-caption text-fg-muted">{l.fulfilled_by_type ?? '—'}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-body font-semibold text-fg">Purchase orders raised</h2>
          <TableShell>
            <thead>
              <tr><Th>Number</Th><Th>Supplier</Th><Th>Via</Th><Th className="text-right">Total</Th><Th>Status</Th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(req.purchase_orders ?? []).length === 0 && <EmptyRow colSpan={5}>None yet.</EmptyRow>}
              {(req.purchase_orders ?? []).map((p: any) => (
                <tr key={p.id} className="hover:bg-surface-sunken">
                  <Td>
                    <Link href={`/purchase/orders/${p.id}`} className="font-mono text-caption text-accent hover:underline">
                      {p.po_number}
                    </Link>
                  </Td>
                  <Td className="text-caption text-fg-muted">{p.supplier?.name}</Td>
                  {/* Direct, or via a tender — both are reachable from here. */}
                  <Td className="text-caption text-fg-muted">
                    {p.source_document_type === 'RFQ' ? 'tender' : 'direct'}
                  </Td>
                  <Td className="text-right font-mono text-caption">{money(p.total_amount)}</Td>
                  <Td><StatusPill status={p.status} /></Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>

        <div>
          <h2 className="mb-2 text-body font-semibold text-fg">Tenders</h2>
          <TableShell>
            <thead>
              <tr><Th>Number</Th><Th>Title</Th><Th>Status</Th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(req.rfq_cases ?? []).length === 0 && <EmptyRow colSpan={3}>None yet.</EmptyRow>}
              {(req.rfq_cases ?? []).map((r: any) => (
                <tr key={r.id} className="hover:bg-surface-sunken">
                  <Td>
                    <Link href={`/procurement/rfq/${r.id}`} className="font-mono text-caption text-accent hover:underline">
                      {r.rfq_number}
                    </Link>
                  </Td>
                  <Td className="max-w-xs truncate text-caption">{r.title}</Td>
                  <Td><StatusPill status={r.status} /></Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      </div>
    </div>
  );
}
