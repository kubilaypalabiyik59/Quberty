'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, X, Check, AlertCircle, BookOpen, ChevronDown } from 'lucide-react';

interface JELine { account_id: string; debit_amount: string; credit_amount: string; description: string; }

const emptyLine = (): JELine => ({ account_id: '', debit_amount: '', credit_amount: '', description: '' });

export default function JournalPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ entry_date: new Date().toISOString().split('T')[0], description: '', source_module: '' });
  const [lines, setLines] = useState<JELine[]>([emptyLine(), emptyLine()]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/finance/accounts').then(r => r.data.data),
  });

  const { data: entriesData, isLoading } = useQuery({
    queryKey: ['journal-entries'],
    queryFn: () => api.get('/finance/journal-entries?limit=50').then(r => ({ entries: r.data.data })),
  });

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit_amount) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit_amount) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const reset = () => {
    setShowForm(false);
    setForm({ entry_date: new Date().toISOString().split('T')[0], description: '', source_module: '' });
    setLines([emptyLine(), emptyLine()]);
    setError('');
  };

  const save = useMutation({
    mutationFn: () => api.post('/finance/journal-entries', {
      ...form,
      lines: lines.filter(l => l.account_id).map(l => ({
        account_id: l.account_id,
        debit_amount: Number(l.debit_amount) || 0,
        credit_amount: Number(l.credit_amount) || 0,
        description: l.description || null,
      })),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['journal-entries'] }); reset(); },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Failed to save'),
  });

  const post = useMutation({
    mutationFn: (id: string) => api.post(`/finance/journal-entries/${id}/post`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journal-entries'] }),
    onError: (err: any) => alert(err.response?.data?.message ?? 'Failed to post'),
  });

  const accountOptions = (accounts ?? []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Journal Entries</h1>
          <p className="text-sm text-gray-500 mt-0.5">Partidas contables — double-entry bookkeeping</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus className="h-4 w-4" /> New Entry
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-6 mb-6">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">New Journal Entry</h2>
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.entry_date} onChange={e => setForm(p => ({ ...p, entry_date: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-red-500">*</span></label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Venta de mercaderías al contado"
                value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
          </div>

          {/* Lines */}
          <div className="rounded-xl border border-gray-200 overflow-hidden mb-4">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Account</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 w-28">Description</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 w-32">Debit (Bs.)</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 w-32">Credit (Bs.)</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <select className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={line.account_id}
                        onChange={e => setLines(p => p.map((l, j) => j === i ? { ...l, account_id: e.target.value } : l))}>
                        <option value="">— pick account —</option>
                        {accountOptions.map((a: any) => (
                          <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Optional"
                        value={line.description}
                        onChange={e => setLines(p => p.map((l, j) => j === i ? { ...l, description: e.target.value } : l))} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" step="0.01" placeholder="0.00"
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={line.debit_amount}
                        onChange={e => setLines(p => p.map((l, j) => j === i ? { ...l, debit_amount: e.target.value, credit_amount: e.target.value ? '' : l.credit_amount } : l))} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" step="0.01" placeholder="0.00"
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={line.credit_amount}
                        onChange={e => setLines(p => p.map((l, j) => j === i ? { ...l, credit_amount: e.target.value, debit_amount: e.target.value ? '' : l.debit_amount } : l))} />
                    </td>
                    <td className="px-3 py-2">
                      {lines.length > 2 && (
                        <button onClick={() => setLines(p => p.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr>
                  <td className="px-3 py-2" colSpan={2}>
                    <button onClick={() => setLines(p => [...p, emptyLine()])}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
                      <Plus className="h-3 w-3" /> Add line
                    </button>
                  </td>
                  <td className={`px-3 py-2 text-right text-sm font-bold ${isBalanced ? 'text-green-600' : 'text-red-600'}`}>
                    {totalDebit.toFixed(2)}
                  </td>
                  <td className={`px-3 py-2 text-right text-sm font-bold ${isBalanced ? 'text-green-600' : 'text-red-600'}`}>
                    {totalCredit.toFixed(2)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {!isBalanced && totalDebit > 0 && (
            <p className="text-xs text-red-600 mb-3 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" /> Entry is not balanced. Difference: Bs. {Math.abs(totalDebit - totalCredit).toFixed(2)}
            </p>
          )}

          {error && (
            <div className="flex items-center gap-2 mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => save.mutate()}
              disabled={!form.description || !isBalanced || save.isPending}
              className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium">
              <Check className="h-4 w-4" /> {save.isPending ? 'Saving...' : 'Save as Draft'}
            </button>
            <button onClick={reset} className="border border-gray-200 text-gray-600 px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {isLoading && Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 bg-white rounded-xl border border-gray-200 animate-pulse" />
        ))}
        {!isLoading && (entriesData?.entries ?? []).length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <BookOpen className="h-10 w-10 mx-auto mb-2 text-gray-200" />
            <p>No journal entries yet.</p>
          </div>
        )}
        {(entriesData?.entries ?? []).map((entry: any) => (
          <div key={entry.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50"
              onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}>
              <div className="flex items-center gap-4">
                <span className="font-mono text-xs text-gray-400">{entry.entry_number}</span>
                <span className="text-xs text-gray-500">{new Date(entry.entry_date).toLocaleDateString()}</span>
                <span className="font-medium text-gray-900 text-sm">{entry.description}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${entry.status === 'POSTED' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {entry.status}
                </span>
                {entry.status === 'DRAFT' && (
                  <button onClick={e => { e.stopPropagation(); post.mutate(entry.id); }}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 px-2 py-1 rounded-lg">
                    Post
                  </button>
                )}
                <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${expandedId === entry.id ? 'rotate-180' : ''}`} />
              </div>
            </div>
            {expandedId === entry.id && (
              <div className="border-t border-gray-200">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-2 font-semibold text-gray-500">Account</th>
                      <th className="text-left px-4 py-2 font-semibold text-gray-500">Description</th>
                      <th className="text-right px-4 py-2 font-semibold text-gray-500">Debit (Bs.)</th>
                      <th className="text-right px-4 py-2 font-semibold text-gray-500">Credit (Bs.)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(entry.lines ?? []).map((line: any) => (
                      <tr key={line.id}>
                        <td className="px-4 py-2 font-mono">
                          <span className="text-gray-400">{line.account?.code}</span>
                          <span className="ml-2 text-gray-700">{line.account?.name}</span>
                        </td>
                        <td className="px-4 py-2 text-gray-500">{line.description ?? '—'}</td>
                        <td className="px-4 py-2 text-right font-medium">{Number(line.debit_amount) > 0 ? `Bs. ${Number(line.debit_amount).toFixed(2)}` : '—'}</td>
                        <td className="px-4 py-2 text-right font-medium">{Number(line.credit_amount) > 0 ? `Bs. ${Number(line.credit_amount).toFixed(2)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
