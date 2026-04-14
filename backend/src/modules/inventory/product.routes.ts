import { Hono }    from 'hono';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { ok, created, paginated } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

// GET /products — public (storefront needs no auth for browsing)
app.get('/', async (c) => {
  const { search, category, inStock, published, page = '1', limit = '20', sortBy = 'name' } = c.req.query();

  const where: any = { tenant_id: c.get('tenantId'), is_active: true };

  if (published === 'true') where.is_published = true;
  if (search) where.name = { contains: search, mode: 'insensitive' };
  if (category) where.category_id = category;

  if (inStock === 'true') {
    where.inventory_stock = { some: { quantity: { gt: 0 } } };
  }

  const [products, total] = await Promise.all([
    db.product.findMany({
      where,
      include: {
        category: { select: { name: true } },
        variants: { where: { is_active: true } },
      },
      orderBy: sortBy === 'price_asc'
        ? { selling_price: 'asc' }
        : sortBy === 'price_desc'
        ? { selling_price: 'desc' }
        : { name: 'asc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    db.product.count({ where }),
  ]);

  // Attach total_stock per product
  const productIds = products.map((p: any) => p.id);
  const stockAgg = productIds.length > 0
    ? await db.inventoryStock.groupBy({
        by: ['product_id'],
        where: { tenant_id: c.get('tenantId'), product_id: { in: productIds } },
        _sum: { quantity: true, reserved_qty: true },
      })
    : [];
  const stockByProduct = new Map(
    stockAgg.map((s: any) => [s.product_id, Math.max(0, (s._sum.quantity ?? 0) - (s._sum.reserved_qty ?? 0))])
  );
  const productsWithStock = products.map((p: any) => ({
    ...p,
    total_stock: stockByProduct.get(p.id) ?? 0,
  }));

  return paginated(c, productsWithStock, total, Number(page), Number(limit));
});

// GET /products/barcode/:code — fast lookup by product or variant barcode (POS use)
app.get('/barcode/:code', async (c) => {
  const code = c.req.param('code');

  // Try product barcode first
  let product = await db.product.findFirst({
    where: { tenant_id: c.get('tenantId'), barcode: code, is_active: true },
    include: { category: { select: { name: true } }, variants: { where: { is_active: true } } },
  });

  let matchedVariantId: string | null = null;

  // Try variant barcode
  if (!product) {
    const variant = await db.productVariant.findFirst({
      where: { tenant_id: c.get('tenantId'), barcode: code, is_active: true },
      include: {
        product: {
          include: { category: { select: { name: true } }, variants: { where: { is_active: true } } },
        },
      },
    });
    if (variant) {
      product = variant.product as any;
      matchedVariantId = variant.id;
    }
  }

  if (!product) throw new AppError('No product found for this barcode', 404);

  // Attach stock
  const stockRecords = await db.inventoryStock.findMany({
    where: { tenant_id: c.get('tenantId'), product_id: product.id },
    select: { variant_id: true, quantity: true, reserved_qty: true },
  });
  const stockByVariant = new Map<string | null, number>();
  let totalStock = 0;
  for (const s of stockRecords) {
    const available = Math.max(0, s.quantity - s.reserved_qty);
    stockByVariant.set(s.variant_id ?? null, (stockByVariant.get(s.variant_id ?? null) ?? 0) + available);
    totalStock += available;
  }
  const variantsWithStock = (product.variants as any[]).map((v: any) => ({
    ...v, available_stock: stockByVariant.get(v.id) ?? 0,
  }));

  return ok(c, { ...product, variants: variantsWithStock, total_stock: totalStock, matched_variant_id: matchedVariantId });
});

app.get('/categories', async (c) => {
  const categories = await db.productCategory.findMany({
    where: { tenant_id: c.get('tenantId') },
    orderBy: { name: 'asc' },
  });
  return ok(c, categories);
});

app.post('/categories', requireRole('admin', 'store_manager'), async (c) => {
  const { name, code, parent_id } = await c.req.json();
  if (!name || !code) throw new AppError('name and code are required');
  const category = await db.productCategory.create({
    data: { name, code, parent_id: parent_id ?? null, tenant_id: c.get('tenantId') },
  });
  return created(c, category);
});

app.get('/:id', async (c) => {
  const product = await db.product.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: {
      category: true,
      variants: { where: { is_active: true } },
    },
  });
  if (!product) throw new AppError('Product not found', 404);

  // Attach available stock per variant and total product stock
  const stockRecords = await db.inventoryStock.findMany({
    where: { tenant_id: c.get('tenantId'), product_id: product.id },
    select: { variant_id: true, quantity: true, reserved_qty: true },
  });
  const stockByVariant = new Map<string | null, number>();
  let totalStock = 0;
  for (const s of stockRecords) {
    const available = Math.max(0, s.quantity - s.reserved_qty);
    const key = s.variant_id ?? null;
    stockByVariant.set(key, (stockByVariant.get(key) ?? 0) + available);
    totalStock += available;
  }

  const variantsWithStock = (product.variants as any[]).map((v: any) => ({
    ...v,
    available_stock: stockByVariant.get(v.id) ?? 0,
  }));

  return ok(c, { ...product, variants: variantsWithStock, total_stock: totalStock });
});

app.post('/', requireRole('admin', 'store_manager'), async (c) => {
  const {
    name, sku, barcode, description, brand, category_id,
    unit_of_measure, cost_price, selling_price, sale_price,
    weight_kg, is_published, images,
  } = await c.req.json();

  if (!name || !sku || !selling_price) throw new AppError('name, sku and selling_price are required');

  const product = await db.product.create({
    data: {
      name,
      sku,
      barcode: barcode || null,
      description: description || null,
      brand: brand || null,
      category_id: category_id || null,
      unit_of_measure: unit_of_measure ?? 'pair',
      cost_price: cost_price ? Number(cost_price) : null,
      selling_price: Number(selling_price),
      sale_price: sale_price ? Number(sale_price) : null,
      weight_kg: weight_kg ? Number(weight_kg) : null,
      is_published: is_published ?? false,
      images: Array.isArray(images) ? images : [],
      tenant_id: c.get('tenantId'),
    },
  });
  return created(c, product);
});

app.put('/:id', requireRole('admin', 'store_manager'), async (c) => {
  const {
    name, sku, barcode, description, brand, category_id,
    unit_of_measure, cost_price, selling_price, sale_price,
    weight_kg, images, is_active, is_published,
  } = await c.req.json();

  const data: any = { updated_at: new Date() };
  if (name !== undefined) data.name = name;
  if (sku !== undefined) data.sku = sku;
  if (barcode !== undefined) data.barcode = barcode;
  if (description !== undefined) data.description = description;
  if (brand !== undefined) data.brand = brand;
  if (category_id !== undefined) data.category_id = category_id || null;
  if (unit_of_measure !== undefined) data.unit_of_measure = unit_of_measure;
  if (cost_price !== undefined) data.cost_price = cost_price ? Number(cost_price) : null;
  if (selling_price !== undefined) data.selling_price = Number(selling_price);
  if (sale_price !== undefined) data.sale_price = sale_price ? Number(sale_price) : null;
  if (weight_kg !== undefined) data.weight_kg = weight_kg ? Number(weight_kg) : null;
  if (images !== undefined) data.images = images;
  if (is_active !== undefined) data.is_active = is_active;
  if (is_published !== undefined) data.is_published = is_published;

  await db.product.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data,
  });
  return ok(c, null);
});

app.delete('/:id', requireRole('admin'), async (c) => {
  await db.product.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data: { is_active: false, is_published: false },
  });
  return ok(c, null);
});

// ── Variant CRUD ──────────────────────────────────────────────────────────────

app.post('/:id/variants', requireRole('admin', 'store_manager'), async (c) => {
  const { sku_variant, attributes, additional_cost, barcode, is_active } = await c.req.json();
  if (!sku_variant) throw new AppError('sku_variant is required');

  const existing = await db.productVariant.findFirst({
    where: { tenant_id: c.get('tenantId'), sku_variant },
  });

  if (existing) {
    const variant = await db.productVariant.update({
      where: { id: existing.id },
      data: {
        attributes: attributes ?? existing.attributes,
        additional_cost: additional_cost !== undefined ? Number(additional_cost) : existing.additional_cost,
        barcode: barcode !== undefined ? (barcode || null) : existing.barcode,
        is_active: is_active !== false,
        product_id: c.req.param('id'),
      },
    });
    return ok(c, variant);
  } else {
    const variant = await db.productVariant.create({
      data: {
        sku_variant,
        attributes: attributes ?? null,
        additional_cost: additional_cost ? Number(additional_cost) : 0,
        barcode: barcode || null,
        is_active: is_active !== false,
        product_id: c.req.param('id'),
        tenant_id: c.get('tenantId'),
      },
    });
    return created(c, variant);
  }
});

app.put('/:id/variants/:variantId', requireRole('admin', 'store_manager'), async (c) => {
  const { sku_variant, attributes, additional_cost, barcode, is_active } = await c.req.json();
  const data: any = {};
  if (sku_variant !== undefined) data.sku_variant = sku_variant;
  if (attributes !== undefined) data.attributes = attributes;
  if (additional_cost !== undefined) data.additional_cost = Number(additional_cost);
  if (barcode !== undefined) data.barcode = barcode || null;
  if (is_active !== undefined) data.is_active = is_active;
  await db.productVariant.updateMany({
    where: { id: c.req.param('variantId'), product_id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data,
  });
  return ok(c, null);
});

app.delete('/:id/variants/:variantId', requireRole('admin', 'store_manager'), async (c) => {
  await db.productVariant.updateMany({
    where: { id: c.req.param('variantId'), product_id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data: { is_active: false },
  });
  return ok(c, null);
});

// ── Stock ─────────────────────────────────────────────────────────────────────

app.get('/:id/stock', async (c) => {
  const stock = await db.inventoryStock.findMany({
    where: { tenant_id: c.get('tenantId'), product_id: c.req.param('id') },
    include: {
      location: {
        include: { zone: { include: { warehouse: { include: { site: true } } } } },
      },
      variant: { select: { sku_variant: true, size: true, color: true } },
    },
  });
  return ok(c, stock);
});

export default app;
