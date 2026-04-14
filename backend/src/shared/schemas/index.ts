import { z } from 'zod';

// ── Auth ──────────────────────────────────────────────────────────────────────

export const LoginSchema = z.object({
  email:       z.string().email('Invalid email address'),
  password:    z.string().min(1, 'Password is required'),
  tenant_id:   z.string().uuid().optional(),
  tenant_slug: z.string().optional(),
});

export const RegisterSchema = z.object({
  email:      z.string().email(),
  password:   z.string().min(8, 'Password must be at least 8 characters'),
  first_name: z.string().min(1),
  last_name:  z.string().min(1),
  tenant_id:  z.string().uuid().optional(),
});

// ── Sales ─────────────────────────────────────────────────────────────────────

const SalesLineSchema = z.object({
  product_id:   z.string().uuid(),
  variant_id:   z.string().uuid().nullable().optional(),
  quantity:     z.number().int().positive('Quantity must be a positive integer'),
  unit_price:   z.number().nonnegative('Unit price cannot be negative'),
  discount_pct: z.number().min(0).max(100).optional().default(0),
});

export const CreateSalesOrderSchema = z.object({
  customer_id:  z.string().uuid().optional(),
  site_id:      z.string().uuid().optional(),
  warehouse_id: z.string().uuid().optional(),
  source:       z.string().optional(),
  notes:        z.string().optional(),
  lines:        z.array(SalesLineSchema).min(1, 'At least one line is required'),
});

export const InvoiceOrderSchema = z.object({
  customer_nit: z.string().optional(),
  notes:        z.string().optional(),
});

export const PayOrderSchema = z.object({
  payment_date:  z.string().optional(),
  account_code:  z.string().optional().default('1102'),
  notes:         z.string().optional(),
});

// ── POS ───────────────────────────────────────────────────────────────────────

const PosLineSchema = z.object({
  product_id:   z.string().uuid(),
  variant_id:   z.string().uuid().nullable().optional(),
  quantity:     z.number().int().positive(),
  unit_price:   z.number().nonnegative(),
  discount_pct: z.number().min(0).max(100).optional().default(0),
});

export const OpenSessionSchema = z.object({
  terminal_name:  z.string().min(1),
  opening_float:  z.number().nonnegative(),
  site_id:        z.string().uuid().optional(),
  warehouse_id:   z.string().uuid().optional(),
});

export const CloseSessionSchema = z.object({
  closing_float: z.number().nonnegative(),
});

export const PosSaleSchema = z.object({
  session_id:     z.string().uuid(),
  customer_name:  z.string().optional().default('Cliente Mostrador'),
  customer_nit:   z.string().optional(),
  payment_method: z.enum(['CASH', 'CARD', 'TRANSFER']),
  cash_tendered:  z.number().nonnegative().optional(),
  lines:          z.array(PosLineSchema).min(1, 'At least one line is required'),
});

// ── Finance ───────────────────────────────────────────────────────────────────

const JournalLineSchema = z.object({
  account_id:    z.string().uuid(),
  debit_amount:  z.number().nonnegative().optional().default(0),
  credit_amount: z.number().nonnegative().optional().default(0),
  description:   z.string().optional(),
});

export const CreateJournalEntrySchema = z.object({
  entry_date:    z.string(),
  description:   z.string().min(1),
  lines:         z.array(JournalLineSchema).min(2, 'At least 2 lines required for a journal entry'),
}).refine(
  (data) => {
    const totalDebit  = data.lines.reduce((s, l) => s + (l.debit_amount  ?? 0), 0);
    const totalCredit = data.lines.reduce((s, l) => s + (l.credit_amount ?? 0), 0);
    return Math.abs(totalDebit - totalCredit) < 0.01; // Allow floating point tolerance
  },
  { message: 'Journal entry must balance: total debits must equal total credits' }
);

export const CreateManualFacturaSchema = z.object({
  customer_name: z.string().min(1),
  customer_nit:  z.string().optional(),
  total_amount:  z.number().positive(),
  invoice_date:  z.string().optional(),
  notes:         z.string().optional(),
});

// ── Purchase ──────────────────────────────────────────────────────────────────

const PurchaseLineSchema = z.object({
  product_id:   z.string().uuid(),
  variant_id:   z.string().uuid().nullable().optional(),
  quantity:     z.number().int().positive(),
  unit_cost:    z.number().nonnegative(),
  description:  z.string().optional(),
});

export const CreatePurchaseOrderSchema = z.object({
  supplier_id:          z.string().uuid(),
  warehouse_id:         z.string().uuid().optional(),
  receive_location_id:  z.string().uuid().optional(),
  expected_date:        z.string().optional(),
  currency:             z.string().optional().default('BOB'),
  notes:                z.string().optional(),
  lines:                z.array(PurchaseLineSchema).min(1),
});

// ── HR ────────────────────────────────────────────────────────────────────────

export const CreateEmployeeSchema = z.object({
  first_name:  z.string().min(1),
  last_name:   z.string().min(1),
  department:  z.string().optional(),
  position:    z.string().optional(),
  role:        z.enum(['employee', 'warehouse_worker', 'store_manager', 'admin']).optional().default('employee'),
  email:       z.string().email().optional(),
  password:    z.string().min(8).optional(),
}).refine(
  (data) => !data.email || (data.email && data.password),
  { message: 'Password is required when creating a system account (email provided)', path: ['password'] }
);

// ── Customers ─────────────────────────────────────────────────────────────────

export const CreateCustomerSchema = z.object({
  first_name: z.string().min(1),
  last_name:  z.string().min(1),
  email:      z.string().email().optional(),
  phone:      z.string().optional(),
  nit:        z.string().optional(),
  address:    z.string().optional(),
  city:       z.string().optional(),
});
