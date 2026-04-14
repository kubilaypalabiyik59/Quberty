'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

const STATUS_COLORS: Record<string, any> = { OPEN: 'blue', RELEASED: 'yellow', COMPLETED: 'green' };

export default function WavesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['waves'],
    queryFn: () => api.get('/warehouse/waves').then(r => r.data.data),
  });

  const release = useMutation({
    mutationFn: (id: string) => api.post(`/warehouse/waves/${id}/release`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['waves'] }),
  });

  const columns = [
    { key: 'id', label: 'Wave ID', render: (v: string) => v.slice(0, 8) + '...' },
    { key: 'status', label: 'Status', render: (v: string) => <Badge color={STATUS_COLORS[v] ?? 'gray'}>{v}</Badge> },
    { key: '_count', label: 'Work Tasks', render: (v: any) => v?.work ?? 0 },
    { key: 'created_at', label: 'Created', render: (v: string) => new Date(v).toLocaleString() },
    { key: 'released_at', label: 'Released', render: (v: string) => v ? new Date(v).toLocaleString() : '—' },
    { key: 'id', label: 'Action', render: (v: string, row: any) => row.status === 'OPEN' ? (
      <Button size="sm" onClick={() => release.mutate(v)}>Release</Button>
    ) : null },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Waves</h1>
        <p className="text-gray-500">Batch picking waves for outbound orders</p>
      </div>
      <DataTable columns={columns} data={data ?? []} isLoading={isLoading} />
    </div>
  );
}
