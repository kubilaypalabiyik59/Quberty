'use client';

import { useState, useEffect } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle, Lock } from 'lucide-react';

const IVA_RATE = 0.13;

export default function CheckoutPage() {
  const { items, totalAmount, checkout, isCheckingOut } = useCartStore();
  const { user } = useAuthStore();
  const router = useRouter();
  const [order, setOrder] = useState<{ order_id: string; order_number: string } | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', address: '', city: '', phone: '' });

  useEffect(() => {
    if (items.length === 0 && !order) router.push('/cart');
  }, [items.length, order, router]);

  // Pre-fill from auth user
  useEffect(() => {
    if (user) {
      setForm(p => ({
        ...p,
        name: `${user.first_name} ${user.last_name}`.trim(),
        email: user.email,
      }));
    }
  }, [user]);

  if (order) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Order Placed!</h2>
        <p className="text-gray-500 mb-1">Your order number is:</p>
        <p className="text-xl font-bold text-[#C65306] mb-6">{order.order_number}</p>
        <Link href="/shop" className="bg-[#C65306] text-white px-6 py-2.5 rounded-xl font-medium hover:bg-[#b34a05] transition-colors">
          Continue Shopping
        </Link>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <Lock className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Sign in to checkout</h2>
        <p className="text-gray-500 text-sm mb-6">You need an account to complete your purchase.</p>
        <div className="flex flex-col gap-3">
          <Link href="/store/login" className="bg-[#C65306] text-white px-6 py-3 rounded-xl font-medium hover:bg-[#b34a05] transition-colors">
            Sign In
          </Link>
          <Link href="/store/register" className="border border-gray-200 text-gray-700 px-6 py-3 rounded-xl font-medium hover:bg-gray-50 transition-colors">
            Create Account
          </Link>
          <Link href="/cart" className="text-sm text-gray-400 hover:text-gray-600 mt-2">
            Back to Cart
          </Link>
        </div>
      </div>
    );
  }

  const grandTotal = totalAmount(); // prices already include IVA in Bolivia
  const ivaAmount = grandTotal - grandTotal / (1 + IVA_RATE); // extract IVA from inclusive price

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const result = await checkout({ name: form.name, email: form.email, address: form.address, city: form.city, phone: form.phone });
      setOrder(result);
    } catch (err: any) {
      setError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Checkout failed. Please try again.');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Link href="/cart" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to Cart
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Shipping Details</h2>
          {[
            { key: 'name', label: 'Full Name', type: 'text' },
            { key: 'email', label: 'Email', type: 'email' },
            { key: 'phone', label: 'Phone', type: 'tel' },
            { key: 'address', label: 'Address', type: 'text' },
            { key: 'city', label: 'City', type: 'text' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
              <input
                type={f.type}
                required
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C65306]"
                value={(form as any)[f.key]}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <button type="submit" disabled={isCheckingOut} className="w-full bg-[#C65306] hover:bg-[#b34a05] text-white py-3 rounded-xl font-medium disabled:opacity-50 transition-colors">
            {isCheckingOut ? 'Placing Order...' : 'Place Order'}
          </button>
        </form>

        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-4">Order Summary</h2>
          <div className="bg-gray-50 rounded-2xl p-5 space-y-3">
            {items.map(item => (
              <div key={`${item.product_id}-${item.variant_id}`} className="flex justify-between text-sm">
                <span className="text-gray-600">{item.name} × {item.quantity}</span>
                <span className="font-medium">Bs. {(item.price * item.quantity).toLocaleString()}</span>
              </div>
            ))}
            <div className="border-t border-gray-200 pt-3 space-y-2">
              <div className="flex justify-between text-sm text-gray-500">
                <span>Subtotal (IVA incl.)</span>
                <span>Bs. {grandTotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>IVA 13% (incluido)</span>
                <span>Bs. {ivaAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 text-lg pt-1">
                <span>Total</span>
                <span>Bs. {grandTotal.toLocaleString()}</span>
              </div>
            </div>
            <p className="text-xs text-gray-400 pt-1">Precios incluyen IVA 13% según ley boliviana.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
