'use client';

import { usePosCartStore } from '@/stores/posCartStore';

interface Props {
  product: any;
  visible: boolean;
  onClose: () => void;
}

function variantLabel(v: any): string {
  if (v.attributes && typeof v.attributes === 'object') {
    const vals = Object.values(v.attributes as Record<string, string>);
    if (vals.length) return vals.join(' / ');
  }
  return v.sku_variant;
}

export function VariantPicker({ product, visible, onClose }: Props) {
  const addLine = usePosCartStore((s) => s.addLine);

  if (!product || !visible) return null;

  const variants: any[] = product.variants ?? [];
  const hasVariants = variants.length > 0;

  function addToCart(variant: any | null) {
    const available = variant
      ? (variant.available_stock ?? 0)
      : (product.total_stock ?? 0);

    addLine({
      product_id:      product.id,
      product_name:    product.name,
      product_sku:     product.sku,
      variant_id:      variant?.id ?? null,
      variant_label:   variant ? variantLabel(variant) : '',
      unit_price:      Number(product.selling_price) + Number(variant?.additional_cost ?? 0),
      discount_pct:    0,
      available_stock: available,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-[540px] max-h-[80vh] p-6 flex flex-col shadow-2xl border border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1">
            <p className="text-slate-900 font-bold text-lg">{product.name}</p>
            <p className="text-slate-400 text-xs mt-0.5">{product.sku}</p>
          </div>
          <p className="text-indigo-600 font-bold text-xl">
            Bs. {Number(product.selling_price).toFixed(2)}
          </p>
        </div>

        <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest mb-3">
          {hasVariants ? 'Select Variant' : 'Add to Cart'}
        </p>

        <div className="overflow-y-auto flex-1">
          <div className="flex flex-wrap gap-2.5">
            {!hasVariants && (
              <button
                onClick={() => addToCart(null)}
                className="w-36 rounded-xl p-3.5 border border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50 hover:shadow-md transition-all text-center"
              >
                <p className="text-slate-900 font-bold text-sm mb-1">Add to Cart</p>
                <p className="text-slate-400 text-xs">Stock: {product.total_stock ?? 0}</p>
              </button>
            )}
            {variants.map((v: any) => {
              const stock = v.available_stock ?? 0;
              const oos = stock === 0;
              return (
                <button
                  key={v.id}
                  onClick={() => !oos && addToCart(v)}
                  disabled={oos}
                  className={`w-36 rounded-xl p-3.5 border text-center transition-all ${
                    oos
                      ? 'border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed'
                      : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50 hover:shadow-md'
                  }`}
                >
                  <p className={`font-bold text-sm mb-1 ${oos ? 'text-slate-400' : 'text-slate-900'}`}>
                    {variantLabel(v)}
                  </p>
                  <p className={`text-xs mb-1 ${oos ? 'text-slate-400' : 'text-indigo-600'}`}>
                    Bs. {(Number(product.selling_price) + Number(v.additional_cost ?? 0)).toFixed(2)}
                  </p>
                  <p className={`text-xs ${oos ? 'text-red-400' : 'text-slate-400'}`}>
                    {oos ? 'Out of Stock' : `Stock: ${stock}`}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full py-3 bg-white border border-slate-200 rounded-xl text-slate-600 font-semibold hover:bg-slate-100 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
