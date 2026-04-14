import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';

const STATUS_COLORS: Record<string, 'gray' | 'blue' | 'yellow' | 'purple' | 'orange' | 'green' | 'red'> = {
  DRAFT: 'gray', CONFIRMED: 'blue', PICKING: 'yellow',
  PACKED: 'purple', SHIPPED: 'orange', COMPLETED: 'green', CANCELLED: 'red',
};

interface Order {
  id: string;
  order_number: string;
  status: string;
  total_amount: number;
  created_at: string;
  customer?: { first_name: string; last_name: string };
}

export function RecentOrdersTable({ orders }: { orders: Order[] }) {
  if (!orders.length) return <p className="text-sm text-gray-400 text-center py-6">No recent orders</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="pb-2 text-left font-medium text-gray-500">Order #</th>
            <th className="pb-2 text-left font-medium text-gray-500">Customer</th>
            <th className="pb-2 text-left font-medium text-gray-500">Status</th>
            <th className="pb-2 text-right font-medium text-gray-500">Total</th>
            <th className="pb-2 text-right font-medium text-gray-500">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {orders.map((order) => (
            <tr key={order.id} className="hover:bg-gray-50">
              <td className="py-2.5">
                <Link href={`/sales/orders/${order.id}`} className="font-medium text-blue-600 hover:underline">
                  {order.order_number}
                </Link>
              </td>
              <td className="py-2.5 text-gray-600">
                {order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : '—'}
              </td>
              <td className="py-2.5">
                <Badge color={STATUS_COLORS[order.status] ?? 'gray'}>{order.status}</Badge>
              </td>
              <td className="py-2.5 text-right font-medium">Bs. {Number(order.total_amount).toLocaleString()}</td>
              <td className="py-2.5 text-right text-gray-400">{new Date(order.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
