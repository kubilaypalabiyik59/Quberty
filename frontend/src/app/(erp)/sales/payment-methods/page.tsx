'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Dialog, apiErrorMessage, dialogField } from '@/components/erp/Dialog';
import { EmptyRow, LoadingRows, PageHeader, TableShell, Td, Th } from '@/components/erp/PageHeader';
import { useMoney } from '@/components/CurrencyProvider';

/**
 * Sales payment methods (WORK-047): how customers pay at the till and which ledger
 * account each tender debits. A COUNT method must be counted when the register
 * closes; a difference above its tolerance needs a manager and posts to the cash
 * difference account. Only cash gives change. Selling on customer account is not
 * available until receivables are itemised per customer.
 */

// VOUCHER and CUSTOMER_ACCOUNT exist in the schema but a sale refuses them until balances are tracked.
const TYPES = ['CASH', 'CARD', 'QR', 'TRANSFER'];
const empty = { code: '', name: '', tender_type: 'CASH', account_id: '', declaration_policy: 'COUNT', allow_change: true, max_difference_amount: '', is_active: true };

export default function SalesPaymentMethodsPage() {
  const qc = useQueryClient();
  const { money } = useMoney();
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [error, setError] = useState('');

  const { data: methods, isLoading, error: loadError } = useQuery({
    queryKey: ['sales-payment-methods'],
    queryFn: () => api.get('/sales/payment-methods').then((r) => r.data.data),
  });
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/finance/accounts').then((r) => r.data.data),
    enabled: !!editing,
  });

  const save = useMutation({
    mutationFn: () => {
      const tolerance = form.max_difference_amount === '' ? null : Number(form.max_difference_amount);
      return editing?.id
        ? api.put(`/sales/payment-methods/${editing.id}`, {
            name: form.name, account_id: form.account_id, declaration_policy: form.declaration_policy,
            allow_change: form.tender_type === 'CASH' && form.allow_change, max_difference_amount: tolerance, is_active: form.is_active,
          })
        : api.post('/sales/payment-methods', {
            code: form.code, name: form.name, tender_type: form.tender_type, account_id: form.account_id,
            declaration_policy: form.declaration_policy, allow_change: form.tender_type === 'CASH' && form.allow_change,
            max_difference_amount: tolerance,
          });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-payment-methods'] }); setEditing(null); setError(''); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not save the payment method.')),
  });

  const open = (row?: any) => {
    setEditing(row ?? {});
    setForm(row ? {
      code: row.code, name: row.name, tender_type: row.tender_type, account_id: row.account_id,
      declaration_policy: row.declaration_policy, allow_change: row.allow_change,
      max_difference_amount: row.max_difference_amount == null ? '' : String(row.max_difference_amount), is_active: row.is_active,
    } : { ...empty });
    setError('');
  };

  const postingAccounts = (accounts ?? []).filter((a: any) => a.is_active !== false && a.category !== 'HEADING');
  const blocked =
    !form.code.trim() ? 'Enter a code.'
    : !form.name.trim() ? 'Enter a name.'
    : !form.account_id ? 'Select the ledger account the tender debits.'
    : form.max_difference_amount !== '' && !(Number(form.max_difference_amount) >= 0) ? 'The tolerance must be zero or more.'
    : null;

  return <div>
    <PageHeader title="Sales payment methods"
      subtitle="How customers pay at the till and the account each payment debits. Methods marked Count are counted when a register closes."
      actions={<Button size="sm" onClick={() => open()}><Plus className="h-4 w-4" />New method</Button>} />
    {loadError && <p className="mb-3 text-body text-danger">{apiErrorMessage(loadError, 'Could not load the payment methods.')}</p>}
    <TableShell><thead><tr><Th>Code</Th><Th>Name</Th><Th>Type</Th><Th>Account</Th><Th>At close</Th><Th>Change</Th><Th>Tolerance</Th><Th>Status</Th><Th /></tr></thead>
      <tbody className="divide-y divide-border">
        {isLoading && <LoadingRows cols={9} />}
        {!isLoading && !(methods ?? []).length && <EmptyRow colSpan={9}>No payment methods yet. The till cannot take a sale until at least one is set up.</EmptyRow>}
        {(methods ?? []).map((row: any) => <tr key={row.id}>
          <Td className="font-mono">{row.code}</Td><Td>{row.name}</Td><Td>{row.tender_type}</Td>
          <Td>{row.account?.code} — {row.account?.name}</Td>
          <Td>{row.declaration_policy === 'COUNT' ? 'Count' : 'Not counted'}</Td>
          <Td>{row.allow_change ? 'Yes' : 'No'}</Td>
          <Td>{row.max_difference_amount == null ? 'None' : money(Number(row.max_difference_amount))}</Td>
          <Td>{row.is_active ? 'Active' : 'Inactive'}</Td>
          <Td className="text-right"><Button variant="ghost" size="sm" onClick={() => open(row)}><Pencil className="h-3.5 w-3.5" />Edit</Button></Td>
        </tr>)}
      </tbody></TableShell>

    {editing && <Dialog title={editing.id ? `Edit ${editing.code}` : 'New payment method'} onClose={() => setEditing(null)} error={error}
      blockedReason={blocked} submitLabel="Save method" submitting={save.isPending} onSubmit={() => save.mutate()}>
      <div className="space-y-3">
        <label className="block text-caption text-fg-muted">Code<input className={dialogField} disabled={Boolean(editing.id)} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></label>
        <label className="block text-caption text-fg-muted">Name<input className={dialogField} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="block text-caption text-fg-muted">Type
          <select className={dialogField} value={form.tender_type} disabled={Boolean(editing.id)}
            onChange={(e) => setForm({ ...form, tender_type: e.target.value, allow_change: e.target.value === 'CASH', declaration_policy: e.target.value === 'CASH' ? 'COUNT' : 'NONE' })}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="block text-caption text-fg-muted">Account debited
          <select className={dialogField} value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
            <option value="">Select account</option>
            {postingAccounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </label>
        <label className="block text-caption text-fg-muted">At register close
          <select className={dialogField} value={form.declaration_policy} onChange={(e) => setForm({ ...form, declaration_policy: e.target.value })}>
            <option value="COUNT">Count it</option><option value="NONE">Not counted</option>
          </select>
        </label>
        <label className="block text-caption text-fg-muted">Difference tolerance (blank = any difference needs a manager)
          <input className={dialogField} inputMode="decimal" value={form.max_difference_amount} onChange={(e) => setForm({ ...form, max_difference_amount: e.target.value })} />
        </label>
        {form.tender_type === 'CASH' && <label className="flex items-center gap-2 text-body"><input type="checkbox" checked={form.allow_change} onChange={(e) => setForm({ ...form, allow_change: e.target.checked })} />Gives change</label>}
        {editing.id && <label className="flex items-center gap-2 text-body"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />Active</label>}
      </div>
    </Dialog>}
  </div>;
}
