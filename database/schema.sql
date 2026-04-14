-- =============================================================
-- SKARPINE ERP — COMPLETE DATABASE SCHEMA
-- Multi-tenant (schema-per-tenant) PostgreSQL
-- Inspired by Microsoft Dynamics 365 F&O data model
-- =============================================================

-- =====================
-- PUBLIC SCHEMA (Platform-level)
-- =====================

-- TENANTS
create table if not exists public.tenants (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,           -- used as schema name + subdomain
  name            text not null,
  plan            text not null default 'starter', -- starter, professional, enterprise
  modules         jsonb not null default '{"sales":true,"purchase":true,"inventory":true,"warehouse":true,"hr":true,"reporting":true,"import":true}',
  branding        jsonb,                           -- {logo_url, primary_color, ...}
  language        text not null default 'en',
  timezone        text not null default 'UTC',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- =====================
-- TENANT SCHEMA TEMPLATE
-- (applied once per tenant as: CREATE SCHEMA tenant_{slug})
-- All tables below are created inside each tenant schema
-- =====================

-- Example: run this for each new tenant:
-- SELECT create_tenant_schema('skarpine_demo');

-- For this SQL file, we use a placeholder schema name.
-- In production, Prisma generates per-schema migrations.

-- We'll define under a 'tenant' schema for documentation:

-- =====================
-- USERS & AUTH
-- =====================

create table if not exists users (
  id              uuid primary key default gen_random_uuid(),
  email           text unique not null,
  password_hash   text not null,
  first_name      text not null,
  last_name       text not null,
  role            text not null default 'employee',  -- admin, store_manager, warehouse_worker, employee, customer
  is_active       boolean not null default true,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists refresh_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create table if not exists audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id),
  action      text not null,                         -- CREATE, UPDATE, DELETE
  entity_type text not null,                         -- 'sales_order', 'product', etc.
  entity_id   uuid,
  old_data    jsonb,
  new_data    jsonb,
  ip_address  inet,
  created_at  timestamptz not null default now()
);

-- =====================
-- HR MODULE
-- =====================

create table if not exists employees (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references users(id),
  employee_code   text unique not null,
  department      text,
  position        text,
  hire_date       date,
  salary          numeric(12,2),
  assigned_site   uuid,                              -- FK to sites (added after)
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- =====================
-- LOCATION HIERARCHY (D365-inspired)
-- Site → Warehouse → Zone → Aisle → Rack → Bin
-- =====================

create table if not exists sites (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,                  -- e.g. 'SITE-IST', 'SITE-ANK'
  name        text not null,
  city        text not null,
  country     text not null default 'TR',
  address     text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists warehouses (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references sites(id),
  code            text unique not null,              -- e.g. 'WH-IST-01'
  name            text not null,
  type            text not null default 'standard',  -- standard, transit, virtual
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists warehouse_zones (
  id              uuid primary key default gen_random_uuid(),
  warehouse_id    uuid not null references warehouses(id),
  code            text not null,                     -- e.g. 'RECEIVE', 'STORAGE', 'SHIP', 'QUALITY'
  name            text not null,
  zone_type       text not null default 'storage',   -- receive, storage, shipping, staging, quality
  created_at      timestamptz not null default now(),
  unique(warehouse_id, code)
);

create table if not exists warehouse_locations (
  id              uuid primary key default gen_random_uuid(),
  zone_id         uuid not null references warehouse_zones(id),
  code            text not null,                     -- e.g. 'A-01-01-01' (aisle-rack-shelf-bin)
  aisle           text,
  rack            text,
  shelf           text,
  bin             text,
  location_type   text not null default 'bulk',      -- bulk, shelf, floor, dock
  is_pick_location  boolean not null default false,
  is_receive_location boolean not null default false,
  max_weight      numeric(10,2),
  max_volume      numeric(10,2),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique(zone_id, code)
);

-- Add FK for employees → sites
alter table employees add constraint fk_employee_site
  foreign key (assigned_site) references sites(id);

-- =====================
-- PRODUCTS & CATALOG
-- =====================

create table if not exists product_categories (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references product_categories(id),
  code        text unique not null,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists products (
  id              uuid primary key default gen_random_uuid(),
  sku             text unique not null,
  barcode         text unique,
  name            text not null,
  description     text,
  category_id     uuid references product_categories(id),
  brand           text,
  -- Attributes for shoes
  attributes      jsonb,                             -- {color, material, gender, style}
  unit_of_measure text not null default 'pair',
  cost_price      numeric(12,2),                     -- purchase cost
  selling_price   numeric(12,2) not null,
  sale_price      numeric(12,2),                     -- optional discount price
  weight_kg       numeric(8,3),
  images          text[],
  is_active       boolean not null default true,
  is_published    boolean not null default false,    -- visible on storefront
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists product_variants (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  sku_variant     text unique not null,              -- e.g. 'AIR-MAX-42-BLK'
  size            text,                              -- shoe size
  color           text,
  barcode         text unique,
  additional_cost numeric(12,2) default 0,           -- price difference from base
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- =====================
-- INVENTORY
-- =====================

-- Real-time stock by location + variant
create table if not exists inventory_stock (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id),
  variant_id      uuid references product_variants(id),
  location_id     uuid not null references warehouse_locations(id),
  quantity        integer not null default 0,
  reserved_qty    integer not null default 0,        -- reserved by confirmed orders
  available_qty   integer generated always as (quantity - reserved_qty) stored,
  updated_at      timestamptz not null default now(),
  unique(product_id, variant_id, location_id)
);

-- Every stock movement — the ledger
create table if not exists inventory_transactions (
  id                uuid primary key default gen_random_uuid(),
  transaction_type  text not null,                   -- INBOUND, OUTBOUND, TRANSFER_IN, TRANSFER_OUT, ADJUSTMENT, OPENING, RETURN
  reference_type    text,                            -- 'purchase_order', 'sales_order', 'transfer', 'adjustment'
  reference_id      uuid,
  product_id        uuid not null references products(id),
  variant_id        uuid references product_variants(id),
  from_location_id  uuid references warehouse_locations(id),
  to_location_id    uuid references warehouse_locations(id),
  quantity          integer not null,
  unit_cost         numeric(12,4),
  notes             text,
  performed_by      uuid references users(id),
  created_at        timestamptz not null default now()
);

-- =====================
-- WAREHOUSE MANAGEMENT (D365-style WMS)
-- =====================

-- Work Templates — define sequences of warehouse tasks
create table if not exists work_templates (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,
  name            text not null,
  work_type       text not null,                     -- PUTAWAY, PICKING, COUNTING, TRANSFER
  warehouse_id    uuid not null references warehouses(id),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists work_template_lines (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references work_templates(id) on delete cascade,
  sequence        integer not null,
  work_type       text not null,                     -- PICK, PUT, PACK, VERIFY
  location_type   text,                              -- source location type filter
  sort_order      integer not null default 0
);

-- Location Directives — rules for where to put/pick
create table if not exists location_directives (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,
  name            text not null,
  directive_type  text not null,                     -- PUTAWAY, PICK
  warehouse_id    uuid not null references warehouses(id),
  work_type       text not null,                     -- PURCHASE, SALES, TRANSFER
  sequence        integer not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists location_directive_lines (
  id              uuid primary key default gen_random_uuid(),
  directive_id    uuid not null references location_directives(id) on delete cascade,
  sequence        integer not null,
  from_qty        numeric(12,2) default 0,
  to_qty          numeric(12,2),
  strategy        text not null default 'CONSOLIDATE', -- CONSOLIDATE, EMPTY_LOCATION, FIFO, FEFO
  zone_id         uuid references warehouse_zones(id),
  location_id     uuid references warehouse_locations(id)
);

-- Wave Templates — batch orders for picking
create table if not exists wave_templates (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,
  name            text not null,
  warehouse_id    uuid not null references warehouses(id),
  wave_type       text not null default 'SHIPPING',  -- SHIPPING, PRODUCTION
  auto_process    boolean not null default false,
  auto_release    boolean not null default false,
  created_at      timestamptz not null default now()
);

-- Waves — groups of orders processed together
create table if not exists waves (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid references wave_templates(id),
  warehouse_id    uuid not null references warehouses(id),
  status          text not null default 'OPEN',      -- OPEN, PROCESSING, RELEASED, COMPLETED
  created_at      timestamptz not null default now(),
  released_at     timestamptz,
  completed_at    timestamptz
);

-- Warehouse Work (individual tasks assigned to workers)
create table if not exists warehouse_work (
  id              uuid primary key default gen_random_uuid(),
  work_id_code    text unique not null,              -- human-readable e.g. 'WRK-2024-001'
  work_type       text not null,                     -- PICK, PUTAWAY, TRANSFER, PACK
  status          text not null default 'OPEN',      -- OPEN, IN_PROGRESS, COMPLETED, CANCELLED
  wave_id         uuid references waves(id),
  warehouse_id    uuid not null references warehouses(id),
  assigned_to     uuid references users(id),
  reference_type  text,                              -- 'sales_order', 'purchase_order'
  reference_id    uuid,
  priority        integer not null default 5,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists warehouse_work_lines (
  id              uuid primary key default gen_random_uuid(),
  work_id         uuid not null references warehouse_work(id) on delete cascade,
  sequence        integer not null,
  line_type       text not null,                     -- PICK, PUT, PACK, VERIFY
  product_id      uuid not null references products(id),
  variant_id      uuid references product_variants(id),
  quantity        numeric(12,2) not null,
  quantity_done   numeric(12,2) not null default 0,
  from_location_id uuid references warehouse_locations(id),
  to_location_id   uuid references warehouse_locations(id),
  status          text not null default 'PENDING',   -- PENDING, IN_PROGRESS, DONE, SHORT
  completed_at    timestamptz
);

-- Arrival Journals (D365: Arrival journal for inbound)
create table if not exists arrival_journals (
  id              uuid primary key default gen_random_uuid(),
  journal_number  text unique not null,
  purchase_order_id uuid,                            -- FK added after purchase_orders table
  warehouse_id    uuid not null references warehouses(id),
  status          text not null default 'DRAFT',     -- DRAFT, POSTED
  arrival_date    date not null default current_date,
  notes           text,
  created_by      uuid references users(id),
  posted_at       timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists arrival_journal_lines (
  id              uuid primary key default gen_random_uuid(),
  journal_id      uuid not null references arrival_journals(id) on delete cascade,
  product_id      uuid not null references products(id),
  variant_id      uuid references product_variants(id),
  expected_qty    numeric(12,2),
  received_qty    numeric(12,2) not null default 0,
  receive_location_id uuid references warehouse_locations(id)
);

-- =====================
-- SUPPLIERS
-- =====================

create table if not exists suppliers (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,
  name            text not null,
  contact_name    text,
  email           text,
  phone           text,
  address         text,
  city            text,
  country         text,
  payment_terms   integer default 30,               -- days
  currency        text not null default 'TRY',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- =====================
-- PURCHASE MANAGEMENT
-- =====================

create table if not exists purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  po_number       text unique not null,
  supplier_id     uuid not null references suppliers(id),
  warehouse_id    uuid not null references warehouses(id),
  status          text not null default 'DRAFT',     -- DRAFT, CONFIRMED, PARTIALLY_RECEIVED, RECEIVED, CANCELLED
  order_date      date not null default current_date,
  expected_date   date,
  currency        text not null default 'TRY',
  subtotal        numeric(14,2) not null default 0,
  tax_amount      numeric(14,2) not null default 0,
  total_amount    numeric(14,2) not null default 0,
  notes           text,
  created_by      uuid references users(id),
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists purchase_order_lines (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid not null references purchase_orders(id) on delete cascade,
  product_id      uuid not null references products(id),
  variant_id      uuid references product_variants(id),
  quantity        numeric(12,2) not null,
  received_qty    numeric(12,2) not null default 0,
  unit_cost       numeric(12,4) not null,
  line_total      numeric(14,2) not null,
  sort_order      integer not null default 0
);

-- Add FK for arrival_journals → purchase_orders
alter table arrival_journals add constraint fk_arrival_po
  foreign key (purchase_order_id) references purchase_orders(id);

-- =====================
-- CUSTOMERS
-- =====================

create table if not exists customers (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references users(id),         -- if registered on storefront
  code            text unique not null,
  first_name      text not null,
  last_name       text not null,
  email           text,
  phone           text,
  address         text,
  city            text,
  country         text,
  date_of_birth   date,
  segment         text default 'regular',            -- regular, vip, wholesale
  tags            text[],
  notes           text,
  lifetime_value  numeric(14,2) not null default 0,  -- updated by trigger
  total_orders    integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- =====================
-- SALES MANAGEMENT
-- =====================

create table if not exists sales_orders (
  id              uuid primary key default gen_random_uuid(),
  order_number    text unique not null,
  customer_id     uuid references customers(id),
  source          text not null default 'manual',    -- manual, storefront, import
  status          text not null default 'DRAFT',     -- DRAFT, CONFIRMED, PICKING, PACKED, SHIPPED, COMPLETED, CANCELLED
  site_id         uuid references sites(id),
  warehouse_id    uuid references warehouses(id),
  currency        text not null default 'TRY',
  subtotal        numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  tax_amount      numeric(14,2) not null default 0,
  total_amount    numeric(14,2) not null default 0,
  shipping_address jsonb,
  notes           text,
  wave_id         uuid references waves(id),
  created_by      uuid references users(id),
  confirmed_at    timestamptz,
  shipped_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists sales_order_lines (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references sales_orders(id) on delete cascade,
  product_id      uuid not null references products(id),
  variant_id      uuid references product_variants(id),
  quantity        integer not null,
  unit_price      numeric(12,4) not null,
  discount_pct    numeric(5,2) not null default 0,
  line_total      numeric(14,2) not null,
  sort_order      integer not null default 0
);

create table if not exists shipments (
  id              uuid primary key default gen_random_uuid(),
  shipment_number text unique not null,
  order_id        uuid not null references sales_orders(id),
  status          text not null default 'PENDING',   -- PENDING, SHIPPED, DELIVERED, RETURNED
  carrier         text,
  tracking_number text,
  shipped_at      timestamptz,
  delivered_at    timestamptz,
  from_warehouse_id uuid references warehouses(id),
  created_at      timestamptz not null default now()
);

-- =====================
-- REPORTING (Materialized Views)
-- =====================

-- Monthly sales summary (refreshed nightly or on-demand)
create materialized view if not exists mv_monthly_sales as
select
  date_trunc('month', so.created_at) as month,
  s.city,
  s.name as site_name,
  count(distinct so.id) as order_count,
  sum(so.total_amount) as revenue,
  sum(so.discount_amount) as discounts,
  count(distinct so.customer_id) as unique_customers
from sales_orders so
join sites s on s.id = so.site_id
where so.status in ('SHIPPED', 'COMPLETED')
group by 1, 2, 3;

create materialized view if not exists mv_top_products as
select
  p.id,
  p.sku,
  p.name,
  p.selling_price,
  p.cost_price,
  sum(sol.quantity) as units_sold,
  sum(sol.line_total) as revenue,
  sum(sol.quantity * p.cost_price) as cogs,
  sum(sol.line_total) - sum(sol.quantity * p.cost_price) as gross_profit
from sales_order_lines sol
join products p on p.id = sol.product_id
join sales_orders so on so.id = sol.order_id
where so.status in ('SHIPPED', 'COMPLETED')
group by 1, 2, 3, 4, 5;

-- =====================
-- DATA IMPORT MODULE
-- =====================

create table if not exists import_jobs (
  id              uuid primary key default gen_random_uuid(),
  import_type     text not null,                     -- products, customers, inventory, orders
  file_name       text not null,
  file_url        text not null,
  status          text not null default 'PENDING',   -- PENDING, VALIDATING, VALID, INVALID, IMPORTING, COMPLETED, FAILED
  column_mapping  jsonb,                             -- {"excel_col": "db_col", ...}
  total_rows      integer,
  valid_rows      integer,
  error_rows      integer,
  errors          jsonb,                             -- [{row: 5, error: "duplicate SKU"}]
  created_by      uuid references users(id),
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- =====================
-- INDEXES
-- =====================

create index if not exists idx_inventory_stock_product on inventory_stock(product_id);
create index if not exists idx_inventory_stock_location on inventory_stock(location_id);
create index if not exists idx_inventory_transactions_product on inventory_transactions(product_id);
create index if not exists idx_inventory_transactions_created on inventory_transactions(created_at desc);
create index if not exists idx_inventory_transactions_reference on inventory_transactions(reference_type, reference_id);
create index if not exists idx_sales_orders_customer on sales_orders(customer_id);
create index if not exists idx_sales_orders_status on sales_orders(status);
create index if not exists idx_sales_orders_created on sales_orders(created_at desc);
create index if not exists idx_sales_order_lines_order on sales_order_lines(order_id);
create index if not exists idx_sales_order_lines_product on sales_order_lines(product_id);
create index if not exists idx_purchase_orders_supplier on purchase_orders(supplier_id);
create index if not exists idx_warehouse_work_status on warehouse_work(status, warehouse_id);
create index if not exists idx_warehouse_work_assigned on warehouse_work(assigned_to);
create index if not exists idx_customers_segment on customers(segment);
create index if not exists idx_products_sku on products(sku);
create index if not exists idx_products_category on products(category_id);
create index if not exists idx_product_variants_product on product_variants(product_id);
create index if not exists idx_audit_logs_entity on audit_logs(entity_type, entity_id);
create index if not exists idx_audit_logs_created on audit_logs(created_at desc);
