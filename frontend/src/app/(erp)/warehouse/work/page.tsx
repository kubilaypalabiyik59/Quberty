'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';
import { CheckCircle, Clock, AlertCircle } from 'lucide-react';

const WORK_TYPE_LABELS: Record<string, string> = {
  PICK: 'Picking',
  PUTAWAY: 'Put-away',
  TRANSFER: 'Transfer',
  PACK: 'Packing',
};

export default function WarehouseWorkPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['warehouse-work'],
    queryFn: () => api.get('/warehouse/work?status=OPEN,IN_PROGRESS').then((r) => r.data.data),
    refetchInterval: 30000, // Auto-refresh every 30s
  });

  const startWork = useMutation({
    mutationFn: (workId: string) => api.post(`/warehouse/work/${workId}/start`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['warehouse-work'] }),
  });

  const completeWork = useMutation({
    mutationFn: (workId: string) => api.post(`/warehouse/work/${workId}/complete`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['warehouse-work'] }),
  });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading work tasks...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Warehouse Work</h1>
        <p className="text-gray-500">Pick, put-away, and transfer tasks</p>
      </div>

      <div className="grid gap-4">
        {(data ?? []).length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
            <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-400" />
            <p className="font-medium">No open work tasks</p>
            <p className="text-sm">All tasks are complete</p>
          </div>
        )}

        {(data ?? []).map((work: any) => (
          <div key={work.id} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-mono text-sm font-bold text-gray-900">{work.work_id_code}</span>
                  <Badge color={work.status === 'IN_PROGRESS' ? 'yellow' : 'gray'}>
                    {work.status}
                  </Badge>
                  <Badge color="blue">{WORK_TYPE_LABELS[work.work_type] ?? work.work_type}</Badge>
                </div>
                <p className="text-sm text-gray-500">
                  {work.reference_type === 'sales_order' ? `Order: ${work.reference_id}` : work.reference_type}
                </p>
              </div>
              <div className="flex gap-2">
                {work.status === 'OPEN' && (
                  <Button
                    size="sm"
                    onClick={() => startWork.mutate(work.id)}
                    disabled={startWork.isPending}
                  >
                    Start
                  </Button>
                )}
                {work.status === 'IN_PROGRESS' && (
                  <Button
                    size="sm"
                    variant="success"
                    onClick={() => completeWork.mutate(work.id)}
                    disabled={completeWork.isPending}
                  >
                    Complete
                  </Button>
                )}
              </div>
            </div>

            {/* Work Lines */}
            <div className="mt-4 space-y-2">
              {(work.lines ?? []).map((line: any) => (
                <div key={line.id} className="flex items-center gap-3 text-sm bg-gray-50 rounded-lg px-3 py-2">
                  {line.status === 'DONE'
                    ? <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                    : line.status === 'SHORT'
                    ? <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                    : <Clock className="h-4 w-4 text-gray-400 shrink-0" />
                  }
                  <span className="font-medium w-12 text-gray-500">{line.line_type}</span>
                  <span className="flex-1">{line.product?.name ?? line.product_id}</span>
                  <span className="text-gray-500">Qty: {line.quantity}</span>
                  {line.from_location && (
                    <span className="text-gray-400">From: {line.from_location.code}</span>
                  )}
                  {line.to_location && (
                    <span className="text-gray-400">To: {line.to_location.code}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
