import { AppError } from '../errors/AppError';
import type { AppContext, AppNext } from '../context';

export const PURCHASE_PERMISSIONS = [
  'purchase.supplier.read', 'purchase.supplier.maintain',
  'purchase.requisition.read', 'purchase.requisition.create', 'purchase.requisition.submit',
  'purchase.requisition.approve', 'purchase.requisition.cancel',
  'purchase.rfq.read', 'purchase.rfq.maintain', 'purchase.rfq.send',
  'purchase.rfq.response.manage', 'purchase.rfq.award', 'purchase.rfq.cancel',
  'purchase.order.read', 'purchase.order.create', 'purchase.order.update',
  'purchase.order.confirm', 'purchase.order.cancel',
  'purchase.receipt.read', 'purchase.receipt.post',
  'purchase.vendor_invoice.read', 'purchase.vendor_invoice.create', 'purchase.vendor_invoice.match',
  'purchase.vendor_invoice.approve_discrepancy', 'purchase.vendor_invoice.post', 'purchase.vendor_invoice.cancel',
  'purchase.vendor_payment.read', 'purchase.vendor_payment.create', 'purchase.vendor_payment.post',
  'purchase.vendor_payment.settle', 'purchase.vendor_payment.reverse',
  'purchase.return.read', 'purchase.return.create', 'purchase.return.ship',
  'purchase.supplier_credit.read', 'purchase.supplier_credit.create', 'purchase.supplier_credit.post',
  'purchase.setup.read', 'purchase.setup.maintain',
] as const;

export type PurchasePermission = typeof PURCHASE_PERMISSIONS[number];

// Organisation setup (branding, language, timezone) is operational; accounting
// setup (currency, tax basis, chart of accounts) is a separate finance duty so
// the roles that post transactions cannot also change what they post against.
export const SETUP_PERMISSIONS = ['setup.tenant.read', 'setup.tenant.maintain'] as const;
export const FINANCE_SETUP_PERMISSIONS = ['finance.setup.maintain'] as const;
// Exchange rates are operational data entered daily, so they are a separate duty
// from the ledger currencies themselves. Operational roles may only ADD a dated
// rate; correcting an existing one is accounting setup (finance.setup.maintain).
export const FINANCE_CURRENCY_PERMISSIONS = ['finance.currency.read', 'finance.exchange_rate.maintain'] as const;

// Order to cash, CRM, customers, storefront and POS (WORK-030a). Dotted business
// actions, one per enforced route family — no code exists without a route that
// checks it. Customer-facing codes are their own namespace, because a shopper is
// not a workforce role and must never inherit back-office reach.
export const SALES_PERMISSIONS = [
  'sales.order.read', 'sales.order.create', 'sales.order.update', 'sales.order.confirm',
  'sales.order.ship', 'sales.order.complete', 'sales.order.cancel',
  'sales.invoice.post', 'sales.customer_payment.post', 'sales.return.post',
  'sales.quotation.read', 'sales.quotation.create', 'sales.quotation.update',
  'sales.quotation.send', 'sales.quotation.confirm', 'sales.quotation.close',
] as const;
export const CRM_PERMISSIONS = [
  'crm.lead.read', 'crm.lead.maintain',
  'crm.opportunity.read', 'crm.opportunity.maintain', 'crm.opportunity.close',
  'crm.setup.maintain',
] as const;
export const CUSTOMER_PERMISSIONS = ['customer.read', 'customer.create', 'customer.update'] as const;
export const STOREFRONT_PERMISSIONS = ['storefront.catalog.read', 'storefront.order.place'] as const;
export const POS_PERMISSIONS = [
  'pos.session.operate', 'pos.sale.post', 'pos.sale.void',
  // WORK-047: closing with a difference above the method's tolerance, and reviewing
  // register sessions and their Z reports without operating a till.
  'pos.session.close_with_difference', 'pos.session.read',
] as const;
/** How customers pay: who may see the methods, and who maps them to accounts (WORK-047). */
export const SALES_SETUP_PERMISSIONS = ['sales.payment_method.read', 'sales.payment_method.maintain'] as const;
// The catalogue read the storefront shares with the back office (WORK-030a).
export const PRODUCT_PERMISSIONS = ['product.read'] as const;
// Customer segments are a sales report; the rest of report.* arrives in 030c.
export const REPORT_PERMISSIONS = ['report.sales.read'] as const;

export const O2C_PERMISSIONS = [
  ...SALES_PERMISSIONS, ...CRM_PERMISSIONS, ...CUSTOMER_PERMISSIONS, ...STOREFRONT_PERMISSIONS,
  ...POS_PERMISSIONS, ...PRODUCT_PERMISSIONS, ...REPORT_PERMISSIONS, ...SALES_SETUP_PERMISSIONS,
] as const;

export type O2cPermission = typeof O2C_PERMISSIONS[number];

// Product master, stock, warehouse and import (WORK-030b).
export const PRODUCT_MAINTENANCE_PERMISSIONS = [
  'product.maintain', 'product.delete', 'product.media.generate',
  'product.setup.read', 'product.setup.maintain',
] as const;
export const INVENTORY_PERMISSIONS = [
  'inventory.stock.read', 'inventory.transaction.read',
  'inventory.transfer.post', 'inventory.adjustment.post',
  'inventory.count.read', 'inventory.count.create', 'inventory.count.record', 'inventory.count.post',
  // WORK-045: an opening balance creates equity (admin); reason codes are setup.
  'inventory.journal.opening', 'inventory.setup.maintain',
  // Stating the cost an added unit carries changes inventory value and profit in
  // one step, so it is separate from entering the adjustment (plan §2.2).
  'inventory.journal.cost_override',
] as const;
export const WAREHOUSE_PERMISSIONS = [
  'warehouse.structure.read', 'warehouse.structure.maintain', 'warehouse.site.maintain',
  'warehouse.work.read', 'warehouse.work.execute',
  'warehouse.wave.read', 'warehouse.wave.release',
  'warehouse.arrival.read', 'warehouse.arrival.create', 'warehouse.arrival.post',
  'warehouse.setup.read', 'warehouse.setup.maintain',
] as const;
export const IMPORT_PERMISSIONS = ['import.job.read', 'import.job.prepare', 'import.job.execute'] as const;

export const STOCK_PERMISSIONS = [
  ...PRODUCT_MAINTENANCE_PERMISSIONS, ...INVENTORY_PERMISSIONS, ...WAREHOUSE_PERMISSIONS, ...IMPORT_PERMISSIONS,
] as const;
export type StockPermission = typeof STOCK_PERMISSIONS[number];
export type SetupPermission = typeof SETUP_PERMISSIONS[number];
export type FinanceSetupPermission = typeof FINANCE_SETUP_PERMISSIONS[number];
export type FinanceCurrencyPermission = typeof FINANCE_CURRENCY_PERMISSIONS[number];

type LegacyPermission =
  | 'sales:read'       | 'sales:create'       | 'sales:confirm'     | 'sales:ship'
  | 'sales:cancel'     | 'sales:invoice'      | 'sales:return'
  | 'purchase:read'    | 'purchase:create'    | 'purchase:confirm'  | 'purchase:receive'
  | 'purchase:pay'     | 'purchase:cancel'
  | 'hr:read'          | 'hr:create'          | 'hr:update'         | 'hr:delete'
  | 'finance:read'     | 'finance:journal'    | 'finance:close_period'
  | 'reports:read'
  | 'admin:all';

export type Permission =
  | LegacyPermission | PurchasePermission | SetupPermission | FinanceSetupPermission | FinanceCurrencyPermission
  | O2cPermission | StockPermission;

export type Role =
  | 'admin' | 'store_manager' | 'cashier' | 'employee' | 'warehouse_worker' | 'customer'
  | 'purchasing_requester' | 'buyer' | 'receiver' | 'ap_clerk' | 'finance_approver' | 'auditor'
  | 'finance_manager';

const purchasingReads: PurchasePermission[] = [
  'purchase.supplier.read', 'purchase.requisition.read', 'purchase.rfq.read',
  'purchase.order.read', 'purchase.receipt.read', 'purchase.vendor_invoice.read',
  'purchase.vendor_payment.read', 'purchase.setup.read',
  'purchase.return.read', 'purchase.supplier_credit.read',
];

const O2C_READS: O2cPermission[] = O2C_PERMISSIONS.filter(
  (p) => p.endsWith('.read') && !p.startsWith('storefront.'),
);

const STOCK_READS: StockPermission[] = STOCK_PERMISSIONS.filter((p) => p.endsWith('.read'));

/** Every workforce role that picks a store or a location needs to see them. */
const STRUCTURE_READ: StockPermission[] = ['warehouse.structure.read'];

const requesterPermissions: PurchasePermission[] = [
  'purchase.requisition.read', 'purchase.requisition.create',
  'purchase.requisition.submit', 'purchase.requisition.cancel',
];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    'admin:all',
    'sales:read', 'sales:create', 'sales:confirm', 'sales:ship', 'sales:cancel', 'sales:invoice', 'sales:return',
    'purchase:read', 'purchase:create', 'purchase:confirm', 'purchase:receive', 'purchase:pay', 'purchase:cancel',
    'hr:read', 'hr:create', 'hr:update', 'hr:delete',
    'finance:read', 'finance:journal', 'finance:close_period',
    'reports:read',
  ],
  store_manager: [
    'sales:read', 'sales:create', 'sales:confirm', 'sales:ship', 'sales:cancel', 'sales:invoice', 'sales:return',
    'purchase:read', 'purchase:create', 'purchase:confirm', 'purchase:receive', 'purchase:cancel',
    'hr:read',
    'finance:read', 'finance:journal',
    'reports:read',
    // WORK-030a — everything the store runs, except cancelling a sales order,
    // which today is admin-only and stays so.
    ...SALES_PERMISSIONS.filter((p) => p !== 'sales.order.cancel'),
    'crm.lead.read', 'crm.lead.maintain',
    'crm.opportunity.read', 'crm.opportunity.maintain', 'crm.opportunity.close',
    ...CUSTOMER_PERMISSIONS, ...POS_PERMISSIONS,
    'product.read', 'report.sales.read',
    // WORK-047: sees how customers pay; mapping a method to an account is the admin's.
    'sales.payment_method.read',
    ...purchasingReads,
    ...requesterPermissions,
    'purchase.supplier.maintain',
    'purchase.order.create', 'purchase.order.update', 'purchase.order.confirm',
    'purchase.receipt.post',
    'purchase.vendor_invoice.create', 'purchase.vendor_invoice.match', 'purchase.vendor_invoice.post',
    'purchase.rfq.maintain', 'purchase.rfq.send', 'purchase.rfq.response.manage',
    'purchase.rfq.award', 'purchase.rfq.cancel',
    'purchase.requisition.approve',
    'purchase.setup.maintain',
    'setup.tenant.read', 'setup.tenant.maintain',
    'finance.currency.read', 'finance.exchange_rate.maintain',
    // WORK-030b: the store's catalogue, stock and warehouse. Deleting a product,
    // changing item setup and creating a site stay with the admin; so does running
    // an import (the store manager may prepare one).
    // Product financial setup (item groups, item model groups — which accounts a
    // product posts to and how it is costed) is finance's, not the store's: no
    // product.setup.* here. Admin and finance_manager hold it.
    'product.maintain', 'product.media.generate',
    ...INVENTORY_PERMISSIONS.filter((p) => p !== 'inventory.journal.opening' && p !== 'inventory.journal.cost_override'),
    ...WAREHOUSE_PERMISSIONS.filter((p) => p !== 'warehouse.site.maintain'),
    'import.job.read', 'import.job.prepare',
  ],
  cashier: [
    'sales:read', 'sales:create',
    'reports:read',
    // WORK-030a (D-7): the till and nothing around it. No sales-order screens, no
    // CRM, no void — voiding stays with the store manager.
    'pos.session.operate', 'pos.sale.post',
    'sales.payment_method.read',
    'customer.read', 'customer.create',
    'product.read',
    // WORK-030b: the till looks up stock and store locations.
    'inventory.stock.read', ...STRUCTURE_READ,
    // No tenant-setup permission: the currency every POS screen renders money in
    // comes from GET /tenant/currency, which needs authentication and nothing
    // else, so a cashier never sees the tenant's plan, modules or branding.
  ],
  employee: [
    'sales:read',
    'purchase:read',
    'reports:read',
    ...requesterPermissions,
    // WORK-030a (D-7): reads only.
    'sales.order.read', 'sales.quotation.read',
    'customer.read', 'crm.lead.read', 'crm.opportunity.read',
    'product.read',
    'inventory.stock.read', ...STRUCTURE_READ,
  ],
  // WORK-030b (D-8): executes warehouse work and records counts; posting a count
  // stays with the store manager (S-2).
  warehouse_worker: [
    'purchase.order.read', 'purchase.receipt.read', 'purchase.receipt.post',
    'product.read',
    'inventory.stock.read', ...STRUCTURE_READ,
    'warehouse.work.read', 'warehouse.work.execute', 'warehouse.wave.read', 'warehouse.arrival.read',
    'inventory.count.read', 'inventory.count.record',
  ],
  // A shopper browses the published catalogue and places their own order —
  // nothing else in v1 (the workforce gate enforces the same line independently).
  customer: [...STOREFRONT_PERMISSIONS],
  purchasing_requester: [...requesterPermissions, 'product.read', ...STRUCTURE_READ],
  buyer: [
    'purchase.supplier.read', 'purchase.supplier.maintain',
    'purchase.requisition.read', 'purchase.requisition.approve',
    'purchase.rfq.read', 'purchase.rfq.maintain', 'purchase.rfq.send',
    'purchase.rfq.response.manage', 'purchase.rfq.award', 'purchase.rfq.cancel',
    'purchase.order.read', 'purchase.order.create', 'purchase.order.update',
    'purchase.order.confirm', 'purchase.order.cancel',
    'purchase.return.read', 'purchase.return.create',
    'purchase.receipt.read', 'purchase.vendor_invoice.read',
    'purchase.setup.read', 'purchase.setup.maintain',
    'finance.currency.read',
    'product.read',
    'inventory.stock.read', ...STRUCTURE_READ,
  ],
  // WORK-030b (D-9): put-away after a receipt is the receiver's own work.
  receiver: [
    'purchase.order.read', 'purchase.receipt.read', 'purchase.receipt.post',
    'purchase.return.read', 'purchase.return.ship',
    'product.read',
    'inventory.stock.read', ...STRUCTURE_READ,
    'warehouse.work.read', 'warehouse.work.execute', 'warehouse.arrival.read',
  ],
  ap_clerk: [
    'purchase.supplier.read', 'purchase.order.read', 'purchase.receipt.read',
    'purchase.vendor_invoice.read', 'purchase.vendor_invoice.create',
    'purchase.vendor_invoice.match', 'purchase.vendor_invoice.post',
    'purchase.vendor_payment.read', 'purchase.vendor_payment.create', 'purchase.setup.read',
    'purchase.return.read', 'purchase.supplier_credit.read', 'purchase.supplier_credit.create',
    'finance.currency.read',
    'product.read',
    ...STRUCTURE_READ,
  ],
  finance_approver: [
    'purchase.supplier.read', 'purchase.vendor_invoice.read',
    'purchase.vendor_invoice.approve_discrepancy', 'purchase.vendor_invoice.post',
    'purchase.vendor_invoice.cancel', 'purchase.vendor_payment.read',
    'purchase.vendor_payment.post', 'purchase.vendor_payment.settle', 'purchase.vendor_payment.reverse',
    'purchase.return.read', 'purchase.supplier_credit.read', 'purchase.supplier_credit.post',
    'purchase.setup.read',
    'finance.currency.read', 'finance.exchange_rate.maintain',
  ],
  // Owns the financial configuration: product financial setup (item groups and
  // item model groups), the chart and posting setup, currencies and rates, and
  // the journal and period close. Not a store role and not an approver of its
  // own postings' source documents: no sales, purchasing or POS duties.
  finance_manager: [
    'finance:read', 'finance:journal', 'finance:close_period', 'reports:read',
    ...FINANCE_SETUP_PERMISSIONS, ...FINANCE_CURRENCY_PERMISSIONS,
    'product.read', 'product.setup.read', 'product.setup.maintain',
    'purchase.setup.read', 'sales.payment_method.read', 'setup.tenant.read',
    'inventory.stock.read', ...STRUCTURE_READ,
  ],
  // Every read the registry knows, derived rather than listed so a new .read code
  // reaches the auditor without an edit; pinned by a snapshot test.
  auditor: [...purchasingReads, 'setup.tenant.read', 'finance.currency.read', ...O2C_READS, ...STOCK_READS],
};

/**
 * What a role may do, for the client to shape its menus. The server still
 * checks every call; this only spares users links that would answer 403.
 * An admin is reported as ['admin:all'].
 */
export function permissionsForRole(role: string): string[] {
  if (!isKnownRole(role)) return [];
  const perms = ROLE_PERMISSIONS[role];
  return perms.includes('admin:all') ? ['admin:all'] : [...new Set(perms)];
}

export function hasPermission(role: string, permission: Permission): boolean {
  // Own keys only: a role such as `constructor` must not resolve through the
  // object prototype and throw instead of being refused.
  if (!isKnownRole(role)) return false;
  const perms = ROLE_PERMISSIONS[role];
  return perms.includes('admin:all') || perms.includes(permission);
}

/** Pass when the caller holds ANY of the permissions (all-of is requirePermission). */
export function requireAnyPermission(...permissions: [Permission, ...Permission[]]) {
  return async (c: AppContext, next: AppNext) => {
    const user = c.get('user');
    if (!user) throw new AppError('Authentication required', 401);
    if (!permissions.some((permission) => hasPermission(user.role, permission))) {
      throw new AppError(`Permission denied: one of ${permissions.join(', ')}`, 403);
    }
    await next();
  };
}

/** A route's guard: every listed permission, or { anyOf } for any one of them. */
export type RouteGuard =
  | readonly [Permission, ...Permission[]]
  | { readonly anyOf: readonly [Permission, ...Permission[]] };
export type RouteGuards = Record<string, RouteGuard>;

/**
 * guard(key) for a route manifest. The key is the route's "METHOD /path", and the
 * manifest is exported so a test can pin it and prove every route has one.
 */
export function routeGuard<M extends RouteGuards>(manifest: M) {
  return (route: keyof M & string) => {
    const entry: RouteGuard = manifest[route];
    if ('anyOf' in entry) {
      const [first, ...rest] = entry.anyOf;
      return requireAnyPermission(first, ...rest);
    }
    const [first, ...rest] = entry as readonly [Permission, ...Permission[]];
    return requirePermission(first, ...rest);
  };
}

/** True for a role the registry knows; an unknown role is refused everywhere. */
export function isKnownRole(role: string | undefined): role is Role {
  return !!role && Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role);
}

export function requirePermission(...permissions: [Permission, ...Permission[]]) {
  return async (c: AppContext, next: AppNext) => {
    const user = c.get('user');
    if (!user) throw new AppError('Authentication required', 401);
    const denied = permissions.find((permission) => !hasPermission(user.role, permission));
    if (denied) throw new AppError(`Permission denied: ${denied}`, 403);
    await next();
  };
}
