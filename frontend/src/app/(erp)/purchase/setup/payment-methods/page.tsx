'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Dialog, apiErrorMessage, dialogField } from '@/components/erp/Dialog';
import { EmptyRow, LoadingRows, PageHeader, TableShell, Td, Th } from '@/components/erp/PageHeader';

// `allowed_currency` starts empty, meaning "any". A default of the anchor
// tenant's currency silently restricted every new method to it (WORK-025).
const empty = { code: '', name: '', account_type: 'BANK', offset_account_id: '', allowed_currency: '', bank_account_reference: '', reconciliation_reference: '', is_active: true };

export default function PaymentMethodsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [error, setError] = useState('');
  const { data: methods, isLoading } = useQuery({
    queryKey: ['purchase-payment-methods'],
    queryFn: () => api.get('/purchase/setup/payment-methods').then(r => r.data.data),
  });
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/finance/accounts').then(r => r.data.data),
  });
  const save = useMutation({
    mutationFn: () => editing
      ? api.put(`/purchase/setup/payment-methods/${editing.id}`, form)
      : api.post('/purchase/setup/payment-methods', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase-payment-methods'] }); setEditing(null); setError(''); },
    onError: e => setError(apiErrorMessage(e, 'Could not save the payment method.')),
  });
  const open = (row?: any) => {
    setEditing(row ?? {});
    setForm(row ? {
      code: row.code, name: row.name, account_type: row.account_type,
      offset_account_id: row.offset_account_id, allowed_currency: row.allowed_currency ?? '',
      bank_account_reference: row.bank_account_reference ?? '', reconciliation_reference: row.reconciliation_reference ?? '',
      is_active: row.is_active,
    } : { ...empty });
    setError('');
  };
  const blocked = !form.code.trim() ? 'Enter a code.' : !form.name.trim() ? 'Enter a name.' : !form.offset_account_id ? 'Select the cash or bank ledger account.' : null;
  return <div>
    <PageHeader title="Payment methods" subtitle="Define where vendor payments leave the ledger. Each payment snapshots this account when it is created." actions={<Button size="sm" onClick={() => open()}><Plus className="h-4 w-4" />New method</Button>} />
    <TableShell><thead><tr><Th>Code</Th><Th>Name</Th><Th>Type</Th><Th>Offset account</Th><Th>Currency</Th><Th>Status</Th><Th /></tr></thead>
      <tbody className="divide-y divide-border">
        {isLoading && <LoadingRows cols={7} />}
        {!isLoading && !(methods ?? []).length && <EmptyRow colSpan={7}>No payment methods yet. Add the bank or cash method used to pay suppliers.</EmptyRow>}
        {(methods ?? []).map((row: any) => <tr key={row.id}>
          <Td className="font-mono">{row.code}</Td><Td>{row.name}</Td><Td>{row.account_type}</Td>
          <Td>{row.offset_account?.code} — {row.offset_account?.name}</Td><Td>{row.allowed_currency ?? 'Any'}</Td>
          <Td>{row.is_active ? 'Active' : 'Inactive'}</Td>
          <Td className="text-right"><Button variant="ghost" size="sm" onClick={() => open(row)}><Pencil className="h-3.5 w-3.5" />Edit</Button></Td>
        </tr>)}</tbody></TableShell>
    {editing && <Dialog title={editing.id ? `Edit ${editing.code}` : 'New payment method'} onClose={() => setEditing(null)} error={error} blockedReason={blocked} submitLabel="Save method" submitting={save.isPending} onSubmit={() => save.mutate()}>
      <div className="space-y-3">
        <label className="block text-caption text-fg-muted">Code<input className={dialogField} disabled={Boolean(editing.id)} value={form.code} onChange={e => setForm({...form, code:e.target.value})} /></label>
        <label className="block text-caption text-fg-muted">Name<input className={dialogField} value={form.name} onChange={e => setForm({...form, name:e.target.value})} /></label>
        <label className="block text-caption text-fg-muted">Type<select className={dialogField} value={form.account_type} disabled={Boolean(editing.id)} onChange={e => setForm({...form, account_type:e.target.value})}><option>BANK</option><option>CASH</option><option>LEDGER</option></select></label>
        <label className="block text-caption text-fg-muted">Offset account<select className={dialogField} value={form.offset_account_id} onChange={e => setForm({...form, offset_account_id:e.target.value})}><option value="">Select account</option>{(accounts ?? []).map((a:any)=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label>
        <label className="block text-caption text-fg-muted">Allowed currency<input className={dialogField} value={form.allowed_currency} onChange={e => setForm({...form, allowed_currency:e.target.value})} /></label>
        <label className="block text-caption text-fg-muted">Bank account reference<input className={dialogField} value={form.bank_account_reference} onChange={e => setForm({...form, bank_account_reference:e.target.value})} /></label>
        <label className="block text-caption text-fg-muted">Reconciliation reference<input className={dialogField} value={form.reconciliation_reference} onChange={e => setForm({...form, reconciliation_reference:e.target.value})} /></label>
        {editing.id && <label className="flex items-center gap-2 text-body"><input type="checkbox" checked={form.is_active} onChange={e => setForm({...form, is_active:e.target.checked})} />Active</label>}
      </div>
    </Dialog>}
  </div>;
}
