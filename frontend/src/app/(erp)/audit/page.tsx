'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ShieldCheck, Search } from 'lucide-react';

const METHOD_BADGE: Record<string, string> = {
  POST:   'bg-green-100 text-green-700',
  PUT:    'bg-blue-100 text-blue-700',
  PATCH:  'bg-amber-100 text-amber-700',
  DELETE: 'bg-red-100 text-red-600',
};

function statusColor(code: number): string {
  if (code >= 500) return 'text-red-600';
  if (code >= 400) return 'text-amber-600';
  return 'text-green-600';
}

export default function AuditLogPage() {
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', method, q, page],
    queryFn: () =>
      api.get(`/audit?page=${page}&limit=50${method ? `&method=${method}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
        .then(r => ({ logs: r.data.data, total: r.data.meta?.total ?? 0, pages: r.data.meta?.pages ?? 1 })),
  });

  const logs: any[] = data?.logs ?? [];
  const totalPages = data?.pages ?? 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500 mt-0.5">Every write operation, who did it, and when</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search by path or user email..."
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
          />
        </div>
        <select
          className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={method} onChange={e => { setMethod(e.target.value); setPage(1); }}>
          <option value="">All methods</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">When</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Method</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Path</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 6 }).map((_, j) => (
                <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
              ))}</tr>
            ))}
            {!isLoading && logs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center text-gray-400">
                  <ShieldCheck className="h-10 w-10 mx-auto mb-2 text-gray-200" />
                  <p>No audit entries match your filters.</p>
                </td>
              </tr>
            )}
            {logs.map(log => (
              <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <div className="text-gray-700">{log.user_email ?? '—'}</div>
                  {log.user_role && <div className="text-xs text-gray-400">{log.user_role}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold font-mono ${METHOD_BADGE[log.method] ?? 'bg-gray-100 text-gray-600'}`}>
                    {log.method}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs max-w-md truncate">{log.path}</td>
                <td className={`px-4 py-3 text-center font-semibold ${statusColor(log.status_code)}`}>{log.status_code}</td>
                <td className="px-4 py-3 text-right text-gray-400 text-xs">{log.duration_ms != null ? `${log.duration_ms}ms` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <span className="text-sm text-gray-500">Page {page} of {totalPages} ({data?.total ?? 0} entries)</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => p - 1)} disabled={page <= 1}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50">Previous</button>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
