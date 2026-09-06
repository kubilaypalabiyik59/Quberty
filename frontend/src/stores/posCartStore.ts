import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useTaxPreview } from '@/lib/useTaxPreview';

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

/**
 * The cart total is arithmetic on the cart, so it stays here. The tax split is
 * not — it came from `total / 1.13` and `subtotal * 0.03`, the arithmetic the
 * backend tax test records as a defect, which meant the breakdown the cashier
 * read off the till did not match the factura the same sale produced.
 *
 * `taxLoading` is exposed so the till can show the split as pending rather than
 * as zero. A price the customer is about to pay should not be displayed as a
 * confident wrong number while the real one is still in flight.
 */
export function usePosCartTotals() {
  const lines = usePosCartStore((s) => s.lines);
  const customer = usePosCartStore((s) => s.customer);
  const total = lines.reduce((sum, l) => sum + l.unit_price * l.quantity * (1 - l.discount_pct / 100), 0);

  const { tax, isPending } = useTaxPreview(total, {
    partyId: (customer as any)?.id ?? null,
  });

  return {
    subtotal: tax.subtotal,
    iva:      tax.vat,
    it:       tax.turnover,
    total,
    taxLines: tax.lines,
    taxLoading: isPending && total > 0,
    lineCount: lines.length,
  };
}
