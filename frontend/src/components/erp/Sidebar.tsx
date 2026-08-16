'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, ShoppingCart, Package, Warehouse, Users,
  Truck, BarChart3, Upload, UserCog, Settings, ChevronDown, Box, DollarSign,
  MessageCircle, Moon, SunMedium, Wand2, Monitor, ShieldCheck, AlertTriangle,
  Target, ClipboardList,
} from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import { useState, useEffect, useRef } from 'react';

const NAV = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/pos',       icon: Monitor,         label: 'POS Terminal' },
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
          { href: '/products/setup', label: 'Financial Setup' },
        ],
      },
      // Prospect to Quote (85) — the documents in front of the sales order.
      // Listed before Sales because that is the order they happen in.
      {
        href: '/crm', icon: Target, label: 'Pipeline', children: [
          { href: '/crm/leads', label: 'Leads' },
          { href: '/crm/opportunities', label: 'Opportunities' },
        ],
      },
      {
        href: '/sales', icon: ShoppingCart, label: 'Sales', children: [
          { href: '/sales/quotations', label: 'Quotations' },
          { href: '/sales/orders', label: 'Orders' },
          { href: '/sales/customers', label: 'Customers' },
        ],
      },
      // Source to Pay (75) upstream — requisition and tender, before the order.
      {
        href: '/procurement', icon: ClipboardList, label: 'Procurement', children: [
          { href: '/procurement/requisitions', label: 'Requisitions' },
          { href: '/procurement/rfq', label: 'Requests for Quotation' },
        ],
      },
      {
        href: '/purchase', icon: Truck, label: 'Purchase', children: [
          { href: '/purchase/orders', label: 'Purchase Orders' },
          // The order -> product receipt -> vendor invoice cycle, in the order
          // the documents are actually raised.
          { href: '/purchase/receipts', label: 'Product Receipts' },
          { href: '/purchase/invoices', label: 'Vendor Invoices' },
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
          { href: '/inventory/low-stock', label: 'Low Stock' },
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
      { href: '/audit', icon: ShieldCheck, label: 'Audit Log' },
      { href: '/settings', icon: Settings, label: 'Settings' },
      { href: '/setup', icon: Wand2, label: 'Setup Wizard' },
    ],
  },
];

const SHORTCUTS = [
  { key: 'G then D', action: 'Go to Dashboard' },
  { key: 'G then P', action: 'Go to Products' },
  { key: 'G then S', action: 'Go to Sales' },
  { key: 'G then F', action: 'Go to Finance' },
  { key: 'Ctrl + K', action: 'Global Search' },
  { key: 'Ctrl + N', action: 'Create New' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { theme, resolved, setTheme } = useTheme();
  const [helpOpen,    setHelpOpen]    = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcuts: G then D/P/S/F
  useEffect(() => {
    let gPressed = false;
    let gTimer: NodeJS.Timeout;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'g' || e.key === 'G') {
        gPressed = true;
        gTimer = setTimeout(() => { gPressed = false; }, 1000);
        return;
      }
      if (gPressed) {
        clearTimeout(gTimer);
        gPressed = false;
        const map: Record<string, string> = { d: '/dashboard', p: '/products', s: '/sales/orders', f: '/finance/accounts' };
        const dest = map[e.key.toLowerCase()];
        if (dest) { e.preventDefault(); window.location.href = dest; }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Close help panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) setHelpOpen(false);
    };
    if (helpOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [helpOpen]);

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
      className="w-56 border-r border-border/80 flex flex-col shrink-0"
      /* Was a hardcoded indigo gradient in an inline style — invisible to every
         theme mechanism, which is why the sidebar stayed light after the rest of
         the product went dark. A flat token surface also stops the nav competing
         with the content it frames. */
      style={{ background: 'hsl(var(--surface))' }}
    >
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center shrink-0">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="5" height="5" rx="1" fill="white" />
            <rect x="9" y="2" width="5" height="5" rx="1" fill="white" opacity="0.6" />
            <rect x="2" y="9" width="5" height="5" rx="1" fill="white" opacity="0.6" />
            <rect x="9" y="9" width="5" height="5" rx="1" fill="white" />
          </svg>
        </div>
        <span className="text-sm font-bold text-accent-onSoft tracking-tight">Quberty</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-4">
        {NAV.map((section) => (
          <div key={section.label}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle/90 px-2 mb-1">
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
                              ? 'bg-accent-soft/80 text-accent-onSoft font-medium'
                              : 'text-fg-muted hover:bg-accent-soft/80 hover:text-accent-onSoft'
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1 text-left">{item.label}</span>
                          <ChevronDown className={`h-3 w-3 transition-transform text-fg-subtle ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                      ) : (
                        <Link
                          href={item.href}
                          className={`flex-1 flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                            pathname === item.href
                              ? 'bg-accent-soft/80 text-accent-onSoft font-medium'
                              : 'text-fg-muted hover:bg-accent-soft/80 hover:text-accent-onSoft'
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {item.label}
                        </Link>
                      )}
                    </div>

                    {hasChildren && isExpanded && (
                      <ul className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-3">
                        {(item as any).children.map((child: any) => (
                          <li key={child.href}>
                            <Link
                              href={child.href}
                              className={`block px-2 py-1.5 text-xs rounded-md transition-colors ${
                                pathname === child.href
                                  ? 'text-accent-onSoft font-semibold bg-accent-soft/80'
                                  : 'text-fg-subtle hover:text-accent-onSoft hover:bg-accent-soft/80'
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
      <div className="border-t border-border/60 p-3 flex items-center gap-1 relative">

        {/* Help / shortcuts panel */}
        {helpOpen && (
          <div ref={helpRef} className="absolute bottom-14 left-3 w-56 bg-surface border border-border rounded-xl shadow-xl z-50 p-4 space-y-3">
            <p className="text-xs font-bold text-fg uppercase tracking-widest">Keyboard Shortcuts</p>
            <div className="space-y-1.5">
              {SHORTCUTS.map(s => (
                <div key={s.key} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-fg-muted">{s.action}</span>
                  <kbd className="text-[10px] bg-surface-sunken border border-border rounded px-1.5 py-0.5 font-mono text-fg-muted whitespace-nowrap">{s.key}</kbd>
                </div>
              ))}
            </div>
            <div className="border-t pt-2">
              <p className="text-[10px] text-fg-subtle text-center">Quberty ERP v2.0</p>
            </div>
          </div>
        )}

        <button
          onClick={() => setHelpOpen(v => !v)}
          title="Keyboard shortcuts"
          className={`p-2 rounded-lg transition-colors ${helpOpen ? 'bg-accent-soft/80 text-accent-onSoft' : 'text-fg-subtle hover:text-accent-onSoft hover:bg-accent-soft/60'}`}
        >
          <MessageCircle className="h-4 w-4" />
        </button>

        {/* Three states, matching the sign-in screen: system has to be
            reachable, or a user who picks light can never go back to following
            their OS. */}
        {([
          ['light', 'Light mode', SunMedium],
          ['system', 'Follow system', Monitor],
          ['dark', 'Dark mode', Moon],
        ] as const).map(([value, title, Icon]) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            title={title}
            aria-label={title}
            aria-pressed={theme === value}
            className={`p-2 rounded-lg transition-colors cursor-pointer ${
              theme === value
                ? 'bg-accent-soft/80 text-accent-onSoft'
                : 'text-fg-subtle hover:text-accent-onSoft hover:bg-accent-soft/60'
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>
    </aside>
  );
}
