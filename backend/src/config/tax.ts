/**
 * Bolivia Tax Configuration
 *
 * IVA  = 13% price-inclusive (Impuesto al Valor Agregado)
 * IT   =  3% on net subtotal  (Impuesto a las Transacciones)
 *
 * Usage:
 *   import { TAX } from '../../config/tax';
 *   const subtotal  = total / (1 + TAX.IVA_RATE);   // 88.496...
 *   const iva       = total - subtotal;               // 11.504...
 *   const it        = subtotal * TAX.IT_RATE;         //  2.655...
 */

export const TAX = {
  /** IVA inclusive divisor — price already contains IVA */
  IVA_RATE: 0.13,

  /** IT (Impuesto a las Transacciones) — applied to net subtotal */
  IT_RATE: 0.03,

  /**
   * Extract subtotal (net) from a price-inclusive total.
   * subtotal = total / 1.13
   */
  subtotal(total: number): number {
    return total / (1 + this.IVA_RATE);
  },

  /**
   * Extract IVA amount from a price-inclusive total.
   * iva = total - total/1.13
   */
  iva(total: number): number {
    return total - this.subtotal(total);
  },

  /**
   * Calculate IT (Impuesto a las Transacciones) from a price-inclusive total.
   * it = subtotal * 0.03
   */
  it(total: number): number {
    return this.subtotal(total) * this.IT_RATE;
  },

  /**
   * Full tax breakdown from a price-inclusive total amount.
   */
  breakdown(total: number): { subtotal: number; iva: number; it: number } {
    const subtotal = this.subtotal(total);
    return {
      subtotal,
      iva: total - subtotal,
      it:  subtotal * this.IT_RATE,
    };
  },
} as const;
