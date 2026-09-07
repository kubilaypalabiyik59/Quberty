'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { BarChart3, Download } from 'lucide-react';
import { IvaReportPDFButton } from '@/components/erp/finance/IvaReportPDFButton';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export default function IvaReportPage() {
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);

  const { data, isLoading } = useQuery({
    queryKey: ['iva-report', year, month],
    queryFn: () => api.get(`/finance/iva-report?year=${year}&month=${month}`).then(r => r.data.data),
  });

  const { data: trialData } = useQuery({
    queryKey: ['trial-balance'],
    queryFn: () => api.get('/finance/trial-balance').then(r => r.data.data),
  });

  const { data: ivaNet } = useQuery({
    queryKey: ['iva-net', year, month],
    queryFn: () => api.get(`/finance/iva-net-report?year=${year}&month=${month}`).then(r => r.data.data),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">IVA Report</h1>
          <p className="text-sm text-gray-500 mt-0.5">Libro de Ventas — Débito Fiscal mensual</p>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-3 mb-6">
        <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          value={month} onChange={e => setMonth(Number(e.target.value))}>
          {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          value={year} onChange={e => setYear(Number(e.target.value))}>
          {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {data && (
          <IvaReportPDFButton
            facturas={data.facturas ?? []}
            totals={data.totals}
            year={year}
            month={month}
          />
        )}
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Subtotal Neto', value: data.totals.subtotal, color: 'text-gray-900' },
            { label: 'IVA Débito Fiscal (13%)', value: data.totals.iva, color: 'text-blue-600' },
            { label: 'IT (3% sobre neto)', value: data.totals.it, color: 'text-orange-600' },
            { label: 'Total Facturado', value: data.totals.total, color: 'text-green-600' },
          ].map(card => (
            <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 font-medium mb-1">{card.label}</p>
              <p className={`text-xl font-bold ${card.color}`}>Bs. {card.value.toFixed(2)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Factura detail */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-700">
            Libro de Ventas — {MONTHS[month - 1]} {year}
          </h2>
          <span className="text-xs text-gray-400">{data?.facturas?.length ?? 0} facturas</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Factura #</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Fecha</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Cliente</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">NIT/CI</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Subtotal</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">IVA 13%</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">IT 3%</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && Array.from({ length: 3 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 8 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>)}</tr>
            ))}
            {!isLoading && (data?.facturas ?? []).length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 text-sm">No facturas for this period.</td></tr>
            )}
            {(data?.facturas ?? []).map((f: any) => (
              <tr key={f.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono font-bold">{f.factura_number}</td>
                <td className="px-4 py-2 text-xs text-gray-500">{new Date(f.invoice_date).toLocaleDateString()}</td>
                <td className="px-4 py-2 text-gray-900">{f.customer_name}</td>
                <td className="px-4 py-2 font-mono text-xs text-gray-400">{f.customer_nit ?? '—'}</td>
                <td className="px-4 py-2 text-right">Bs. {Number(f.subtotal).toFixed(2)}</td>
                <td className="px-4 py-2 text-right text-blue-600">Bs. {Number(f.iva_amount).toFixed(2)}</td>
                <td className="px-4 py-2 text-right text-orange-600">Bs. {Number(f.it_amount).toFixed(2)}</td>
                <td className="px-4 py-2 text-right font-bold">Bs. {Number(f.total_amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* IVA Net (Débito vs Crédito) */}
      {ivaNet && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-bold text-gray-700 mb-4">IVA Net Payable — {MONTHS[month-1]} {year}</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <p className="text-xs text-red-600 font-semibold mb-1">Débito Fiscal (Sales)</p>
              <p className="text-lg font-bold text-red-700">Bs. {ivaNet.debito_fiscal.toFixed(2)}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-xs text-green-600 font-semibold mb-1">Crédito Fiscal (Purchases)</p>
              <p className="text-lg font-bold text-green-700">Bs. {ivaNet.credito_fiscal.toFixed(2)}</p>
            </div>
            <div className={`rounded-lg p-3 text-center ${ivaNet.net_payable >= 0 ? 'bg-orange-50' : 'bg-blue-50'}`}>
              <p className={`text-xs font-semibold mb-1 ${ivaNet.net_payable >= 0 ? 'text-orange-600' : 'text-blue-600'}`}>Net IVA Payable to SIN</p>
              <p className={`text-lg font-bold ${ivaNet.net_payable >= 0 ? 'text-orange-700' : 'text-blue-700'}`}>
                Bs. {ivaNet.net_payable.toFixed(2)}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{ivaNet.net_payable >= 0 ? 'You owe the government' : 'Credit in your favour'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Trial Balance */}
      {trialData && trialData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h2 className="text-sm font-bold text-gray-700">Trial Balance (all posted entries)</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Code</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Account</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Type</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Total Debit</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Total Credit</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {trialData.map((a: any) => (
                <tr key={a.account_id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-400">{a.code}</td>
                  <td className="px-4 py-2 font-medium text-gray-900">{a.name}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{a.type}</td>
                  <td className="px-4 py-2 text-right text-xs">{a.total_debit > 0 ? `Bs. ${a.total_debit.toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-2 text-right text-xs">{a.total_credit > 0 ? `Bs. ${a.total_credit.toFixed(2)}` : '—'}</td>
                  <td className={`px-4 py-2 text-right font-bold text-xs ${a.balance > 0 ? 'text-blue-600' : a.balance < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                    Bs. {a.balance.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
