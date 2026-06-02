'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import Link from 'next/link';
import { AlertTriangle, PackageCheck, Truck } from 'lucide-react';

export default function LowStockPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['low-stock'],
    queryFn: () => api.get('/inventory/low-stock').then(r => r.data.data as any[]),
  });

  const items: any[] = data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Low Stock</h1>
          <p className="text-sm text-gray-500 mt-0.5">Products at or below their reorder point</p>
        </div>
        {!isLoading && items.length > 0 && (
          <span className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-800 text-sm font-semibold px-3 py-1.5 rounded-full">
            <AlertTriangle className="h-4 w-4" /> {items.length} need attention
          </span>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Product</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">SKU</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Available</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Reorder Point</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Shortfall</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 6 }).map((_, j) => (
                <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
              ))}</tr>
            ))}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center text-gray-400">
                  <PackageCheck className="h-10 w-10 mx-auto mb-2 text-green-200" />
                  <p>All monitored products are above their reorder point. 🎉</p>
                  <p className="text-xs mt-1">Set a reorder point on a product to start monitoring it.</p>
                </td>
              </tr>
            )}
            {items.map(item => {
              const critical = item.available === 0;
              return (
                <tr key={item.id} className={`transition-colors ${critical ? 'bg-red-50/40' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{item.sku}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${critical ? 'text-red-600' : 'text-amber-600'}`}>
                    {item.available}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">{item.reorder_point}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                      -{item.shortfall}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href="/purchase/orders"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
                      <Truck className="h-3.5 w-3.5" /> Reorder
                    </Link>
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
