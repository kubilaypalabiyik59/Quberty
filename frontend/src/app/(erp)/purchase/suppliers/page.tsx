'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, Pencil, X, Check, Building2, AlertCircle, FileText } from 'lucide-react';
import { SupplierStatement, openPayableBySupplier } from '@/components/erp/SupplierStatement';
import { useMoney } from '@/components/CurrencyProvider';

interface SupplierForm {
  code: string;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  payment_terms: string;
  currency: string;
}

// No country or currency default: a supplier is created in the tenant's own
// jurisdiction and ledger currency, which the caller passes in (WORK-025).
const emptyForm = (currency = ''): SupplierForm => ({
  code: '',
  name: '',
  contact_name: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  country: '',
  payment_terms: '30',
  currency,
});

export default function SuppliersPage() {
  const qc = useQueryClient();
  const { code: ledgerCurrency } = useMoney();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<SupplierForm>(emptyForm());
  const [error, setError] = useState('');
  const [txSupplier, setTxSupplier] = useState<any | null>(null);
  const { money } = useMoney();

  // What each supplier is owed, from the AP subledger. Reading it is a payables
  // duty; a role without it simply does not get the column.
  const { data: openTx, isError: apDenied } = useQuery({
    queryKey: ['vendor-open-transactions'],
    queryFn: () => api.get('/purchase/open-transactions').then(r => r.data.data as any[]),
    retry: false,
  });
  const payable = openPayableBySupplier(openTx ?? []);

  const { data: suppliers, isLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/purchase/suppliers').then(r => r.data.data),
  });

  // The currencies this tenant has actually activated, in place of a fixed
  // BOB/USD/EUR list. Reading the currency setup is a finance duty, so a role
  // without it falls back to the ledger currency rather than seeing an error.
  const { data: tenantCurrencies } = useQuery({
    queryKey: ['tenant-currencies'],
    queryFn: () => api.get('/finance/currencies').then(r => r.data.data),
    retry: false,
  });
  const activated: string[] = (tenantCurrencies ?? [])
    .filter((c: any) => c.is_active)
    .map((c: any) => c.currency_code);
  const currencyOptions = activated.length ? activated : [ledgerCurrency].filter(Boolean);

  const reset = () => {
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm(ledgerCurrency));
    setError('');
  };

  const startEdit = (s: any) => {
    setEditId(s.id);
    setForm({
      code: s.code ?? '',
      name: s.name ?? '',
      contact_name: s.contact_name ?? '',
      email: s.email ?? '',
      phone: s.phone ?? '',
      address: s.address ?? '',
      city: s.city ?? '',
      country: s.country ?? '',
      payment_terms: String(s.payment_terms ?? 30),
      currency: s.currency ?? ledgerCurrency,
    });
    setShowForm(true);
  };

  const save = useMutation({
    mutationFn: () => editId
      ? api.put(`/purchase/suppliers/${editId}`, { ...form, payment_terms: Number(form.payment_terms) })
      : api.post('/purchase/suppliers', { ...form, payment_terms: Number(form.payment_terms) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); reset(); },
    onError: (err: any) => setError(err.response?.data?.message ?? 'Failed to save supplier'),
  });

  const f = (key: keyof SupplierForm, label: string, props?: any) => (
    <div key={key}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={form[key]}
        onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
        {...props}
      />
    </div>
  );

  return (
    <div>
      {txSupplier && <SupplierStatement supplier={txSupplier} onClose={() => setTxSupplier(null)} />}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your supplier directory</p>
        </div>
        {!showForm && (
          <button
            onClick={() => { setForm(emptyForm(ledgerCurrency)); setShowForm(true); }}
            className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" /> New Supplier
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-6 mb-6">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-5">
            {editId ? 'Edit Supplier' : 'New Supplier'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {f('code', 'Supplier Code *', { placeholder: 'SUP-001', required: true })}
            {f('name', 'Company Name *', { placeholder: 'Acme Shoes Co.', required: true })}
            {f('contact_name', 'Contact Person', { placeholder: 'John Smith' })}
            {f('email', 'Email', { type: 'email', placeholder: 'contact@supplier.com' })}
            {f('phone', 'Phone', { type: 'tel', placeholder: '+591 2 000 0000' })}
            {f('city', 'City', { placeholder: 'La Paz' })}
            {f('country', 'Country', { placeholder: 'ISO code, e.g. BO' })}
            {f('address', 'Address', { placeholder: 'Av. Principal 123' })}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms (days)</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.payment_terms}
                onChange={e => setForm(p => ({ ...p, payment_terms: e.target.value }))}
              >
                {['7', '14', '30', '45', '60', '90'].map(d => (
                  <option key={d} value={d}>{d} days</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.currency}
                onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}
              >
                {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-3 mt-5">
            <button
              onClick={() => save.mutate()}
              disabled={!form.code || !form.name || save.isPending}
              className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              <Check className="h-4 w-4" /> {save.isPending ? 'Saving...' : 'Save Supplier'}
            </button>
            <button onClick={reset} className="border border-gray-200 text-gray-600 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Supplier</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">City</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Currency</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Terms</th>
              {!apDenied && <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Open payable</th>}
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && Array.from({ length: 3 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 9 }).map((_, j) => (
                <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
              ))}</tr>
            ))}
            {!isLoading && (suppliers ?? []).length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-16 text-center text-gray-400">
                  <Building2 className="h-10 w-10 mx-auto mb-2 text-gray-200" />
                  <p>No suppliers yet.</p>
                </td>
              </tr>
            )}
            {(suppliers ?? []).map((s: any) => (
              <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{s.name}</div>
                  <div className="text-xs text-gray-400 font-mono">{s.code}</div>
                </td>
                <td className="px-4 py-3 text-gray-500">{s.contact_name ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">
                  <div>{s.email ?? '—'}</div>
                  {s.phone && <div className="text-xs">{s.phone}</div>}
                </td>
                <td className="px-4 py-3 text-gray-500">{[s.city, s.country].filter(Boolean).join(', ') || '—'}</td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{s.currency}</td>
                <td className="px-4 py-3 text-gray-500">{s.payment_terms ?? 30} days</td>
                {!apDenied && (
                  <td className={`px-4 py-3 text-right font-mono text-xs ${(payable.get(s.id) ?? 0) > 0 ? 'font-semibold text-amber-700' : 'text-gray-400'}`}>
                    {money(payable.get(s.id) ?? 0)}
                  </td>
                )}
                <td className="px-4 py-3">
                  <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${s.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => startEdit(s)} className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                    <button onClick={() => setTxSupplier(s)} className="text-xs text-gray-500 hover:text-gray-800 font-medium flex items-center gap-1">
                      <FileText className="h-3 w-3" /> Statement
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
