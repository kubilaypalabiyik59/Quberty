/**
 * ZOD SCHEMA VALIDATION TESTS
 * Tests every shared schema for correct accept/reject behaviour.
 * Pure — no DB or HTTP needed.
 */

import {
  LoginSchema,
  RegisterSchema,
  CreateSalesOrderSchema,
  CreateJournalEntrySchema,
  PosSaleSchema,
  OpenSessionSchema,
  CreatePurchaseOrderSchema,
  CreateEmployeeSchema,
  CreateCustomerSchema,
} from '../shared/schemas';

const VALID_UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

// ── LoginSchema ───────────────────────────────────────────────────────────────

describe('LoginSchema', () => {
  it('accepts valid credentials', () => {
    const result = LoginSchema.safeParse({ email: 'admin@test.com', password: 'secret' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = LoginSchema.safeParse({ email: 'not-an-email', password: 'secret' });
    expect(result.success).toBe(false);
  });

  it('rejects missing password', () => {
    const result = LoginSchema.safeParse({ email: 'admin@test.com', password: '' });
    expect(result.success).toBe(false);
  });
});

// ── RegisterSchema ────────────────────────────────────────────────────────────

describe('RegisterSchema', () => {
  const valid = {
    email: 'user@test.com', password: 'Password1!',
    first_name: 'John', last_name: 'Doe',
  };

  it('accepts valid payload', () => {
    expect(RegisterSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects password shorter than 8 characters', () => {
    const result = RegisterSchema.safeParse({ ...valid, password: 'short' });
    expect(result.success).toBe(false);
  });

  it('rejects missing first_name', () => {
    const result = RegisterSchema.safeParse({ ...valid, first_name: '' });
    expect(result.success).toBe(false);
  });
});

// ── CreateSalesOrderSchema ────────────────────────────────────────────────────

describe('CreateSalesOrderSchema', () => {
  const validLine = { product_id: VALID_UUID, quantity: 2, unit_price: 100 };

  it('accepts order with valid lines', () => {
    const result = CreateSalesOrderSchema.safeParse({ lines: [validLine] });
    expect(result.success).toBe(true);
  });

  it('rejects order with no lines', () => {
    const result = CreateSalesOrderSchema.safeParse({ lines: [] });
    expect(result.success).toBe(false);
  });

  it('rejects negative quantity', () => {
    const result = CreateSalesOrderSchema.safeParse({
      lines: [{ ...validLine, quantity: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative unit_price', () => {
    const result = CreateSalesOrderSchema.safeParse({
      lines: [{ ...validLine, unit_price: -5 }],
    });
    expect(result.success).toBe(false);
  });

  it('defaults discount_pct to 0', () => {
    const result = CreateSalesOrderSchema.safeParse({ lines: [validLine] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lines[0].discount_pct).toBe(0);
    }
  });

  it('rejects discount_pct above 100', () => {
    const result = CreateSalesOrderSchema.safeParse({
      lines: [{ ...validLine, discount_pct: 110 }],
    });
    expect(result.success).toBe(false);
  });
});

// ── CreateJournalEntrySchema ──────────────────────────────────────────────────

describe('CreateJournalEntrySchema', () => {
  const balanced = {
    entry_date: '2026-04-06',
    description: 'Test entry',
    lines: [
      { account_id: VALID_UUID, debit_amount: 1000, credit_amount: 0 },
      { account_id: VALID_UUID, debit_amount: 0,    credit_amount: 1000 },
    ],
  };

  it('accepts a balanced journal entry', () => {
    expect(CreateJournalEntrySchema.safeParse(balanced).success).toBe(true);
  });

  it('rejects an unbalanced entry (debits ≠ credits)', () => {
    const unbalanced = {
      ...balanced,
      lines: [
        { account_id: VALID_UUID, debit_amount: 1000, credit_amount: 0 },
        { account_id: VALID_UUID, debit_amount: 0,    credit_amount: 999 },
      ],
    };
    const result = CreateJournalEntrySchema.safeParse(unbalanced);
    expect(result.success).toBe(false);
  });

  it('rejects entry with only one line', () => {
    const oneLinEntry = {
      ...balanced,
      lines: [{ account_id: VALID_UUID, debit_amount: 500, credit_amount: 0 }],
    };
    expect(CreateJournalEntrySchema.safeParse(oneLinEntry).success).toBe(false);
  });

  it('accepts entry with floating point amounts within 0.01 tolerance', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS — should still pass
    const floatingEntry = {
      entry_date: '2026-04-06',
      description: 'Float test',
      lines: [
        { account_id: VALID_UUID, debit_amount: 0.1 + 0.2, credit_amount: 0 },
        { account_id: VALID_UUID, debit_amount: 0,          credit_amount: 0.3 },
      ],
    };
    expect(CreateJournalEntrySchema.safeParse(floatingEntry).success).toBe(true);
  });

  it('rejects missing description', () => {
    const result = CreateJournalEntrySchema.safeParse({ ...balanced, description: '' });
    expect(result.success).toBe(false);
  });
});

// ── PosSaleSchema ─────────────────────────────────────────────────────────────

describe('PosSaleSchema', () => {
  const validSale = {
    session_id:     VALID_UUID,
    payment_method: 'CASH',
    lines: [{ product_id: VALID_UUID, quantity: 1, unit_price: 50 }],
  };

  it('accepts a valid POS sale', () => {
    expect(PosSaleSchema.safeParse(validSale).success).toBe(true);
  });

  it('rejects invalid payment method', () => {
    const result = PosSaleSchema.safeParse({ ...validSale, payment_method: 'CRYPTO' });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID session_id', () => {
    const result = PosSaleSchema.safeParse({ ...validSale, session_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects empty lines array', () => {
    const result = PosSaleSchema.safeParse({ ...validSale, lines: [] });
    expect(result.success).toBe(false);
  });

  it('defaults customer_name to "Cliente Mostrador"', () => {
    const result = PosSaleSchema.safeParse(validSale);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customer_name).toBe('Cliente Mostrador');
    }
  });
});

// ── OpenSessionSchema ─────────────────────────────────────────────────────────

describe('OpenSessionSchema', () => {
  it('accepts valid session open payload', () => {
    const result = OpenSessionSchema.safeParse({
      terminal_name: 'Terminal-1', opening_float: 500,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty terminal_name', () => {
    const result = OpenSessionSchema.safeParse({ terminal_name: '', opening_float: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative opening float', () => {
    const result = OpenSessionSchema.safeParse({ terminal_name: 'T1', opening_float: -100 });
    expect(result.success).toBe(false);
  });
});

// ── CreatePurchaseOrderSchema ──────────────────────────────────────────────────

describe('CreatePurchaseOrderSchema', () => {
  const validPO = {
    supplier_id: VALID_UUID,
    lines: [{ product_id: VALID_UUID, quantity: 10, unit_cost: 50 }],
  };

  it('accepts valid PO', () => {
    expect(CreatePurchaseOrderSchema.safeParse(validPO).success).toBe(true);
  });

  it('requires at least one line', () => {
    const result = CreatePurchaseOrderSchema.safeParse({ ...validPO, lines: [] });
    expect(result.success).toBe(false);
  });

  it('requires valid supplier UUID', () => {
    const result = CreatePurchaseOrderSchema.safeParse({ ...validPO, supplier_id: 'bad-id' });
    expect(result.success).toBe(false);
  });

  it('defaults currency to BOB', () => {
    const result = CreatePurchaseOrderSchema.safeParse(validPO);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe('BOB');
  });
});

// ── CreateEmployeeSchema ──────────────────────────────────────────────────────

describe('CreateEmployeeSchema', () => {
  it('accepts employee without system account', () => {
    const result = CreateEmployeeSchema.safeParse({
      first_name: 'Maria', last_name: 'Lopez',
    });
    expect(result.success).toBe(true);
  });

  it('accepts employee with email AND password', () => {
    const result = CreateEmployeeSchema.safeParse({
      first_name: 'Carlos', last_name: 'Ruiz',
      email: 'carlos@test.com', password: 'Password1!',
    });
    expect(result.success).toBe(true);
  });

  it('rejects employee with email but no password', () => {
    const result = CreateEmployeeSchema.safeParse({
      first_name: 'Ana', last_name: 'Paz',
      email: 'ana@test.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects password shorter than 8 chars', () => {
    const result = CreateEmployeeSchema.safeParse({
      first_name: 'Ana', last_name: 'Paz',
      email: 'ana@test.com', password: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('defaults role to employee', () => {
    const result = CreateEmployeeSchema.safeParse({ first_name: 'X', last_name: 'Y' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.role).toBe('employee');
  });
});

// ── CreateCustomerSchema ──────────────────────────────────────────────────────

describe('CreateCustomerSchema', () => {
  it('accepts minimal customer', () => {
    const result = CreateCustomerSchema.safeParse({ first_name: 'Juan', last_name: 'Perez' });
    expect(result.success).toBe(true);
  });

  it('rejects empty first_name', () => {
    const result = CreateCustomerSchema.safeParse({ first_name: '', last_name: 'Perez' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const result = CreateCustomerSchema.safeParse({
      first_name: 'Juan', last_name: 'Perez', email: 'not-email',
    });
    expect(result.success).toBe(false);
  });
});
