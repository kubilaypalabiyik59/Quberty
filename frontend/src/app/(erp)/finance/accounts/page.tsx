'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, Check, X, AlertCircle, BookOpen, Zap } from 'lucide-react';

const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
const TYPE_COLORS: Record<string, string> = {
  ASSET: 'bg-blue-100 text-blue-700',
  LIABILITY: 'bg-red-100 text-red-700',
  EQUITY: 'bg-purple-100 text-purple-700',
  REVENUE: 'bg-green-100 text-green-700',
  EXPENSE: 'bg-orange-100 text-orange-700',
};

const emptyForm = () => ({ code: '', name: '', type: 'ASSET', normal_balance: 'DEBIT', parent_id: '' });

export default function AccountsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');
  const [filterType, setFilterType] = useState('');

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/finance/accounts').then(r => r.data.data),
  });

  const reset = () => { setShowForm(false); setEditId(null); setForm(emptyForm()); setError(''); };

  const save = useMutation({
    mutationFn: () => editId
      ? api.put(`/finance/accounts/${editId}`, form)
      : api.post('/finance/accounts', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); reset(); },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Failed to save'),
  });

  const seedDefault = useMutation({
    mutationFn: () => api.post('/finance/accounts/seed-default', {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); },
    onError: (err: any) => alert(err.response?.data?.message ?? 'Failed to seed accounts'),
  });

  const filtered = (accounts ?? []).filter((a: any) => !filterType || a.type === filterType);

  const grouped = TYPES.reduce((acc, type) => {
    acc[type] = filtered.filter((a: any) => a.type === type);
    return acc;
  }, {} as Record<string, any[]>);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chart of Accounts</h1>
          <p className="text-sm text-gray-500 mt-0.5">Plan de Cuentas — Bolivian PCG structure</p>
        </div>
        <div className="flex gap-2">
          {(accounts ?? []).length === 0 && (
            <button
              onClick={() => seedDefault.mutate()}
              disabled={seedDefault.isPending}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              <Zap className="h-4 w-4" /> {seedDefault.isPending ? 'Creating...' : 'Seed Default Accounts'}
            </button>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus className="h-4 w-4" /> New Account
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-6 mb-6">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">
            {editId ? 'Edit Account' : 'New Account'}
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code <span className="text-red-500">*</span></label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="1101" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Caja" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type <span className="text-red-500">*</span></label>
              <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.type}
                onChange={e => {
                  const type = e.target.value;
                  const nb = (type === 'REVENUE' || type === 'LIABILITY' || type === 'EQUITY') ? 'CREDIT' : 'DEBIT';
                  setForm(p => ({ ...p, type, normal_balance: nb }));
                }}>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Normal Balance</label>
              <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.normal_balance} onChange={e => setForm(p => ({ ...p, normal_balance: e.target.value }))}>
                <option value="DEBIT">DEBIT</option>
                <option value="CREDIT">CREDIT</option>
              </select>
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          <div className="flex gap-3 mt-4">
            <button onClick={() => save.mutate()} disabled={!form.code || !form.name || save.isPending}
              className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium">
              <Check className="h-4 w-4" /> {save.isPending ? 'Saving...' : 'Save'}
            </button>
            <button onClick={reset} className="border border-gray-200 text-gray-600 px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-5">
        <button onClick={() => setFilterType('')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${!filterType ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
          All
        </button>
        {TYPES.map(t => (
          <button key={t} onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filterType === t ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {t}
          </button>
        ))}
      </div>

      {isLoading && <div className="text-center py-12 text-gray-400">Loading...</div>}

      {!isLoading && (accounts ?? []).length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <BookOpen className="h-12 w-12 mx-auto mb-3 text-gray-200" />
          <p className="font-semibold text-gray-700">No accounts yet</p>
          <p className="text-sm mt-1">Click "Seed Default Accounts" to create the standard Bolivian chart of accounts.</p>
        </div>
      )}

      <div className="space-y-4">
        {TYPES.map(type => {
          const items = grouped[type] ?? [];
          if (items.length === 0) return null;
          return (
            <div key={type} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${TYPE_COLORS[type]}`}>{type}</span>
                <span className="text-xs text-gray-400">{items.length} accounts</span>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {items.map((a: any) => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500 w-24">{a.code}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-900">{a.name}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-gray-400">{a.normal_balance}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={() => {
                          setEditId(a.id);
                          setForm({ code: a.code, name: a.name, type: a.type, normal_balance: a.normal_balance, parent_id: a.parent_id ?? '' });
                          setShowForm(true);
                        }} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
