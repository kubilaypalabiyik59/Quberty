'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ProductCard } from '@/components/store/ProductCard';
import { Search, SlidersHorizontal, Tag, Zap, Shield, Truck } from 'lucide-react';

export default function ShopPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [inStock, setInStock] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['products', search, category, inStock, page],
    queryFn: () =>
      api.get(
        `/products?page=${page}&limit=24&search=${search}&category=${category}&inStock=${inStock}&published=true`
      ).then((r) => ({ products: r.data.data, total: r.data.meta?.total ?? 0 })),
  });

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get('/products/categories').then((r) => r.data.data),
  });

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Hero Banner */}
      <div className="bg-[#111111] text-white">
        <div className="max-w-7xl mx-auto px-4 py-14">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div>
              <p className="text-[#C65306] text-sm font-bold uppercase tracking-widest mb-2">New Collection 2026</p>
              <h1 className="text-4xl md:text-5xl font-black leading-tight mb-4">
                Step Into<br />
                <span className="text-[#C65306]">Your Style</span>
              </h1>
              <p className="text-gray-400 max-w-sm text-sm">
                Discover premium footwear crafted for every occasion. From streets to peaks.
              </p>
            </div>
            <div className="flex gap-6">
              {[
                { icon: <Truck className="h-5 w-5" />, label: 'Free Delivery', sub: 'Orders over Bs. 500' },
                { icon: <Shield className="h-5 w-5" />, label: 'Quality Guarantee', sub: '30-day returns' },
                { icon: <Zap className="h-5 w-5" />, label: 'Fast Dispatch', sub: 'Same day shipping' },
              ].map((f) => (
                <div key={f.label} className="text-center">
                  <div className="w-10 h-10 bg-[#C65306]/20 rounded-xl flex items-center justify-center mx-auto mb-2 text-[#C65306]">
                    {f.icon}
                  </div>
                  <p className="text-xs font-semibold text-white">{f.label}</p>
                  <p className="text-xs text-gray-500">{f.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Search bar */}
        <div className="relative mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="w-full pl-11 pr-4 py-3.5 bg-white border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[#C65306] shadow-sm"
            placeholder="Search sneakers, boots, sandals..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          {/* Filters sidebar */}
          <aside className="w-full md:w-56 shrink-0">
            <div className="sticky top-20 bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-6">
              <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
                <SlidersHorizontal className="h-4 w-4 text-[#C65306]" />
                Filters
              </div>

              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Category</h3>
                <ul className="space-y-1">
                  <li>
                    <button
                      onClick={() => { setCategory(''); setPage(1); }}
                      className={`text-sm w-full text-left px-3 py-2 rounded-xl transition-colors ${!category ? 'bg-[#111111] text-white font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      All Products
                    </button>
                  </li>
                  {(categories ?? []).map((cat: any) => (
                    <li key={cat.id}>
                      <button
                        onClick={() => { setCategory(cat.id); setPage(1); }}
                        className={`text-sm w-full text-left px-3 py-2 rounded-xl transition-colors ${category === cat.id ? 'bg-[#111111] text-white font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
                      >
                        {cat.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Availability</h3>
                <label className="flex items-center gap-2.5 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inStock}
                    onChange={(e) => { setInStock(e.target.checked); setPage(1); }}
                    className="w-4 h-4 rounded border-gray-300 accent-[#C65306]"
                  />
                  In Stock Only
                </label>
              </div>

              {(search || category || inStock) && (
                <button
                  onClick={() => { setSearch(''); setCategory(''); setInStock(false); setPage(1); }}
                  className="w-full text-xs text-[#C65306] font-medium hover:underline"
                >
                  Clear all filters
                </button>
              )}
            </div>
          </aside>

          {/* Product grid */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-500">
                <span className="font-semibold text-gray-900">{data?.total ?? 0}</span> products
              </p>
              {data?.total === 0 && !isLoading && (
                <span className="text-xs text-[#C65306] flex items-center gap-1">
                  <Tag className="h-3 w-3" /> Try different filters
                </span>
              )}
            </div>

            {isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-white animate-pulse rounded-2xl h-72 border border-gray-100" />
                ))}
              </div>
            ) : (data?.products ?? []).length === 0 ? (
              <div className="text-center py-24 text-gray-400">
                <Tag className="h-12 w-12 mx-auto mb-3 text-gray-200" />
                <p className="text-lg font-semibold text-gray-700 mb-1">No products found</p>
                <p className="text-sm">Try adjusting your search or filters.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {(data?.products ?? []).map((product: any) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>

                {/* Pagination */}
                {data && data.total > 24 && (
                  <div className="flex justify-center mt-10 gap-2">
                    {Array.from({ length: Math.ceil(data.total / 24) }).map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setPage(i + 1)}
                        className={`w-9 h-9 rounded-xl text-sm font-semibold transition-colors ${
                          page === i + 1 ? 'bg-[#C65306] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
