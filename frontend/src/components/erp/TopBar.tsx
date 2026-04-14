'use client';

import { useAuthStore } from '@/stores/authStore';
import { useRouter, usePathname } from 'next/navigation';
import { Search, Bell, MessageCircle, LogOut } from 'lucide-react';

const PATH_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/products': 'Products',
  '/sales/orders': 'Sales Orders',
  '/sales/customers': 'Customers',
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

function getTitle(pathname: string) {
  if (PATH_TITLES[pathname]) return PATH_TITLES[pathname];
  const match = Object.keys(PATH_TITLES)
    .filter((k) => pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return match ? PATH_TITLES[match] : 'Quberty';
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  return (
    <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center shrink-0">
      <span className="text-[11px] font-bold text-white">{initials}</span>
    </div>
  );
}

export function TopBar() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const title = getTitle(pathname);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const fullName = `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim() || 'User';

  return (
    <header className="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-6 shrink-0">
      {/* Page title */}
      <h1 className="text-lg font-bold text-gray-900 tracking-tight">{title}</h1>

      {/* Right: search + actions */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative hidden md:flex items-center">
          <Search className="absolute left-3 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search anything..."
            className="pl-9 pr-4 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-xl w-52 focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-transparent placeholder:text-gray-400"
          />
        </div>

        {/* Create button */}
        <button className="px-4 py-1.5 text-sm font-semibold bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-colors">
          Create
        </button>

        {/* Bell */}
        <button className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors relative">
          <Bell className="h-4 w-4" />
        </button>

        {/* Chat */}
        <button className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          <MessageCircle className="h-4 w-4" />
        </button>

        {/* Avatar + logout */}
        <div className="flex items-center gap-2">
          <Avatar name={fullName} />
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
