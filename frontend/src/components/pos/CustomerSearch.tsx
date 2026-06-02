'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { usePosCartStore } from '@/stores/posCartStore';

interface Props {
  visible: boolean;
  onClose: () => void;
}

async function searchCustomers(q: string) {
  const res = await api.get('/customers', { params: { search: q, limit: 20 } });
  return res.data.data?.customers ?? res.data.data ?? [];
}

async function createCustomer(data: { first_name: string; last_name: string; phone?: string }) {
  const code = `${data.first_name.slice(0, 3).toUpperCase()}${Date.now().toString().slice(-4)}`;
  const res = await api.post('/customers', { ...data, code });
  return res.data.data;
}

export function CustomerSearch({ visible, onClose }: Props) {
  const setCustomer = usePosCartStore((s) => s.setCustomer);
  const customer    = usePosCartStore((s) => s.customer);

  const [query,     setQuery]     = useState('');
  const [results,   setResults]   = useState<any[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [tab,       setTab]       = useState<'search' | 'create'>('search');

  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [phone,     setPhone]     = useState('');
  const [creating,  setCreating]  = useState(false);
  const [createErr, setCreateErr] = useState('');

  async function doSearch(q: string) {
    setQuery(q);
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const data = await searchCustomers(q);
      setResults(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }

  function select(c: any) {
    setCustomer(c);
    onClose();
  }

  async function handleCreate() {
    if (!firstName.trim() || !lastName.trim()) {
      setCreateErr('First and last name are required');
      return;
    }
    setCreating(true);
    setCreateErr('');
    try {
      const c = await createCustomer({
        first_name: firstName.trim(),
        last_name:  lastName.trim(),
        phone:      phone.trim() || undefined,
      });
      setCustomer(c);
      onClose();
    } catch (e: any) {
      setCreateErr(e.message ?? 'Failed to create customer');
    } finally {
      setCreating(false);
    }
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl w-full max-w-2xl p-6 max-h-[80vh] flex flex-col shadow-2xl border-t border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-slate-900 font-bold text-lg mb-4">Customer</p>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {(['search', 'create'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                tab === t ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {t === 'search' ? 'Search' : 'New Customer'}
            </button>
          ))}
        </div>

        {tab === 'search' && (
          <div className="flex flex-col gap-3 flex-1 min-h-0">
            {customer && (
              <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                <p className="text-slate-500 text-xs">Current:</p>
                <p className="flex-1 text-slate-900 font-semibold text-sm">
                  {customer.first_name} {customer.last_name}
                </p>
                <button
                  onClick={() => { setCustomer(null); onClose(); }}
                  className="text-indigo-600 text-xs underline"
                >
                  Walk-in
                </button>
              </div>
            )}
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => doSearch(e.target.value)}
              placeholder="Search by name, email or phone..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 text-sm placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition"
            />
            {loading && (
              <div className="flex justify-center py-3">
                <span className="w-5 h-5 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
              </div>
            )}
            <div className="overflow-y-auto flex-1 max-h-60">
              {results.map((item) => (
                <button
                  key={item.id}
                  onClick={() => select(item)}
                  className="w-full flex items-center gap-3 py-2.5 border-b border-slate-100 hover:bg-indigo-50/60 px-1 text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                    <span className="text-indigo-700 font-bold text-sm">
                      {item.first_name?.[0]}{item.last_name?.[0]}
                    </span>
                  </div>
                  <div>
                    <p className="text-slate-900 font-semibold text-sm">{item.first_name} {item.last_name}</p>
                    <p className="text-slate-400 text-xs mt-0.5">{item.phone ?? item.email ?? item.code}</p>
                  </div>
                </button>
              ))}
              {query.length >= 2 && !loading && results.length === 0 && (
                <p className="text-slate-400 text-center py-4 text-sm">No customers found.</p>
              )}
            </div>
          </div>
        )}

        {tab === 'create' && (
          <div className="flex flex-col gap-2.5">
            <input
              type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name *"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 text-sm placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition"
            />
            <input
              type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name *"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 text-sm placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition"
            />
            <input
              type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone (optional)"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 text-sm placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition"
            />
            {createErr && <p className="text-red-500 text-sm">{createErr}</p>}
            <button
              onClick={handleCreate}
              disabled={creating}
              className={`w-full py-3.5 rounded-xl font-bold text-sm transition-colors ${
                creating ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200'
              }`}
            >
              {creating ? 'Creating...' : 'Create & Select'}
            </button>
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-3 w-full py-3 bg-white border border-slate-200 rounded-xl text-slate-600 font-semibold hover:bg-slate-100 transition-colors text-sm"
        >
          Close
        </button>
      </div>
    </div>
  );
}
