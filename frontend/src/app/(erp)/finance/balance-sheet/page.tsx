'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CheckCircle, AlertCircle } from 'lucide-react';

export default function BalanceSheetPage() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const { data, isLoading } = useQuery({
    queryKey: ['balance-sheet', date],
    queryFn: () => api.get(`/finance/balance-sheet?date=${date}`).then(r => r.data.data),
  });

  const Section = ({ title, rows, total, color }: { title: string; rows: any[]; total: number; color: string }) => (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
      <div className={`px-4 py-3 border-b ${color}`}>
        <h2 className="text-sm font-bold">{title}</h2>
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-50">
          {rows.length === 0 && (
            <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400 text-xs">No balances.</td></tr>
          )}
          {rows.map((r: any) => {
            const isNetIncome = r.code === '—';
            return (
              <tr key={r.code + r.name} className={isNetIncome ? 'bg-emerald-50' : 'hover:bg-gray-50'}>
                <td className="px-4 py-2 font-mono text-xs text-gray-400 w-16">{r.code}</td>
                <td className={`px-4 py-2 ${isNetIncome ? 'text-emerald-800 font-medium italic' : 'text-gray-900'}`}>{r.name}</td>
                <td className={`px-4 py-2 text-right font-medium ${isNetIncome ? (r.balance >= 0 ? 'text-emerald-700' : 'text-red-600') : 'text-gray-900'}`}>
                  Bs. {Number(r.balance).toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-2 border-gray-300 bg-gray-50">
          <tr>
            <td colSpan={2} className="px-4 py-2.5 font-bold text-gray-700">Total</td>
            <td className="px-4 py-2.5 text-right font-bold text-gray-900">Bs. {Number(total).toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Balance Sheet</h1>
          <p className="text-sm text-gray-500 mt-0.5">Balance General — as of selected date</p>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <span className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full ${data.is_balanced ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {data.is_balanced
                ? <><CheckCircle className="h-3.5 w-3.5" /> Balanced</>
                : <><AlertCircle className="h-3.5 w-3.5" /> Out of balance</>}
            </span>
          )}
          <input type="date"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>

      {isLoading && <div className="text-center py-20 text-gray-400">Loading balance sheet...</div>}

      {data && (
        <div className="grid grid-cols-2 gap-6">
          {/* Left — Assets */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Assets (1xxx)</p>
            <Section title="Assets" rows={data.assets} total={data.total_assets} color="bg-blue-50 border-blue-100 text-blue-800" />
          </div>

          {/* Right — Liabilities + Equity */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Liabilities + Equity</p>
            <Section title="Liabilities (2xxx)" rows={data.liabilities} total={data.total_liabilities} color="bg-red-50 border-red-100 text-red-800" />
            <Section title="Equity (3xxx)" rows={data.equity} total={data.total_equity} color="bg-purple-50 border-purple-100 text-purple-800" />

            <div className="bg-gray-800 rounded-xl p-4 flex items-center justify-between">
              <span className="font-bold text-white text-sm">Total Liabilities + Equity</span>
              <span className="font-bold text-white">Bs. {(data.total_liabilities_equity ?? 0).toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {data && (
        <div className={`mt-4 rounded-xl p-4 flex items-center justify-between text-sm font-medium ${data.is_balanced ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <span>Assets: <strong>Bs. {data.total_assets.toFixed(2)}</strong></span>
          <span>=</span>
          <span>Liabilities + Equity: <strong>Bs. {data.total_liabilities_equity.toFixed(2)}</strong></span>
          <span className={data.is_balanced ? 'text-green-700 font-bold' : 'text-red-700 font-bold'}>
            Diff: Bs. {Math.abs(data.total_assets - data.total_liabilities_equity).toFixed(2)}
          </span>
        </div>
      )}
    </div>
  );
}
