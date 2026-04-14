'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Clock } from 'lucide-react';
import Link from 'next/link';

const BUCKETS = ['0-30', '31-60', '61-90', '90+'];
const BUCKET_COLOR: Record<string, string> = {
  '0-30':  'bg-green-100 text-green-700',
  '31-60': 'bg-yellow-100 text-yellow-700',
  '61-90': 'bg-orange-100 text-orange-700',
  '90+':   'bg-red-100 text-red-700',
};

export default function AgingPage() {
  const [tab, setTab] = useState<'ap' | 'ar'>('ap');

  const apQuery = useQuery({
    queryKey: ['ap-aging'],
    queryFn: () => api.get('/finance/ap-aging').then(r => r.data.data),
    enabled: tab === 'ap',
  });

  const arQuery = useQuery({
    queryKey: ['ar-aging'],
    queryFn: () => api.get('/finance/ar-aging').then(r => r.data.data),
    enabled: tab === 'ar',
  });

  const data = tab === 'ap' ? apQuery.data : arQuery.data;
  const isLoading = tab === 'ap' ? apQuery.isLoading : arQuery.isLoading;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Aging Report</h1>
          <p className="text-sm text-gray-500 mt-0.5">Outstanding balances by age (days)</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setTab('ap')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'ap' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            AP Aging (Payables)
          </button>
          <button onClick={() => setTab('ar')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'ar' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            AR Aging (Receivables)
          </button>
        </div>
      </div>

      {/* Summary buckets */}
      {data && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {BUCKETS.map(b => (
            <div key={b} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-gray-400" />
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${BUCKET_COLOR[b]}`}>{b} days</span>
              </div>
              <p className="text-xl font-bold text-gray-900">Bs. {(data.summary[b] ?? 0).toFixed(2)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Total */}
      {data && (
        <div className="bg-gray-800 text-white rounded-xl p-4 flex items-center justify-between mb-6">
          <span className="font-semibold">{tab === 'ap' ? 'Total Outstanding AP' : 'Total Outstanding AR'}</span>
          <span className="text-xl font-bold">Bs. {(data.total ?? 0).toFixed(2)}</span>
        </div>
      )}

      {/* Detail table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-sm font-bold text-gray-700">
            {tab === 'ap' ? 'Unpaid Purchase Orders' : 'Uninvoiced / Unpaid Sales Orders'}
          </h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Ref #</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">{tab === 'ap' ? 'Supplier' : 'Customer'}</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Date</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Age</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && Array.from({length:3}).map((_,i) => (
              <tr key={i}>{Array.from({length:5}).map((_,j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>)}</tr>
            ))}
            {!isLoading && (data?.rows ?? []).length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400 text-sm">
                No outstanding {tab === 'ap' ? 'payables' : 'receivables'}.
              </td></tr>
            )}
            {(data?.rows ?? []).map((row: any) => (
              <tr key={row.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono font-semibold text-xs">
                  {tab === 'ap'
                    ? <Link href={`/purchase/orders/${row.id}`} className="text-blue-600 hover:underline">{row.po_number}</Link>
                    : <span className="text-gray-900">{row.order_number}</span>}
                </td>
                <td className="px-4 py-2 text-gray-700 text-sm">
                  {tab === 'ap'
                    ? row.supplier?.name ?? '—'
                    : row.customer ? `${row.customer.first_name} ${row.customer.last_name}` : 'Walk-in'}
                </td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {new Date(tab === 'ap' ? (row.received_at ?? row.created_at) : row.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${BUCKET_COLOR[row.bucket]}`}>
                    {row.age_days}d ({row.bucket})
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-medium text-gray-900">
                  Bs. {Number(row.total_amount).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
