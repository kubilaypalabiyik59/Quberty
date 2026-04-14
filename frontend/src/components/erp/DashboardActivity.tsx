'use client';

import { motion, type Variants } from 'framer-motion';
import Link from 'next/link';
import { ShoppingCart, BookOpen, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';

const STATUS_COLORS: Record<string, 'gray' | 'blue' | 'yellow' | 'purple' | 'orange' | 'green' | 'red'> = {
  DRAFT: 'gray', CONFIRMED: 'blue', PICKING: 'yellow',
  PACKED: 'purple', SHIPPED: 'orange', COMPLETED: 'green', CANCELLED: 'red',
};

const MODULE_LABEL: Record<string, string> = {
  SALES_INVOICE:   'Sales Invoice',
  SALES_PAYMENT:   'AR Payment',
  PURCHASE:        'PO Receipt',
  PURCHASE_PAYMENT:'AP Payment',
};

interface Order {
  id: string;
  order_number: string;
  status: string;
  total_amount: number;
  created_at: string;
  customer?: { first_name: string; last_name: string } | null;
}

interface JournalEntry {
  entry_number: string;
  description: string;
  entry_date: string;
  source_module: string | null;
}

interface Props {
  orders: Order[];
  journalEntries: JournalEntry[];
}

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const itemVariants: Variants = {
  hidden:  { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 400, damping: 28 } },
};

export function DashboardActivity({ orders, journalEntries }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Recent Orders */}
      <div className="bg-white rounded-xl p-6" style={{ border: '1px solid rgba(220,38,38,0.12)', borderLeft: '3px solid rgba(185,28,28,0.5)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-700">Recent Orders</h2>
          </div>
          <Link href="/sales/orders" className="text-xs text-blue-600 hover:underline font-medium">View all →</Link>
        </div>

        {orders.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No orders yet</p>
        ) : (
          <motion.ul
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-3"
          >
            {orders.map((order) => (
              <motion.li key={order.id} variants={itemVariants}
                className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                    <ShoppingCart className="h-4 w-4 text-blue-500" />
                  </div>
                  <div>
                    <Link href={`/sales/orders/${order.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600">
                      {order.order_number}
                    </Link>
                    <p className="text-xs text-gray-400">
                      {order.customer
                        ? `${order.customer.first_name} ${order.customer.last_name}`
                        : 'Walk-in'}
                      {' · '}
                      {new Date(order.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={STATUS_COLORS[order.status] ?? 'gray'}>{order.status}</Badge>
                  <span className="text-sm font-semibold text-gray-900 min-w-[5rem] text-right">
                    Bs. {Number(order.total_amount).toLocaleString()}
                  </span>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>

      {/* Recent Journal Entries */}
      <div className="bg-white rounded-xl p-6" style={{ border: '1px solid rgba(220,38,38,0.12)', borderLeft: '3px solid rgba(185,28,28,0.5)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-700">Recent Journal Entries</h2>
          </div>
          <Link href="/finance/journal" className="text-xs text-blue-600 hover:underline font-medium">View all →</Link>
        </div>

        {journalEntries.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No journal entries yet</p>
        ) : (
          <motion.ul
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-3"
          >
            {journalEntries.map((je, i) => (
              <motion.li key={i} variants={itemVariants}
                className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                    <BookOpen className="h-4 w-4 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{je.entry_number}</p>
                    <p className="text-xs text-gray-400 truncate max-w-[200px]">{je.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-right">
                  {je.source_module && (
                    <span className="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {MODULE_LABEL[je.source_module] ?? je.source_module}
                    </span>
                  )}
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <Clock className="h-3 w-3" />
                    {new Date(je.entry_date).toLocaleDateString()}
                  </div>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>
    </div>
  );
}
