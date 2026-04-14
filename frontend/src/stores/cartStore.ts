import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/lib/api';
import { useAuthStore } from './authStore';

interface CartItem {
  product_id: string;
  variant_id?: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
  image?: string;
}

interface CartState {
  items: CartItem[];
  isCheckingOut: boolean;
  addItem: (product: any, variantId?: string, qty?: number) => void;
  removeItem: (product_id: string, variant_id?: string) => void;
  updateQuantity: (product_id: string, variant_id: string | undefined, qty: number) => void;
  clearCart: () => void;
  checkout: (shippingAddress: object) => Promise<{ order_id: string; order_number: string }>;
  totalItems: () => number;
  totalAmount: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isCheckingOut: false,

      addItem: (product, variantId, qty = 1) => {
        set((state) => {
          const existing = state.items.find(
            (i) => i.product_id === product.id && i.variant_id === variantId
          );
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.product_id === product.id && i.variant_id === variantId
                  ? { ...i, quantity: i.quantity + qty }
                  : i
              ),
            };
          }
          return {
            items: [
              ...state.items,
              {
                product_id: product.id,
                variant_id: variantId,
                name: product.name,
                sku: product.sku,
                price: product.sale_price ?? product.selling_price,
                quantity: qty,
                image: product.images?.[0],
              },
            ],
          };
        });
      },

      removeItem: (product_id, variant_id) => {
        set((state) => ({
          items: state.items.filter(
            (i) => !(i.product_id === product_id && i.variant_id === variant_id)
          ),
        }));
      },

      updateQuantity: (product_id, variant_id, qty) => {
        if (qty <= 0) {
          get().removeItem(product_id, variant_id);
          return;
        }
        set((state) => ({
          items: state.items.map((i) =>
            i.product_id === product_id && i.variant_id === variant_id
              ? { ...i, quantity: qty }
              : i
          ),
        }));
      },

      clearCart: () => set({ items: [] }),

      checkout: async (shippingAddress) => {
        set({ isCheckingOut: true });

        try {
          const { items } = get();
          const { data } = await api.post('/sales/orders/storefront', {
            shipping_address: shippingAddress,
            lines: items.map((item) => ({
              product_id: item.product_id,
              variant_id: item.variant_id,
              quantity: item.quantity,
              unit_price: item.price,
            })),
          });

          get().clearCart();
          return { order_id: data.data.id, order_number: data.data.order_number };
        } finally {
          set({ isCheckingOut: false });
        }
      },

      totalItems: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
      totalAmount: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    }),
    { name: 'skarpine-cart' }
  )
);
