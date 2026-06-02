/**
 * Bolivia Tax Configuration (defaults)
 * IVA  = 13% price-inclusive
 * IT   =  3% on net subtotal
 *
 * Use resolveTax(tenantTaxConfig) to get a dynamic tax helper.
 * TAX export kept for backward-compatibility.
 */

export interface TaxConfig {
  vat_rate: number;
  vat_inclusive: boolean;
  vat_label: string;
  secondary_tax_rate: number;
  secondary_tax_name: string;
  invoice_label: string;
}

export const BOLIVIA_DEFAULTS: TaxConfig = {
  vat_rate:           0.13,
  vat_inclusive:      true,
  vat_label:          'IVA',
  secondary_tax_rate: 0.03,
  secondary_tax_name: 'IT',
  invoice_label:      'Factura',
};

export function resolveTax(cfg?: any) {
  const c: TaxConfig = { ...BOLIVIA_DEFAULTS, ...(cfg ?? {}) };

  function subtotal(total: number): number {
    return c.vat_inclusive ? total / (1 + c.vat_rate) : total;
  }

  function vat(total: number): number {
    return c.vat_inclusive ? total - subtotal(total) : total * c.vat_rate;
  }

  function secondary(total: number): number {
    return subtotal(total) * c.secondary_tax_rate;
  }

  function breakdown(total: number): { subtotal: number; iva: number; it: number } {
    const sub = subtotal(total);
    return { subtotal: sub, iva: vat(total), it: sub * c.secondary_tax_rate };
  }

  // `iva`/`it` are backward-compat aliases for `vat`/`secondary` (Bolivia naming);
  // `IVA_RATE`/`IT_RATE` expose the raw rates the same way the old TAX const did.
  return {
    config: c, subtotal, vat, secondary, breakdown,
    iva: vat, it: secondary,
    IVA_RATE: c.vat_rate, IT_RATE: c.secondary_tax_rate,
  };
}

// Backward-compat: Bolivia defaults — same as old TAX const
export const TAX = resolveTax(BOLIVIA_DEFAULTS);
