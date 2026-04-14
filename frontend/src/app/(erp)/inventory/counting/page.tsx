'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, ClipboardList, CheckCircle, Clock } from 'lucide-react';
import Link from 'next/link';

export default function InventoryCountingPage() {
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  const { data: counts, isLoading } = useQuery({
    queryKey: ['inventory-counts'],
    queryFn: () => api.get('/inventory-counts').then(r => r.data.data),
  });

  const create = useMutation({
    mutationFn: () => api.post('/inventory-counts', { notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-counts'] });
      setShowForm(false);
      setNotes('');
      setError('');
    },
    onError: (err: any) => setError(err.response?.data?.message ?? 'Failed to create count'),
  });

  const statusBadge = (status: string) => {
    if (status === 'FINALIZED') return <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-2.5 py-1 rounded-full text-xs font-medium"><CheckCircle className="h-3 w-3" /> Finalized</span>;
    if (status === 'IN_PROGRESS') return <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full text-xs font-medium"><Clock className="h-3 w-3" /> In Progress</span>;
    return <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full text-xs font-medium">{status}</span>;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Counting</h1>
          <p className="text-sm text-gray-500 mt-0.5">Create count sessions to verify and adjust physical stock</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="h-4 w-4" /> New Count
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-blue-200 p-5 mb-6 shadow-sm">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">New Counting Session</h2>
          <p className="text-xs text-gray-500 mb-3">This will create a count session pre-populated with all current stock levels. You then enter the physical counted quantities and finalize.</p>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <input
              type="text"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Monthly stock count - April 2026"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          <div className="flex gap-3">
            <button
              onClick={() => create.mutate()}
              disabled={create.isPending}
              className="bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {create.isPending ? 'Creating...' : 'Create Count Session'}
            </button>
            <button onClick={() => setShowForm(false)} className="border border-gray-200 text-gray-600 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Reference</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Lines</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Finalized</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && Array.from({ length: 3 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 6 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>)}</tr>
            ))}
            {!isLoading && (counts ?? []).length === 0 && (
              <tr><td colSpan={6} className="px-4 py-16 text-center text-gray-400">
                <ClipboardList className="h-10 w-10 mx-auto mb-2 text-gray-200" />
                <p className="text-sm">No counting sessions yet.</p>
              </td></tr>
            )}
            {(counts ?? []).map((c: any) => (
              <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono font-medium text-gray-900">{c.reference}</td>
                <td className="px-4 py-3">{statusBadge(c.status)}</td>
                <td className="px-4 py-3 text-center text-gray-600">{c.lines?.length ?? 0}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{new Date(c.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{c.finalized_at ? new Date(c.finalized_at).toLocaleString() : '—'}</td>
                <td className="px-4 py-3">
                  {c.status === 'IN_PROGRESS' && (
                    <Link href={`/inventory/counting/${c.id}`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                      Open →
                    </Link>
                  )}
                  {c.status === 'FINALIZED' && (
                    <Link href={`/inventory/counting/${c.id}`} className="text-xs text-gray-500 hover:text-gray-700 font-medium">
                      View
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
