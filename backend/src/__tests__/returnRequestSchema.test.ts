/**
 * THE RETURN REQUEST — `POST /sales/orders/:id/return`
 *
 * The defect this pins: the route read raw `c.req.json()` and took only `notes`,
 * while the credit note it writes draws its number from the FACTURA series. With
 * FACTURA set to manual, `allocateNumber` refuses to invent a number — so the
 * Return action could not complete AT ALL on a manual tenant, and the failure
 * surfaced as `NUMBER_SEQUENCE_MANUAL_REQUIRED` with no field to put the number
 * in.
 *
 * The credit note deliberately still draws from FACTURA rather than CREDIT_NOTE:
 * whether Bolivia requires notas de crédito to run on their own legal series is
 * an OPEN, UNVERIFIED question (HANDOVER §7), and guessing it here would be a
 * legal decision made by a schema change.
 *
 * These are the request-contract tests. `numberSequence.manual.test.ts` covers
 * what `allocateNumber` then does with the value.
 */

import { ReturnSalesOrderSchema, InvoiceOrderSchema } from '../shared/schemas';

describe('ReturnSalesOrderSchema', () => {
  it('accepts an empty body — an automatic tenant sends nothing', () => {
    const r = ReturnSalesOrderSchema.safeParse({});
    expect(r.success).toBe(true);
    // Absent, not empty-string: `allocateNumber` REJECTS a supplied number on an
    // automatic series, so the field has to be missing rather than blank.
    expect(r.success && r.data.factura_number).toBeUndefined();
  });

  it('accepts notes on their own, exactly as the route always did', () => {
    const r = ReturnSalesOrderSchema.safeParse({ notes: 'Customer defect return' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.notes).toBe('Customer defect return');
    expect(r.success && r.data.factura_number).toBeUndefined();
  });

  it('carries a typed credit-note number, trimmed and unreformatted', () => {
    const r = ReturnSalesOrderSchema.safeParse({ factura_number: '  A-04-0001918  ' });
    expect(r.success).toBe(true);
    // Not padded, not validated against the sequence format: authority-issued
    // stock does not have to match a format we generate.
    expect(r.success && r.data.factura_number).toBe('A-04-0001918');
  });

  it('uses the same ManualDocumentNumber contract as the forward invoice', () => {
    // One rule, not two. A number the invoice form accepts must be a number the
    // return form accepts, or the two surfaces disagree about a legal document.
    const long = 'X'.repeat(41);
    expect(ReturnSalesOrderSchema.safeParse({ factura_number: long }).success).toBe(false);
    expect(InvoiceOrderSchema.safeParse({ factura_number: long }).success).toBe(false);

    const ok = 'X'.repeat(40);
    expect(ReturnSalesOrderSchema.safeParse({ factura_number: ok }).success).toBe(true);
    expect(InvoiceOrderSchema.safeParse({ factura_number: ok }).success).toBe(true);
  });

  it('rejects a blank or whitespace-only number rather than sending it on', () => {
    // Reaching `allocateNumber` with '   ' would produce "the document number
    // must be supplied" for a request that looks like it supplied one.
    expect(ReturnSalesOrderSchema.safeParse({ factura_number: '' }).success).toBe(false);
    expect(ReturnSalesOrderSchema.safeParse({ factura_number: '   ' }).success).toBe(false);
  });

  it('rejects a non-string number', () => {
    expect(ReturnSalesOrderSchema.safeParse({ factura_number: 1918 }).success).toBe(false);
  });

  it('is STRICT — a misspelled field is refused, not silently dropped', () => {
    // The failure this prevents: `factura_no` on a manual tenant would otherwise
    // be discarded, and the operator told the number must be supplied while
    // looking at a request that appears to supply it.
    const r = ReturnSalesOrderSchema.safeParse({ notes: 'x', factura_no: 'A-04-0001918' });
    expect(r.success).toBe(false);
  });

  it('does not accept fields belonging to the forward invoice', () => {
    // A return credits an existing invoice; it does not re-state the customer.
    expect(ReturnSalesOrderSchema.safeParse({ customer_nit: '12345678' }).success).toBe(false);
  });
});
