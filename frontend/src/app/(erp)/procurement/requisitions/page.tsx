'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/erp/StatusPill';
import { Dialog, dialogField, apiErrorMessage } from '@/components/erp/Dialog';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows, ErrorNote } from '@/components/erp/PageHeader';

/**
 * Purchase requisitions — the internal request that comes before the purchase
 * order. A store asks; a buyer decides.
 *
 * Whether an approval step exists at all is a tenant parameter, not a code
 * branch: with approval switched off, submitting approves immediately.
 */
const money = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2 });
const STATUSES = ['', 'DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED', 'CANCELLED'];

export default function RequisitionsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['requisitions', status],
    queryFn: () =>
      api.get('/procurement/requisitions', { params: { ...(status && { status }), limit: 50 } }).then((r) => r.data),
  });

  const rows = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Purchase requisitions"
        subtitle="Internal requests to buy. Approved lines become a purchase order, or go out to tender first."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New requisition
          </Button>
        }
      />

      <ErrorNote message={error} />

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
            {s ? s.replace(/_/g, ' ') : 'All'}
          </button>
        ))}
      </div>

      <TableShell>
        <thead>
          <tr>
            <Th>Number</Th>
            <Th>Warehouse</Th>
            <Th>Justification</Th>
            <Th className="text-right">Lines</Th>
            <Th className="text-right">Estimated</Th>
            <Th>Required</Th>
            <Th>Status</Th>
            <Th className="text-right">RFQs</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading && <LoadingRows cols={8} />}
          {!isLoading && rows.length === 0 && (
            <EmptyRow colSpan={8}>
              No requisitions. This is where a store asks for stock before anyone commits to a vendor.
            </EmptyRow>
          )}
          {rows.map((r: any) => (
            <tr key={r.id} className="hover:bg-surface-sunken">
              <Td>
                <Link href={`/procurement/requisitions/${r.id}`} className="font-mono text-caption text-accent hover:underline">
                  {r.requisition_number}
                </Link>
              </Td>
              <Td className="text-caption text-fg-muted">{r.warehouse?.code ?? '—'}</Td>
              <Td className="max-w-xs truncate text-caption text-fg-muted">{r.justification ?? '—'}</Td>
              <Td className="text-right font-mono text-caption text-fg-muted">{r._count?.lines ?? 0}</Td>
              <Td className="text-right font-mono text-caption">{money(r.estimated_total)}</Td>
              <Td className="text-caption text-fg-muted">
                {r.required_date ? new Date(r.required_date).toLocaleDateString() : '—'}
              </Td>
              <Td><StatusPill status={r.status} /></Td>
              <Td className="text-right font-mono text-caption text-fg-muted">{r._count?.rfq_cases ?? 0}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      {creating && (
        <NewRequisitionDialog
          onClose={() => setCreating(false)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['requisitions'] }); setError(''); }}
        />
      )}
    </div>
  );
}

function NewRequisitionDialog({
  onClose, onSaved,
}: { onClose: () => void; onSaved: () => void }) {
  const [warehouseId, setWarehouseId] = useState('');
  const [justification, setJustification] = useState('');
  const [error, setError] = useState('');
  const [lines, setLines] = useState<{ product_id: string; quantity: string; estimated_unit_cost: string }[]>([
    { product_id: '', quantity: '1', estimated_unit_cost: '0' },
  ]);

  const { data: warehouses, isLoading: whLoading } = useQuery({
    queryKey: ['warehouses-lookup'],
    queryFn: () => api.get('/warehouse/warehouses').then((r) => r.data.data ?? []),
  });
  const { data: products, isLoading: prLoading } = useQuery({
    queryKey: ['products-lookup'],
    queryFn: () => api.get('/products', { params: { limit: 200 } }).then((r) => r.data.data ?? []),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/procurement/requisitions', {
        warehouse_id: warehouseId || undefined,
        justification: justification || undefined,
        lines: lines
          .filter((l) => l.product_id)
          .map((l) => ({
            product_id: l.product_id,
            quantity: Number(l.quantity),
            estimated_unit_cost: Number(l.estimated_unit_cost || 0),
          })),
      }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not create the requisition.')),
  });

  // Stated in words, next to the button. A form that refuses to submit without
  // saying why is indistinguishable from a broken one — which is exactly how
  // this page failed the first person who tried to use it.
  const blockedReason =
    whLoading || prLoading
      ? 'Loading warehouses and products…'
      : !(warehouses ?? []).length
        ? 'No warehouses exist yet — create one under Warehouse first.'
        : !warehouseId
          ? 'Choose a warehouse.'
          : !lines.some((l) => l.product_id)
            ? 'Add at least one product line.'
            : lines.some((l) => l.product_id && !(Number(l.quantity) > 0))
              ? 'Every product line needs a quantity greater than zero.'
              : null;

  return (
    <Dialog
      title="New purchase requisition"
      description="An internal request. Nothing is ordered and nothing is posted until it is approved."
      width="max-w-2xl"
      onClose={onClose}
      error={error}
      blockedReason={blockedReason}
      submitLabel="Create requisition"
      submitting={create.isPending}
      onSubmit={() => create.mutate()}
    >
      <div className="mb-3 grid grid-cols-2 gap-2.5">
        <label className="text-caption text-fg-muted">
          Warehouse *
          <select className={dialogField} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">— select —</option>
            {(warehouses ?? []).map((w: any) => (
              <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
            ))}
          </select>
        </label>
        <label className="text-caption text-fg-muted">
          Justification
          <input className={dialogField} value={justification} onChange={(e) => setJustification(e.target.value)} />
        </label>
      </div>

      {/* Grid, not flex: `dialogField` carries `w-full`, which fights `flex-1` and
          collapsed the product select to the width of its arrow. Fixed columns
          make the row predictable regardless of the field's own width class. */}
      <div className="mb-1 grid grid-cols-[1fr_5rem_7rem_2.25rem] gap-2 text-micro font-semibold uppercase tracking-wide text-fg-muted">
        <span>Product</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Est. cost</span>
        <span />
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_5rem_7rem_2.25rem] items-center gap-2">
            <select
              className={dialogField}
              aria-label={`Product for line ${i + 1}`}
              value={l.product_id}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, product_id: e.target.value } : x)))}
            >
              <option value="">— product —</option>
              {(products ?? []).map((p: any) => (
                <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>
              ))}
            </select>
            <input
              className={`${dialogField} text-right`} type="number" min="1" placeholder="Qty"
              aria-label={`Quantity for line ${i + 1}`}
              value={l.quantity}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
            />
            <input
              className={`${dialogField} text-right`} type="number" min="0" step="0.01" placeholder="0,00"
              aria-label={`Estimated unit cost for line ${i + 1}`}
              value={l.estimated_unit_cost}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, estimated_unit_cost: e.target.value } : x)))}
            />
            <Button
              variant="ghost" size="icon" type="button" aria-label={`Remove line ${i + 1}`}
              onClick={() => setLines(lines.filter((_, j) => j !== i))}
              disabled={lines.length === 1}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        variant="ghost" size="sm" className="mt-2"
        onClick={() => setLines([...lines, { product_id: '', quantity: '1', estimated_unit_cost: '0' }])}
      >
        <Plus className="h-3.5 w-3.5" /> Add line
      </Button>

      <p className="mt-3 text-micro text-fg-subtle">
        The estimated cost is the requester&apos;s guess. An RFQ replaces it with a real quoted price.
      </p>
    </Dialog>
  );
}
