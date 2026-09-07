/**
 * Quberty ERP — OpenAPI 3.0 Specification
 * Served at GET /api/docs
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const openApiSpec: Record<string, any> = {
  openapi: '3.0.3',
  info: {
    title: 'Quberty ERP API',
    version: '2.0.0',
    description: `
## Quberty ERP — Multi-tenant ERP & POS for Bolivian SMEs

Full-stack ERP with Sales, Purchase, Inventory, Warehouse, HR, Finance, and POS modules.

### Authentication
All endpoints (except \`/auth/login\`, \`/auth/register\`, \`/tenants\`) require a **Bearer token** in the \`Authorization\` header.

Tenant is resolved from:
- \`x-tenant-id\` header (UUID), OR
- \`x-tenant-slug\` header (string)

### Bolivia Tax
- **IVA**: 13% (price-inclusive, extracted from total)
- **IT**: 3% on net subtotal (Impuesto a las Transacciones)
`,
    contact: { name: 'Quberty ERP Support', email: 'support@quberty.bo' },
  },
  servers: [
    { url: 'http://localhost:3001/api', description: 'Development' },
    { url: 'https://api.quberty.bo/api', description: 'Production' },
  ],
  tags: [
    { name: 'Auth',           description: 'Authentication & user account' },
    { name: 'Tenants',        description: 'Tenant provisioning & configuration' },
    { name: 'Products',       description: 'Product catalogue & variants' },
    { name: 'Inventory',      description: 'Stock levels, transactions & adjustments' },
    { name: 'Inventory Counts', description: 'Physical inventory counts' },
    { name: 'Warehouse',      description: 'Sites, warehouses, zones, locations & work orders' },
    { name: 'Sales',          description: 'Sales orders, invoicing & payments' },
    { name: 'Purchase',       description: 'Suppliers, purchase orders & AP' },
    { name: 'Customers',      description: 'Customer records & segments' },
    { name: 'HR',             description: 'Users, employees & payroll' },
    { name: 'Finance',        description: 'Chart of accounts, journal entries, facturas & financial reports' },
    { name: 'Reporting',      description: 'Analytics & dashboard' },
    { name: 'POS',            description: 'Point of Sale — sessions & sales' },
    { name: 'Import',         description: 'Bulk data import' },
    { name: 'Variant Types',  description: 'Product variant type definitions' },
    { name: 'Health',         description: 'Liveness & readiness probes' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              code: { type: 'string' },
            },
          },
        },
      },
      SuccessNull: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { nullable: true, example: null },
        },
      },
      PaginationMeta: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          page:  { type: 'integer' },
          limit: { type: 'integer' },
          pages: { type: 'integer' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id:           { type: 'string', format: 'uuid' },
          email:        { type: 'string', format: 'email' },
          first_name:   { type: 'string' },
          last_name:    { type: 'string' },
          role:         { type: 'string', enum: ['admin', 'store_manager', 'warehouse_worker', 'employee', 'customer'] },
          is_active:    { type: 'boolean' },
          last_login_at: { type: 'string', format: 'date-time', nullable: true },
          created_at:   { type: 'string', format: 'date-time' },
        },
      },
      Tenant: {
        type: 'object',
        properties: {
          id:       { type: 'string', format: 'uuid' },
          name:     { type: 'string' },
          slug:     { type: 'string' },
          plan:     { type: 'string', enum: ['starter', 'growth', 'enterprise'] },
          language: { type: 'string', example: 'es' },
          timezone: { type: 'string', example: 'America/La_Paz' },
          modules:  { type: 'object' },
        },
      },
      Product: {
        type: 'object',
        properties: {
          id:            { type: 'string', format: 'uuid' },
          name:          { type: 'string' },
          sku:           { type: 'string' },
          barcode:       { type: 'string', nullable: true },
          description:   { type: 'string', nullable: true },
          brand:         { type: 'string', nullable: true },
          category_id:   { type: 'string', format: 'uuid', nullable: true },
          selling_price: { type: 'number' },
          cost_price:    { type: 'number', nullable: true },
          sale_price:    { type: 'number', nullable: true },
          is_published:  { type: 'boolean' },
          is_active:     { type: 'boolean' },
          total_stock:   { type: 'integer' },
        },
      },
      SalesOrder: {
        type: 'object',
        properties: {
          id:           { type: 'string', format: 'uuid' },
          order_number: { type: 'string', example: 'SO-00001' },
          status:       { type: 'string', enum: ['DRAFT','CONFIRMED','SHIPPED','COMPLETED','CANCELLED','RETURNED','VOIDED'] },
          subtotal:     { type: 'number' },
          tax_amount:   { type: 'number' },
          total_amount: { type: 'number' },
          customer_id:  { type: 'string', format: 'uuid', nullable: true },
          created_at:   { type: 'string', format: 'date-time' },
        },
      },
      PurchaseOrder: {
        type: 'object',
        properties: {
          id:           { type: 'string', format: 'uuid' },
          po_number:    { type: 'string', example: 'PO-00001' },
          status:       { type: 'string', enum: ['DRAFT','CONFIRMED','RECEIVED','CANCELLED'] },
          subtotal:     { type: 'number' },
          tax_amount:   { type: 'number' },
          total_amount: { type: 'number' },
          supplier_id:  { type: 'string', format: 'uuid' },
          created_at:   { type: 'string', format: 'date-time' },
        },
      },
      Factura: {
        type: 'object',
        properties: {
          id:             { type: 'string', format: 'uuid' },
          factura_number: { type: 'string', example: '000001' },
          source_type:    { type: 'string', enum: ['SALE','POS_SALE','MANUAL','RETURN'] },
          customer_name:  { type: 'string' },
          customer_nit:   { type: 'string', nullable: true },
          invoice_date:   { type: 'string', format: 'date-time' },
          subtotal:       { type: 'number' },
          iva_amount:     { type: 'number', description: 'IVA 13% (Bolivia)' },
          it_amount:      { type: 'number', description: 'IT 3% (Bolivia)' },
          total_amount:   { type: 'number' },
          status:         { type: 'string', enum: ['ISSUED','CANCELLED'] },
        },
      },
      JournalEntry: {
        type: 'object',
        properties: {
          id:           { type: 'string', format: 'uuid' },
          entry_number: { type: 'string', example: 'JE-2026-00001' },
          entry_date:   { type: 'string', format: 'date-time' },
          description:  { type: 'string' },
          source_module: { type: 'string', nullable: true },
          status:       { type: 'string', enum: ['DRAFT','POSTED'] },
          lines:        { type: 'array', items: { $ref: '#/components/schemas/JournalLine' } },
        },
      },
      JournalLine: {
        type: 'object',
        properties: {
          account_id:    { type: 'string', format: 'uuid' },
          debit_amount:  { type: 'number' },
          credit_amount: { type: 'number' },
          description:   { type: 'string', nullable: true },
          account:       { type: 'object', properties: { code: { type: 'string' }, name: { type: 'string' } } },
        },
      },
      RegisterSession: {
        type: 'object',
        properties: {
          id:                { type: 'string', format: 'uuid' },
          terminal_name:     { type: 'string' },
          status:            { type: 'string', enum: ['OPEN','CLOSED'] },
          opening_float:     { type: 'number' },
          closing_float:     { type: 'number', nullable: true },
          total_sales:       { type: 'number' },
          transaction_count: { type: 'integer' },
          opened_at:         { type: 'string', format: 'date-time' },
          closed_at:         { type: 'string', format: 'date-time', nullable: true },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {

    // ── Health ──────────────────────────────────────────────────────────────
    '/health/live': {
      get: {
        tags: ['Health'], summary: 'Liveness probe', security: [],
        responses: { '200': { description: 'Server is alive', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } } } } } },
      },
    },
    '/health/ready': {
      get: {
        tags: ['Health'], summary: 'Readiness probe (DB ping + metrics)', security: [],
        responses: {
          '200': {
            description: 'Server is ready',
            content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' }, version: { type: 'string' }, uptime: { type: 'string' }, db: { type: 'string' }, memory: { type: 'string' } } } } },
          },
        },
      },
    },

    // ── Auth ────────────────────────────────────────────────────────────────
    '/v1/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Login', security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['email','password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' }, tenant_slug: { type: 'string' }, tenant_id: { type: 'string', format: 'uuid' } } } } },
        },
        responses: {
          '200': { description: 'Login successful', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { access_token: { type: 'string' }, refresh_token: { type: 'string' }, tenant_id: { type: 'string' }, user: { $ref: '#/components/schemas/User' } } } } } } } },
          '401': { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/v1/auth/register': {
      post: {
        tags: ['Auth'], summary: 'Register new customer account', security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['email','password','first_name','last_name'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8 }, first_name: { type: 'string' }, last_name: { type: 'string' }, tenant_id: { type: 'string', format: 'uuid' } } } } },
        },
        responses: {
          '201': { description: 'Account created' },
          '409': { description: 'Email already registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/v1/auth/refresh': {
      post: {
        tags: ['Auth'], summary: 'Refresh access token', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['refresh_token'], properties: { refresh_token: { type: 'string' } } } } } },
        responses: { '200': { description: 'New access token issued' } },
      },
    },
    '/v1/auth/me': {
      get: {
        tags: ['Auth'], summary: 'Get current user',
        responses: { '200': { description: 'Current user', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/User' } } } } } } },
      },
    },
    '/v1/auth/account': {
      get: { tags: ['Auth'], summary: 'Get user + linked customer record', responses: { '200': { description: 'User and customer data' } } },
      put: { tags: ['Auth'], summary: 'Update account profile', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { first_name: { type: 'string' }, last_name: { type: 'string' }, phone: { type: 'string' }, city: { type: 'string' }, country: { type: 'string' } } } } } }, responses: { '200': { description: 'Updated' } } },
    },

    // ── Tenants ─────────────────────────────────────────────────────────────
    '/v1/tenants': {
      post: {
        tags: ['Tenants'], summary: 'Create new tenant', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name','slug'], properties: { name: { type: 'string' }, slug: { type: 'string' }, plan: { type: 'string', default: 'starter' }, language: { type: 'string', default: 'es' }, timezone: { type: 'string', default: 'America/La_Paz' } } } } } },
        responses: { '201': { description: 'Tenant created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/Tenant' } } } } } } },
      },
    },
    '/v1/tenants/{id}/config': {
      get: { tags: ['Tenants'], summary: 'Get tenant configuration', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Tenant config' } } },
      put: { tags: ['Tenants'], summary: 'Update tenant configuration', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { modules: { type: 'object' }, branding: { type: 'object' }, language: { type: 'string' }, timezone: { type: 'string' } } } } } }, responses: { '200': { description: 'Updated' } } },
    },

    // ── Products ─────────────────────────────────────────────────────────────
    '/v1/products': {
      get: {
        tags: ['Products'], summary: 'List products with stock',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'inStock', in: 'query', schema: { type: 'boolean' } },
          { name: 'published', in: 'query', schema: { type: 'boolean' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'sortBy', in: 'query', schema: { type: 'string', enum: ['name','price_asc','price_desc'] } },
        ],
        responses: { '200': { description: 'Paginated product list' } },
      },
      post: {
        tags: ['Products'], summary: 'Create product',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name','sku','selling_price'], properties: { name: { type: 'string' }, sku: { type: 'string' }, barcode: { type: 'string' }, selling_price: { type: 'number' }, cost_price: { type: 'number' }, category_id: { type: 'string' }, is_published: { type: 'boolean' } } } } } },
        responses: { '201': { description: 'Product created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/Product' } } } } } } },
      },
    },
    '/v1/products/barcode/{code}': {
      get: {
        tags: ['Products'], summary: 'Lookup product by barcode (POS use)',
        parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Product with stock' }, '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
      },
    },
    '/v1/products/categories': {
      get: { tags: ['Products'], summary: 'List product categories', responses: { '200': { description: 'Category list' } } },
      post: { tags: ['Products'], summary: 'Create category', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name','code'], properties: { name: { type: 'string' }, code: { type: 'string' }, parent_id: { type: 'string' } } } } } }, responses: { '201': { description: 'Created' } } },
    },
    '/v1/products/{id}': {
      get: { tags: ['Products'], summary: 'Get product with variants & stock', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Product detail' } } },
      put: { tags: ['Products'], summary: 'Update product', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Product' } } } }, responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Products'], summary: 'Deactivate product (soft delete)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Deactivated' } } },
    },
    '/v1/products/{id}/variants': {
      post: { tags: ['Products'], summary: 'Create or upsert variant', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['sku_variant'], properties: { sku_variant: { type: 'string' }, attributes: { type: 'object' }, additional_cost: { type: 'number' }, barcode: { type: 'string' } } } } } }, responses: { '201': { description: 'Created' } } },
    },
    '/v1/products/{id}/stock': {
      get: { tags: ['Products'], summary: 'Get stock by location for a product', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Stock records' } } },
    },

    // ── Inventory ────────────────────────────────────────────────────────────
    '/v1/inventory/stock': {
      get: {
        tags: ['Inventory'], summary: 'View all stock levels',
        parameters: [
          { name: 'warehouse_id', in: 'query', schema: { type: 'string' } },
          { name: 'product_id', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Stock records with location & product info' } },
      },
    },
    '/v1/inventory/transactions': {
      get: { tags: ['Inventory'], summary: 'List inventory transactions', responses: { '200': { description: 'Transaction history' } } },
    },
    '/v1/inventory/transfers': {
      post: { tags: ['Inventory'], summary: 'Transfer stock between locations', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { product_id: { type: 'string' }, from_location_id: { type: 'string' }, to_location_id: { type: 'string' }, quantity: { type: 'integer' } } } } } }, responses: { '200': { description: 'Transfer completed' } } },
    },
    '/v1/inventory/adjust': {
      post: {
        tags: ['Inventory'], summary: 'Manual stock adjustment (+ or -)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['product_id','location_id','quantity'], properties: { product_id: { type: 'string' }, location_id: { type: 'string' }, variant_id: { type: 'string' }, quantity: { type: 'integer', description: 'Positive to add, negative to subtract' }, notes: { type: 'string' } } } } } },
        responses: { '200': { description: 'Adjustment recorded' } },
      },
    },

    // ── Inventory Counts ─────────────────────────────────────────────────────
    '/v1/inventory-counts': {
      get: { tags: ['Inventory Counts'], summary: 'List inventory counts', responses: { '200': { description: 'Count list' } } },
      post: { tags: ['Inventory Counts'], summary: 'Create new count (auto-populates from current stock)', requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { notes: { type: 'string' }, location_id: { type: 'string' } } } } } }, responses: { '201': { description: 'Count created with lines pre-populated' } } },
    },
    '/v1/inventory-counts/{id}': {
      get: { tags: ['Inventory Counts'], summary: 'Get count with all lines', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Count detail' } } },
    },
    '/v1/inventory-counts/{id}/lines/{lineId}': {
      put: { tags: ['Inventory Counts'], summary: 'Record counted quantity for a line', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'lineId', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['counted_qty'], properties: { counted_qty: { type: 'integer' } } } } } }, responses: { '200': { description: 'Updated' } } },
    },
    '/v1/inventory-counts/{id}/finalize': {
      post: { tags: ['Inventory Counts'], summary: 'Finalize count — adjusts stock and records transactions', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Count finalized, stock adjusted' } } },
    },

    // ── Warehouse ────────────────────────────────────────────────────────────
    '/v1/warehouse/sites': {
      get: { tags: ['Warehouse'], summary: 'List sites', responses: { '200': { description: 'Site list' } } },
      post: { tags: ['Warehouse'], summary: 'Create site', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name','code'], properties: { name: { type: 'string' }, code: { type: 'string' }, city: { type: 'string' }, country: { type: 'string', default: 'BO' } } } } } }, responses: { '201': { description: 'Created' } } },
    },
    '/v1/warehouse/warehouses': {
      get: { tags: ['Warehouse'], summary: 'List warehouses with zones', responses: { '200': { description: 'Warehouse list' } } },
      post: { tags: ['Warehouse'], summary: 'Create warehouse (auto-creates site if not provided)', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['code','name'], properties: { code: { type: 'string' }, name: { type: 'string' }, type: { type: 'string', default: 'standard' }, site_id: { type: 'string' } } } } } }, responses: { '201': { description: 'Created' } } },
    },
    '/v1/warehouse/locations': {
      get: { tags: ['Warehouse'], summary: 'List locations', parameters: [{ name: 'zone_id', in: 'query', schema: { type: 'string' } }, { name: 'warehouse_id', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'Location list' } } },
      post: { tags: ['Warehouse'], summary: 'Create location', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['zone_id','code'], properties: { zone_id: { type: 'string' }, code: { type: 'string' }, aisle: { type: 'string' }, rack: { type: 'string' }, shelf: { type: 'string' } } } } } }, responses: { '201': { description: 'Created' } } },
    },

    // ── Sales ────────────────────────────────────────────────────────────────
    '/v1/sales': {
      get: { tags: ['Sales'], summary: 'List sales orders', parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'customer_id', in: 'query', schema: { type: 'string' } }, { name: 'page', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'Sales order list' } } },
      post: { tags: ['Sales'], summary: 'Create sales order', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['lines'], properties: { customer_id: { type: 'string' }, notes: { type: 'string' }, lines: { type: 'array', items: { type: 'object', properties: { product_id: { type: 'string' }, variant_id: { type: 'string' }, quantity: { type: 'integer' }, unit_price: { type: 'number' }, discount_pct: { type: 'number' } } } } } } } } }, responses: { '201': { description: 'Order created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/SalesOrder' } } } } } } } },
    },
    '/v1/sales/{id}': {
      get: { tags: ['Sales'], summary: 'Get order with lines & factura', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Order detail' } } },
      put: { tags: ['Sales'], summary: 'Edit order (DRAFT or CONFIRMED only, before invoicing)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { lines: { type: 'array', items: { type: 'object' } }, notes: { type: 'string' } } } } } }, responses: { '200': { description: 'Updated' } } },
    },
    '/v1/sales/{id}/confirm': {
      post: { tags: ['Sales'], summary: 'Confirm order (reserves stock)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Confirmed' } } },
    },
    '/v1/sales/{id}/invoice': {
      post: {
        tags: ['Sales'], summary: 'Issue Factura (Bolivia invoice) — creates GL journal entry',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { customer_nit: { type: 'string', description: 'NIT for official invoice' }, notes: { type: 'string' }, factura_number: { type: 'string', maxLength: 40, description: 'Required when the FACTURA number sequence is set to manual, and REJECTED when it is not. Read GET /setup/number-sequences to find out which.' } } } } } },
        responses: { '201': { description: 'Factura issued', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/Factura' } } } } } } },
      },
    },
    '/v1/sales/{id}/pay': {
      post: {
        tags: ['Sales'], summary: 'Record AR payment — clears CxC (1103)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { payment_date: { type: 'string', format: 'date' }, account_code: { type: 'string', default: '1102', description: 'Bank account (1102) or cash (1101)' }, notes: { type: 'string' } } } } } },
        responses: { '200': { description: 'Payment recorded' } },
      },
    },
    '/v1/sales/{id}/ship': { post: { tags: ['Sales'], summary: 'Mark as shipped', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Shipped' } } } },
    '/v1/sales/{id}/complete': { post: { tags: ['Sales'], summary: 'Mark as completed', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Completed' } } } },
    '/v1/sales/{id}/cancel': { post: { tags: ['Sales'], summary: 'Cancel order', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Cancelled' } } } },
    '/v1/sales/{id}/return': {
      post: {
        tags: ['Sales'], summary: 'Process return — restores stock + issues credit note Factura + reverses GL',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        // The credit note draws from the FACTURA series, so it obeys the FACTURA
        // numbering mode. Unknown properties are rejected.
        requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: { notes: { type: 'string' }, factura_number: { type: 'string', maxLength: 40, description: 'Required when the FACTURA number sequence is set to manual, and REJECTED when it is not. Read GET /setup/number-sequences to find out which.' } } } } } },
        responses: { '200': { description: 'Return processed' } },
      },
    },

    // ── Purchase ─────────────────────────────────────────────────────────────
    '/v1/purchase/suppliers': {
      get: { tags: ['Purchase'], summary: 'List suppliers', responses: { '200': { description: 'Supplier list' } } },
      post: { tags: ['Purchase'], summary: 'Create supplier', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['code','name'], properties: { code: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, payment_terms: { type: 'integer', default: 30 } } } } } }, responses: { '201': { description: 'Created' } } },
    },
    '/v1/purchase/orders': {
      get: { tags: ['Purchase'], summary: 'List purchase orders', parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'supplier_id', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'PO list' } } },
      post: {
        tags: ['Purchase'], summary: 'Create purchase order',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['supplier_id','warehouse_id','lines'], properties: { supplier_id: { type: 'string' }, warehouse_id: { type: 'string' }, receive_location_id: { type: 'string' }, expected_date: { type: 'string', format: 'date' }, lines: { type: 'array', items: { type: 'object', properties: { product_id: { type: 'string' }, quantity: { type: 'integer' }, unit_cost: { type: 'number' } } } } } } } } },
        responses: { '201': { description: 'PO created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/PurchaseOrder' } } } } } } },
      },
    },
    '/v1/purchase/orders/{id}/confirm': { post: { tags: ['Purchase'], summary: 'Confirm PO (DRAFT → CONFIRMED)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Confirmed' } } } },
    '/v1/purchase/orders/{id}/receive': {
      post: {
        tags: ['Purchase'], summary: 'Receive PO — adds stock + creates GL journal entry (Dr Inventory, Cr AP)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { receive_location_id: { type: 'string' }, packing_slip_url: { type: 'string' } } } } } },
        responses: { '200': { description: 'PO received, stock updated' } },
      },
    },
    '/v1/purchase/orders/{id}/pay': {
      post: {
        tags: ['Purchase'], summary: 'Pay supplier — creates GL journal entry (Dr AP, Cr Bank)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { payment_date: { type: 'string', format: 'date' }, account_code: { type: 'string', default: '1102' }, notes: { type: 'string' } } } } } },
        responses: { '200': { description: 'Payment recorded' } },
      },
    },

    // ── Customers ────────────────────────────────────────────────────────────
    '/v1/customers': {
      get: { tags: ['Customers'], summary: 'List customers', parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }, { name: 'segment', in: 'query', schema: { type: 'string' } }, { name: 'page', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'Customer list' } } },
      post: { tags: ['Customers'], summary: 'Create customer', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['first_name','last_name'], properties: { first_name: { type: 'string' }, last_name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, segment: { type: 'string', default: 'regular' } } } } } }, responses: { '201': { description: 'Created' } } },
    },
    '/v1/customers/segments': { get: { tags: ['Customers'], summary: 'Get customer segment summary', responses: { '200': { description: 'Segments with count and lifetime value' } } } },
    '/v1/customers/{id}': {
      get: { tags: ['Customers'], summary: 'Get customer', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Customer detail' } } },
      put: { tags: ['Customers'], summary: 'Update customer', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'Updated' } } },
    },
    '/v1/customers/{id}/orders': { get: { tags: ['Customers'], summary: 'Get customer order history', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Orders' } } } },

    // ── HR ───────────────────────────────────────────────────────────────────
    '/v1/hr/users': {
      get: { tags: ['HR'], summary: 'List all users (admin only)', responses: { '200': { description: 'User list', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } } } } } },
    },
    '/v1/hr/users/{id}/role': {
      put: { tags: ['HR'], summary: 'Change user role', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['role'], properties: { role: { type: 'string', enum: ['admin','store_manager','warehouse_worker','employee','customer'] } } } } } }, responses: { '200': { description: 'Role updated' } } },
    },
    '/v1/hr/employees': {
      get: { tags: ['HR'], summary: 'List active employees', responses: { '200': { description: 'Employee list' } } },
      post: { tags: ['HR'], summary: 'Create employee (optionally creates linked user account)', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' }, first_name: { type: 'string' }, last_name: { type: 'string' }, pos_pin: { type: 'string', description: '4-6 digit POS PIN' } } } } } }, responses: { '201': { description: 'Employee created' } } },
    },
    '/v1/hr/payroll': {
      get: { tags: ['HR'], summary: 'List payroll runs', responses: { '200': { description: 'Payroll journal entries' } } },
      post: {
        tags: ['HR'], summary: 'Process payroll for a period — creates journal entry',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['year','month','lines'], properties: { year: { type: 'integer' }, month: { type: 'integer', minimum: 1, maximum: 12 }, lines: { type: 'array', items: { type: 'object', properties: { employee_id: { type: 'string' }, gross_salary: { type: 'number' }, deductions: { type: 'number' } } } } } } } } },
        responses: { '201': { description: 'Payroll processed' } },
      },
    },

    // ── Finance ──────────────────────────────────────────────────────────────
    '/v1/finance/accounts': {
      get: { tags: ['Finance'], summary: 'List chart of accounts', responses: { '200': { description: 'Account list (sorted by code)' } } },
      post: { tags: ['Finance'], summary: 'Create account', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['code','name','type'], properties: { code: { type: 'string' }, name: { type: 'string' }, type: { type: 'string', enum: ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'] }, normal_balance: { type: 'string', enum: ['DEBIT','CREDIT'] } } } } } }, responses: { '201': { description: 'Created' } } },
    },
    '/v1/finance/accounts/seed-default': {
      post: { tags: ['Finance'], summary: 'Seed default Bolivian chart of accounts (18 accounts, PCG Bolivia)', responses: { '200': { description: '18 accounts created' }, '409': { description: 'Accounts already exist' } } },
    },
    '/v1/finance/journal-entries': {
      get: { tags: ['Finance'], summary: 'List journal entries', parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['DRAFT','POSTED'] } }, { name: 'page', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'Journal entries' } } },
      post: {
        tags: ['Finance'], summary: 'Create manual journal entry',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['entry_date','description','lines'], properties: { entry_date: { type: 'string', format: 'date' }, description: { type: 'string' }, lines: { type: 'array', items: { type: 'object', required: ['account_id'], properties: { account_id: { type: 'string' }, debit_amount: { type: 'number' }, credit_amount: { type: 'number' }, description: { type: 'string' } } } } } } } } },
        responses: { '201': { description: 'Journal entry created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/JournalEntry' } } } } } } },
      },
    },
    '/v1/finance/facturas': {
      get: { tags: ['Finance'], summary: 'List facturas', parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'Factura list with order lines' } } },
    },
    '/v1/finance/trial-balance': {
      get: { tags: ['Finance'], summary: 'Trial balance — all accounts with debit/credit totals and balance', responses: { '200': { description: 'Trial balance' } } },
    },
    '/v1/finance/profit-loss': {
      get: {
        tags: ['Finance'], summary: 'Profit & Loss statement',
        parameters: [{ name: 'from', in: 'query', schema: { type: 'string', format: 'date' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } }],
        responses: { '200': { description: 'P&L with revenue, expenses, and net income' } },
      },
    },
    '/v1/finance/balance-sheet': {
      get: { tags: ['Finance'], summary: 'Balance sheet as of a date', parameters: [{ name: 'date', in: 'query', schema: { type: 'string', format: 'date' } }], responses: { '200': { description: 'Balance sheet (assets = liabilities + equity check included)' } } },
    },
    '/v1/finance/iva-report': {
      get: { tags: ['Finance'], summary: 'IVA report for a given month (Bolivia Libro de Ventas)', parameters: [{ name: 'year', in: 'query', required: true, schema: { type: 'integer' } }, { name: 'month', in: 'query', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'All issued facturas with IVA totals' } } },
    },
    '/v1/finance/iva-net-report': {
      get: { tags: ['Finance'], summary: 'IVA net payable (Débito Fiscal vs Crédito Fiscal)', parameters: [{ name: 'year', in: 'query', required: true, schema: { type: 'integer' } }, { name: 'month', in: 'query', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Net IVA payable to IMPUESTOS NACIONALES' } } },
    },
    '/v1/finance/ap-aging': { get: { tags: ['Finance'], summary: 'AP aging (unpaid POs by 0-30/31-60/61-90/90+ days)', responses: { '200': { description: 'AP aging buckets' } } } },
    '/v1/finance/ar-aging': { get: { tags: ['Finance'], summary: 'AR aging (unpaid invoiced SOs by bucket)', responses: { '200': { description: 'AR aging buckets' } } } },
    '/v1/finance/bank-reconciliation': {
      get: {
        tags: ['Finance'], summary: 'Bank reconciliation ledger for account 1101 (Banco)',
        parameters: [{ name: 'year', in: 'query', required: true, schema: { type: 'integer' } }, { name: 'month', in: 'query', required: true, schema: { type: 'integer' } }, { name: 'statement_balance', in: 'query', schema: { type: 'number' } }],
        responses: { '200': { description: 'Ledger with running balance and reconciliation diff' } },
      },
    },
    '/v1/finance/periods': { get: { tags: ['Finance'], summary: 'List accounting periods (last 12 months)', responses: { '200': { description: 'Period list with OPEN/CLOSED status' } } } },
    '/v1/finance/periods/{year}/{month}/close': { post: { tags: ['Finance'], summary: 'Close accounting period (blocks new JEs for that period)', parameters: [{ name: 'year', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'month', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Period closed' } } } },
    '/v1/finance/periods/{year}/{month}/reopen': { post: { tags: ['Finance'], summary: 'Reopen accounting period', parameters: [{ name: 'year', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'month', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Period reopened' } } } },

    // ── Reporting ────────────────────────────────────────────────────────────
    '/v1/reports/dashboard': {
      get: { tags: ['Reporting'], summary: 'Dashboard summary (KPIs, recent orders, low stock)', responses: { '200': { description: 'Dashboard data' } } },
    },
    '/v1/reports/sales/monthly': {
      get: { tags: ['Reporting'], summary: 'Monthly sales totals', parameters: [{ name: 'from', in: 'query', schema: { type: 'string' } }, { name: 'to', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'Monthly sales data' } } },
    },
    '/v1/reports/products/top-selling': {
      get: { tags: ['Reporting'], summary: 'Top selling products', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }], responses: { '200': { description: 'Top products by revenue' } } },
    },
    '/v1/reports/inventory/valuation': {
      get: { tags: ['Reporting'], summary: 'Inventory valuation (quantity × cost price)', responses: { '200': { description: 'Inventory value' } } },
    },
    '/v1/reports/inventory/turnover': {
      get: { tags: ['Reporting'], summary: 'Inventory turnover by product', responses: { '200': { description: 'Turnover data' } } },
    },
    '/v1/reports/daily-revenue': {
      get: { tags: ['Reporting'], summary: 'Daily revenue for a given month', parameters: [{ name: 'year', in: 'query', schema: { type: 'integer' } }, { name: 'month', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'Daily revenue array' } } },
    },

    // ── POS ──────────────────────────────────────────────────────────────────
    '/v1/pos/sessions/open': {
      post: {
        tags: ['POS'], summary: 'Open register session',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['terminal_name','opening_float'], properties: { terminal_name: { type: 'string', example: 'POS-01' }, opening_float: { type: 'number', example: 500 }, site_id: { type: 'string' }, warehouse_id: { type: 'string' } } } } } },
        responses: { '201': { description: 'Session opened', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/RegisterSession' } } } } } } },
      },
    },
    '/v1/pos/sessions/current': {
      get: { tags: ['POS'], summary: 'Get current open session for a terminal', parameters: [{ name: 'terminal_name', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Open session or null' } } },
    },
    '/v1/pos/sessions': {
      get: { tags: ['POS'], summary: 'List all register sessions (last 50)', responses: { '200': { description: 'Session list' } } },
    },
    '/v1/pos/sessions/{id}/close': {
      post: {
        tags: ['POS'], summary: 'Close register → returns Z-report',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['closing_float'], properties: { closing_float: { type: 'number' } } } } } },
        responses: {
          '200': {
            description: 'Session closed with Z-report',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { session: { $ref: '#/components/schemas/RegisterSession' }, z_report: { type: 'object', properties: { total_sales: { type: 'number' }, transaction_count: { type: 'integer' }, over_short: { type: 'number' } } } } } } } } },
          },
        },
      },
    },
    '/v1/pos/sale': {
      post: {
        tags: ['POS'], summary: 'Process atomic POS sale — stock → SO → Factura → GL in one transaction',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['session_id','lines'], properties: {
            session_id:     { type: 'string', format: 'uuid' },
            customer_name:  { type: 'string', default: 'Cliente Mostrador' },
            customer_nit:   { type: 'string', nullable: true, description: 'Bolivia NIT for tax receipt' },
            payment_method: { type: 'string', enum: ['CASH','CARD','QR','TRANSFER'], default: 'CASH' },
            cash_tendered:  { type: 'number' },
            lines: { type: 'array', items: { type: 'object', required: ['product_id','quantity','unit_price'], properties: { product_id: { type: 'string' }, variant_id: { type: 'string' }, quantity: { type: 'integer' }, unit_price: { type: 'number' }, discount_pct: { type: 'number', default: 0 } } } },
          } } } },
        },
        responses: {
          '201': { description: 'Sale completed', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { order_id: { type: 'string' }, order_number: { type: 'string' }, factura_number: { type: 'string' }, total: { type: 'number' }, iva_amount: { type: 'number' }, change_due: { type: 'number' } } } } } } } },
          '400': { description: 'Insufficient stock or invalid session', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/v1/pos/sales/{orderId}/void': {
      post: {
        tags: ['POS'], summary: 'Void POS sale (same-day only) — reverses stock + GL',
        parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Sale voided, stock restored' }, '400': { description: 'Cannot void — past same-day window' } },
      },
    },

    // ── Import ───────────────────────────────────────────────────────────────
    '/v1/import/upload': {
      post: {
        tags: ['Import'], summary: 'Upload file for import (CSV/XLSX, max 10MB)',
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file','import_type'], properties: { file: { type: 'string', format: 'binary' }, import_type: { type: 'string', enum: ['products','customers','inventory'] } } } } } },
        responses: { '200': { description: 'File uploaded, job created with preview' } },
      },
    },
    '/v1/import/jobs': { get: { tags: ['Import'], summary: 'List import jobs (last 50)', responses: { '200': { description: 'Job list' } } } },
    '/v1/import/jobs/{id}/validate': { post: { tags: ['Import'], summary: 'Validate mapped import data', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Validation result with errors' } } } },
    '/v1/import/jobs/{id}/execute': { post: { tags: ['Import'], summary: 'Execute import job', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Import started' } } } },

    // ── Variant Types ────────────────────────────────────────────────────────
    '/v1/variant-types': {
      get: { tags: ['Variant Types'], summary: 'List variant types (e.g. Size, Color)', responses: { '200': { description: 'Type list' } } },
      post: { tags: ['Variant Types'], summary: 'Create variant type', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', example: 'Size' }, values: { type: 'array', items: { type: 'string' }, example: ['S','M','L','XL'] } } } } } }, responses: { '201': { description: 'Created' } } },
    },
  },
};
