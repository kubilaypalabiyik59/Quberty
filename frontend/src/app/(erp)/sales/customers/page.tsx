'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Search, Plus, History } from 'lucide-react';
import { TransactionsModal } from '@/components/erp/TransactionsModal';

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [txCustomer, setTxCustomer] = useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', page, search],
    queryFn: () => api.get(`/customers?page=${page}&limit=20${search ? `&search=${search}` : ''}`).then(r => ({ customers: r.data.data, total: r.data.meta?.total ?? 0 })),
  });

  const columns = [
    { key: 'code', label: 'Code' },
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'city', label: 'City' },
    { key: 'segment', label: 'Segment' },
    { key: 'total_orders', label: 'Orders' },
    { key: 'lifetime_value', label: 'LTV', render: (v: number) => `Bs. ${Number(v).toLocaleString()}` },
    {
      key: 'id',
      label: '',
      render: (_: any, row: any) => (
        <button
          onClick={() => setTxCustomer(row)}
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors whitespace-nowrap"
        >
          <History className="h-3.5 w-3.5" /> Transactions
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {txCustomer && (
        <TransactionsModal
          title={`${txCustomer.first_name} ${txCustomer.last_name} (${txCustomer.code})`}
          queryParams={{ customer_id: txCustomer.id }}
          onClose={() => setTxCustomer(null)}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-500">Manage your customer base</p>
        </div>
        <Button><Plus className="h-4 w-4 mr-2" />New Customer</Button>
      </div>
      <div className="bg-white p-4 rounded-xl border border-gray-200">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      <DataTable columns={columns} data={data?.customers ?? []} isLoading={isLoading} pagination={{ page, total: data?.total ?? 0, limit: 20, onPageChange: setPage }} />
    </div>
  );
}
