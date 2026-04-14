'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Lock, Unlock, AlertCircle } from 'lucide-react';
import { useState } from 'react';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function PeriodsPage() {
  const qc = useQueryClient();
  const [actionError, setActionError] = useState('');

  const { data: periods, isLoading } = useQuery({
    queryKey: ['accounting-periods'],
    queryFn: () => api.get('/finance/periods').then(r => r.data.data),
  });

  const close = useMutation({
    mutationFn: ({ year, month }: { year: number; month: number }) =>
      api.post(`/finance/periods/${year}/${month}/close`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounting-periods'] }); setActionError(''); },
    onError: (err: any) => setActionError(err.response?.data?.error?.message ?? 'Failed to close period'),
  });

  const reopen = useMutation({
    mutationFn: ({ year, month }: { year: number; month: number }) =>
      api.post(`/finance/periods/${year}/${month}/reopen`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounting-periods'] }); setActionError(''); },
    onError: (err: any) => setActionError(err.response?.data?.error?.message ?? 'Failed to reopen period'),
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Accounting Periods</h1>
        <p className="text-sm text-gray-500 mt-0.5">Close periods to prevent backdated journal entries</p>
      </div>

      {actionError && (
        <div className="flex items-center gap-2 mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0" /> {actionError}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800">
        <strong>Warning:</strong> Closing a period blocks all manual journal entries dated within that period. Auto-generated entries (from PO/SO) bypass this lock. Reopen is available to admins only.
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Period</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Closed At</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && Array.from({length:6}).map((_,i) => (
              <tr key={i}>{Array.from({length:4}).map((_,j) => <td key={j} className="px-6 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>)}</tr>
            ))}
            {(periods ?? []).map((p: any) => (
              <tr key={`${p.year}-${p.month}`} className="hover:bg-gray-50">
                <td className="px-6 py-3 font-medium text-gray-900">
                  {MONTHS[p.month - 1]} {p.year}
                </td>
                <td className="px-6 py-3">
                  {p.status === 'CLOSED' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-red-100 text-red-700 px-2.5 py-1 rounded-full">
                      <Lock className="h-3 w-3" /> Closed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-green-100 text-green-700 px-2.5 py-1 rounded-full">
                      <Unlock className="h-3 w-3" /> Open
                    </span>
                  )}
                </td>
                <td className="px-6 py-3 text-xs text-gray-500">
                  {p.closed_at ? new Date(p.closed_at).toLocaleDateString() : '—'}
                </td>
                <td className="px-6 py-3 text-right">
                  {p.status === 'OPEN' ? (
                    <button
                      onClick={() => { if (window.confirm(`Close ${MONTHS[p.month-1]} ${p.year}? This will block manual entries for this period.`)) close.mutate({ year: p.year, month: p.month }); }}
                      disabled={close.isPending}
                      className="inline-flex items-center gap-1.5 text-xs font-medium bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg">
                      <Lock className="h-3 w-3" /> Close Period
                    </button>
                  ) : (
                    <button
                      onClick={() => reopen.mutate({ year: p.year, month: p.month })}
                      disabled={reopen.isPending}
                      className="inline-flex items-center gap-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg">
                      <Unlock className="h-3 w-3" /> Reopen
                    </button>
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
