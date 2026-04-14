'use client';

import Link from 'next/link';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { ShoppingBag, User, LogOut, ChevronDown } from 'lucide-react';
import { useState } from 'react';

export function StoreNavbar() {
  const itemCount = useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));
  const { user, logout } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="bg-[#111111] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/shop" className="flex items-center gap-2">
            <span className="text-white font-black text-2xl tracking-tight">SCARPE</span>
            <span className="text-[#C65306] font-black text-2xl tracking-tight">CALZADOS</span>
          </Link>

          {/* Nav Links */}
          <div className="hidden md:flex items-center gap-8">
            <Link href="/shop" className="text-gray-300 hover:text-white text-sm font-medium transition-colors">
              Shop
            </Link>
            <Link href="/shop?category=sneakers" className="text-gray-300 hover:text-white text-sm font-medium transition-colors">
              Sneakers
            </Link>
            <Link href="/shop?category=boots" className="text-gray-300 hover:text-white text-sm font-medium transition-colors">
              Boots
            </Link>
            <Link href="/shop?category=sandals" className="text-gray-300 hover:text-white text-sm font-medium transition-colors">
              Sandals
            </Link>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-4">
            {user ? (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="flex items-center gap-2 text-gray-300 hover:text-white text-sm font-medium transition-colors"
                >
                  <User className="h-4 w-4" />
                  <span className="hidden md:inline">{user.first_name}</span>
                  <ChevronDown className="h-3 w-3" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-8 bg-white rounded-xl shadow-xl border border-gray-100 py-1 w-44 z-50">
                    <Link href="/account" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                      My Account
                    </Link>
                    <button
                      onClick={() => { logout(); setMenuOpen(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <LogOut className="h-4 w-4" /> Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link href="/store/login" className="text-gray-300 hover:text-white text-sm font-medium transition-colors flex items-center gap-1.5">
                <User className="h-4 w-4" />
                <span className="hidden md:inline">Sign In</span>
              </Link>
            )}

            <Link href="/cart" className="relative bg-[#C65306] hover:bg-[#b34a05] text-white p-2 rounded-lg transition-colors">
              <ShoppingBag className="h-5 w-5" />
              {itemCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-white text-[#C65306] text-xs font-bold rounded-full h-4 w-4 flex items-center justify-center">
                  {itemCount}
                </span>
              )}
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
