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

  // Attach total_stock per product AND available_stock per variant.
  // The POS VariantPicker relies on variant.available_stock — without it every
  // variant shows as "Out of Stock" and variant products can't be sold.
  const productIds = products.map((p: any) => p.id);
  const [stockAgg, variantAgg] = productIds.length > 0
    ? await Promise.all([
        db.inventoryStock.groupBy({
          by: ['product_id'],
          where: { tenant_id: c.get('tenantId'), product_id: { in: productIds } },
          _sum: { quantity: true, reserved_qty: true },
        }),
        db.inventoryStock.groupBy({
          by: ['variant_id'],
          where: { tenant_id: c.get('tenantId'), product_id: { in: productIds }, variant_id: { not: null } },
          _sum: { quantity: true, reserved_qty: true },
        }),
      ])
    : [[], []];
  const stockByProduct = new Map(
    stockAgg.map((s: any) => [s.product_id, Math.max(0, (s._sum.quantity ?? 0) - (s._sum.reserved_qty ?? 0))])
  );
  const stockByVariant = new Map(
    variantAgg.map((s: any) => [s.variant_id, Math.max(0, (s._sum.quantity ?? 0) - (s._sum.reserved_qty ?? 0))])
  );
  const productsWithStock = products.map((p: any) => ({
    ...p,
    total_stock: stockByProduct.get(p.id) ?? 0,
    variants: (p.variants ?? []).map((v: any) => ({
      ...v,
      available_stock: stockByVariant.get(v.id) ?? 0,
    })),
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
    uom_id, product_type,
    cost_price, selling_price, sale_price,
    weight_kg, reorder_point, is_published, images,
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
      uom_id: uom_id || null,
      product_type: product_type ?? 'physical',
      cost_price: cost_price ? Number(cost_price) : null,
      selling_price: Number(selling_price),
      sale_price: sale_price ? Number(sale_price) : null,
      weight_kg: weight_kg ? Number(weight_kg) : null,
      reorder_point: reorder_point ? Number(reorder_point) : 0,
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
    uom_id, product_type,
    cost_price, selling_price, sale_price,
    weight_kg, reorder_point, images, is_active, is_published,
  } = await c.req.json();

  const data: any = { updated_at: new Date() };
  if (reorder_point !== undefined) data.reorder_point = Number(reorder_point) || 0;
  if (name !== undefined) data.name = name;
  if (sku !== undefined) data.sku = sku;
  if (barcode !== undefined) data.barcode = barcode;
  if (description !== undefined) data.description = description;
  if (brand !== undefined) data.brand = brand;
  if (category_id !== undefined) data.category_id = category_id || null;
  if (uom_id !== undefined) data.uom_id = uom_id || null;
  if (product_type !== undefined) data.product_type = product_type;
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

// ── Bulk actions on the product list ───────────────────────────────────────────
// Body: { ids: string[], action: 'publish' | 'unpublish' | 'delete' }
app.post('/bulk', requireRole('admin', 'store_manager'), async (c) => {
  const { ids, action } = await c.req.json();
  if (!Array.isArray(ids) || ids.length === 0) throw new AppError('ids must be a non-empty array');
  if (!['publish', 'unpublish', 'delete'].includes(action)) {
    throw new AppError('action must be one of: publish, unpublish, delete');
  }
  // delete is admin-only (soft delete)
  if (action === 'delete' && c.get('user').role !== 'admin') {
    throw new AppError('Only admins can bulk-delete products', 403);
  }

  const data =
    action === 'publish'   ? { is_published: true } :
    action === 'unpublish' ? { is_published: false } :
                             { is_active: false, is_published: false };

  const result = await db.product.updateMany({
    where: { id: { in: ids }, tenant_id: c.get('tenantId') },
    data: { ...data, updated_at: new Date() },
  });

  return ok(c, { affected: result.count, action });
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

// ── Image upload / delete ─────────────────────────────────────────────────────

app.post('/:id/image', async (c) => {
  const productId = c.req.param('id');
  const tenantId  = c.get('tenantId');

  const product = await db.product.findFirst({ where: { id: productId, tenant_id: tenantId } });
  if (!product) throw new AppError('Product not found', 404);

  const body = await c.req.parseBody();
  const file  = body['file'] as File | undefined;
  if (!file) throw new AppError('No file uploaded', 400);
  if (!file.type.startsWith('image/')) throw new AppError('Only image files are allowed', 400);
  if (file.size > 5 * 1024 * 1024) throw new AppError('File too large (max 5MB)', 400);

  const storageUrl = process.env.STORAGE_URL;
  const bucket     = process.env.STORAGE_BUCKET;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!storageUrl || !bucket || !serviceKey) {
    throw new AppError('Storage not configured — set STORAGE_URL, STORAGE_BUCKET, SUPABASE_SERVICE_KEY', 500);
  }

  const ext       = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
  const filename  = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const storagePath = `products/${productId}/${filename}`;
  const uploadUrl   = `${storageUrl}/storage/v1/object/${bucket}/${storagePath}`;

  const arrayBuffer = await file.arrayBuffer();
  const uploadRes   = await fetch(uploadUrl, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': file.type },
    body:    arrayBuffer,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => 'unknown');
    throw new AppError(`Storage upload failed: ${errText}`, 500);
  }

  const publicUrl = `${storageUrl}/storage/v1/object/public/${bucket}/${storagePath}`;

  const updated = await db.product.update({
    where: { id: productId },
    data:  { images: { push: publicUrl } },
  });

  return ok(c, updated);
});

app.delete('/:id/image', async (c) => {
  const productId = c.req.param('id');
  const tenantId  = c.get('tenantId');
  const { url }   = await c.req.json();

  if (!url) throw new AppError('url is required', 400);

  const product = await db.product.findFirst({ where: { id: productId, tenant_id: tenantId } });
  if (!product) throw new AppError('Product not found', 404);

  const updated = await db.product.update({
    where: { id: productId },
    data:  { images: { set: product.images.filter((img: string) => img !== url) } },
  });

  return ok(c, updated);
});

// ── AI Video Generation (FAL.ai — optional) ───────────────────────────────────
// Requires FAL_API_KEY env var. If not set, returns 501.
// Flow: POST generate-video → returns request_id (async job)
//       GET  video-jobs/:requestId → poll until COMPLETED, auto-saves URL to product.video_urls

const FAL_BASE = 'https://queue.fal.run/fal-ai/kling-video/v2.1/standard/image-to-video';

app.post('/:id/generate-video', async (c) => {
  const falKey = process.env.FAL_API_KEY;
  if (!falKey) throw new AppError('AI video generation is not configured. Set FAL_API_KEY in .env.', 501);

  const productId = c.req.param('id');
  const tenantId  = c.get('tenantId');

  const product = await db.product.findFirst({ where: { id: productId, tenant_id: tenantId } });
  if (!product) throw new AppError('Product not found', 404);

  const { image_url, prompt } = await c.req.json();
  if (!image_url) throw new AppError('image_url is required', 400);

  // Verify the image belongs to this product
  if (!product.images.includes(image_url)) {
    throw new AppError('image_url does not belong to this product', 400);
  }

  const res = await fetch(FAL_BASE, {
    method:  'POST',
    headers: {
      'Authorization': `Key ${falKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      image_url,
      prompt:       prompt ?? 'Product showcase, smooth cinematic motion, professional lighting',
      duration:     '5',
      aspect_ratio: '16:9',
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    throw new AppError(`FAL.ai request failed: ${err}`, 502);
  }

  const job = await res.json() as { request_id: string };
  return ok(c, { request_id: job.request_id, status: 'submitted' });
});

app.get('/:id/video-jobs/:requestId', async (c) => {
  const falKey    = process.env.FAL_API_KEY;
  if (!falKey) throw new AppError('AI video generation is not configured.', 501);

  const productId = c.req.param('id');
  const requestId = c.req.param('requestId');
  const tenantId  = c.get('tenantId');

  const product = await db.product.findFirst({ where: { id: productId, tenant_id: tenantId } });
  if (!product) throw new AppError('Product not found', 404);

  // Check job status
  const statusRes = await fetch(`${FAL_BASE}/requests/${requestId}/status`, {
    headers: { 'Authorization': `Key ${falKey}` },
  });

  if (!statusRes.ok) throw new AppError('Failed to check job status', 502);
  const { status } = await statusRes.json() as { status: string };

  if (status === 'COMPLETED') {
    // Fetch result
    const resultRes = await fetch(`${FAL_BASE}/requests/${requestId}`, {
      headers: { 'Authorization': `Key ${falKey}` },
    });
    if (!resultRes.ok) throw new AppError('Failed to fetch video result', 502);

    const result = await resultRes.json() as { video: { url: string } };
    const videoUrl = result.video?.url;

    if (videoUrl && !product.video_urls.includes(videoUrl)) {
      await db.product.update({
        where: { id: productId },
        data:  { video_urls: { push: videoUrl } },
      });
    }

    return ok(c, { status: 'COMPLETED', video_url: videoUrl });
  }

  if (status === 'FAILED') {
    return ok(c, { status: 'FAILED', error: 'Video generation failed on FAL.ai' });
  }

  // IN_QUEUE or IN_PROGRESS
  return ok(c, { status });
});

app.delete('/:id/video', async (c) => {
  const productId = c.req.param('id');
  const tenantId  = c.get('tenantId');
  const { url }   = await c.req.json();
  if (!url) throw new AppError('url is required', 400);

  const product = await db.product.findFirst({ where: { id: productId, tenant_id: tenantId } });
  if (!product) throw new AppError('Product not found', 404);

  await db.product.update({
    where: { id: productId },
    data:  { video_urls: { set: product.video_urls.filter((v: string) => v !== url) } },
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
