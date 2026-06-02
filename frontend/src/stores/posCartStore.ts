import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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

export function usePosCartTotals() {
  const lines = usePosCartStore((s) => s.lines);
  const total     = lines.reduce((sum, l) => sum + l.unit_price * l.quantity * (1 - l.discount_pct / 100), 0);
  const subtotal  = total / 1.13;
  const iva       = total - subtotal;
  const it        = subtotal * 0.03;
  return { subtotal, iva, it, total, lineCount: lines.length };
}
