import { api } from '@/lib/api';

/**
 * Catalogue reads for the storefront.
 *
 * With the deployment's store slug configured (NEXT_PUBLIC_STOREFRONT_TENANT_SLUG,
 * the same value sign-up uses), the shop reads the public catalogue, so a
 * visitor can browse before creating an account. Without it, it falls back to
 * the signed-in catalogue routes — which is what a back-office user previewing
 * the shop gets, and why an anonymous visitor used to see an empty shop.
 *
 * The public catalogue says whether an article is in stock, not how many:
 * `in_stock` on a product and `available` on a variant. `isInStock` and
 * `variantAvailable` read either shape.
 */

export const STOREFRONT_SLUG = process.env.NEXT_PUBLIC_STOREFRONT_TENANT_SLUG ?? '';

const base = STOREFRONT_SLUG ? `/storefront/${encodeURIComponent(STOREFRONT_SLUG)}` : null;

export interface CatalogQuery {
  page: number;
  limit: number;
  search?: string;
  category?: string;
  inStock?: boolean;
}

export async function fetchCatalog(q: CatalogQuery): Promise<{ products: any[]; total: number }> {
  const params = {
    page: q.page,
    limit: q.limit,
    ...(q.search ? { search: q.search } : {}),
    ...(q.category ? { category: q.category } : {}),
    ...(q.inStock ? { inStock: 'true' } : {}),
    ...(base ? {} : { published: 'true' }),
  };
  const r = await api.get(base ? `${base}/products` : '/products', { params });
  return { products: r.data.data ?? [], total: r.data.meta?.total ?? 0 };
}

export async function fetchCategories(): Promise<Array<{ id: string; name: string }>> {
  const r = await api.get(base ? `${base}/categories` : '/products/categories');
  return r.data.data ?? [];
}

export async function fetchProduct(id: string): Promise<any> {
  const r = await api.get(base ? `${base}/products/${encodeURIComponent(id)}` : `/products/${id}`);
  return r.data.data;
}

export function isInStock(p: { in_stock?: boolean; total_stock?: number }): boolean {
  if (typeof p.in_stock === 'boolean') return p.in_stock;
  return p.total_stock === undefined || p.total_stock > 0;
}

export function variantAvailable(v: { available?: boolean; available_stock?: number }): boolean {
  if (typeof v.available === 'boolean') return v.available;
  return (v.available_stock ?? 0) > 0;
}
