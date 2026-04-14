'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, Pencil, X, Check, Building2, AlertCircle, History } from 'lucide-react';
import { TransactionsModal } from '@/components/erp/TransactionsModal';

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

const emptyForm = (): SupplierForm => ({
  code: '',
  name: '',
  contact_name: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  country: 'BO',
  payment_terms: '30',
  currency: 'BOB',
});

export default function SuppliersPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<SupplierForm>(emptyForm());
  const [error, setError] = useState('');
  const [txSupplier, setTxSupplier] = useState<any | null>(null);

  const { data: suppliers, isLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/purchase/suppliers').then(r => r.data.data),
  });

  const reset = () => {
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm());
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
      country: s.country ?? 'BO',
      payment_terms: String(s.payment_terms ?? 30),
      currency: s.currency ?? 'BOB',
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
      {txSupplier && (
        <TransactionsModal
          title={`${txSupplier.name} (${txSupplier.code})`}
          queryParams={{ supplier_id: txSupplier.id }}
          onClose={() => setTxSupplier(null)}
        />
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your supplier directory</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
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
            {f('country', 'Country', { placeholder: 'BO' })}
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
                {['BOB', 'USD', 'EUR'].map(c => <option key={c} value={c}>{c}</option>)}
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
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Terms</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && Array.from({ length: 3 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 6 }).map((_, j) => (
                <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
              ))}</tr>
            ))}
            {!isLoading && (suppliers ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center text-gray-400">
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
                <td className="px-4 py-3 text-gray-500">{s.email ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">{s.city ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">{s.payment_terms ?? 30} days</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => startEdit(s)} className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                    <button onClick={() => setTxSupplier(s)} className="text-xs text-gray-500 hover:text-gray-800 font-medium flex items-center gap-1">
                      <History className="h-3 w-3" /> Transactions
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
