import { z } from 'zod';
import {
  inspectSequenceFormat,
  NEXT_NUMBER_MIN,
  NEXT_NUMBER_MAX,
} from '../services/numberSequenceRules';

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

/**
 * A document number typed by the user.
 *
 * Accepted only when that document's number sequence is set to `manual`;
 * `allocateNumber` rejects it on an automatic series rather than ignoring it, so
 * sending this to a tenant that generates its own numbers is a 400, not a
 * silently discarded field.
 *
 * Free text on purpose. A manual series is whatever the tax authority printed on
 * the stock, and validating it against our own `format` would reject exactly the
 * numbers manual mode exists to accept.
 */
const ManualDocumentNumber = z.string().trim().min(1).max(40).optional();

export const InvoiceOrderSchema = z.object({
  customer_nit:   z.string().optional(),
  notes:          z.string().optional(),
  factura_number: ManualDocumentNumber,
});

/**
 * `POST /sales/orders/:id/return`.
 *
 * The return posts a credit-note factura, and that credit note draws from the
 * FACTURA series — a decision deliberately left in place, because whether
 * Bolivia requires notas de crédito to run on their own series is still an open
 * question (HANDOVER §7). Drawing from FACTURA is therefore what this request
 * has to be able to serve: with the FACTURA sequence set to manual,
 * `allocateNumber` refuses to invent a number, so without this field the Return
 * action cannot complete at all on a manual tenant.
 *
 * The route previously read raw `c.req.json()` and took only `notes`. `.strict()`
 * closes the failure that follows from a typo: a client sending `factura_no`
 * would otherwise be told the document number must be supplied while looking at
 * a request that appears to supply it.
 */
export const ReturnSalesOrderSchema = z.object({
  notes:          z.string().optional(),
  factura_number: ManualDocumentNumber,
}).strict();

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
  factura_number: ManualDocumentNumber,
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
  customer_name:  z.string().min(1),
  customer_nit:   z.string().optional(),
  total_amount:   z.number().positive(),
  invoice_date:   z.string().optional(),
  notes:          z.string().optional(),
  factura_number: ManualDocumentNumber,
});

// ── Finance: tax preview ──────────────────────────────────────────────────────

/**
 * An optional identifier arriving as a QUERY parameter.
 *
 * A query string cannot express "absent" and "empty" differently — a client that
 * always appends `&party_id=` sends the empty string. That is not a wrong value,
 * it is no value, so it is normalised to `undefined` BEFORE the UUID check.
 * Anything else present is validated strictly: a malformed identifier is a 400,
 * never a silently-dropped filter that would preview the wrong party's tax.
 */
const OptionalQueryUuid = (field: string) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().uuid(`${field} must be a UUID`).optional(),
  );

/**
 * `GET /finance/tax/preview`.
 *
 * Every value here arrives as a string, so the numeric rules are spelled out
 * rather than delegated to a coercion that treats `''` as 0 and `'abc'` as NaN.
 *
 * ── Why each refusal exists ────────────────────────────────────────────────
 * `amount` must be finite and strictly positive. Zero is not a document anybody
 * previews, and a negative or `NaN` amount would be handed to the same engine
 * that posts the ledger. The earlier version of this route checked only
 * `Number.isFinite`, so `?amount=0` and `?amount=-500` both reached the tax
 * engine and returned a confident answer.
 *
 * `side` is an enum, NOT a comparison against `'PURCHASE'`. The earlier version
 * read `side === 'PURCHASE' ? 'PURCHASE' : 'SALES'`, which silently turned a
 * typo — `?side=PURCHSE` — into a SALES preview. In Bolivia that is the
 * difference between a figure carrying IT and one that must not: Ley 843 art. 74
 * puts IT on sales only, so a mis-sided preview is a wrong number, not a
 * fallback.
 *
 * Unknown query keys are STRIPPED rather than refused. Unlike a document
 * request, a GET preview legitimately picks up cache-busters and analytics
 * parameters, and refusing those would break the screen without protecting
 * anything: no value here decides a legal number.
 */
export const TaxPreviewQuerySchema = z.object({
  amount: z
    .string({ required_error: 'amount is required' })
    .trim()
    .min(1, 'amount is required')
    .refine((v) => Number.isFinite(Number(v)), 'amount must be a finite number')
    .transform(Number)
    .refine((v) => v > 0, 'amount must be greater than zero'),

  party_id:   OptionalQueryUuid('party_id'),
  product_id: OptionalQueryUuid('product_id'),

  // Default applied only when the parameter is ABSENT. A present-but-invalid
  // value fails; it is never defaulted.
  side: z.enum(['SALES', 'PURCHASE']).optional().default('SALES'),
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

// ── Process front ends: Lead → Opportunity → Quotation, Requisition → RFQ ────
//
// These validate the WRITE path for the documents that come before the order.
// Line quantities are `positive()` rather than `int().positive()` on purpose:
// the new tables hold Decimal(12,2) quantities, unlike `SalesOrderLine.quantity`
// which is an Int. Conversion to an order re-checks integrality and refuses
// rather than truncating — see quotation.service.ts.

export const CreateLeadSchema = z.object({
  company_name:     z.string().optional(),
  first_name:       z.string().min(1, 'First name is required'),
  last_name:        z.string().optional(),
  email:            z.string().email().optional(),
  phone:            z.string().optional(),
  city:             z.string().optional(),
  country:          z.string().optional(),
  source:           z.enum(['MANUAL', 'WEB', 'REFERRAL', 'CAMPAIGN', 'WALK_IN', 'STOREFRONT', 'IMPORT']).optional().default('MANUAL'),
  rating:           z.enum(['HOT', 'WARM', 'COLD']).optional().default('WARM'),
  estimated_amount: z.number().nonnegative().optional(),
  currency:         z.string().optional(),
  owner_user_id:    z.string().uuid().optional(),
  notes:            z.string().optional(),
});

export const QualifyLeadSchema = z.object({
  customer_id:         z.string().uuid().optional(),
  create_opportunity:  z.boolean().optional().default(true),
  opportunity_name:    z.string().optional(),
  estimated_amount:    z.number().nonnegative().optional(),
  stage_id:            z.string().uuid().optional(),
  expected_close_date: z.string().optional(),
});

export const CreateOpportunitySchema = z.object({
  name:                z.string().min(1),
  customer_id:         z.string().uuid().optional(),
  lead_id:             z.string().uuid().optional(),
  stage_id:            z.string().uuid().optional(),
  estimated_amount:    z.number().nonnegative().optional().default(0),
  probability:         z.number().int().min(0).max(100).optional(),
  currency:            z.string().optional(),
  expected_close_date: z.string().optional(),
  owner_user_id:       z.string().uuid().optional(),
  notes:               z.string().optional(),
}).refine(
  (d) => [d.customer_id, d.lead_id].filter(Boolean).length === 1,
  { message: 'Provide exactly one party: customer_id or lead_id', path: ['customer_id'] }
);

const QuotationLineSchema = z.object({
  product_id:   z.string().uuid(),
  variant_id:   z.string().uuid().nullable().optional(),
  quantity:     z.number().positive('Quantity must be positive'),
  unit_price:   z.number().nonnegative(),
  discount_pct: z.number().min(0).max(100).optional().default(0),
  notes:        z.string().optional(),
});

export const CreateQuotationSchema = z.object({
  customer_id:     z.string().uuid().optional(),
  lead_id:         z.string().uuid().optional(),
  opportunity_id:  z.string().uuid().optional(),
  site_id:         z.string().uuid().optional(),
  warehouse_id:    z.string().uuid().optional(),
  currency:        z.string().optional(),
  discount_amount: z.number().nonnegative().optional().default(0),
  valid_until:     z.string().optional(),
  notes:           z.string().optional(),
  lines:           z.array(QuotationLineSchema).min(1, 'At least one line is required'),
}).refine(
  (d) => [d.customer_id, d.lead_id].filter(Boolean).length === 1,
  { message: 'Provide exactly one party: customer_id or lead_id', path: ['customer_id'] }
);

export const UpdateQuotationLinesSchema = z.object({
  discount_amount: z.number().nonnegative().optional(),
  lines:           z.array(QuotationLineSchema).min(1),
});

const RequisitionLineSchema = z.object({
  product_id:            z.string().uuid(),
  variant_id:            z.string().uuid().nullable().optional(),
  quantity:              z.number().positive(),
  estimated_unit_cost:   z.number().nonnegative().optional().default(0),
  required_date:         z.string().optional(),
  preferred_supplier_id: z.string().uuid().optional(),
  notes:                 z.string().optional(),
});

export const CreateRequisitionSchema = z.object({
  site_id:       z.string().uuid().optional(),
  warehouse_id:  z.string().uuid().optional(),
  purpose:       z.enum(['CONSUMPTION', 'REPLENISHMENT']).optional().default('CONSUMPTION'),
  required_date: z.string().optional(),
  justification: z.string().optional(),
  currency:      z.string().optional(),
  notes:         z.string().optional(),
  lines:         z.array(RequisitionLineSchema).min(1, 'At least one line is required'),
});

export const RequisitionDecisionSchema = z.object({
  line_ids: z.array(z.string().uuid()).optional(),
  reason:   z.string().optional(),
});

export const RequisitionToPoSchema = z.object({
  supplier_id:   z.string().uuid(),
  warehouse_id:  z.string().uuid().optional(),
  line_ids:      z.array(z.string().uuid()).optional(),
  expected_date: z.string().optional(),
});

const RfqCaseLineSchema = z.object({
  product_id:    z.string().uuid(),
  variant_id:    z.string().uuid().nullable().optional(),
  quantity:      z.number().positive(),
  required_date: z.string().optional(),
  notes:         z.string().optional(),
});

export const CreateRfqCaseSchema = z.object({
  title:        z.string().min(1),
  warehouse_id: z.string().uuid().optional(),
  bid_deadline: z.string().optional(),
  currency:     z.string().optional(),
  notes:        z.string().optional(),
  lines:        z.array(RfqCaseLineSchema).min(1, 'At least one line is required'),
});

export const InviteVendorsSchema = z.object({
  supplier_ids: z.array(z.string().uuid()).min(1, 'Invite at least one vendor'),
});

export const RecordBidSchema = z.object({
  score:          z.number().int().min(0).max(100).optional(),
  lead_time_days: z.number().int().nonnegative().optional(),
  notes:          z.string().optional(),
  lines: z.array(z.object({
    line_id:        z.string().uuid().optional(),
    case_line_id:   z.string().uuid().optional(),
    quantity:       z.number().positive().optional(),
    unit_price:     z.number().nonnegative(),
    delivery_date:  z.string().optional(),
    lead_time_days: z.number().int().nonnegative().optional(),
  }).refine(
    (l) => Boolean(l.line_id || l.case_line_id),
    { message: 'Each bid line needs line_id or case_line_id' }
  )).min(1, 'A bid needs at least one priced line'),
});

export const AwardRfqSchema = z.object({
  request_id:    z.string().uuid(),
  line_ids:      z.array(z.string().uuid()).optional(),
  reason_code:   z.string().optional(),
  reject_others: z.boolean().optional().default(false),
  expected_date: z.string().optional(),
});

// ── Setup: number sequences ───────────────────────────────────────────────────

/**
 * Strict payload for `PUT /setup/number-sequences/:id`.
 *
 * This route used to accept raw JSON and coerce with `!!` and `Number()`, so
 * `{"manual":"false"}` switched the legal invoice series to manual — the string
 * "false" is truthy — and `{"next_number":"abc"}` reached a NaN check only by
 * luck. Every field is now typed, and `reference` is absent on purpose: it is the
 * key every service looks the sequence up by, so renaming it would orphan the
 * series rather than rename it.
 *
 * The counter-token count is enforced here only as "never more than one", because
 * whether a counter is REQUIRED depends on the row's effective `manual` value,
 * which the route knows and this schema does not.
 */
export const UpdateNumberSequenceSchema = z.object({
  name:        z.string().trim().min(1).max(80).optional(),
  format:      z.string().trim().min(1).max(60).optional(),
  manual:      z.boolean().optional(),
  continuous:  z.boolean().optional(),
  is_active:   z.boolean().optional(),
  // The upper bound is the `Int` column's own ceiling, not a policy: a larger
  // value cannot be stored at all, and rejecting it here beats a database error.
  next_number: z.number().int().min(NEXT_NUMBER_MIN).max(NEXT_NUMBER_MAX).optional(),

  /**
   * REQUEST-ONLY. Never stored, and there is no column for it.
   *
   * Confirms that a person has looked at invoices already issued by hand and is
   * deliberately choosing the series to resume from, in the one case the system
   * refuses to guess: a non-comparable manual history. It defaults to false, so
   * an absent field can never be read as consent.
   */
  acknowledge_unverifiable_resume: z.boolean().optional().default(false),
}).strict().superRefine((data, ctx) => {
  if (data.format === undefined) return;
  const { counters, unknown, malformed } = inspectSequenceFormat(data.format);

  // Braces first: once they are wrong the token counts mean nothing.
  if (malformed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['format'],
      message:
        `Malformed format: ${malformed} A format is literal text plus {YYYY} and one counter ` +
        `such as {######}; anything else would be printed literally on the document.`,
    });
    return;
  }
  if (unknown.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['format'],
      message:
        `Unsupported format token${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}. ` +
        `Only {YYYY} and a counter such as {######} are substituted; anything else would be ` +
        `printed literally on the document.`,
    });
  }
  if (counters > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['format'],
      message: 'A format may contain at most one counter token.',
    });
  }
});
