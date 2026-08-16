'use client';

import { useAuthStore } from '@/stores/authStore';
import { useRouter, usePathname } from 'next/navigation';
import { Search, Bell, LogOut, Settings, User, ChevronDown, Package, ShoppingCart, Truck, FileText, UserPlus, X } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

const PATH_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/products': 'Products',
  '/crm/leads': 'Leads',
  '/crm/opportunities': 'Opportunities',
  '/sales/quotations': 'Quotations',
  '/sales/orders': 'Sales Orders',
  '/sales/customers': 'Customers',
  '/procurement/requisitions': 'Purchase Requisitions',
  '/procurement/rfq': 'Requests for Quotation',
  '/purchase/orders': 'Purchase Orders',
  '/purchase/suppliers': 'Suppliers',
  '/inventory/stock': 'Inventory',
  '/inventory/transactions': 'Transactions',
  '/inventory/counting': 'Counting',
  '/inventory/transfers': 'Transfers',
  '/warehouse/work': 'Work Tasks',
  '/warehouse/waves': 'Waves',
  '/warehouse/arrival': 'Arrivals',
  '/warehouse/locations': 'Locations',
  '/finance/accounts': 'Chart of Accounts',
  '/finance/journal': 'Journal Entries',
  '/finance/facturas': 'Facturas',
  '/finance/iva-report': 'IVA Report',
  '/finance/p-and-l': 'Profit & Loss',
  '/finance/balance-sheet': 'Balance Sheet',
  '/finance/aging': 'Aging Report',
  '/finance/periods': 'Accounting Periods',
  '/finance/bank-reconciliation': 'Bank Reconciliation',
  '/reports': 'Reports',
  '/hr': 'HR',
  '/hr/payroll': 'Payroll',
  '/settings': 'Settings',
  '/import': 'Import',
};

const CREATE_ITEMS = [
  { label: 'New Product',        icon: Package,      href: '/products/new'           },
  { label: 'New Sales Order',    icon: ShoppingCart, href: '/sales/orders/new'       },
  { label: 'New Purchase Order', icon: Truck,        href: '/purchase/orders/new'    },
  { label: 'New Customer',       icon: UserPlus,     href: '/sales/customers/new'    },
  { label: 'New Journal Entry',  icon: FileText,     href: '/finance/journal/new'    },
];

function getTitle(pathname: string) {
  if (PATH_TITLES[pathname]) return PATH_TITLES[pathname];
  const match = Object.keys(PATH_TITLES)
    .filter((k) => pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return match ? PATH_TITLES[match] : 'Quberty';
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  return (
    <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center shrink-0">
      <span className="text-[11px] font-bold text-white">{initials}</span>
    </div>
  );
}

export function TopBar() {
  const { user, logout } = useAuthStore();
  const router   = useRouter();
  const pathname = usePathname();
  const title    = getTitle(pathname);

  const [createOpen,  setCreateOpen]  = useState(false);
  const [bellOpen,    setBellOpen]    = useState(false);
  const [avatarOpen,  setAvatarOpen]  = useState(false);
  const [search,      setSearch]      = useState('');

  const searchRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLDivElement>(null);
  const bellRef   = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);

  const fullName = `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim() || 'User';

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (createRef.current && !createRef.current.contains(e.target as Node)) setCreateOpen(false);
      if (bellRef.current   && !bellRef.current.contains(e.target as Node))   setBellOpen(false);
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setAvatarOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Ctrl+K focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        setCreateOpen(v => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleSearch = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && search.trim()) {
      router.push(`/products?search=${encodeURIComponent(search.trim())}`);
      setSearch('');
      searchRef.current?.blur();
    }
    if (e.key === 'Escape') {
      setSearch('');
      searchRef.current?.blur();
    }
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <header className="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-6 shrink-0">
      <h1 className="text-lg font-bold text-gray-900 tracking-tight">{title}</h1>

      <div className="flex items-center gap-2">

        {/* Search — Ctrl+K */}
        <div className="relative hidden md:flex items-center">
          <Search className="absolute left-3 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleSearch}
            placeholder="Search anything..."
            className="pl-9 pr-8 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-xl w-52 focus:outline-none focus:ring-2 focus:ring-gray-200 focus:w-64 transition-all placeholder:text-gray-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 text-gray-400 hover:text-gray-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <kbd className="absolute right-2 text-[10px] text-gray-300 font-mono hidden group-focus-within:hidden">⌘K</kbd>
        </div>

        {/* Create dropdown */}
        <div ref={createRef} className="relative">
          <button
            onClick={() => { setCreateOpen(v => !v); setBellOpen(false); setAvatarOpen(false); }}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-semibold bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-colors"
          >
            Create
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${createOpen ? 'rotate-180' : ''}`} />
          </button>
          {createOpen && (
            <div className="absolute right-0 top-10 w-52 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1.5">
              {CREATE_ITEMS.map(item => {
                const Icon = item.icon;
                return (
                  <button key={item.href} onClick={() => { router.push(item.href); setCreateOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                    <Icon className="h-4 w-4 text-gray-400" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Bell */}
        <div ref={bellRef} className="relative">
          <button
            aria-label="Notifications"
            onClick={() => { setBellOpen(v => !v); setCreateOpen(false); setAvatarOpen(false); }}
            className={`p-1.5 rounded-lg transition-colors relative ${bellOpen ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
          >
            <Bell className="h-4 w-4" />
          </button>
          {bellOpen && (
            <div className="absolute right-0 top-10 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-50">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800">Notifications</p>
                <button onClick={() => setBellOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
              </div>
              <div className="p-6 text-center">
                <Bell className="h-8 w-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No notifications yet</p>
                <p className="text-xs text-gray-300 mt-1">You're all caught up!</p>
              </div>
            </div>
          )}
        </div>

        {/* Avatar + dropdown */}
        <div ref={avatarRef} className="relative">
          <button
            aria-label="Account menu"
            onClick={() => { setAvatarOpen(v => !v); setCreateOpen(false); setBellOpen(false); }}
            className="flex items-center gap-2 rounded-xl hover:bg-gray-50 p-1 transition-colors"
          >
            <Avatar name={fullName} />
          </button>
          {avatarOpen && (
            <div className="absolute right-0 top-11 w-52 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1.5">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-800">{fullName}</p>
                <p className="text-xs text-gray-400">{user?.email}</p>
              </div>
              <button onClick={() => { router.push('/settings'); setAvatarOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                <Settings className="h-4 w-4 text-gray-400" /> Settings
              </button>
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors">
                  <LogOut className="h-4 w-4" /> Logout
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
