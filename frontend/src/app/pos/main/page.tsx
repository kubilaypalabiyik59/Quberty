'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { usePosSessionStore } from '@/stores/posSessionStore';
import { usePosCartStore, usePosCartTotals } from '@/stores/posCartStore';
import { VariantPicker } from '@/components/pos/VariantPicker';
import { CustomerSearch } from '@/components/pos/CustomerSearch';
import { PaymentModal } from '@/components/pos/PaymentModal';
import { api } from '@/lib/api';
import { formatRate } from '@/lib/useTaxPreview';

async function searchProducts(query: string) {
  const res = await api.get('/products', {
    params: { search: query || undefined, limit: 40 },
  });
  return res.data.data;
}

async function getProductByBarcode(code: string) {
  const res = await api.get(`/products/barcode/${encodeURIComponent(code)}`);
  return res.data.data;
}

export default function PosMainPage() {
  const router = useRouter();
  const user         = useAuthStore((s) => s.user);
  const { logout }   = useAuthStore();
  const session      = usePosSessionStore((s) => s.session);
  const clearSession = usePosSessionStore((s) => s.clearSession);
  const { lines, customer, removeLine, updateQty, clearCart } = usePosCartStore();
  const { total, lineCount, tax, taxPreview } = usePosCartTotals();

  const [search,          setSearch]          = useState('');
  const [debouncedQ,      setDebouncedQ]      = useState('');
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [showVariants,    setShowVariants]    = useState(false);
  const [showCustomer,    setShowCustomer]    = useState(false);
  const [showPayment,     setShowPayment]     = useState(false);
  const [scanLoading,     setScanLoading]     = useState(false);
  const [saleError,       setSaleError]       = useState('');

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const { data: productData, isLoading: productsLoading } = useQuery({
    queryKey: ['pos-products', debouncedQ],
    queryFn:  () => searchProducts(debouncedQ),
    staleTime: 20_000,
  });
  // `/products` returns a paginated envelope whose `data` IS the array (searchProducts
  // already unwraps to res.data.data). Guard both shapes so the grid never silently empties.
  const products: any[] = Array.isArray(productData) ? productData : (productData?.products ?? []);

  function handleSearchChange(text: string) {
    setSearch(text);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(text), 300);
  }

  async function handleBarcodeSearch() {
    if (!search.trim()) return;
    setScanLoading(true);
    try {
      const product = await getProductByBarcode(search.trim());
      setSearch('');
      setDebouncedQ('');
      setSelectedProduct(product);
      setShowVariants(true);
    } catch {
      alert(`No product with barcode "${search}"`);
    } finally {
      setScanLoading(false);
    }
  }

  async function handlePaymentConfirm(
    method: 'CASH' | 'CARD' | 'TRANSFER',
    cashTendered?: number,
    // Supplied by PaymentModal only when the FACTURA sequence is manual; left
    // undefined otherwise so the field is absent from the request.
    facturaNumber?: string,
  ) {
    if (!session) throw new Error('No open register session');
    setSaleError('');
    const res = await api.post('/pos/sale', {
      session_id:     session.id,
      customer_name:  customer ? `${customer.first_name} ${customer.last_name}` : undefined,
      payment_method: method,
      cash_tendered:  cashTendered,
      factura_number: facturaNumber,
      lines: lines.map((l) => ({
        product_id:   l.product_id,
        variant_id:   l.variant_id,
        quantity:     l.quantity,
        unit_price:   l.unit_price,
        discount_pct: l.discount_pct,
      })),
    });
    const result = res.data.data;
    clearCart();
    setShowPayment(false);

    const params = new URLSearchParams({
      order_id:       result.order_id,
      factura_number: String(result.factura_number),
      order_number:   result.order_number,
      total:          String(result.total),
      subtotal:       String(result.subtotal),
      iva_amount:     String(result.iva_amount),
      it_amount:      String(result.it_amount),
      change_due:     String(result.change_due ?? 0),
      payment_method: method,
      customer_name:  customer ? `${customer.first_name} ${customer.last_name}` : 'Walk-in',
    });
    router.push(`/pos/receipt?${params.toString()}`);
  }

  async function handleLogout() {
    if (!confirm('Logout? The register will remain open.')) return;
    await logout();
    router.replace('/pos/login');
  }

  return (
    <div className="flex flex-col h-full">

      {/* TOP BAR */}
      <div className="flex items-center justify-between bg-white px-5 py-2.5 border-b border-slate-200 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-sm shadow-indigo-200">
            <span className="font-black text-base text-white">Q</span>
          </div>
          <span className="text-slate-900 font-bold text-base">Quberty POS</span>
          <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-emerald-700 text-xs font-medium">{session?.terminal_name ?? '—'}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-500 text-sm">{user?.first_name} {user?.last_name}</span>
          <button
            onClick={() => router.push('/pos/z-report')}
            className="bg-slate-100 px-3 py-1.5 rounded-lg text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-colors"
          >
            Close Register
          </button>
          <button
            onClick={handleLogout}
            className="text-slate-400 text-lg hover:text-red-500 transition-colors px-2"
            title="Logout"
          >
            ⏻
          </button>
        </div>
      </div>

      {/* SPLIT BODY */}
      <div className="flex flex-1 min-h-0">

        {/* LEFT: Products (60%) */}
        <div className="flex flex-col flex-[3] p-3.5 border-r border-slate-200 min-h-0">
          {/* Search */}
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleBarcodeSearch()}
              placeholder="Search products or scan barcode..."
              className="flex-1 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 text-sm placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition shadow-sm"
            />
            <button
              onClick={handleBarcodeSearch}
              disabled={scanLoading}
              className="bg-indigo-600 rounded-xl px-3.5 text-white text-xl hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-200"
            >
              {scanLoading ? (
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
              ) : '⌕'}
            </button>
          </div>

          {/* Product grid */}
          <div className="flex-1 overflow-y-auto">
            {productsLoading ? (
              <div className="flex justify-center pt-10">
                <span className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
              </div>
            ) : products.length === 0 ? (
              <div className="flex items-center justify-center h-40">
                <p className="text-slate-400 text-base">
                  {debouncedQ ? 'No products found' : 'Search for products above'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2.5 pb-4">
                {products.map((item) => {
                  const stock = item.total_stock ?? 0;
                  const oos   = stock === 0;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { setSelectedProduct(item); setShowVariants(true); }}
                      className={`bg-white border border-slate-200 rounded-xl p-3 text-left transition-all hover:border-indigo-300 hover:shadow-md shadow-sm ${oos ? 'opacity-60' : ''}`}
                    >
                      <p className="text-slate-400 text-[10px] font-semibold mb-1">{item.sku}</p>
                      <p className="text-slate-900 font-semibold text-sm leading-snug mb-1 line-clamp-2">{item.name}</p>
                      {item.brand && <p className="text-slate-400 text-xs mb-1.5">{item.brand}</p>}
                      <p className="text-indigo-600 font-bold text-base mb-1.5">
                        Bs. {Number(item.selling_price).toFixed(2)}
                      </p>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        oos
                          ? 'bg-red-100 text-red-600'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {oos ? 'Out of Stock' : `Stock: ${stock}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Cart (40%) */}
        <div className="flex flex-col flex-[2] bg-white min-h-0 shadow-[-4px_0_12px_-6px_rgba(0,0,0,0.08)]">

          {/* Customer */}
          <button
            onClick={() => setShowCustomer(true)}
            className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-200 hover:bg-indigo-50/60 transition-colors text-left"
          >
            <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
              <span className="text-indigo-700 font-bold text-sm">
                {customer ? `${customer.first_name?.[0]}${customer.last_name?.[0]}` : '?'}
              </span>
            </div>
            <div className="flex-1">
              <p className="text-slate-900 font-semibold text-sm">
                {customer ? `${customer.first_name} ${customer.last_name}` : 'Walk-in Customer'}
              </p>
              <p className="text-slate-400 text-xs mt-0.5">
                {customer ? (customer.phone ?? customer.email ?? customer.code) : 'Tap to select customer'}
              </p>
            </div>
            <span className="text-slate-300 text-xl">›</span>
          </button>

          {/* Cart lines */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
            {lines.length === 0 && (
              <div className="flex flex-col items-center justify-center h-28 gap-1">
                <p className="text-slate-400 font-semibold">Cart is empty</p>
                <p className="text-slate-300 text-xs">Tap a product to add it</p>
              </div>
            )}
            {lines.map((line) => (
              <div key={line.key} className="flex items-center gap-2.5 bg-slate-50 border border-slate-100 rounded-xl p-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-slate-900 font-semibold text-sm truncate">
                    {line.product_name}{line.variant_label ? ` — ${line.variant_label}` : ''}
                  </p>
                  <p className="text-slate-400 text-xs mt-0.5">{line.product_sku}</p>
                  <p className="text-indigo-600 font-bold text-sm mt-1">
                    Bs. {(line.unit_price * line.quantity).toFixed(2)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateQty(line.key, line.quantity - 1)}
                    className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-700 text-base font-bold hover:bg-slate-100 transition-colors flex items-center justify-center"
                  >−</button>
                  <span className="text-slate-900 font-bold text-sm w-5 text-center">{line.quantity}</span>
                  <button
                    onClick={() => updateQty(line.key, line.quantity + 1)}
                    disabled={line.quantity >= line.available_stock}
                    className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-700 text-base font-bold hover:bg-slate-100 transition-colors flex items-center justify-center disabled:text-slate-300"
                  >+</button>
                </div>
              </div>
            ))}
          </div>

          {/* Totals ─────────────────────────────────────────────────────────
              The TOTAL is arithmetic on the cart and is always shown: it is what
              the customer is charged, and the till must be able to price a
              basket without a round trip.

              The SPLIT comes from the tax engine, so it can be briefly in flight
              or unavailable. It is never rendered as zero — "Bs. 0.00 IVA" is a
              claim that this sale carries no tax, which is a different and much
              worse statement than "not known yet".

              Rows are built from the tax codes that actually applied, so a
              tenant with one tax, three taxes, or a rate that changed next
              January renders correctly without a code change. The literal
              "IVA 13%" / "IT 3%" labels this replaced would have kept saying 13%
              after Ley 1733. */}
          <div className="border-t border-slate-200 px-4 pt-3 pb-2 space-y-1 bg-slate-50/60">
            {tax ? (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Subtotal</span>
                  <span className="text-slate-700">Bs. {tax.subtotal.toFixed(2)}</span>
                </div>
                {tax.lines.length > 0
                  ? tax.lines.map((l) => (
                      <div key={l.code} className="flex justify-between text-sm">
                        <span className="text-slate-500">{l.code} {formatRate(l.rate)}</span>
                        <span className="text-slate-700">Bs. {l.amount.toFixed(2)}</span>
                      </div>
                    ))
                  : (
                    // The LEGACY fallback answers with amounts but no line detail.
                    // Each row appears only when it carries a figure, so a tenant
                    // without a turnover tax is not told it has one.
                    <>
                      {tax.vat > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">IVA</span>
                          <span className="text-slate-700">Bs. {tax.vat.toFixed(2)}</span>
                        </div>
                      )}
                      {tax.turnover > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">IT</span>
                          <span className="text-slate-700">Bs. {tax.turnover.toFixed(2)}</span>
                        </div>
                      )}
                    </>
                  )}
              </>
            ) : taxPreview.status === 'error' ? (
              <div className="flex items-start justify-between gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                <span className="flex-1">{taxPreview.error}</span>
                <button
                  onClick={taxPreview.retry}
                  className="shrink-0 font-semibold text-amber-900 underline"
                >
                  Reintentar
                </button>
              </div>
            ) : (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Impuestos</span>
                <span className="text-slate-400">
                  {taxPreview.status === 'loading' ? 'calculando…' : '—'}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center pt-1.5 border-t border-slate-200 mt-1">
              <span className="text-slate-900 font-bold text-base">TOTAL</span>
              <span className="text-indigo-600 font-black text-xl">Bs. {total.toFixed(2)}</span>
            </div>
          </div>

          {saleError && (
            <p className="text-red-500 text-xs text-center px-4 pb-1">{saleError}</p>
          )}

          {/* Actions */}
          <div className="flex gap-2.5 px-3 pb-3.5 pt-2">
            <button
              onClick={() => lineCount > 0 && confirm('Remove all items?') && clearCart()}
              className="px-4 py-3.5 bg-white border border-slate-200 rounded-xl text-slate-600 font-semibold text-sm hover:bg-slate-100 transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() => lineCount > 0 && setShowPayment(true)}
              disabled={lineCount === 0}
              className={`flex-1 py-3.5 rounded-xl font-black text-base transition-colors ${
                lineCount === 0
                  ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200'
              }`}
            >
              COBRAR  Bs. {total.toFixed(2)}
            </button>
          </div>
        </div>
      </div>

      {/* MODALS */}
      <VariantPicker
        product={selectedProduct}
        visible={showVariants}
        onClose={() => setShowVariants(false)}
      />
      <CustomerSearch visible={showCustomer} onClose={() => setShowCustomer(false)} />
      <PaymentModal
        visible={showPayment}
        total={total}
        onClose={() => setShowPayment(false)}
        onConfirm={handlePaymentConfirm}
      />
    </div>
  );
}
