'use client';

import Link from 'next/link';
import { ShoppingCart } from 'lucide-react';
import { useCartStore } from '@/stores/cartStore';

interface ProductCardProps {
  product: {
    id: string;
    name: string;
    sku: string;
    selling_price: number;
    sale_price?: number;
    images?: string[];
    brand?: string;
    total_stock?: number;
  };
}

function productImage(id: string, images?: string[]) {
  if (images?.length) return images[0];
  const num = parseInt(id.replace(/-/g, '').slice(0, 8), 16) % 100 || 1;
  return `https://picsum.photos/seed/${num}/400/400`;
}

export function ProductCard({ product }: ProductCardProps) {
  const { addItem } = useCartStore();

  const price = product.sale_price ?? product.selling_price;
  const isOnSale = !!product.sale_price && product.sale_price < product.selling_price;
  const discountPct = isOnSale
    ? Math.round((1 - product.sale_price! / product.selling_price) * 100)
    : 0;
  const isOutOfStock = product.total_stock !== undefined && product.total_stock <= 0;

  return (
    <div className={`group bg-white rounded-2xl overflow-hidden hover:shadow-lg transition-all duration-200 border border-gray-100 ${isOutOfStock ? 'opacity-75' : ''}`}>
      {/* Image */}
      <Link href={`/shop/${product.id}`}>
        <div className="relative aspect-square bg-gray-50 overflow-hidden">
          <img
            src={productImage(product.id, product.images)}
            alt={product.name}
            className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ${isOutOfStock ? 'grayscale-[30%]' : ''}`}
          />
          {isOutOfStock && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="bg-black/70 text-white text-xs font-bold px-3 py-1.5 rounded-lg">Out of Stock</span>
            </div>
          )}
          {isOnSale && !isOutOfStock && (
            <span className="absolute top-3 left-3 bg-[#C65306] text-white text-xs font-bold px-2 py-1 rounded-lg">
              -{discountPct}%
            </span>
          )}
        </div>
      </Link>

      {/* Info */}
      <div className="p-4">
        {product.brand && (
          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">{product.brand}</p>
        )}
        <Link href={`/shop/${product.id}`}>
          <h3 className="text-sm font-semibold text-gray-900 hover:text-[#C65306] line-clamp-2 leading-snug transition-colors">
            {product.name}
          </h3>
        </Link>

        <div className="mt-3 flex items-center justify-between">
          <div>
            <span className="font-bold text-gray-900">Bs. {Number(price).toLocaleString()}</span>
            {isOnSale && (
              <span className="ml-2 text-xs text-gray-400 line-through">
                Bs. {Number(product.selling_price).toLocaleString()}
              </span>
            )}
          </div>
          {isOutOfStock ? (
            <span className="text-xs text-gray-400 font-medium">Agotado</span>
          ) : (
            <button
              onClick={() => addItem(product)}
              className="p-2 rounded-xl bg-[#111111] text-white hover:bg-[#C65306] transition-colors"
              title="Add to cart"
            >
              <ShoppingCart className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
