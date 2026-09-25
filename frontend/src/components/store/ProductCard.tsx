'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useCartStore } from '@/stores/cartStore';
import { useMoney } from '@/components/CurrencyProvider';
import { ProductImage } from '@/components/store/ProductImage';
import { isInStock } from '@/lib/storeCatalog';

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
    in_stock?: boolean;
  };
}

/**
 * Photograph first, words second: a tall image on a warm ground, then brand,
 * name and price set quietly underneath. Add-to-cart rides on the photo so the
 * text block stays calm.
 */
export function ProductCard({ product }: ProductCardProps) {
  const { addItem } = useCartStore();
  const { money } = useMoney();

  const price = product.sale_price ?? product.selling_price;
  const isOnSale = !!product.sale_price && product.sale_price < product.selling_price;
  const discountPct = isOnSale
    ? Math.round((1 - product.sale_price! / product.selling_price) * 100)
    : 0;
  const isOutOfStock = !isInStock(product);

  return (
    <div className={`group ${isOutOfStock ? 'opacity-70' : ''}`}>
      <div className="relative overflow-hidden rounded-2xl bg-[#f3ece4]">
        <Link href={`/shop/${product.id}`} className="block aspect-[4/5]">
          <ProductImage
            src={product.images?.[0]}
            alt={product.name}
            className={`transition-transform duration-700 ease-out group-hover:scale-[1.04] ${isOutOfStock ? 'grayscale-[40%]' : ''}`}
          />
        </Link>

        {isOutOfStock ? (
          <span className="absolute left-3 top-3 rounded-full bg-black/75 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white">
            Agotado
          </span>
        ) : isOnSale ? (
          <span className="absolute left-3 top-3 rounded-full bg-[#C65306] px-3 py-1 text-[11px] font-bold text-white">
            -{discountPct}%
          </span>
        ) : null}

        {!isOutOfStock && (
          <button
            onClick={() => addItem(product)}
            aria-label={`Add ${product.name} to cart`}
            title="Add to cart"
            className="absolute bottom-3 right-3 grid h-10 w-10 place-items-center rounded-full bg-white text-[#111111] shadow-lg transition-all duration-300 hover:bg-[#C65306] hover:text-white md:translate-y-2 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-1 pt-3">
        {product.brand && (
          <p className="mb-0.5 text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">{product.brand}</p>
        )}
        <Link href={`/shop/${product.id}`}>
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-gray-900 transition-colors hover:text-[#C65306]">
            {product.name}
          </h3>
        </Link>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className={`text-sm font-semibold ${isOnSale ? 'text-[#C65306]' : 'text-gray-900'}`}>{money(price)}</span>
          {isOnSale && <span className="text-xs text-gray-400 line-through">{money(product.selling_price)}</span>}
        </div>
      </div>
    </div>
  );
}
