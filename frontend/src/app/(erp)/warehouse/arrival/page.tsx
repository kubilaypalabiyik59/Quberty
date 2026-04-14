'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Plus } from 'lucide-react';

const STATUS_COLORS: Record<string, any> = { DRAFT: 'gray', POSTED: 'green' };

const columns = [
  { key: 'journal_number', label: 'Journal #' },
  { key: 'status', label: 'Status', render: (v: string) => <Badge color={STATUS_COLORS[v] ?? 'gray'}>{v}</Badge> },
  { key: 'arrival_date', label: 'Date', render: (v: string) => new Date(v).toLocaleDateString() },
  { key: 'lines', label: 'Lines', render: (v: any[]) => v?.length ?? 0 },
  { key: 'notes', label: 'Notes', render: (v: string) => v ?? '—' },
];

export default function ArrivalPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['arrival-journals'],
    queryFn: () => api.get('/warehouse/arrival-journals').then(r => r.data.data),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Arrival Journals</h1>
          <p className="text-gray-500">Record inbound stock receipts</p>
        </div>
        <Button><Plus className="h-4 w-4 mr-2" />New Journal</Button>
      </div>
      <DataTable columns={columns} data={data ?? []} isLoading={isLoading} />
    </div>
  );
}
