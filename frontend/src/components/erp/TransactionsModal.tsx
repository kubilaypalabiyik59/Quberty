'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { X, ArrowRightLeft } from 'lucide-react';

interface TransactionsModalProps {
  title: string;
  queryParams: Record<string, string>;
  onClose: () => void;
}

const TX_TYPE_COLOR: Record<string, string> = {
  INBOUND:          'bg-green-100 text-green-700',
  OUTBOUND:         'bg-red-100 text-red-600',
  PURCHASE_RECEIPT: 'bg-blue-100 text-blue-700',
  TRANSFER_IN:      'bg-purple-100 text-purple-700',
  TRANSFER_OUT:     'bg-orange-100 text-orange-700',
  ADJUSTMENT:       'bg-gray-100 text-gray-600',
};

export function TransactionsModal({ title, queryParams, onClose }: TransactionsModalProps) {
  const params = new URLSearchParams({ ...queryParams, limit: '100' }).toString();

  const { data: txs, isLoading } = useQuery({
    queryKey: ['inventory-transactions', queryParams],
    queryFn: () => api.get(`/inventory/transactions?${params}`).then(r => r.data.data),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
              <ArrowRightLeft className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Inventory Transactions</h2>
              <p className="text-xs text-gray-500">{title}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1.5 hover:bg-gray-100 rounded-lg">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Date</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Product</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Variant</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">From → To</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Qty</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Unit Cost</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 8 }).map((_, j) => (
                  <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                ))}</tr>
              ))}
              {!isLoading && (txs ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400 text-sm">
                    No transactions found.
                  </td>
                </tr>
              )}
              {(txs ?? []).map((tx: any) => (
                <tr key={tx.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(tx.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TX_TYPE_COLOR[tx.transaction_type] ?? 'bg-gray-100 text-gray-600'}`}>
                      {tx.transaction_type.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900 text-xs">{tx.product?.name}</div>
                    <div className="text-xs font-mono text-gray-400">{tx.product?.sku}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {tx.variant?.sku_variant ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 font-mono whitespace-nowrap">
                    {tx.from_location?.code ?? '—'} → {tx.to_location?.code ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{tx.quantity}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500 text-xs whitespace-nowrap">
                    {tx.unit_cost ? `Bs. ${Number(tx.unit_cost).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-xs text-gray-700">{tx.reference_number ?? '—'}</div>
                    {tx.notes && (
                      <div className="text-xs text-gray-400 mt-0.5 max-w-[160px] truncate" title={tx.notes}>{tx.notes}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {(txs ?? []).length} transaction{(txs ?? []).length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={onClose}
            className="text-sm font-medium text-gray-600 hover:text-gray-900 border border-gray-200 px-4 py-1.5 rounded-lg hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
