'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Plus, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Dialog, apiErrorMessage, dialogField } from '@/components/erp/Dialog';
import { EmptyRow, LoadingRows, PageHeader, TableShell, Td, Th } from '@/components/erp/PageHeader';
import { StatusPill } from '@/components/erp/StatusPill';
import { useMoney } from '@/components/CurrencyProvider';

const today = () => new Date().toISOString().slice(0, 10);

export default function VendorPaymentsPage() {
  // A payment amount is read on its own in dialog prose, so it carries its
  // currency rather than a bare number under a header (WORK-025).
  const { money, date: day, code } = useMoney();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<'create' | 'post' | 'settle' | 'reverse' | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ supplier_id: '', payment_method_id: '', amount: '', payment_date: today(), notes: '' });
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');

  const { data: payments, isLoading } = useQuery({ queryKey: ['vendor-payments'], queryFn: () => api.get('/purchase/payments').then(r => r.data.data) });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/purchase/suppliers').then(r => r.data.data) });
  const { data: methods } = useQuery({ queryKey: ['purchase-payment-methods'], queryFn: () => api.get('/purchase/setup/payment-methods').then(r => r.data.data) });
  const { data: openRows } = useQuery({ queryKey: ['vendor-open-transactions', selected?.supplier_id], enabled: Boolean(selected?.supplier_id), queryFn: () => api.get('/purchase/open-transactions', { params: { supplier_id: selected.supplier_id } }).then(r => r.data.data) });
  const openInvoices = useMemo(() => (openRows ?? []).filter((row:any) => row.source_type === 'INVOICE' && row.direction === 'CREDIT' && row.is_open), [openRows]);
  const allocationTotal = Object.values(allocations).reduce((sum, value) => sum + (Number(value) || 0), 0);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['vendor-payments'] });
    qc.invalidateQueries({ queryKey: ['vendor-open-transactions'] });
    qc.invalidateQueries({ queryKey: ['vendor-invoices'] });
  };
  const create = useMutation({
    mutationFn: () => api.post('/purchase/payments', { ...form, amount: Number(form.amount) }),
    onSuccess: () => { refresh(); setDialog(null); setError(''); },
    onError: e => setError(apiErrorMessage(e, 'Could not create the vendor payment.')),
  });
  const post = useMutation({
    mutationFn: () => api.post(`/purchase/payments/${selected.id}/post`, { allocations: Object.entries(allocations).filter(([,v]) => Number(v)>0).map(([credit_transaction_id, amount]) => ({ credit_transaction_id, amount: Number(amount) })), settlement_date: today() }),
    onSuccess: () => { refresh(); setDialog(null); setError(''); },
    onError: e => setError(apiErrorMessage(e, 'Could not post the vendor payment.')),
  });
  const settle = useMutation({
    mutationFn: () => api.post(`/purchase/payments/${selected.id}/settle`, { allocations: Object.entries(allocations).filter(([,v]) => Number(v)>0).map(([credit_transaction_id, amount]) => ({ credit_transaction_id, amount: Number(amount) })), settlement_date: today() }),
    onSuccess: () => { refresh(); setDialog(null); setError(''); },
    onError: e => setError(apiErrorMessage(e, 'Could not settle the vendor payment.')),
  });
  const reverse = useMutation({
    mutationFn: () => api.post(`/purchase/payments/${selected.id}/reverse`, { reason, reversal_date: today() }),
    onSuccess: () => { refresh(); setDialog(null); setError(''); },
    onError: e => setError(apiErrorMessage(e, 'Could not reverse the vendor payment.')),
  });

  const openCreate = () => { setForm({ supplier_id: '', payment_method_id: (methods ?? []).find((m:any)=>m.is_active)?.id ?? '', amount: '', payment_date: today(), notes: '' }); setError(''); setDialog('create'); };
  const openAction = (kind:'post'|'settle'|'reverse', row:any) => { setSelected(row); setAllocations({}); setReason(''); setError(''); setDialog(kind); };
  const createBlocked = !form.supplier_id ? 'Select a supplier.' : !form.payment_method_id ? 'Select a payment method.' : !(Number(form.amount)>0) ? 'Enter an amount greater than zero.' : null;
  const actionBlocked = allocationTotal > Number(selected?.open_amount ?? selected?.amount ?? 0) + 0.005 ? 'Allocations exceed the payment open amount.' : null;

  return <div>
    <PageHeader title="Vendor payments" subtitle="Post supplier payments, allocate them partially across invoices, and reverse them with a complete audit trail." actions={<Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" />New payment</Button>} />
    <TableShell><thead><tr><Th>Payment</Th><Th>Supplier</Th><Th>Date</Th><Th>Method</Th><Th className="text-right">Amount</Th><Th className="text-right">Open</Th><Th>Status</Th><Th /></tr></thead>
      <tbody className="divide-y divide-border">
        {isLoading && <LoadingRows cols={8} />}
        {!isLoading && !(payments ?? []).length && <EmptyRow colSpan={8}>No vendor payments yet. Configure a payment method, then create the first payment.</EmptyRow>}
        {(payments ?? []).map((row:any)=><tr key={row.id}>
          <Td className="font-mono">{row.payment_number}</Td><Td>{row.supplier?.name}</Td><Td>{day(row.payment_date)}</Td><Td>{row.payment_method?.name}</Td>
          <Td className="text-right tabular-nums">{money(row.amount)}</Td><Td className="text-right tabular-nums">{row.open_amount == null ? '—' : money(row.open_amount)}</Td><Td><StatusPill status={row.status} /></Td>
          <Td><div className="flex justify-end gap-1">
            {row.status === 'DRAFT' && <Button size="sm" onClick={() => openAction('post', row)}><Banknote className="h-3.5 w-3.5" />Post</Button>}
            {row.status === 'POSTED' && Number(row.open_amount)>0.005 && !row.reverses_payment_id && !row.reversed_by && <Button variant="secondary" size="sm" onClick={() => openAction('settle', row)}>Settle</Button>}
            {row.status === 'POSTED' && !row.reverses_payment_id && !row.reversed_by && <Button variant="ghost" size="sm" onClick={() => openAction('reverse', row)}><RotateCcw className="h-3.5 w-3.5" />Reverse</Button>}
          </div></Td>
        </tr>)}</tbody></TableShell>

    {dialog === 'create' && <Dialog title="New vendor payment" description="The bank or cash account is copied from the payment method into this draft." onClose={() => setDialog(null)} error={error} blockedReason={createBlocked} submitLabel="Create draft" submitting={create.isPending} onSubmit={() => create.mutate()}>
      <div className="space-y-3">
        <label className="block text-caption text-fg-muted">Supplier<select className={dialogField} value={form.supplier_id} onChange={e=>setForm({...form,supplier_id:e.target.value})}><option value="">Select supplier</option>{(suppliers??[]).map((s:any)=><option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}</select></label>
        <label className="block text-caption text-fg-muted">Payment method<select className={dialogField} value={form.payment_method_id} onChange={e=>setForm({...form,payment_method_id:e.target.value})}><option value="">Select method</option>{(methods??[]).filter((m:any)=>m.is_active).map((m:any)=><option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}</select></label>
        <label className="block text-caption text-fg-muted">Amount ({code})<input type="number" min="0.01" step="0.01" className={dialogField} value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} /></label>
        <label className="block text-caption text-fg-muted">Payment date<input type="date" className={dialogField} value={form.payment_date} onChange={e=>setForm({...form,payment_date:e.target.value})} /></label>
        <label className="block text-caption text-fg-muted">Notes<input className={dialogField} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} /></label>
      </div>
    </Dialog>}

    {(dialog === 'post' || dialog === 'settle') && selected && <Dialog width="max-w-2xl" title={`${dialog === 'post' ? 'Post' : 'Settle'} ${selected.payment_number}`} description={`Available payment amount: ${money(selected.open_amount ?? selected.amount)}. Allocation is optional when posting.`} onClose={()=>setDialog(null)} error={error} blockedReason={actionBlocked} submitLabel={dialog === 'post' ? 'Post payment' : 'Apply settlement'} submitting={post.isPending || settle.isPending} onSubmit={()=>dialog === 'post' ? post.mutate() : settle.mutate()}>
      <div className="space-y-2">
        {!openInvoices.length && <p className="rounded-control bg-surface-sunken p-3 text-caption text-fg-muted">This supplier has no open posted invoices. You can post the payment unallocated and settle it later.</p>}
        {openInvoices.map((row:any)=><div key={row.id} className="grid grid-cols-[1fr_130px] items-center gap-3 rounded-control border border-border p-2.5">
          <div><div className="font-mono text-caption text-fg">{row.invoice?.invoice_number ?? row.source_id}</div><div className="text-caption text-fg-muted">{row.invoice?.internal_number} · open {money(row.open_amount)}</div></div>
          <input aria-label={`Allocation for ${row.invoice?.invoice_number}`} type="number" min="0" max={row.open_amount} step="0.01" className={dialogField} value={allocations[row.id] ?? ''} onChange={e=>setAllocations({...allocations,[row.id]:e.target.value})} />
        </div>)}
        <div className="text-right text-caption font-medium text-fg">Allocated: {money(allocationTotal)}</div>
      </div>
    </Dialog>}

    {dialog === 'reverse' && selected && <Dialog title={`Reverse ${selected.payment_number}`} description="The original voucher and every active invoice allocation are reversed as new audit records." onClose={()=>setDialog(null)} error={error} blockedReason={!reason.trim() ? 'Enter the business reason for the reversal.' : null} submitLabel="Post reversal" submitting={reverse.isPending} onSubmit={()=>reverse.mutate()}>
      <label className="block text-caption text-fg-muted">Reason<textarea className={`${dialogField} h-24 py-2`} value={reason} onChange={e=>setReason(e.target.value)} /></label>
    </Dialog>}
  </div>;
}
