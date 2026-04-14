'use client';

import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { Trash2, ShoppingBag, ArrowLeft, Lock } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function CartPage() {
  const { items, removeItem, updateQuantity, totalAmount } = useCartStore();
  const { user } = useAuthStore();
  const router = useRouter();

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <ShoppingBag className="h-16 w-16 text-gray-200 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Your cart is empty</h2>
        <p className="text-gray-500 mb-6">Browse our collection and find something you love.</p>
        <Link href="/shop" className="bg-[#C65306] text-white px-6 py-2.5 rounded-xl font-medium hover:bg-[#b34a05] transition-colors">
          Continue Shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/shop" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-6">
        <ArrowLeft className="h-4 w-4" /> Continue Shopping
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Shopping Cart ({items.length} item{items.length !== 1 ? 's' : ''})</h1>

      <div className="space-y-3 mb-8">
        {items.map((item) => (
          <div key={`${item.product_id}-${item.variant_id}`} className="flex items-center gap-4 bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <div className="w-16 h-16 bg-gray-50 rounded-xl overflow-hidden shrink-0">
              <img
                src={`https://picsum.photos/seed/${parseInt(item.product_id.replace(/-/g, '').slice(0, 8), 16) % 100 || 1}/80/80`}
                alt={item.name}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 truncate">{item.name}</p>
              <p className="text-xs text-gray-400">{item.sku}</p>
              <p className="text-sm font-bold text-[#C65306] mt-1">Bs. {Number(item.price).toLocaleString()}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => updateQuantity(item.product_id, item.variant_id, item.quantity - 1)} className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 font-bold">−</button>
              <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
              <button onClick={() => updateQuantity(item.product_id, item.variant_id, item.quantity + 1)} className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 font-bold">+</button>
            </div>
            <p className="w-24 text-right font-bold text-gray-900">Bs. {(item.price * item.quantity).toLocaleString()}</p>
            <button onClick={() => removeItem(item.product_id, item.variant_id)} className="text-gray-300 hover:text-red-500 transition-colors ml-1">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between text-lg font-bold text-gray-900 mb-2">
          <span>Total</span>
          <span>Bs. {totalAmount().toLocaleString()}</span>
        </div>
        <p className="text-xs text-gray-400 mb-5">Precios incluyen IVA 13%</p>

        {!user && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
            <Lock className="h-4 w-4 text-amber-500 shrink-0" />
            <p className="text-xs text-amber-700">
              You need to{' '}
              <Link href="/store/login" className="font-semibold underline">sign in</Link>
              {' '}or{' '}
              <Link href="/store/register" className="font-semibold underline">create an account</Link>
              {' '}to checkout.
            </p>
          </div>
        )}

        <button
          onClick={() => router.push('/checkout')}
          className="w-full bg-[#C65306] hover:bg-[#b34a05] text-white py-3.5 rounded-xl font-bold transition-colors"
        >
          Proceed to Checkout
        </button>
      </div>
    </div>
  );
}
