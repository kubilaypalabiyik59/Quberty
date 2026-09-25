'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { fetchCatalog, fetchCategories } from '@/lib/storeCatalog';
import { ProductCard } from '@/components/store/ProductCard';
import { STORE_EDITORIAL, STORE_HERO, categoryImage } from '@/components/store/storeImagery';
import styles from '@/components/store/store.module.css';
import { ArrowRight, Search, SlidersHorizontal, Tag, Zap, Shield, Truck } from 'lucide-react';

interface Category {
  id: string;
  name: string;
}

const PAGE_SIZE = 24;

export default function ShopPage() {
  // useSearchParams needs a Suspense boundary so the route can still prerender.
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#faf7f3]" />}>
      <Shop />
    </Suspense>
  );
}

function Shop() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // The category lives in the URL, so the navbar, the category tiles and the
  // sidebar all drive the same filter, and a filtered view can be shared.
  const category = params.get('category') ?? '';
  const [search, setSearch] = useState('');
  const [inStock, setInStock] = useState(false);
  const [page, setPage] = useState(1);

  const setCategory = (id: string, scroll = false) => {
    setPage(1);
    const next = new URLSearchParams(params.toString());
    if (id) next.set('category', id);
    else next.delete('category');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    if (scroll) document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const { data, isLoading } = useQuery({
    queryKey: ['products', search, category, inStock, page],
    queryFn: () => fetchCatalog({ page, limit: PAGE_SIZE, search, category, inStock }),
  });

  const { data: categories } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: fetchCategories,
  });

  const activeName = categories?.find((c) => c.id === category)?.name;

  return (
    <div className="min-h-screen bg-[#faf7f3]">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative h-[min(78vh,720px)] min-h-[460px] overflow-hidden bg-[#111111]">
        {/* eslint-disable-next-line @next/next/no-img-element -- static campaign image, already sized WebP */}
        <img
          src={STORE_HERO}
          alt=""
          aria-hidden
          fetchPriority="high"
          className={`absolute inset-0 h-full w-full object-cover object-[70%_60%] ${styles.heroImage}`}
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(17,17,17,0.82)_0%,rgba(17,17,17,0.55)_38%,rgba(17,17,17,0.05)_70%),linear-gradient(0deg,rgba(17,17,17,0.55)_0%,transparent_35%)]"
        />
        <div className="relative mx-auto flex h-full max-w-7xl flex-col justify-center px-4 sm:px-6">
          <p className={`mb-4 text-xs font-bold uppercase tracking-[0.3em] text-[#e58a4b] ${styles.rise}`}>
            New Collection 2026
          </p>
          <h1
            className={`max-w-xl text-5xl font-medium leading-[1.02] text-white md:text-7xl ${styles.display} ${styles.rise}`}
            style={{ animationDelay: '0.12s' }}
          >
            Step into
            <br />
            <em className="font-normal text-[#f0a46f]">your style</em>
          </h1>
          <p
            className={`mt-5 max-w-md text-base leading-relaxed text-white/75 ${styles.rise}`}
            style={{ animationDelay: '0.24s' }}
          >
            Footwear chosen for every occasion — from city streets to mountain trails.
          </p>
          <div className={`mt-8 flex flex-wrap gap-3 ${styles.rise}`} style={{ animationDelay: '0.36s' }}>
            <a
              href="#catalog"
              className="inline-flex items-center gap-2 rounded-full bg-[#C65306] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#b34a05]"
            >
              Shop the collection <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#categories"
              className="inline-flex items-center gap-2 rounded-full border border-white/35 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/10"
            >
              Browse categories
            </a>
          </div>
        </div>
      </section>

      {/* ── Promise strip ────────────────────────────────────────────── */}
      <div className="border-b border-[#eadfd3] bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-1 divide-y divide-[#f0e7dd] px-4 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-6">
          {[
            { icon: Truck, label: 'Free Delivery', sub: 'On qualifying orders' },
            { icon: Shield, label: 'Quality Guarantee', sub: '30-day returns' },
            { icon: Zap, label: 'Fast Dispatch', sub: 'Same day shipping' },
          ].map(({ icon: Icon, label, sub }) => (
            <div key={label} className="flex items-center justify-center gap-3 py-4">
              <Icon className="h-5 w-5 text-[#C65306]" aria-hidden />
              <p className="text-sm">
                <span className="font-semibold text-gray-900">{label}</span>
                <span className="text-gray-500"> · {sub}</span>
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Categories ───────────────────────────────────────────────── */}
      {(categories?.length ?? 0) > 0 && (
        <section id="categories" className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-16 sm:px-6">
          <div className="mb-6 flex items-end justify-between">
            <h2 className={`text-3xl text-gray-900 md:text-4xl ${styles.display}`}>Shop by category</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            {categories!.slice(0, 4).map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id, true)}
                className="group relative aspect-[3/4] overflow-hidden rounded-2xl bg-[#e8dccf] text-left"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- static campaign image */}
                <img
                  src={categoryImage(cat.name)}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(17,17,17,0.7)_0%,rgba(17,17,17,0.1)_45%,transparent_70%)]" />
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-4 md:p-5">
                  <span className={`text-2xl text-white md:text-3xl ${styles.display}`}>{cat.name}</span>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-white/90 text-[#111111] transition-colors group-hover:bg-[#C65306] group-hover:text-white">
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Catalog ──────────────────────────────────────────────────── */}
      <section id="catalog" className="mx-auto max-w-7xl scroll-mt-20 px-4 pb-20 pt-16 sm:px-6">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className={`text-3xl text-gray-900 md:text-4xl ${styles.display}`}>{activeName ?? 'All footwear'}</h2>
            <p className="mt-1 text-sm text-gray-500">
              <span className="font-semibold text-gray-900">{data?.total ?? 0}</span> products
            </p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
            <input
              className="w-full rounded-full border border-[#e6dacd] bg-white py-3 pl-11 pr-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#C65306]"
              placeholder="Search sneakers, boots, sandals..."
              aria-label="Search products"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-8 md:flex-row">
          {/* Filters */}
          <aside className="w-full shrink-0 md:w-52">
            <div className="sticky top-20 space-y-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <SlidersHorizontal className="h-4 w-4 text-[#C65306]" aria-hidden />
                Filters
              </div>

              <div>
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400">Category</h3>
                <ul className="flex flex-wrap gap-2 md:block md:space-y-0.5">
                  {[{ id: '', name: 'All Products' }, ...(categories ?? [])].map((cat) => {
                    const active = category === cat.id;
                    return (
                      <li key={cat.id || 'all'}>
                        <button
                          onClick={() => setCategory(cat.id)}
                          aria-pressed={active}
                          className={`rounded-full px-3.5 py-1.5 text-sm transition-colors md:w-full md:rounded-lg md:text-left ${
                            active
                              ? 'bg-[#111111] font-semibold text-white'
                              : 'text-gray-600 hover:bg-[#f0e7dd] max-md:border max-md:border-[#e6dacd] max-md:bg-white'
                          }`}
                        >
                          {cat.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div>
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400">Availability</h3>
                <label className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={inStock}
                    onChange={(e) => {
                      setInStock(e.target.checked);
                      setPage(1);
                    }}
                    className="h-4 w-4 rounded border-gray-300 accent-[#C65306]"
                  />
                  In Stock Only
                </label>
              </div>

              {(search || category || inStock) && (
                <button
                  onClick={() => {
                    setSearch('');
                    setInStock(false);
                    setCategory('');
                  }}
                  className="text-xs font-medium text-[#C65306] hover:underline"
                >
                  Clear all filters
                </button>
              )}
            </div>
          </aside>

          {/* Grid */}
          <div className="flex-1">
            {isLoading ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i}>
                    <div className="aspect-[4/5] animate-pulse rounded-2xl bg-[#efe6dc]" />
                    <div className="mt-3 h-3 w-3/4 animate-pulse rounded bg-[#efe6dc]" />
                    <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-[#efe6dc]" />
                  </div>
                ))}
              </div>
            ) : (data?.products ?? []).length === 0 ? (
              <div className="py-24 text-center text-gray-400">
                <Tag className="mx-auto mb-3 h-12 w-12 text-gray-200" aria-hidden />
                <p className="mb-1 text-lg font-semibold text-gray-700">No products found</p>
                <p className="text-sm">Try adjusting your search or filters.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
                  {(data?.products ?? []).map((product: any) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>

                {data && data.total > PAGE_SIZE && (
                  <div className="mt-12 flex justify-center gap-2">
                    {Array.from({ length: Math.ceil(data.total / PAGE_SIZE) }).map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setPage(i + 1)}
                        aria-current={page === i + 1 ? 'page' : undefined}
                        className={`h-9 w-9 rounded-full text-sm font-semibold transition-colors ${
                          page === i + 1
                            ? 'bg-[#111111] text-white'
                            : 'border border-[#e6dacd] bg-white text-gray-600 hover:bg-[#f0e7dd]'
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
      </section>

      {/* ── Editorial band ───────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#e9c7a8]">
        {/* eslint-disable-next-line @next/next/no-img-element -- static campaign image */}
        <img
          src={STORE_EDITORIAL}
          alt=""
          aria-hidden
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover object-right"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(250,240,230,0.92)_0%,rgba(250,240,230,0.6)_40%,transparent_65%)]"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-[#a8480a]">Visit us</p>
          <h2 className={`max-w-md text-4xl leading-tight text-[#1c140e] md:text-5xl ${styles.display}`}>
            Every step, <em className="text-[#a8480a]">considered.</em>
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-[#4a3a2e]">
            Try your pair in one of our stores, or order online and have it delivered to your door.
          </p>
          <Link
            href="#catalog"
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-[#111111] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#C65306]"
          >
            Find your pair <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
