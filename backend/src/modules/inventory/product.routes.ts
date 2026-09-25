import { Hono }    from 'hono';
import { db }       from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { logger } from '../../shared/logger';
import { ok, created, paginated } from '../../shared/response';
import { hasPermission, routeGuard, type RouteGuards } from '../../shared/middleware/permissions';
import type { AppContext, AppEnv } from '../../shared/context';
import {
  IMAGE_QUALITIES, PRODUCT_VIEWS, generateProductView, isOneProviderConfigured,
  type ImageQuality, type ProductView,
} from '../../shared/services/oneProvider.service';

const app = new Hono<AppEnv>();

/**
 * The three product reads the storefront shares with the back office (WORK-030a).
 * Every other product route is on PRODUCT_ROUTE_PERMISSIONS below (WORK-030b).
 *
 * A caller without `product.read` — a shopper — gets the storefront projection:
 * published products only, whatever `published` the request carries, and no
 * `cost_price`. `additional_cost` on a variant is NOT hidden: despite its name it
 * is a price surcharge (the POS sells a variant at selling_price + additional_cost),
 * so it is catalogue information, not cost.
 */
export const PRODUCT_READ_ROUTE_PERMISSIONS = Object.freeze({
  'GET /': { anyOf: ['product.read', 'storefront.catalog.read'] },
  'GET /categories': { anyOf: ['product.read', 'storefront.catalog.read'] },
  'GET /:id': { anyOf: ['product.read', 'storefront.catalog.read'] },
} satisfies RouteGuards);

/**
 * The rest of the product router (WORK-030b). Catalogue maintenance, item setup,
 * deletion and paid media generation are separate duties; the stock view of one
 * product is an inventory read.
 */
export const PRODUCT_ROUTE_PERMISSIONS = Object.freeze({
  'GET /barcode/:code': ['product.read'],
  'POST /categories': ['product.maintain'],
  'POST /': ['product.maintain'],
  'PUT /:id': ['product.maintain'],
  'GET /setup/item-groups': ['product.setup.read'],
  'GET /setup/item-model-groups': ['product.setup.read'],
  'POST /setup/item-groups': ['product.setup.maintain'],
  'POST /setup/item-model-groups': ['product.setup.maintain'],
  'PUT /setup/item-model-groups/:id': ['product.setup.maintain'],
  'PUT /setup/item-groups/:id': ['product.setup.maintain'],
  'GET /setup/coverage': ['product.setup.read'],
  'POST /setup/assign-groups': ['product.setup.maintain'],
  'DELETE /:id': ['product.delete'],
  'POST /bulk': ['product.maintain'],
  'POST /:id/variants': ['product.maintain'],
  'PUT /:id/variants/:variantId': ['product.maintain'],
  'DELETE /:id/variants/:variantId': ['product.maintain'],
  'POST /:id/image': ['product.maintain'],
  'DELETE /:id/image': ['product.maintain'],
  'POST /:id/generate-views': ['product.media.generate'],
  'POST /:id/generate-video': ['product.media.generate'],
  'GET /:id/video-jobs/:requestId': ['product.media.generate'],
  'DELETE /:id/video': ['product.maintain'],
  'GET /:id/stock': ['inventory.stock.read'],
} satisfies RouteGuards);

const guard = routeGuard({ ...PRODUCT_READ_ROUTE_PERMISSIONS, ...PRODUCT_ROUTE_PERMISSIONS });

/**
 * Refuses a group id that is not this tenant's. Without it a product could be
 * pointed at another company's item group — and so at its GL accounts.
 */
async function assertGroupsInTenant(
  tenantId: string,
  ids: { item_group_id?: string | null; item_model_group_id?: string | null },
) {
  if (ids.item_group_id) {
    const g = await db.itemGroup.findFirst({ where: { id: ids.item_group_id, tenant_id: tenantId }, select: { id: true } });
    if (!g) throw new AppError('Unknown reference for this tenant: item_group_id', 422, 'FOREIGN_REFERENCE');
  }
  if (ids.item_model_group_id) {
    const g = await db.itemModelGroup.findFirst({ where: { id: ids.item_model_group_id, tenant_id: tenantId }, select: { id: true } });
    if (!g) throw new AppError('Unknown reference for this tenant: item_model_group_id', 422, 'FOREIGN_REFERENCE');
  }
}

/** True when the caller sees the storefront projection rather than the full product. */
export function isStorefrontReader(c: AppContext): boolean {
  return !hasPermission(c.get('user')?.role ?? '', 'product.read');
}

function withoutCost<T extends Record<string, any>>(product: T): T {
  const { cost_price: _hidden, ...rest } = product;
  return rest as T;
}

// GET /products — back office, POS and storefront (projection per the caller)
app.get('/', guard('GET /'), async (c) => {
  const { search, category, inStock, published, page = '1', limit = '20', sortBy = 'name' } = c.req.query();
  const storefront = isStorefrontReader(c);

  const where: any = { tenant_id: c.get('tenantId'), is_active: true };

  // A shopper sees published products only; the query flag cannot widen that.
  if (storefront || published === 'true') where.is_published = true;
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
    ...(storefront ? withoutCost(p) : p),
    total_stock: stockByProduct.get(p.id) ?? 0,
    variants: (p.variants ?? []).map((v: any) => ({
      ...v,
      available_stock: stockByVariant.get(v.id) ?? 0,
    })),
  }));

  return paginated(c, productsWithStock, total, Number(page), Number(limit));
});

// GET /products/barcode/:code — fast lookup by product or variant barcode (POS use)
app.get('/barcode/:code', guard('GET /barcode/:code'), async (c) => {
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

app.get('/categories', guard('GET /categories'), async (c) => {
  const categories = await db.productCategory.findMany({
    where: { tenant_id: c.get('tenantId') },
    orderBy: { name: 'asc' },
  });
  return ok(c, categories);
});

app.post('/categories', guard('POST /categories'), async (c) => {
  const { name, code, parent_id } = await c.req.json();
  if (!name || !code) throw new AppError('name and code are required');
  const category = await db.productCategory.create({
    data: { name, code, parent_id: parent_id ?? null, tenant_id: c.get('tenantId') },
  });
  return created(c, category);
});

app.get('/:id', guard('GET /:id'), async (c) => {
  const storefront = isStorefrontReader(c);
  const product = await db.product.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId'), ...(storefront ? { is_published: true } : {}) },
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

  return ok(c, { ...(storefront ? withoutCost(product) : product), variants: variantsWithStock, total_stock: totalStock });
});

app.post('/', guard('POST /'), async (c) => {
  const {
    name, sku, barcode, description, brand, category_id,
    uom_id, product_type,
    cost_price, selling_price, sale_price,
    weight_kg, reorder_point, is_published, images,
    item_group_id, item_model_group_id,
  } = await c.req.json();

  if (!name || !sku || !selling_price) throw new AppError('name, sku and selling_price are required');
  // A new product has no transactions, so its groups are set freely — at birth
  // is exactly when they should be, not in a separate setup pass afterwards.
  await assertGroupsInTenant(c.get('tenantId'), { item_group_id, item_model_group_id });

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
      item_group_id: item_group_id || null,
      item_model_group_id: item_model_group_id || null,
      tenant_id: c.get('tenantId'),
    },
  });
  return created(c, product);
});

app.put('/:id', guard('PUT /:id'), async (c) => {
  const {
    name, sku, barcode, description, brand, category_id,
    uom_id, product_type,
    cost_price, selling_price, sale_price,
    weight_kg, reorder_point, images, is_active, is_published,
    item_group_id, item_model_group_id, item_tax_group_id,
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
  if (item_tax_group_id !== undefined) data.item_tax_group_id = item_tax_group_id || null;

  // ── Item group / item model group ────────────────────────────────────────
  // [OFFICIAL] "If you change the item group that you assigned to an item after
  // transactions exist, the revenue on new transactions posts to the updated
  // account. However, any revenue that you posted before the change remains in
  // the original account."
  // learn.microsoft.com/dynamics365/finance/general-ledger/recommended-practices-pstg-prfles
  //
  // So a change here splits the ledger from the subledger. It is allowed - the
  // owner may genuinely need to reclassify - but never silently: it is refused
  // once the product has posted transactions unless ?force=true says the caller
  // means it, and it is always logged.
  const changesGrouping =
    (item_group_id !== undefined || item_model_group_id !== undefined);

  if (changesGrouping) {
    await assertGroupsInTenant(c.get('tenantId'), { item_group_id, item_model_group_id });
    const existing = await db.product.findFirst({
      where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
      select: { id: true, sku: true, item_group_id: true, item_model_group_id: true },
    });
    if (!existing) throw new AppError('Product not found', 404);

    const groupMoved =
      (item_group_id !== undefined && (item_group_id || null) !== existing.item_group_id) ||
      (item_model_group_id !== undefined && (item_model_group_id || null) !== existing.item_model_group_id);

    if (groupMoved) {
      const posted = await db.inventoryTransaction.count({
        where: { tenant_id: c.get('tenantId'), product_id: existing.id },
      });
      const force = c.req.query('force') === 'true';

      if (posted > 0 && !force) {
        throw new AppError(
          `"${existing.sku}" already has ${posted} posted inventory transaction(s). ` +
            `Changing its item group or item model group now means new postings go to different ` +
            `accounts while the existing ones stay where they are, so the ledger will no longer ` +
            `reconcile to the subledger. Re-send with ?force=true if that is intended.`,
          409,
          'ITEM_GROUP_CHANGE_AFTER_TRANSACTIONS',
        );
      }
      if (posted > 0 && force) {
        logger.warn(
          {
            tenantId: c.get('tenantId'), sku: existing.sku, posted,
            from: { item_group_id: existing.item_group_id, item_model_group_id: existing.item_model_group_id },
            to: { item_group_id, item_model_group_id },
          },
          'Item grouping changed on a product WITH posted transactions - ledger and subledger will diverge for this item',
        );
      }
    }

    if (item_group_id !== undefined) data.item_group_id = item_group_id || null;
    if (item_model_group_id !== undefined) data.item_model_group_id = item_model_group_id || null;
  }

  await db.product.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data,
  });
  return ok(c, null);
});

/* ── Released-product setup groups ──────────────────────────────────────────
 * [OFFICIAL] a released product requires an item MODEL group (how it is valued
 * and controlled) and an item group (which GL accounts it posts to), among
 * others.
 * learn.microsoft.com/dynamics365/supply-chain/pim/tasks/create-released-product-single-company
 * Design and the full setup order: docs/architecture/ERP_SETUP_CHECKLIST.md
 */

app.get('/setup/item-groups', guard('GET /setup/item-groups'), async (c) => {
  const groups = await db.itemGroup.findMany({
    where: { tenant_id: c.get('tenantId') },
    include: { _count: { select: { products: true } } },
    orderBy: { code: 'asc' },
  });
  return ok(c, groups);
});

app.get('/setup/item-model-groups', guard('GET /setup/item-model-groups'), async (c) => {
  const groups = await db.itemModelGroup.findMany({
    where: { tenant_id: c.get('tenantId') },
    include: { _count: { select: { products: true } } },
    orderBy: { code: 'asc' },
  });
  return ok(c, groups);
});

app.post('/setup/item-groups', guard('POST /setup/item-groups'), async (c) => {
  const { code, name, description } = await c.req.json();
  if (!code || !name) throw new AppError('code and name are required', 400);
  const group = await db.itemGroup.create({
    data: { tenant_id: c.get('tenantId'), code, name, description: description || null },
  });
  return created(c, group);
});

/**
 * The item model group's settings, as one payload.
 *
 * [OFFICIAL] every setting here is independent of every other. In particular
 * `costing_method` and `stocked` are separate axes: a tangible, inventory-
 * tracked item may be valued at standard cost, and a service that appears on a
 * BOM must be stocked. The API therefore never derives one from the other.
 * learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-costing-faq
 */
const COSTING_METHODS = ['FIFO', 'LIFO', 'WEIGHTED_AVG', 'MOVING_AVG', 'STANDARD'];

function modelGroupSettings(b: any, opts: { checkCosting: boolean } = { checkCosting: true }) {
  if (b.costing_method !== undefined && !COSTING_METHODS.includes(b.costing_method)) {
    throw new AppError(
      `Unknown costing method "${b.costing_method}". Expected one of ${COSTING_METHODS.join(', ')}.`,
      400,
    );
  }
  const bool = (v: any, dflt: boolean) => (v === undefined ? dflt : Boolean(v));
  const costingMethod = b.costing_method ?? 'FIFO';
  const stocked = bool(b.stocked, true);
  // FIFO is the only valuation the posting code implements. A stocked group with
  // any other method would be valued FIFO while its setup claimed otherwise, so
  // the combination is refused rather than stored. Non-stocked groups have no
  // inventory valuation and keep whatever method they carry.
  if (opts.checkCosting && stocked && costingMethod !== 'FIFO') {
    throw new AppError(
      `Costing method "${costingMethod}" is not implemented for stocked items yet; only FIFO is. ` +
        'Use FIFO, or mark the group as not stocked.',
      422,
      'COSTING_METHOD_NOT_IMPLEMENTED',
    );
  }
  return {
    costing_method: costingMethod,
    stocked,
    include_physical_value: bool(b.include_physical_value, false),
    fixed_receipt_price: bool(b.fixed_receipt_price, false),
    post_physical_inventory: bool(b.post_physical_inventory, true),
    post_financial_inventory: bool(b.post_financial_inventory, true),
    accrue_liability_on_receipt: bool(b.accrue_liability_on_receipt, true),
    post_deferred_revenue_on_delivery: bool(b.post_deferred_revenue_on_delivery, false),
    registration_requirements: bool(b.registration_requirements, false),
    receiving_requirements: bool(b.receiving_requirements, false),
    picking_requirements: bool(b.picking_requirements, false),
    deduction_requirements: bool(b.deduction_requirements, false),
  };
}

app.post('/setup/item-model-groups', guard('POST /setup/item-model-groups'), async (c) => {
  const b = await c.req.json();
  if (!b.code || !b.name) throw new AppError('code and name are required', 400);
  const group = await db.itemModelGroup.create({
    data: {
      tenant_id: c.get('tenantId'),
      code: b.code,
      name: b.name,
      description: b.description ?? null,
      ...modelGroupSettings(b),
    },
  });
  return created(c, group);
});

app.put('/setup/item-model-groups/:id', guard('PUT /setup/item-model-groups/:id'), async (c) => {
  const b = await c.req.json();
  const existing = await db.itemModelGroup.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    include: { _count: { select: { products: true } } },
  });
  if (!existing) throw new AppError('Item model group not found', 404);

  // Changing the costing method of a group that products already use is not a
  // supported operation once those products have transactions: the valuation of
  // history and of the future would disagree. Refuse unless forced, and say why.
  const changingCosting = b.costing_method !== undefined && b.costing_method !== existing.costing_method;
  const changingStocked = b.stocked !== undefined && Boolean(b.stocked) !== existing.stocked;

  if ((changingCosting || changingStocked) && existing._count.products > 0) {
    const productIds = (
      await db.product.findMany({
        where: { tenant_id: c.get('tenantId'), item_model_group_id: existing.id },
        select: { id: true },
      })
    ).map((p) => p.id);
    const posted = await db.inventoryTransaction.count({
      where: { tenant_id: c.get('tenantId'), product_id: { in: productIds } },
    });

    if (posted > 0 && c.req.query('force') !== 'true') {
      throw new AppError(
        `"${existing.code}" is used by ${existing._count.products} product(s) with ${posted} posted ` +
          `inventory transaction(s). Changing ` +
          `${[changingCosting && 'the costing method', changingStocked && 'whether it is stocked'].filter(Boolean).join(' and ')} ` +
          `now would value history and future differently for the same items. ` +
          `Re-send with ?force=true if that is intended.`,
        409,
        'MODEL_GROUP_CHANGE_AFTER_TRANSACTIONS',
      );
    }
    if (posted > 0) {
      logger.warn(
        { tenantId: c.get('tenantId'), group: existing.code, products: existing._count.products, posted },
        'Item model group valuation settings changed despite posted transactions',
      );
    }
  }

  const group = await db.itemModelGroup.update({
    where: { id: existing.id },
    data: {
      ...(b.name !== undefined && { name: b.name }),
      ...(b.description !== undefined && { description: b.description || null }),
      ...(b.is_active !== undefined && { is_active: Boolean(b.is_active) }),
      // The costing rule is checked when the request touches valuation; a rename
      // or deactivation of a group created before the rule must still go through.
      ...modelGroupSettings({ ...existing, ...b }, { checkCosting: changingCosting || changingStocked }),
    },
  });
  return ok(c, group);
});

app.put('/setup/item-groups/:id', guard('PUT /setup/item-groups/:id'), async (c) => {
  const b = await c.req.json();
  const { count } = await db.itemGroup.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data: {
      ...(b.name !== undefined && { name: b.name }),
      ...(b.description !== undefined && { description: b.description || null }),
      ...(b.is_active !== undefined && { is_active: Boolean(b.is_active) }),
    },
  });
  if (count === 0) throw new AppError('Item group not found', 404);
  return ok(c, null);
});

/**
 * The setup gap, as a number. Products with no item group can only ever resolve
 * the ALL-scope posting profile, so per-group accounts are unreachable for them.
 */
app.get('/setup/coverage', guard('GET /setup/coverage'), async (c) => {
  const tenantId = c.get('tenantId');
  const total = await db.product.count({ where: { tenant_id: tenantId } });
  const noItemGroup = await db.product.count({ where: { tenant_id: tenantId, item_group_id: null } });
  const noModelGroup = await db.product.count({ where: { tenant_id: tenantId, item_model_group_id: null } });
  const noTaxGroup = await db.product.count({ where: { tenant_id: tenantId, item_tax_group_id: null } });

  return ok(c, {
    products: total,
    missing_item_group: noItemGroup,
    missing_item_model_group: noModelGroup,
    missing_item_tax_group: noTaxGroup,
    note:
      'Unassigned products fall back to the ALL-scope posting profile and to ' +
      'InventoryParameters.costing_method, which is the behaviour that existed before ' +
      'item groups were introduced. Nothing is broken; per-group accounts and per-item ' +
      'costing are simply unreachable until assigned.',
  });
});

/**
 * Assigns an item group and/or item model group to many products at once —
 * the way a catalogue of a thousand articles gets set up, instead of one
 * product at a time.
 *
 * Body: {
 *   item_group_id?, item_model_group_id?   at least one; null clears it
 *   product_ids?: string[]                 these products, or
 *   only_unassigned?: true                 every product where that field is empty
 *   force?: boolean
 * }
 *
 * The same guard as PUT /:id applies, set-wise: a product that already has
 * posted inventory transactions is skipped and reported, because moving it
 * would split the ledger from the subledger. `force` includes those too and
 * is logged.
 */
app.post('/setup/assign-groups', guard('POST /setup/assign-groups'), async (c) => {
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));
  const { product_ids, only_unassigned, force } = body as {
    product_ids?: unknown; only_unassigned?: unknown; force?: unknown;
  };

  const fields = (['item_group_id', 'item_model_group_id'] as const).filter((f) => f in body);
  if (fields.length === 0) throw new AppError('Give item_group_id and/or item_model_group_id', 400, 'VALIDATION');
  for (const f of fields) {
    const v = body[f];
    if (v !== null && typeof v !== 'string') throw new AppError(`${f} must be an id or null`, 400, 'VALIDATION');
  }
  const ids = Array.isArray(product_ids) ? product_ids.filter((x): x is string => typeof x === 'string') : null;
  if (!ids?.length && only_unassigned !== true) {
    throw new AppError('Give product_ids, or only_unassigned: true', 400, 'VALIDATION');
  }
  if (ids && ids.length > 5000) throw new AppError('At most 5000 products per call', 400, 'VALIDATION');
  await assertGroupsInTenant(tenantId, { item_group_id: body.item_group_id, item_model_group_id: body.item_model_group_id });

  const result: Record<string, { updated: number; skipped_with_transactions: string[] }> = {};
  for (const field of fields) {
    const value: string | null = body[field] || null;
    const candidates = await db.product.findMany({
      where: {
        tenant_id: tenantId,
        ...(ids?.length ? { id: { in: ids } } : {}),
        ...(only_unassigned === true ? { [field]: null } : {}),
        // Products that would actually change. Spelled out rather than NOT
        // (field = value): in SQL that is NULL for an empty field, which would
        // drop exactly the unassigned products this route exists for.
        ...(value === null
          ? { NOT: { [field]: null } }
          : { OR: [{ [field]: null }, { [field]: { not: value } }] }),
      },
      select: { id: true, sku: true },
    });

    const posted = candidates.length
      ? await db.inventoryTransaction.groupBy({
          by: ['product_id'],
          where: { tenant_id: tenantId, product_id: { in: candidates.map((p) => p.id) } },
        })
      : [];
    const withTx = new Set(posted.map((r) => r.product_id));
    const eligible = candidates.filter((p) => force === true || !withTx.has(p.id));
    const skipped = force === true ? [] : candidates.filter((p) => withTx.has(p.id)).map((p) => p.sku);

    if (force === true && withTx.size > 0) {
      logger.warn(
        { tenantId, field, value, products_with_transactions: withTx.size },
        'Bulk item grouping change on products WITH posted transactions - ledger and subledger will diverge for them',
      );
    }
    const { count } = eligible.length
      ? await db.product.updateMany({
          where: { tenant_id: tenantId, id: { in: eligible.map((p) => p.id) } },
          data: { [field]: value, updated_at: new Date() },
        })
      : { count: 0 };
    result[field] = { updated: count, skipped_with_transactions: skipped };
  }
  return ok(c, result);
});

app.delete('/:id', guard('DELETE /:id'), async (c) => {
  await db.product.updateMany({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data: { is_active: false, is_published: false },
  });
  return ok(c, null);
});

// ── Bulk actions on the product list ───────────────────────────────────────────
// Body: { ids: string[], action: 'publish' | 'unpublish' | 'delete' }
app.post('/bulk', guard('POST /bulk'), async (c) => {
  const { ids, action } = await c.req.json();
  if (!Array.isArray(ids) || ids.length === 0) throw new AppError('ids must be a non-empty array');
  if (!['publish', 'unpublish', 'delete'].includes(action)) {
    throw new AppError('action must be one of: publish, unpublish, delete');
  }
  // Bulk delete is the same duty as deleting one product (soft delete).
  if (action === 'delete' && !hasPermission(c.get('user').role, 'product.delete')) {
    throw new AppError('Permission denied: product.delete', 403);
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

app.post('/:id/variants', guard('POST /:id/variants'), async (c) => {
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

app.put('/:id/variants/:variantId', guard('PUT /:id/variants/:variantId'), async (c) => {
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

app.delete('/:id/variants/:variantId', guard('DELETE /:id/variants/:variantId'), async (c) => {
  await db.productVariant.updateMany({
    where: { id: c.req.param('variantId'), product_id: c.req.param('id'), tenant_id: c.get('tenantId') },
    data: { is_active: false },
  });
  return ok(c, null);
});

// ── Image upload / delete ─────────────────────────────────────────────────────

/** Stores one product image in Supabase Storage and returns its public URL. */
async function uploadProductImage(productId: string, bytes: ArrayBuffer, contentType: string, ext: string): Promise<string> {
  const storageUrl = process.env.STORAGE_URL;
  const bucket     = process.env.STORAGE_BUCKET;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!storageUrl || !bucket || !serviceKey) {
    throw new AppError('Storage not configured — set STORAGE_URL, STORAGE_BUCKET, SUPABASE_SERVICE_KEY', 500);
  }

  const filename    = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const storagePath = `products/${productId}/${filename}`;
  const uploadUrl   = `${storageUrl}/storage/v1/object/${bucket}/${storagePath}`;

  const uploadRes = await fetch(uploadUrl, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': contentType },
    body:    bytes,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => 'unknown');
    throw new AppError(`Storage upload failed: ${errText}`, 500);
  }

  return `${storageUrl}/storage/v1/object/public/${bucket}/${storagePath}`;
}

app.post('/:id/image', guard('POST /:id/image'), async (c) => {
  const productId = c.req.param('id');
  const tenantId  = c.get('tenantId');

  const product = await db.product.findFirst({ where: { id: productId, tenant_id: tenantId } });
  if (!product) throw new AppError('Product not found', 404);

  const body = await c.req.parseBody();
  const file  = body['file'] as File | undefined;
  if (!file) throw new AppError('No file uploaded', 400);
  if (!file.type.startsWith('image/')) throw new AppError('Only image files are allowed', 400);
  if (file.size > 5 * 1024 * 1024) throw new AppError('File too large (max 5MB)', 400);

  const ext       = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
  const publicUrl = await uploadProductImage(productId, await file.arrayBuffer(), file.type, ext);

  const updated = await db.product.update({
    where: { id: productId },
    data:  { images: { push: publicUrl } },
  });

  return ok(c, updated);
});

app.delete('/:id/image', guard('DELETE /:id/image'), async (c) => {
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

// ── AI View Generation (OneProvider — optional) ───────────────────────────────
// Requires ONEPROVIDER_API_KEY env var. If not set, returns 501.
// Generates front / back / left / right views from one of the product's own
// images and appends each successful view to product.images. Views are generated
// independently: one failed view does not discard the others.

app.post('/:id/generate-views', guard('POST /:id/generate-views'), async (c) => {
  if (!isOneProviderConfigured()) {
    throw new AppError('AI image generation is not configured. Set ONEPROVIDER_API_KEY.', 501);
  }

  const productId = c.req.param('id');
  const tenantId  = c.get('tenantId');

  const product = await db.product.findFirst({ where: { id: productId, tenant_id: tenantId } });
  if (!product) throw new AppError('Product not found', 404);

  const { image_url, views, quality } = await c.req.json() as { image_url?: string; views?: string[]; quality?: string };
  if (!image_url) throw new AppError('image_url is required', 400);
  if (quality !== undefined && !IMAGE_QUALITIES.includes(quality as ImageQuality)) {
    throw new AppError(`quality must be one of: ${IMAGE_QUALITIES.join(', ')}`, 400);
  }
  if (!product.images.includes(image_url)) {
    throw new AppError('image_url does not belong to this product', 400);
  }

  const requested = (views?.length ? views : [...PRODUCT_VIEWS]) as ProductView[];
  const unknown = requested.filter((v) => !PRODUCT_VIEWS.includes(v));
  if (unknown.length) throw new AppError(`Unknown view(s): ${unknown.join(', ')}`, 400);

  const refRes = await fetch(image_url);
  if (!refRes.ok) throw new AppError('Reference image could not be downloaded', 502);
  const reference = {
    bytes:       await refRes.arrayBuffer(),
    contentType: refRes.headers.get('content-type') ?? 'image/png',
  };

  const results = await Promise.allSettled(requested.map(async (view) => {
    const image = await generateProductView(reference, view, quality as ImageQuality | undefined);
    const url   = await uploadProductImage(productId, image.bytes, image.contentType, image.ext);
    return { view, url };
  }));

  const generated = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failed = results.flatMap((r, i) => (r.status === 'rejected'
    ? [{ view: requested[i], error: r.reason instanceof Error ? r.reason.message : String(r.reason) }]
    : []));

  for (const f of failed) logger.warn({ productId, view: f.view, error: f.error }, 'AI view generation failed');
  if (!generated.length) throw new AppError(`AI view generation failed: ${failed[0]?.error ?? 'unknown'}`, 502);

  const updated = await db.product.update({
    where: { id: productId },
    data:  { images: { push: generated.map((g) => g.url) } },
  });

  return ok(c, { product: updated, generated, failed });
});

// ── AI Video Generation (FAL.ai — optional) ───────────────────────────────────
// Requires FAL_API_KEY env var. If not set, returns 501.
// Flow: POST generate-video → returns request_id (async job)
//       GET  video-jobs/:requestId → poll until COMPLETED, auto-saves URL to product.video_urls

const FAL_BASE = 'https://queue.fal.run/fal-ai/kling-video/v2.1/standard/image-to-video';
/** Kling v2.1 standard accepts only these clip lengths, in seconds (FAL.ai API schema). */
const FAL_VIDEO_DURATIONS = ['5', '10'] as const;

app.post('/:id/generate-video', guard('POST /:id/generate-video'), async (c) => {
  const falKey = process.env.FAL_API_KEY;
  if (!falKey) throw new AppError('AI video generation is not configured. Set FAL_API_KEY in .env.', 501);

  const productId = c.req.param('id');
  const tenantId  = c.get('tenantId');

  const product = await db.product.findFirst({ where: { id: productId, tenant_id: tenantId } });
  if (!product) throw new AppError('Product not found', 404);

  const { image_url, prompt, duration } = await c.req.json();
  if (!image_url) throw new AppError('image_url is required', 400);

  const seconds = duration === undefined ? '5' : String(duration);
  if (!(FAL_VIDEO_DURATIONS as readonly string[]).includes(seconds)) {
    throw new AppError(`duration must be one of: ${FAL_VIDEO_DURATIONS.join(', ')} seconds`, 400);
  }

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
      duration:     seconds,
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

app.get('/:id/video-jobs/:requestId', guard('GET /:id/video-jobs/:requestId'), async (c) => {
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

app.delete('/:id/video', guard('DELETE /:id/video'), async (c) => {
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

app.get('/:id/stock', guard('GET /:id/stock'), async (c) => {
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
