import { Hono } from 'hono';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { ok, paginated } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

/**
 * The storefront catalogue for visitors who have not signed in.
 *
 * A shop has to be browsable before anyone creates an account; until now every
 * catalogue read needed a token, so an anonymous visitor saw an empty shop.
 * These routes are public and read-only, and the store is named in the path by
 * its tenant slug — the same slug the storefront already sends to sign-up
 * (NEXT_PUBLIC_STOREFRONT_TENANT_SLUG). Resolving the tenant from the host name
 * is the fuller SaaS form and can replace the slug without changing the shape.
 *
 * What a visitor sees is an allow-list (REMEDIATION_PLAN §2.7.6): published,
 * active products only; price, description, images, category name and variant
 * options; and whether something is in stock — never the quantity on hand,
 * costs, reorder points, item groups or any internal field.
 *
 * Placing an order still requires a customer account (storefront.order.place).
 */
const app = new Hono<AppEnv>();

const MAX_PAGE_SIZE = 48;

async function tenantOf(slug: string): Promise<string> {
  const tenant = await db.tenant.findFirst({ where: { slug, is_active: true }, select: { id: true } });
  if (!tenant) throw new AppError('Store not found', 404, 'STORE_NOT_FOUND');
  return tenant.id;
}

/** Available = on hand minus reserved, summed per product and per variant. */
async function availability(tenantId: string, productIds: string[]) {
  if (productIds.length === 0) return { byProduct: new Map<string, number>(), byVariant: new Map<string, number>() };
  const rows = await db.inventoryStock.groupBy({
    by: ['product_id', 'variant_id'],
    where: { tenant_id: tenantId, product_id: { in: productIds } },
    _sum: { quantity: true, reserved_qty: true },
  });
  const byProduct = new Map<string, number>();
  const byVariant = new Map<string, number>();
  for (const r of rows) {
    const free = Math.max(0, (r._sum.quantity ?? 0) - (r._sum.reserved_qty ?? 0));
    byProduct.set(r.product_id, (byProduct.get(r.product_id) ?? 0) + free);
    if (r.variant_id) byVariant.set(r.variant_id, (byVariant.get(r.variant_id) ?? 0) + free);
  }
  return { byProduct, byVariant };
}

const productSelect = {
  id: true, sku: true, name: true, brand: true, description: true, images: true,
  selling_price: true, sale_price: true,
  category: { select: { name: true } },
  variants: {
    where: { is_active: true },
    select: { id: true, sku_variant: true, attributes: true, size: true, color: true, additional_cost: true },
  },
} as const;

type Row = { id: string; variants: Array<{ id: string } & Record<string, unknown>> } & Record<string, unknown>;

function project(p: Row, stock: Awaited<ReturnType<typeof availability>>) {
  return {
    ...p,
    in_stock: (stock.byProduct.get(p.id) ?? 0) > 0,
    variants: p.variants.map((v) => ({ ...v, available: (stock.byVariant.get(v.id) ?? 0) > 0 })),
  };
}

app.get('/:slug/categories', async (c) => {
  const tenantId = await tenantOf(c.req.param('slug'));
  const categories = await db.productCategory.findMany({
    where: { tenant_id: tenantId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return ok(c, categories);
});

app.get('/:slug/products', async (c) => {
  const tenantId = await tenantOf(c.req.param('slug'));
  const { search, category, inStock, sortBy = 'name' } = c.req.query();
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(c.req.query('limit')) || 24));

  const where: any = { tenant_id: tenantId, is_active: true, is_published: true };
  if (search) where.name = { contains: String(search).slice(0, 100), mode: 'insensitive' };
  if (category) where.category_id = category;
  if (inStock === 'true') where.inventory_stock = { some: { quantity: { gt: 0 } } };

  const [products, total] = await Promise.all([
    db.product.findMany({
      where,
      select: productSelect,
      orderBy: sortBy === 'price_asc' ? { selling_price: 'asc' } : sortBy === 'price_desc' ? { selling_price: 'desc' } : { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.product.count({ where }),
  ]);
  const stock = await availability(tenantId, products.map((p) => p.id));
  return paginated(c, products.map((p) => project(p as unknown as Row, stock)), total, page, limit);
});

app.get('/:slug/products/:id', async (c) => {
  const tenantId = await tenantOf(c.req.param('slug'));
  const product = await db.product.findFirst({
    where: { id: c.req.param('id'), tenant_id: tenantId, is_active: true, is_published: true },
    select: productSelect,
  });
  if (!product) throw new AppError('Product not found', 404);
  const stock = await availability(tenantId, [product.id]);
  return ok(c, project(product as unknown as Row, stock));
});

export default app;
