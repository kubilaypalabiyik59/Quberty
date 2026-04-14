'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CheckCircle, XCircle, Landmark } from 'lucide-react';

const fmt = (n: number) =>
  n.toLocaleString('es-BO', { style: 'currency', currency: 'BOB', minimumFractionDigits: 2 });

export default function BankReconciliationPage() {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [statementBalance, setStatementBalance] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['bank-rec', year, month, submitted],
    queryFn: () =>
      api
        .get('/finance/bank-reconciliation', {
          params: { year, month, ...(statementBalance ? { statement_balance: statementBalance } : {}) },
        })
        .then((r) => r.data.data),
    enabled: submitted,
  });

  const handleLoad = () => setSubmitted(true);

  const sourceLabel: Record<string, string> = {
    PURCHASE: 'Compra',
    SALES:    'Venta',
    PAYROLL:  'Planilla',
    MANUAL:   'Manual',
    SALES_COGS: 'COGS',
    SALES_RETURN: 'Devolución',
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Landmark className="w-6 h-6 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bank Reconciliation</h1>
          <p className="text-sm text-gray-500 mt-0.5">Account 1101 — Banco. Compare book balance to bank statement.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-wrap gap-4 items-end mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => { setYear(Number(e.target.value)); setSubmitted(false); }}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-24"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Month</label>
          <select
            value={month}
            onChange={(e) => { setMonth(Number(e.target.value)); setSubmitted(false); }}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(2000, i).toLocaleString('es-BO', { month: 'long' })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Bank Statement Balance (BOB)</label>
          <input
            type="number"
            step="0.01"
            placeholder="Enter from bank statement"
            value={statementBalance}
            onChange={(e) => { setStatementBalance(e.target.value); setSubmitted(false); }}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-52"
          />
        </div>
        <button
          onClick={handleLoad}
          className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-800"
        >
          Load
        </button>
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading...</p>}
      {error && <p className="text-red-600 text-sm">Error loading reconciliation data.</p>}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">Opening Balance</p>
              <p className="text-lg font-semibold text-gray-800">{fmt(data.opening_balance)}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">Book Balance (ERP)</p>
              <p className="text-lg font-semibold text-blue-700">{fmt(data.book_balance)}</p>
            </div>
            {data.statement_balance !== null && (
              <>
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">Statement Balance</p>
                  <p className="text-lg font-semibold text-gray-800">{fmt(data.statement_balance)}</p>
                </div>
                <div className={`border rounded-lg p-4 flex items-center gap-3 ${data.is_reconciled ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  {data.is_reconciled ? (
                    <CheckCircle className="w-6 h-6 text-green-600 shrink-0" />
                  ) : (
                    <XCircle className="w-6 h-6 text-red-600 shrink-0" />
                  )}
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Difference</p>
                    <p className={`text-lg font-semibold ${data.is_reconciled ? 'text-green-700' : 'text-red-700'}`}>
                      {fmt(data.difference ?? 0)}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Ledger */}
          {data.ledger.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No transactions on account 1101 this period.</div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Entry #</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Date</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Description</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Source</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Debit</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Credit</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr className="bg-gray-50">
                    <td colSpan={6} className="px-4 py-2 text-xs text-gray-500 italic">Opening Balance</td>
                    <td className="text-right px-4 py-2 font-medium text-gray-700">{fmt(data.opening_balance)}</td>
                  </tr>
                  {data.ledger.map((row: any, i: number) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs text-gray-600">{row.entry_number}</td>
                      <td className="px-4 py-2 text-gray-600">{new Date(row.entry_date).toLocaleDateString('es-BO')}</td>
                      <td className="px-4 py-2 text-gray-800">
                        <div>{row.description}</div>
                        {row.line_description && <div className="text-xs text-gray-400">{row.line_description}</div>}
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                          {sourceLabel[row.source_module] ?? row.source_module ?? '—'}
                        </span>
                      </td>
                      <td className="text-right px-4 py-2 text-green-700">{row.debit > 0 ? fmt(row.debit) : ''}</td>
                      <td className="text-right px-4 py-2 text-red-600">{row.credit > 0 ? fmt(row.credit) : ''}</td>
                      <td className="text-right px-4 py-2 font-medium text-gray-800">{fmt(row.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
