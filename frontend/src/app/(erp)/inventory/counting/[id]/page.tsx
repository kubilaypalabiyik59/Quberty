'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle, Save, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

export default function CountDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [counts, setCounts] = useState<Record<string, number | ''>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data: count, isLoading } = useQuery({
    queryKey: ['inventory-count', id],
    queryFn: () => api.get(`/inventory-counts/${id}`).then(r => r.data.data),
    onSuccess: (data: any) => {
      const initial: Record<string, number | ''> = {};
      data.lines.forEach((l: any) => {
        initial[l.id] = l.counted_qty ?? '';
      });
      setCounts(initial);
    },
  });

  const updateLine = async (lineId: string, val: number) => {
    setSaving(lineId);
    try {
      await api.put(`/inventory-counts/${id}/lines/${lineId}`, { counted_qty: val });
      qc.invalidateQueries({ queryKey: ['inventory-count', id] });
    } finally {
      setSaving(null);
    }
  };

  const finalize = useMutation({
    mutationFn: () => api.post(`/inventory-counts/${id}/finalize`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-count', id] });
      qc.invalidateQueries({ queryKey: ['inventory-counts'] });
      router.push('/inventory/counting');
    },
    onError: (err: any) => setError(err.response?.data?.message ?? 'Failed to finalize'),
  });

  if (isLoading) return <div className="text-gray-400 py-12 text-center">Loading...</div>;
  if (!count) return <div className="text-gray-400 py-12 text-center">Count not found.</div>;

  const isFinalized = count.status === 'FINALIZED';
  const lines = count.lines ?? [];
  const linesWithDiff = lines.map((l: any) => ({
    ...l,
    current_counted: counts[l.id] !== undefined ? counts[l.id] : (l.counted_qty ?? ''),
    diff: counts[l.id] !== '' && counts[l.id] !== undefined ? Number(counts[l.id]) - l.system_qty : (l.counted_qty !== null ? l.counted_qty - l.system_qty : null),
  }));

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/inventory/counting" className="text-gray-400 hover:text-gray-700">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{count.reference}</h1>
          <p className="text-sm text-gray-500">{count.notes || 'Inventory Count Session'}</p>
        </div>
        <div className="flex items-center gap-3">
          {isFinalized ? (
            <span className="flex items-center gap-1.5 bg-green-100 text-green-700 px-4 py-2 rounded-lg text-sm font-medium">
              <CheckCircle className="h-4 w-4" /> Finalized
            </span>
          ) : (
            <button
              onClick={() => finalize.mutate()}
              disabled={finalize.isPending}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <CheckCircle className="h-4 w-4" />
              {finalize.isPending ? 'Finalizing...' : 'Finalize Count'}
            </button>
          )}
        </div>
      </div>

      {!isFinalized && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">How to use this count</p>
            <p className="text-sm text-amber-700 mt-0.5">Enter the physical quantities you counted for each item. When done, click "Finalize Count" — the system will create adjustment transactions for any differences.</p>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600 mb-4 bg-red-50 px-4 py-3 rounded-xl">{error}</p>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Product</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Variant</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Location</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">System Qty</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Counted Qty</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Difference</th>
              <th className="px-4 py-3 w-12" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linesWithDiff.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">No items in this count session.</td></tr>
            )}
            {linesWithDiff.map((line: any) => {
              const hasDiff = line.diff !== null && line.diff !== 0;
              return (
                <tr key={line.id} className={`hover:bg-gray-50 transition-colors ${hasDiff ? 'bg-orange-50/50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 text-xs">{line.product?.name}</div>
                    <div className="text-gray-400 text-xs font-mono">{line.product?.sku}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {line.variant
                      ? (line.variant.attributes ? Object.values(line.variant.attributes as Record<string,string>).join(' / ') : line.variant.sku_variant)
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {line.location?.zone?.warehouse?.name} › {line.location?.code}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-gray-700">{line.system_qty}</td>
                  <td className="px-4 py-3 text-right">
                    {isFinalized ? (
                      <span className="font-mono font-semibold text-gray-700">{line.counted_qty ?? '—'}</span>
                    ) : (
                      <input
                        type="number"
                        min="0"
                        className="w-20 text-right border border-gray-200 rounded-lg px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={counts[line.id] ?? ''}
                        onChange={e => setCounts(p => ({ ...p, [line.id]: e.target.value === '' ? '' : Number(e.target.value) }))}
                        onBlur={() => {
                          const v = counts[line.id];
                          if (v !== '' && v !== undefined) updateLine(line.id, Number(v));
                        }}
                      />
                    )}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono font-semibold text-sm ${
                    line.diff === null ? 'text-gray-300' :
                    line.diff > 0 ? 'text-green-600' :
                    line.diff < 0 ? 'text-red-600' :
                    'text-gray-400'
                  }`}>
                    {line.diff === null ? '—' : line.diff > 0 ? `+${line.diff}` : line.diff === 0 ? '✓' : line.diff}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {saving === line.id && <Save className="h-3.5 w-3.5 text-blue-400 animate-spin mx-auto" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
