'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function ProfitLossPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const from = `${year}-${String(month).padStart(2,'0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2,'0')}-${lastDay}`;

  const { data, isLoading } = useQuery({
    queryKey: ['profit-loss', year, month],
    queryFn: () => api.get(`/finance/profit-loss?from=${from}&to=${to}`).then(r => r.data.data),
  });

  const netIncome = data?.net_income ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Profit & Loss</h1>
          <p className="text-sm text-gray-500 mt-0.5">Estado de Resultados — from posted journal entries</p>
        </div>
        <div className="flex gap-3">
          <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
          <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={year} onChange={e => setYear(Number(e.target.value))}>
            {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-green-500" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Revenue</p>
          </div>
          <p className="text-2xl font-bold text-green-600">Bs. {(data?.total_revenue ?? 0).toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="h-4 w-4 text-red-500" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Expenses</p>
          </div>
          <p className="text-2xl font-bold text-red-600">Bs. {(data?.total_expenses ?? 0).toFixed(2)}</p>
        </div>
        <div className={`rounded-xl border p-5 ${netIncome >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-2 mb-1">
            <Minus className={`h-4 w-4 ${netIncome >= 0 ? 'text-green-600' : 'text-red-600'}`} />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Net Income</p>
          </div>
          <p className={`text-2xl font-bold ${netIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            Bs. {netIncome.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Revenue */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-green-50 border-b border-green-100 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-600" />
            <h2 className="text-sm font-bold text-green-800">Revenue (4xxx)</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Code</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Account</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading && <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400 text-xs">Loading...</td></tr>}
              {!isLoading && (data?.revenue ?? []).length === 0 && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400 text-xs">No revenue entries for this period.</td></tr>
              )}
              {(data?.revenue ?? []).map((r: any) => (
                <tr key={r.code} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-400">{r.code}</td>
                  <td className="px-4 py-2 text-gray-900">{r.name}</td>
                  <td className="px-4 py-2 text-right font-medium text-green-600">Bs. {r.balance.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-gray-200 bg-green-50">
              <tr>
                <td colSpan={2} className="px-4 py-2 text-sm font-bold text-gray-700">Total Revenue</td>
                <td className="px-4 py-2 text-right font-bold text-green-700">Bs. {(data?.total_revenue ?? 0).toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Expenses */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-red-50 border-b border-red-100 flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-red-600" />
            <h2 className="text-sm font-bold text-red-800">Expenses (5xxx)</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Code</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Account</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading && <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400 text-xs">Loading...</td></tr>}
              {!isLoading && (data?.expenses ?? []).length === 0 && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400 text-xs">No expense entries for this period.</td></tr>
              )}
              {(data?.expenses ?? []).map((e: any) => (
                <tr key={e.code} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-400">{e.code}</td>
                  <td className="px-4 py-2 text-gray-900">{e.name}</td>
                  <td className="px-4 py-2 text-right font-medium text-red-600">Bs. {e.balance.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-gray-200 bg-red-50">
              <tr>
                <td colSpan={2} className="px-4 py-2 text-sm font-bold text-gray-700">Total Expenses</td>
                <td className="px-4 py-2 text-right font-bold text-red-700">Bs. {(data?.total_expenses ?? 0).toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Net Income summary */}
      <div className={`mt-4 rounded-xl border p-4 flex items-center justify-between ${netIncome >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
        <span className="font-bold text-gray-700">Net Income — {MONTHS[month-1]} {year}</span>
        <span className={`text-xl font-bold ${netIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>
          Bs. {netIncome.toFixed(2)} {netIncome >= 0 ? '▲ Profit' : '▼ Loss'}
        </span>
      </div>
    </div>
  );
}
