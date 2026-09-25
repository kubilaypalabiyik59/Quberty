'use client';

import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Dialog, apiErrorMessage, dialogField } from '@/components/erp/Dialog';
import { EmptyRow, ErrorNote, LoadingRows, PageHeader, TableShell, Td, Th } from '@/components/erp/PageHeader';
import { useMoney } from '@/components/CurrencyProvider';
import { useAuthStore } from '@/stores/authStore';

/**
 * Inventory journals (WORK-045): every stock correction posts quantity AND value.
 *
 * A positive line receives a cost layer at its unit cost (blank = the newest cost
 * of that item) and credits inventory profit; a negative line consumes FIFO layers
 * and debits inventory loss. An OPENING journal brings stock in at onboarding and
 * credits opening balance equity — only an administrator may post one. Count
 * journals appear here once a count is finalised.
 */

type Line = { product_id: string; variant_id: string; location_id: string; quantity: string; unit_cost: string; reason_code_id: string };
const emptyLine: Line = { product_id: '', variant_id: '', location_id: '', quantity: '', unit_cost: '', reason_code_id: '' };

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  POSTED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

export default function InventoryJournalsPage() {
  const qc = useQueryClient();
  const { money } = useMoney();
  const role = useAuthStore((s) => s.user?.role);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reasonForm, setReasonForm] = useState<{ code: string; name: string; direction: string } | null>(null);

  const { data: journals, isLoading } = useQuery({
    queryKey: ['inventory-journals'],
    queryFn: () => api.get('/inventory-journals').then((r) => r.data.data),
  });
  const { data: detail } = useQuery({
    queryKey: ['inventory-journal', expanded],
    queryFn: () => api.get(`/inventory-journals/${expanded}`).then((r) => r.data.data),
    enabled: !!expanded,
  });
  const { data: reasons } = useQuery({
    queryKey: ['inventory-reason-codes'],
    queryFn: () => api.get('/inventory-journals/reason-codes').then((r) => r.data.data),
  });
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouse/warehouses').then((r) => r.data.data),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['inventory-journals'] });
    qc.invalidateQueries({ queryKey: ['inventory-journal'] });
    qc.invalidateQueries({ queryKey: ['inventory-stock'] });
  };
  const post = useMutation({
    mutationFn: (id: string) => api.post(`/inventory-journals/${id}/post`),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not post the journal.')),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/inventory-journals/${id}/cancel`),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not cancel the journal.')),
  });
  const saveReason = useMutation({
    mutationFn: () => api.post('/inventory-journals/reason-codes', reasonForm),
    onSuccess: () => { setReasonForm(null); setError(''); qc.invalidateQueries({ queryKey: ['inventory-reason-codes'] }); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not save the reason code.')),
  });
  const toggleReason = useMutation({
    mutationFn: (r: any) => api.put(`/inventory-journals/reason-codes/${r.id}`, { is_active: !r.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-reason-codes'] }),
    onError: (e) => setError(apiErrorMessage(e, 'Could not change the reason code.')),
  });

  const whName = (id: string) => (warehouses ?? []).find((w: any) => w.id === id)?.name ?? '—';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory journals"
        subtitle="Adjustments, counts and opening balances — each one moves stock and its value together"
        actions={<Button size="sm" onClick={() => setEditing({})}><Plus className="h-4 w-4" />New journal</Button>}
      />
      <ErrorNote message={error} />

      <TableShell>
        <thead>
          <tr><Th>Number</Th><Th>Type</Th><Th>Warehouse</Th><Th>Lines</Th><Th>Value</Th><Th>Status</Th><Th>Created</Th><Th /></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading && <LoadingRows cols={8} />}
          {!isLoading && (journals ?? []).length === 0 && <EmptyRow colSpan={8}>No inventory journals yet.</EmptyRow>}
          {(journals ?? []).map((j: any) => {
            const value = j.lines.reduce((s: number, l: any) => s + Number(l.cost_amount ?? 0), 0);
            return (
              <Fragment key={j.id}>
                <tr className="cursor-pointer hover:bg-surface-sunken" onClick={() => setExpanded(expanded === j.id ? null : j.id)}>
                  <Td className="font-mono">{j.journal_number}</Td>
                  <Td>{j.journal_type}</Td>
                  <Td>{whName(j.warehouse_id)}</Td>
                  <Td>{j.lines.length}</Td>
                  <Td>{j.status === 'POSTED' ? money(value) : '—'}</Td>
                  <Td><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[j.status] ?? ''}`}>{j.status}</span></Td>
                  <Td>{new Date(j.created_at).toLocaleDateString()}</Td>
                  <Td className="whitespace-nowrap text-right" >
                    {j.status === 'DRAFT' && j.journal_type !== 'COUNT' && (j.journal_type !== 'OPENING' || role === 'admin') && (
                      <span className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="ghost" onClick={() => api.get(`/inventory-journals/${j.id}`).then((r) => setEditing(r.data.data))}>
                          <Pencil className="h-3.5 w-3.5" />Edit
                        </Button>
                        <Button size="sm" disabled={post.isPending} onClick={() => post.mutate(j.id)}>Post</Button>
                        <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(j.id)}>Cancel</Button>
                      </span>
                    )}
                  </Td>
                </tr>
                {expanded === j.id && detail?.id === j.id && (
                  <tr>
                    <td colSpan={8} className="bg-surface-sunken px-4 py-3">
                      <table className="w-full text-caption">
                        <thead><tr className="text-fg-muted"><th className="text-left">Product</th><th className="text-left">Location</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th><th className="text-right">Value</th><th className="text-left">Notes</th></tr></thead>
                        <tbody>
                          {detail.lines.map((l: any) => (
                            <tr key={l.id}>
                              <td>{l.product?.name ?? l.product_id}{l.variant ? ` · ${l.variant.sku_variant}` : ''}</td>
                              <td className="font-mono">{l.location?.code}</td>
                              <td className={`text-right ${l.quantity < 0 ? 'text-danger' : 'text-success'}`}>{l.quantity > 0 ? `+${l.quantity}` : l.quantity}</td>
                              <td className="text-right">{l.unit_cost !== null ? money(Number(l.unit_cost)) : 'newest cost'}</td>
                              <td className="text-right">{l.cost_amount !== null ? money(Number(l.cost_amount)) : '—'}</td>
                              <td>{l.notes ?? ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </TableShell>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lead font-semibold text-fg">Reason codes</h2>
          <Button size="sm" variant="ghost" onClick={() => setReasonForm({ code: '', name: '', direction: 'BOTH' })}><Plus className="h-4 w-4" />New reason</Button>
        </div>
        <TableShell>
          <thead><tr><Th>Code</Th><Th>Name</Th><Th>Direction</Th><Th>Status</Th><Th /></tr></thead>
          <tbody className="divide-y divide-border">
            {(reasons ?? []).length === 0 && <EmptyRow colSpan={5}>No reason codes yet — for example DAMAGED, THEFT, FOUND.</EmptyRow>}
            {(reasons ?? []).map((r: any) => (
              <tr key={r.id}>
                <Td className="font-mono">{r.code}</Td><Td>{r.name}</Td><Td>{r.direction}</Td>
                <Td>{r.is_active ? 'Active' : 'Inactive'}</Td>
                <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => toggleReason.mutate(r)}>{r.is_active ? 'Deactivate' : 'Activate'}</Button></Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </section>

      {reasonForm && (
        <Dialog
          title="New reason code"
          onClose={() => setReasonForm(null)}
          error={error}
          blockedReason={!reasonForm.code.trim() ? 'Enter a code.' : !reasonForm.name.trim() ? 'Enter a name.' : null}
          submitLabel="Save"
          submitting={saveReason.isPending}
          onSubmit={() => saveReason.mutate()}
        >
          <div className="space-y-3">
            <label className="block text-caption text-fg-muted">Code
              <input className={dialogField} value={reasonForm.code} onChange={(e) => setReasonForm({ ...reasonForm, code: e.target.value.toUpperCase() })} placeholder="DAMAGED" />
            </label>
            <label className="block text-caption text-fg-muted">Name
              <input className={dialogField} value={reasonForm.name} onChange={(e) => setReasonForm({ ...reasonForm, name: e.target.value })} placeholder="Damaged goods" />
            </label>
            <label className="block text-caption text-fg-muted">Direction
              <select className={dialogField} value={reasonForm.direction} onChange={(e) => setReasonForm({ ...reasonForm, direction: e.target.value })}>
                <option value="BOTH">Either direction</option>
                <option value="DECREASE">Only removes stock</option>
                <option value="INCREASE">Only adds stock</option>
              </select>
            </label>
          </div>
        </Dialog>
      )}

      {editing && (
        <JournalDialog
          journal={editing}
          warehouses={warehouses ?? []}
          reasons={(reasons ?? []).filter((r: any) => r.is_active)}
          isAdmin={role === 'admin'}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function JournalDialog({
  journal, warehouses, reasons, isAdmin, onClose, onSaved,
}: {
  journal: any; warehouses: any[]; reasons: any[]; isAdmin: boolean; onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!journal.id;
  const [type, setType] = useState<string>(journal.journal_type ?? 'ADJUSTMENT');
  const [warehouseId, setWarehouseId] = useState<string>(journal.warehouse_id ?? '');
  const [description, setDescription] = useState<string>(journal.description ?? '');
  const [lines, setLines] = useState<Line[]>(
    journal.lines?.length
      ? journal.lines.map((l: any) => ({
          product_id: l.product_id, variant_id: l.variant_id ?? '', location_id: l.location_id,
          quantity: String(l.quantity), unit_cost: l.unit_cost !== null && l.unit_cost !== undefined ? String(l.unit_cost) : '',
          reason_code_id: l.reason_code_id ?? '',
        }))
      : [{ ...emptyLine }],
  );
  const [error, setError] = useState('');

  const { data: products } = useQuery({
    queryKey: ['products-for-journal'],
    queryFn: () => api.get('/products?limit=500').then((r) => r.data.data),
  });
  const { data: locations } = useQuery({
    queryKey: ['locations', warehouseId],
    queryFn: () => api.get(`/warehouse/locations?warehouse_id=${warehouseId}`).then((r) => r.data.data),
    enabled: !!warehouseId,
  });
  const productById = useMemo(() => new Map((products ?? []).map((p: any) => [p.id, p])), [products]);

  const body = () => ({
    ...(isEdit ? {} : { journal_type: type, warehouse_id: warehouseId }),
    description: description || null,
    lines: lines.map((l) => ({
      product_id: l.product_id,
      variant_id: l.variant_id || null,
      location_id: l.location_id,
      quantity: Number(l.quantity),
      unit_cost: l.unit_cost === '' ? null : Number(l.unit_cost),
      reason_code_id: l.reason_code_id || null,
    })),
  });
  const save = useMutation({
    mutationFn: () => (isEdit ? api.put(`/inventory-journals/${journal.id}`, body()) : api.post('/inventory-journals', body())),
    onSuccess: onSaved,
    onError: (e) => setError(apiErrorMessage(e, 'Could not save the journal.')),
  });

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const blocked =
    !warehouseId ? 'Choose a warehouse.'
    : lines.some((l) => !l.product_id || !l.location_id) ? 'Every line needs a product and a location.'
    : lines.some((l) => !Number.isInteger(Number(l.quantity)) || Number(l.quantity) === 0) ? 'Quantities must be whole numbers other than zero (negative removes stock).'
    : type === 'OPENING' && lines.some((l) => Number(l.quantity) < 0) ? 'An opening balance only adds stock.'
    : null;

  return (
    <Dialog
      title={isEdit ? `Edit ${journal.journal_number}` : 'New inventory journal'}
      description="Saved as a draft. Posting moves the stock and posts the voucher."
      onClose={onClose}
      error={error}
      blockedReason={blocked}
      submitLabel={isEdit ? 'Save draft' : 'Create draft'}
      submitting={save.isPending}
      onSubmit={() => save.mutate()}
      width="max-w-4xl"
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-caption text-fg-muted">Type
            <select className={dialogField} value={type} disabled={isEdit} onChange={(e) => setType(e.target.value)}>
              <option value="ADJUSTMENT">Adjustment</option>
              {isAdmin && <option value="OPENING">Opening balance</option>}
            </select>
          </label>
          <label className="text-caption text-fg-muted">Warehouse
            <select className={dialogField} value={warehouseId} disabled={isEdit} onChange={(e) => { setWarehouseId(e.target.value); setLines((ls) => ls.map((l) => ({ ...l, location_id: '' }))); }}>
              <option value="">Choose…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </label>
          <label className="text-caption text-fg-muted">Description
            <input className={dialogField} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Damaged in transit" />
          </label>
        </div>

        <table className="w-full text-caption">
          <thead><tr className="text-fg-muted"><th className="text-left">Product</th><th className="text-left">Variant</th><th className="text-left">Location</th><th className="text-left">Qty (±)</th><th className="text-left">Unit cost</th><th className="text-left">Reason</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const variants = (productById.get(l.product_id) as any)?.variants ?? [];
              return (
                <tr key={i} className="align-top">
                  <td className="pr-1"><select className={dialogField} value={l.product_id} onChange={(e) => set(i, { product_id: e.target.value, variant_id: '' })}>
                    <option value="">Choose…</option>
                    {(products ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                  </select></td>
                  <td className="pr-1"><select className={dialogField} value={l.variant_id} disabled={variants.length === 0} onChange={(e) => set(i, { variant_id: e.target.value })}>
                    <option value="">{variants.length ? 'Choose…' : 'No variants'}</option>
                    {variants.map((v: any) => <option key={v.id} value={v.id}>{v.sku_variant}</option>)}
                  </select></td>
                  <td className="pr-1"><select className={dialogField} value={l.location_id} disabled={!warehouseId} onChange={(e) => set(i, { location_id: e.target.value })}>
                    <option value="">Choose…</option>
                    {(locations ?? []).map((loc: any) => <option key={loc.id} value={loc.id}>{loc.code}</option>)}
                  </select></td>
                  <td className="pr-1 w-24"><input className={dialogField} type="number" step="1" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></td>
                  <td className="pr-1 w-28"><input className={dialogField} type="number" min="0" step="0.01" value={l.unit_cost} placeholder={Number(l.quantity) > 0 ? 'newest cost' : 'FIFO'} disabled={Number(l.quantity) < 0 || (!isAdmin && type !== 'OPENING')} title={!isAdmin ? 'Entering a cost needs the cost override permission' : undefined} onChange={(e) => set(i, { unit_cost: e.target.value })} /></td>
                  <td className="pr-1"><select className={dialogField} value={l.reason_code_id} onChange={(e) => set(i, { reason_code_id: e.target.value })}>
                    <option value="">—</option>
                    {reasons.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
                  </select></td>
                  <td><Button size="icon" variant="ghost" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Button size="sm" variant="ghost" onClick={() => setLines((ls) => [...ls, { ...emptyLine }])}><Plus className="h-4 w-4" />Add line</Button>
        <p className="text-micro text-fg-muted">
          A positive quantity adds stock at the unit cost (blank uses the item&apos;s newest cost). A negative quantity removes
          stock at its FIFO cost; stock held by orders cannot be removed.
        </p>
      </div>
    </Dialog>
  );
}
