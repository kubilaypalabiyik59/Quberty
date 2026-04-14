'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useCartStore } from '@/stores/cartStore';
import { useParams, useRouter } from 'next/navigation';
import { ShoppingCart, ArrowLeft, CheckCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

function productFallbackImage(id: string) {
  const num = parseInt(id.replace(/-/g, '').slice(0, 8), 16) % 100 || 1;
  return `https://picsum.photos/seed/${num}/600/600`;
}

export default function ProductDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { addItem } = useCartStore();
  const [selectedVariant, setSelectedVariant] = useState<string | undefined>();
  const [added, setAdded] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const [stockError, setStockError] = useState('');

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: () => api.get(`/products/${id}`).then(r => r.data.data),
  });

  if (isLoading) return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div className="aspect-square bg-gray-100 rounded-2xl animate-pulse" />
        <div className="space-y-4">
          <div className="h-6 bg-gray-100 rounded-xl animate-pulse w-1/3" />
          <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
          <div className="h-8 bg-gray-100 rounded-xl animate-pulse w-1/4" />
        </div>
      </div>
    </div>
  );

  if (!product) return (
    <div className="max-w-5xl mx-auto px-4 py-12 text-center text-gray-400">
      Product not found.{' '}
      <Link href="/shop" className="text-[#C65306] hover:underline">Back to shop</Link>
    </div>
  );

  const price = product.sale_price ?? product.selling_price;
  const isOnSale = !!product.sale_price && product.sale_price < product.selling_price;
  const discountPct = isOnSale ? Math.round((1 - product.sale_price / product.selling_price) * 100) : 0;

  const hasVariants = product.variants?.length > 0;
  const selectedVariantObj = hasVariants
    ? (product.variants as any[]).find((v: any) => v.id === selectedVariant)
    : null;
  const isProductOutOfStock = product.total_stock !== undefined && product.total_stock <= 0;
  const isVariantOutOfStock = selectedVariantObj
    ? (selectedVariantObj.available_stock ?? 0) <= 0
    : false;
  const canAddToCart = !isProductOutOfStock && (!hasVariants || (selectedVariant && !isVariantOutOfStock));

  const handleAddToCart = () => {
    if (hasVariants && !selectedVariant) {
      setStockError('Please select a variant first.');
      return;
    }
    setStockError('');
    addItem(product, selectedVariant);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <Link href="/shop" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to Shop
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        {/* Image */}
        <div className="space-y-3">
          <div className="relative aspect-square rounded-2xl overflow-hidden bg-gray-50">
            <img
              src={(product.images as string[])?.[activeImage] || productFallbackImage(product.id as string)}
              alt={product.name}
              className="w-full h-full object-cover"
            />
            {isOnSale && (
              <span className="absolute top-4 left-4 bg-[#C65306] text-white text-sm font-bold px-3 py-1 rounded-xl">
                -{discountPct}%
              </span>
            )}
          </div>
          {/* Thumbnail strip */}
          {(product.images as string[])?.length > 1 && (
            <div className="flex gap-2">
              {(product.images as string[]).map((img: string, i: number) => (
                <button
                  key={i}
                  onClick={() => setActiveImage(i)}
                  className={`w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                    activeImage === i ? 'border-[#C65306]' : 'border-transparent'
                  }`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="space-y-5">
          {product.brand && (
            <p className="text-sm text-gray-400 uppercase tracking-widest font-medium">{product.brand}</p>
          )}
          <h1 className="text-3xl font-black text-gray-900">{product.name}</h1>
          <p className="text-xs text-gray-400">SKU: {product.sku}</p>

          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-gray-900">Bs. {Number(price).toLocaleString()}</span>
            {isOnSale && (
              <span className="text-lg text-gray-400 line-through">Bs. {Number(product.selling_price).toLocaleString()}</span>
            )}
          </div>

          {product.description && (
            <p className="text-gray-600 text-sm leading-relaxed">{product.description}</p>
          )}

          {/* Out of stock banner */}
          {isProductOutOfStock && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-medium text-red-700">
              This product is currently out of stock.
            </div>
          )}

          {/* Variants */}
          {hasVariants && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Select Option</p>
              <div className="flex flex-wrap gap-2">
                {(product.variants as any[]).map((v: any) => {
                  const label = v.attributes
                    ? Object.values(v.attributes as Record<string, string>).join(' / ')
                    : [v.size, v.color].filter(Boolean).join(' / ') || v.sku_variant;
                  const outOfStock = (v.available_stock ?? 0) <= 0;
                  return (
                    <button
                      key={v.id}
                      onClick={() => { if (!outOfStock) { setSelectedVariant(v.id); setStockError(''); } }}
                      disabled={outOfStock}
                      title={outOfStock ? 'Out of stock' : undefined}
                      className={`px-4 py-2 text-sm rounded-xl border font-medium transition-colors relative ${
                        outOfStock
                          ? 'border-gray-100 text-gray-300 bg-gray-50 cursor-not-allowed line-through'
                          : selectedVariant === v.id
                          ? 'border-[#C65306] bg-[#C65306] text-white'
                          : 'border-gray-200 text-gray-600 hover:border-gray-400'
                      }`}
                    >
                      {label}
                      {outOfStock && <span className="ml-1 text-[10px] no-underline">(out)</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {stockError && (
            <p className="text-sm text-red-600">{stockError}</p>
          )}

          <p className="text-xs text-gray-400">Precio incluye IVA 13%</p>

          <button
            onClick={handleAddToCart}
            disabled={!canAddToCart}
            className="w-full flex items-center justify-center gap-2 bg-[#C65306] hover:bg-[#b34a05] disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-2xl font-bold text-base transition-colors"
          >
            {added ? (
              <><CheckCircle className="h-5 w-5" /> Added to Cart!</>
            ) : isProductOutOfStock ? (
              <>Out of Stock</>
            ) : (
              <><ShoppingCart className="h-5 w-5" /> Add to Cart</>
            )}
          </button>

          <button
            onClick={() => router.push('/cart')}
            className="w-full py-3.5 rounded-2xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            View Cart
          </button>
        </div>
      </div>
    </div>
  );
}
