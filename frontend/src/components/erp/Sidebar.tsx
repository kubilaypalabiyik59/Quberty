'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, ShoppingCart, Package, Warehouse, Users,
  Truck, BarChart3, Upload, UserCog, Settings, ChevronDown, Box, DollarSign,
  MessageCircle, Moon, SunMedium,
} from 'lucide-react';
import { useState } from 'react';

const NAV = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    ],
  },
  {
    label: 'Commerce',
    items: [
      {
        href: '/products', icon: Box, label: 'Products', children: [
          { href: '/products', label: 'All Products' },
          { href: '/products/variants', label: 'Variant Types' },
          { href: '/products/categories', label: 'Categories' },
        ],
      },
      {
        href: '/sales', icon: ShoppingCart, label: 'Sales', children: [
          { href: '/sales/orders', label: 'Orders' },
          { href: '/sales/customers', label: 'Customers' },
        ],
      },
      {
        href: '/purchase', icon: Truck, label: 'Purchase', children: [
          { href: '/purchase/orders', label: 'Purchase Orders' },
          { href: '/purchase/suppliers', label: 'Suppliers' },
        ],
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        href: '/inventory', icon: Package, label: 'Inventory', children: [
          { href: '/inventory/stock', label: 'Stock Overview' },
          { href: '/inventory/transactions', label: 'Transactions' },
          { href: '/inventory/counting', label: 'Counting' },
          { href: '/inventory/transfers', label: 'Transfers' },
        ],
      },
      {
        href: '/warehouse', icon: Warehouse, label: 'Warehouse', children: [
          { href: '/warehouse/work', label: 'Work Tasks' },
          { href: '/warehouse/waves', label: 'Waves' },
          { href: '/warehouse/arrival', label: 'Arrivals' },
          { href: '/warehouse/locations', label: 'Locations' },
        ],
      },
    ],
  },
  {
    label: 'Finance',
    items: [
      {
        href: '/finance', icon: DollarSign, label: 'Finance', children: [
          { href: '/finance/accounts', label: 'Chart of Accounts' },
          { href: '/finance/journal', label: 'Journal Entries' },
          { href: '/finance/facturas', label: 'Facturas' },
          { href: '/finance/iva-report', label: 'IVA Report' },
          { href: '/finance/p-and-l', label: 'Profit & Loss' },
          { href: '/finance/balance-sheet', label: 'Balance Sheet' },
          { href: '/finance/aging', label: 'Aging Report' },
          { href: '/finance/periods', label: 'Accounting Periods' },
          { href: '/finance/bank-reconciliation', label: 'Bank Reconciliation' },
        ],
      },
    ],
  },
  {
    label: 'Management',
    items: [
      { href: '/reports', icon: BarChart3, label: 'Reports' },
      { href: '/import', icon: Upload, label: 'Import' },
      {
        href: '/hr', icon: UserCog, label: 'HR', children: [
          { href: '/hr', label: 'Employees' },
          { href: '/hr/payroll', label: 'Payroll' },
        ],
      },
      { href: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    '/products': true,
    '/sales': true,
    '/inventory': true,
    '/warehouse': false,
    '/purchase': false,
    '/finance': false,
    '/hr': false,
  });

  return (
    <aside
      className="w-56 border-r border-indigo-100/80 flex flex-col shrink-0"
      style={{ background: 'linear-gradient(160deg, #eef2ff 0%, #f8faff 45%, #f0f5ff 100%)' }}
    >
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-indigo-900 flex items-center justify-center shrink-0">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="5" height="5" rx="1" fill="white" />
            <rect x="9" y="2" width="5" height="5" rx="1" fill="white" opacity="0.6" />
            <rect x="2" y="9" width="5" height="5" rx="1" fill="white" opacity="0.6" />
            <rect x="9" y="9" width="5" height="5" rx="1" fill="white" />
          </svg>
        </div>
        <span className="text-sm font-bold text-indigo-950 tracking-tight">Quberty</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-4">
        {NAV.map((section) => (
          <div key={section.label}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300/90 px-2 mb-1">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname.startsWith(item.href);
                const hasChildren = 'children' in item && item.children;
                const isExpanded = expanded[item.href];

                return (
                  <li key={item.href}>
                    <div className="flex items-center">
                      {hasChildren ? (
                        <button
                          onClick={() => setExpanded((e) => ({ ...e, [item.href]: !e[item.href] }))}
                          className={`flex-1 flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                            isActive
                              ? 'bg-indigo-100/80 text-indigo-900 font-medium'
                              : 'text-slate-500 hover:bg-indigo-50/80 hover:text-indigo-800'
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1 text-left">{item.label}</span>
                          <ChevronDown className={`h-3 w-3 transition-transform text-indigo-300 ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                      ) : (
                        <Link
                          href={item.href}
                          className={`flex-1 flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                            pathname === item.href
                              ? 'bg-indigo-100/80 text-indigo-900 font-medium'
                              : 'text-slate-500 hover:bg-indigo-50/80 hover:text-indigo-800'
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {item.label}
                        </Link>
                      )}
                    </div>

                    {hasChildren && isExpanded && (
                      <ul className="ml-3 mt-0.5 space-y-0.5 border-l border-indigo-100 pl-3">
                        {(item as any).children.map((child: any) => (
                          <li key={child.href}>
                            <Link
                              href={child.href}
                              className={`block px-2 py-1.5 text-xs rounded-md transition-colors ${
                                pathname === child.href
                                  ? 'text-indigo-900 font-semibold bg-indigo-100/80'
                                  : 'text-slate-400 hover:text-indigo-800 hover:bg-indigo-50/80'
                              }`}
                            >
                              {child.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom icons */}
      <div className="border-t border-indigo-100/60 p-3 flex items-center gap-1">
        <button className="p-2 rounded-lg text-indigo-300 hover:text-indigo-700 hover:bg-indigo-100/60 transition-colors">
          <MessageCircle className="h-4 w-4" />
        </button>
        <button className="p-2 rounded-lg text-indigo-300 hover:text-indigo-700 hover:bg-indigo-100/60 transition-colors">
          <Moon className="h-4 w-4" />
        </button>
        <button className="p-2 rounded-lg text-indigo-300 hover:text-indigo-700 hover:bg-indigo-100/60 transition-colors">
          <SunMedium className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
