import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useTaxPreview, type TaxPreviewState } from '@/lib/useTaxPreview';

export interface CartLine {
  key:             string;
  product_id:      string;
  product_name:    string;
  product_sku:     string;
  variant_id:      string | null;
  variant_label:   string;
  unit_price:      number;
  quantity:        number;
  discount_pct:    number;
  available_stock: number;
}

interface CartState {
  lines:       CartLine[];
  customer:    any | null;
  addLine:     (line: Omit<CartLine, 'quantity' | 'key'>) => void;
  removeLine:  (key: string) => void;
  updateQty:   (key: string, qty: number) => void;
  setCustomer: (c: any | null) => void;
  clearCart:   () => void;
}

export function makeCartKey(product_id: string, variant_id: string | null) {
  return `${product_id}::${variant_id ?? 'base'}`;
}

export const usePosCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      lines:    [],
      customer: null,

      addLine: (line: Omit<CartLine, 'quantity' | 'key'>) => {
        const key      = makeCartKey(line.product_id, line.variant_id);
        const existing = get().lines.find((l) => l.key === key);
        if (existing) {
          const next = existing.quantity + 1;
          if (next > existing.available_stock) return;
          set((s) => ({ lines: s.lines.map((l) => l.key === key ? { ...l, quantity: next } : l) }));
        } else {
          set((s) => ({ lines: [...s.lines, { ...line, key, quantity: 1 }] }));
        }
      },

      removeLine: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),

      updateQty: (key, qty) => {
        if (qty <= 0) {
          set((s) => ({ lines: s.lines.filter((l) => l.key !== key) }));
        } else {
          set((s) => ({
            lines: s.lines.map((l) =>
              l.key === key ? { ...l, quantity: Math.min(qty, l.available_stock) } : l
            ),
          }));
        }
      },

      setCustomer: (customer) => set({ customer }),
      clearCart:   () => set({ lines: [], customer: null }),
    }),
    { name: 'pos-cart-web', storage: createJSONStorage(() => localStorage) }
  )
);

export interface PosCartTotals {
  /** What the customer pays. Arithmetic on the cart, so it is computed here. */
  total: number;
  lineCount: number;
  /**
   * The tax split, from the server. NULL until it is known for THIS total — read
   * `taxPreview.status` to tell "still loading" from "could not be calculated".
   */
  tax: TaxPreviewState['tax'];
  taxPreview: TaxPreviewState;
}

/**
 * The cart total is arithmetic on the cart, so it stays local: a till must be
 * able to price a basket without a round trip, and the merchandise total is what
 * the customer is charged.
 *
 * The tax SPLIT is not local. It came from `total / 1.13` and `subtotal * 0.03`,
 * the arithmetic the backend tax test records as a defect, which meant the
 * breakdown the cashier read off the till did not match the factura the same
 * sale produced. It now comes from the engine that posts the journal.
 *
 * `tax` is null while unknown rather than zeroed. A price a customer is about to
 * pay must not carry a confident wrong breakdown, and "IVA Bs. 0.00" is a
 * different and much worse claim than "not known yet".
 */
export function usePosCartTotals(): PosCartTotals {
  const lines    = usePosCartStore((s) => s.lines);
  const customer = usePosCartStore((s) => s.customer);

  const total = lines.reduce((sum, l) => sum + l.unit_price * l.quantity * (1 - l.discount_pct / 100), 0);

  // The customer carries the tax group, which is one half of the intersection the
  // engine resolves. A walk-in sale has none and falls back to the tenant default.
  const taxPreview = useTaxPreview(total, { partyId: (customer as { id?: string } | null)?.id ?? null });

  return { total, lineCount: lines.length, tax: taxPreview.tax, taxPreview };
}
