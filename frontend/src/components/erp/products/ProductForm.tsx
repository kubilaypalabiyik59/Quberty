'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ArrowLeft, Plus, Trash2, Globe, EyeOff, Save, AlertCircle, ImagePlus, X, Loader2, Zap } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

// Attributes stored as array internally to allow multiple entries with same-type keys
interface AttrRow { key: string; value: string; _id: string; }

interface Variant {
  id?: string;
  sku_variant: string;
  attrRows: AttrRow[];          // internal array — converted to {key:value} on save
  additional_cost: number;
  barcode: string;
  is_active: boolean;
  _isNew?: boolean;
  _deleted?: boolean;
}

interface ProductFormProps {
  product?: any;
  onSaved: (id: string) => void;
  onCancel: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

let _uid = 0;
const uid = () => String(++_uid);

const attrsToRows = (attrs: Record<string, string> | null | undefined): AttrRow[] => {
  if (!attrs) return [];
  return Object.entries(attrs).map(([key, value]) => ({ key, value, _id: uid() }));
};

const rowsToAttrs = (rows: AttrRow[]): Record<string, string> => {
  const out: Record<string, string> = {};
  rows.forEach(r => { if (r.key) out[r.key] = r.value; });
  return out;
};

const emptyVariant = (): Variant => ({
  sku_variant: '',
  attrRows: [],
  additional_cost: 0,
  barcode: '',
  is_active: true,
  _isNew: true,
});

// Upload image via backend → Supabase Storage
async function uploadToBackend(productId: string, file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post(`/products/${productId}/image`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  // The updated product is returned; grab the last image URL (the one just added)
  const updatedImages: string[] = res.data?.data?.images ?? [];
  if (!updatedImages.length) throw new Error('Image upload failed — no URL returned');
  return updatedImages[updatedImages.length - 1];
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ProductForm({ product, onSaved, onCancel }: ProductFormProps) {
  const qc = useQueryClient();
  const isEdit = !!product;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: variantTypes } = useQuery({
    queryKey: ['variant-types'],
    queryFn: () => api.get('/variant-types').then(r => r.data.data),
  });

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get('/products/categories').then(r => r.data.data),
  });

  const [uoms, setUoms] = useState<Array<{ id: string; code: string; name: string; symbol: string }>>([]);

  useEffect(() => {
    api.get('/uom').then(r => setUoms(r.data.data ?? [])).catch(() => {});
  }, []);

  const [form, setForm] = useState({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    brand: product?.brand ?? '',
    description: product?.description ?? '',
    category_id: product?.category_id ?? '',
    uom_id: product?.uom_id ?? '',
    product_type: product?.product_type ?? 'physical',
    cost_price: product?.cost_price ?? '',
    selling_price: product?.selling_price ?? '',
    sale_price: product?.sale_price ?? '',
    weight_kg: product?.weight_kg ?? '',
    reorder_point: product?.reorder_point ?? '',
    is_published: product?.is_published ?? false,
  });

  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState('');

  const [variants, setVariants] = useState<Variant[]>(
    (product?.variants ?? []).map((v: any) => ({
      id: v.id,
      sku_variant: v.sku_variant,
      attrRows: attrsToRows(v.attributes ?? (v.size || v.color ? { ...(v.size ? { Size: v.size } : {}), ...(v.color ? { Color: v.color } : {}) } : {})),
      additional_cost: Number(v.additional_cost) || 0,
      barcode: v.barcode ?? '',
      is_active: v.is_active,
      _isNew: false,
      _deleted: false,
    }))
  );

  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ── AI Video state ───────────────────────────────────────────────────────────
  const [videoImages,    setVideoImages]    = useState<string[]>(product?.video_urls ?? []);
  const [selectedVidImg, setSelectedVidImg] = useState<string>('');
  const [vidPrompt,      setVidPrompt]      = useState('');
  const [vidGenerating,  setVidGenerating]  = useState(false);
  const [vidStatus,      setVidStatus]      = useState('');
  const [vidError,       setVidError]       = useState('');
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const pollVideoJob = useCallback((reqId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const r = await api.get(`/products/${product?.id}/video-jobs/${reqId}`);
        const d = r.data.data;
        setVidStatus(d.status);
        if (d.status === 'COMPLETED') {
          stopPoll(); setVidGenerating(false);
          qc.invalidateQueries({ queryKey: ['product-erp', product?.id] });
          const fresh = await api.get(`/products/${product?.id}`);
          setVideoImages(fresh.data.data.video_urls ?? []);
        } else if (d.status === 'FAILED') {
          stopPoll(); setVidGenerating(false);
          setVidError('Video generation failed. Please try again.');
        }
      } catch { stopPoll(); setVidGenerating(false); setVidError('Lost connection while checking job status.'); }
    }, 5000);
  }, [product?.id, qc]);

  const generateVideo = async () => {
    const imgSrc = selectedVidImg || images[0];
    if (!imgSrc) { setVidError('Select a product image first.'); return; }
    setVidError(''); setVidGenerating(true); setVidStatus('Submitting...');
    try {
      const r = await api.post(`/products/${product?.id}/generate-video`, {
        image_url: imgSrc, prompt: vidPrompt.trim() || undefined,
      });
      const reqId = r.data.data.request_id;
      setVidStatus('IN_QUEUE');
      pollVideoJob(reqId);
    } catch (err: any) {
      setVidGenerating(false); setVidStatus('');
      if (err?.response?.status === 501) {
        setVidError('FAL_API_KEY is not set in backend .env');
      } else {
        setVidError(err?.response?.data?.error?.message ?? 'Failed to start video generation');
      }
    }
  };

  const deleteVideo = async (url: string) => {
    try {
      await api.delete(`/products/${product?.id}/video`, { data: { url } });
      setVideoImages(v => v.filter(u => u !== url));
    } catch { /* silent */ }
  };

  const vidStatusLabel: Record<string, string> = {
    IN_QUEUE: 'Waiting in queue...', IN_PROGRESS: 'Generating video...', 'Submitting...': 'Submitting...',
  };

  // ── Cartesian product helper ─────────────────────────────────────────────────

  const cartesian = <T,>(arrays: T[][]): T[][] => {
    if (!arrays.length) return [[]];
    const [first, ...rest] = arrays;
    const tail = cartesian(rest);
    return first.flatMap(item => tail.map(combo => [item, ...combo]));
  };

  const countCombinations = () => {
    const types = (variantTypes ?? []).filter((t: any) => selectedTypes.includes(t.id));
    return types.reduce((acc: number, t: any) => acc * (t.values?.length ?? 1), 1);
  };

  const generateVariants = () => {
    const types = (variantTypes ?? []).filter((t: any) => selectedTypes.includes(t.id));
    if (types.length === 0) return;
    const valueSets: Array<Array<{ typeName: string; value: string }>> = types.map((t: any) =>
      (t.values ?? []).map((v: string) => ({ typeName: t.name, value: v }))
    );
    const combinations = cartesian(valueSets);
    const newVariants: Variant[] = combinations.map(combo => ({
      sku_variant: `${form.sku || 'SKU'}-${combo.map(c => c.value).join('-')}`.toUpperCase(),
      attrRows: combo.map(c => ({ key: c.typeName, value: c.value, _id: uid() })),
      additional_cost: 0,
      barcode: '',
      is_active: true,
      _isNew: true,
    }));
    // Replace only previously auto-generated (new) variants
    setVariants(prev => [...prev.filter(v => v.id && !v._isNew), ...newVariants]);
  };

  // ── Image handling ───────────────────────────────────────────────────────────

  const handleImageFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!product?.id) {
      setImageError('Save the product first, then you can add images.');
      return;
    }
    setImageError('');
    setUploadingImage(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) { setImageError('Only image files are allowed'); continue; }
        if (file.size > 5 * 1024 * 1024) { setImageError('Max file size is 5MB'); continue; }
        const url = await uploadToBackend(product.id, file);
        urls.push(url);
      }
      setImages(prev => [...prev, ...urls]);
    } catch {
      setImageError('Upload failed. Check storage configuration or try again.');
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeImage = async (idx: number) => {
    const url = images[idx];
    if (product?.id && url) {
      try {
        await api.delete(`/products/${product.id}/image`, { data: { url } });
      } catch {
        // best-effort: remove from local state regardless
      }
    }
    setImages(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Variant helpers ──────────────────────────────────────────────────────────

  const addVariant = () => setVariants(v => [...v, emptyVariant()]);

  const removeVariant = (idx: number) => setVariants(v =>
    v.map((variant, i) => i === idx ? { ...variant, _deleted: true } : variant)
  );

  const updateVariant = (idx: number, field: keyof Variant, value: any) =>
    setVariants(v => v.map((variant, i) => i === idx ? { ...variant, [field]: value } : variant));

  // Add a new attribute row to a variant
  const addAttrRow = (idx: number) => {
    const usedKeys = variants[idx]?.attrRows.map(r => r.key) ?? [];
    const firstAvailable = (variantTypes ?? []).find((t: any) => !usedKeys.includes(t.name));
    const newRow: AttrRow = { key: firstAvailable?.name ?? '', value: '', _id: uid() };
    setVariants(v => v.map((variant, i) =>
      i === idx ? { ...variant, attrRows: [...variant.attrRows, newRow] } : variant
    ));
  };

  const updateAttrRow = (varIdx: number, rowId: string, field: 'key' | 'value', val: string) =>
    setVariants(v => v.map((variant, i) =>
      i !== varIdx ? variant : {
        ...variant,
        attrRows: variant.attrRows.map(r => r._id === rowId ? { ...r, [field]: val } : r),
      }
    ));

  const removeAttrRow = (varIdx: number, rowId: string) =>
    setVariants(v => v.map((variant, i) =>
      i !== varIdx ? variant : { ...variant, attrRows: variant.attrRows.filter(r => r._id !== rowId) }
    ));

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const body = {
        name: form.name,
        sku: form.sku,
        brand: form.brand || null,
        description: form.description || null,
        category_id: form.category_id || null,
        uom_id: form.uom_id || null,
        product_type: form.product_type,
        cost_price: form.cost_price ? Number(form.cost_price) : null,
        selling_price: Number(form.selling_price),
        sale_price: form.sale_price ? Number(form.sale_price) : null,
        weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
        reorder_point: form.reorder_point ? Number(form.reorder_point) : 0,
        is_published: form.is_published,
        images,
      };

      let productId = product?.id;

      if (isEdit) {
        await api.put(`/products/${productId}`, body);
      } else {
        const { data } = await api.post('/products', body);
        productId = data.data.id;
      }

      // Sync variants
      for (const v of variants) {
        const attributes = rowsToAttrs(v.attrRows);
        if (v._deleted && v.id) {
          await api.delete(`/products/${productId}/variants/${v.id}`);
        } else if (v._isNew && !v._deleted && v.sku_variant) {
          await api.post(`/products/${productId}/variants`, {
            sku_variant: v.sku_variant,
            attributes,
            additional_cost: v.additional_cost,
            barcode: v.barcode || null,
            is_active: v.is_active,
          });
        } else if (!v._isNew && !v._deleted && v.id) {
          await api.put(`/products/${productId}/variants/${v.id}`, {
            sku_variant: v.sku_variant,
            attributes,
            additional_cost: v.additional_cost,
            barcode: v.barcode || null,
            is_active: v.is_active,
          });
        }
      }

      qc.invalidateQueries({ queryKey: ['erp-products'] });
      qc.invalidateQueries({ queryKey: ['product-erp', productId] });
      onSaved(productId);
    } catch (err: any) {
      setError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  const activeVariants = variants.filter(v => !v._deleted);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {isEdit ? 'Edit Product' : 'New Product'}
            </h1>
            <p className="text-sm text-gray-500">{isEdit ? product.sku : 'Fill in the product details below'}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setForm(f => ({ ...f, is_published: !f.is_published }))}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
            form.is_published
              ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
              : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
          }`}
        >
          {form.is_published
            ? <><Globe className="h-4 w-4" /> Listed on E-Commerce</>
            : <><EyeOff className="h-4 w-4" /> Not Listed on E-Commerce</>
          }
        </button>
      </div>

      <form onSubmit={handleSave}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Left col ─────────────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-5">

            {/* Basic Info */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">Basic Information</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Product Name <span className="text-red-500">*</span></label>
                  <input required type="text" placeholder="e.g. Nike Air Max 270"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">SKU <span className="text-red-500">*</span></label>
                    <input required type="text" placeholder="NIKE-AM270"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value.toUpperCase() }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
                    <input type="text" placeholder="Nike"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-gray-400 font-normal">(shown on store)</span></label>
                  <textarea rows={3} placeholder="Describe the product for your customers..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                    <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
                      <option value="">— No category —</option>
                      {(categories ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Product Type</label>
                    <select
                      value={form.product_type}
                      onChange={e => setForm(f => ({ ...f, product_type: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="physical">Physical — tracked in inventory</option>
                      <option value="service">Service — no inventory tracking</option>
                      <option value="digital">Digital — no inventory tracking</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit of Measure</label>
                  <select
                    value={form.uom_id}
                    onChange={e => setForm(f => ({ ...f, uom_id: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— select unit —</option>
                    {uoms.map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>
                    ))}
                  </select>
                  {uoms.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">No units found — go to <strong>Products → Units of Measure</strong> and click "Seed Defaults".</p>
                  )}
                </div>
              </div>
            </div>

            {/* Pricing */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">Pricing</h2>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { key: 'cost_price', label: 'Cost Price (Bs.)', placeholder: '0.00' },
                  { key: 'selling_price', label: 'Selling Price (Bs.)', placeholder: '0.00', required: true },
                  { key: 'sale_price', label: 'Sale / Promo Price (Bs.)', placeholder: 'Optional' },
                ].map(({ key, label, placeholder, required }) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{label}{required && <span className="text-red-500 ml-1">*</span>}</label>
                    <input type="number" step="0.01" min="0" required={required} placeholder={placeholder}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={(form as any)[key]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-3">Prices in Bolivianos (Bs.). IVA 13% is included in the selling price.</p>
            </div>

            {/* Product Images */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Product Images</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Images appear on your E-Commerce store. First image is the main image.</p>
                </div>
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50">
                  {uploadingImage
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading...</>
                    : <><ImagePlus className="h-4 w-4" /> Add Picture</>
                  }
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={e => handleImageFiles(e.target.files)} />
              </div>

              {imageError && <p className="text-xs text-red-600 mb-3 bg-red-50 px-3 py-2 rounded-lg">{imageError}</p>}

              {images.length === 0 ? (
                <div
                  className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-blue-300 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">
                    {isEdit ? 'Click to upload product images' : 'Save the product first to upload images'}
                  </p>
                  <p className="text-xs text-gray-300 mt-1">PNG, JPG, WebP up to 5MB each</p>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-3">
                  {images.map((url, i) => (
                    <div key={url} className="relative group aspect-square rounded-xl overflow-hidden border border-gray-200">
                      <img src={url} alt={`Product ${i + 1}`} className="w-full h-full object-cover" />
                      {i === 0 && (
                        <span className="absolute top-1 left-1 bg-gray-900 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">Main</span>
                      )}
                      <button type="button" onClick={() => removeImage(i)}
                        className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <div
                    className="aspect-square rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center cursor-pointer hover:border-blue-300 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Plus className="h-5 w-5 text-gray-300" />
                    <span className="text-xs text-gray-300 mt-1">Add</span>
                  </div>
                </div>
              )}
            </div>

            {/* Variants */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Variants</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Each variant is a unique combination of attributes (e.g. Size 38 + Color Red)</p>
                </div>
                <button type="button" onClick={addVariant}
                  className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium">
                  <Plus className="h-4 w-4" /> Add Manually
                </button>
              </div>

              {(variantTypes ?? []).length === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mt-3 text-xs text-amber-700">
                  Tip: Go to <strong>Products → Variant Types</strong> to define attributes (Size, Color…) with their allowed values before adding variants.
                </div>
              )}

              {/* Auto-generate section */}
              {(variantTypes ?? []).length > 0 && (
                <div className="mt-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                  <p className="text-xs font-bold text-blue-800 uppercase tracking-widest mb-2">Auto-Generate from Types</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {(variantTypes ?? []).map((t: any) => (
                      <label key={t.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-xs font-medium transition-colors select-none ${
                        selectedTypes.includes(t.id)
                          ? 'bg-gray-900 border-blue-600 text-white'
                          : 'bg-white border-gray-200 text-gray-700 hover:border-blue-400'
                      }`}>
                        <input type="checkbox" className="hidden" checked={selectedTypes.includes(t.id)}
                          onChange={() => setSelectedTypes(prev =>
                            prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id]
                          )} />
                        {t.name} ({t.values?.length ?? 0})
                      </label>
                    ))}
                  </div>
                  {selectedTypes.length > 0 && (
                    <button type="button" onClick={generateVariants}
                      className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors">
                      <Zap className="h-3.5 w-3.5" />
                      Generate {countCombinations()} Variants
                    </button>
                  )}
                </div>
              )}

              {activeVariants.length === 0 && (variantTypes ?? []).length > 0 && (
                <div className="mt-3 text-center py-8 border-2 border-dashed border-gray-200 rounded-xl text-gray-400">
                  <p className="text-sm">No variants yet.</p>
                  <p className="text-xs mt-1">Click "Add Variant" to define sizes, colors, etc.</p>
                </div>
              )}

              <div className="space-y-4 mt-4">
                {variants.map((variant, varIdx) => {
                  if (variant._deleted) return null;
                  const displayIdx = variants.filter((v, i) => !v._deleted && i <= varIdx).length;

                  return (
                    <div key={varIdx} className="border border-gray-200 rounded-xl p-4 bg-gray-50/60">
                      {/* Variant header */}
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm font-semibold text-gray-700">Variant {displayIdx}</span>
                        <button type="button" onClick={() => removeVariant(varIdx)} className="text-gray-400 hover:text-red-500 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Variant SKU <span className="text-red-400">*</span></label>
                          <input type="text" required placeholder="e.g. NIKE-AM270-38-RED"
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={variant.sku_variant}
                            onChange={e => updateVariant(varIdx, 'sku_variant', e.target.value.toUpperCase())} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Extra Cost (Bs.)</label>
                          <input type="number" step="0.01" min="0" placeholder="0.00"
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={variant.additional_cost}
                            onChange={e => updateVariant(varIdx, 'additional_cost', Number(e.target.value))} />
                        </div>
                      </div>

                      {/* Attributes */}
                      <div className="mb-3">
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Attributes</label>
                          <button type="button" onClick={() => addAttrRow(varIdx)}
                            className="text-xs text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1">
                            <Plus className="h-3 w-3" /> Add attribute
                          </button>
                        </div>

                        {variant.attrRows.length === 0 && (
                          <p className="text-xs text-gray-400 italic">No attributes yet — click "Add attribute"</p>
                        )}

                        <div className="space-y-2">
                          {variant.attrRows.map((row) => {
                            const matchedType = (variantTypes ?? []).find((t: any) => t.name === row.key);
                            return (
                              <div key={row._id} className="flex items-center gap-2">
                                {/* Attribute name */}
                                {(variantTypes ?? []).length > 0 ? (
                                  <select
                                    className="w-32 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    value={row.key}
                                    onChange={e => updateAttrRow(varIdx, row._id, 'key', e.target.value)}
                                  >
                                    <option value="">— pick —</option>
                                    {(variantTypes ?? []).map((t: any) => (
                                      <option key={t.id} value={t.name}>{t.name}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <input type="text" placeholder="Attribute" value={row.key}
                                    className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    onChange={e => updateAttrRow(varIdx, row._id, 'key', e.target.value)} />
                                )}

                                <span className="text-gray-300 text-sm">:</span>

                                {/* Attribute value */}
                                {matchedType?.values?.length > 0 ? (
                                  <select
                                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    value={row.value}
                                    onChange={e => updateAttrRow(varIdx, row._id, 'value', e.target.value)}
                                  >
                                    <option value="">— select —</option>
                                    {matchedType.values.map((v: string) => (
                                      <option key={v} value={v}>{v}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <input type="text" placeholder="Value" value={row.value}
                                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    onChange={e => updateAttrRow(varIdx, row._id, 'value', e.target.value)} />
                                )}

                                <button type="button" onClick={() => removeAttrRow(varIdx, row._id)}
                                  className="text-gray-300 hover:text-red-500 transition-colors p-1">
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 pt-3 border-t border-gray-200">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Barcode</label>
                          <input type="text" placeholder="Optional"
                            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={variant.barcode}
                            onChange={e => updateVariant(varIdx, 'barcode', e.target.value)} />
                        </div>
                        <label className="flex items-center gap-2 text-xs font-medium text-gray-600 cursor-pointer">
                          <input type="checkbox" checked={variant.is_active}
                            onChange={e => updateVariant(varIdx, 'is_active', e.target.checked)}
                            className="w-4 h-4 rounded accent-blue-600" />
                          Active
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Right sidebar ─────────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* Publish status */}
            <div className={`rounded-xl border p-4 ${form.is_published ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-start gap-3">
                {form.is_published
                  ? <Globe className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                  : <EyeOff className="h-5 w-5 text-gray-400 shrink-0 mt-0.5" />}
                <div>
                  <p className={`text-sm font-semibold ${form.is_published ? 'text-green-800' : 'text-gray-600'}`}>
                    {form.is_published ? 'Listed on E-Commerce' : 'Not Listed on E-Commerce'}
                  </p>
                  <p className={`text-xs mt-0.5 ${form.is_published ? 'text-green-600' : 'text-gray-400'}`}>
                    {form.is_published ? 'Visible on your online store.' : 'Toggle above to publish to your store.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Logistics */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">Logistics</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Weight (kg)</label>
                  <input type="number" step="0.001" min="0" placeholder="0.000"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reorder Point</label>
                  <input type="number" step="1" min="0" placeholder="0"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.reorder_point} onChange={e => setForm(f => ({ ...f, reorder_point: e.target.value }))} />
                  <p className="text-xs text-gray-400 mt-0.5">Alert when stock drops to this level. 0 = off.</p>
                </div>
              </div>
            </div>

            {/* Images summary */}
            {images.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Images ({images.length})</h2>
                <div className="grid grid-cols-3 gap-2">
                  {images.slice(0, 6).map((url, i) => (
                    <div key={url} className="aspect-square rounded-lg overflow-hidden border border-gray-100">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Video Generation */}
            {isEdit && images.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">AI Product Video</h2>
                  <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full">FAL.ai</span>
                </div>

                {/* Existing videos */}
                {videoImages.length > 0 && (
                  <div className="space-y-2">
                    {videoImages.map(url => (
                      <div key={url} className="relative group rounded-lg overflow-hidden border bg-black">
                        <video src={url} controls className="w-full aspect-video object-cover" />
                        <button type="button" onClick={() => deleteVideo(url)}
                          className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-5 h-5 text-xs hidden group-hover:flex items-center justify-center">×</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Image picker */}
                <div className="flex gap-1.5 flex-wrap">
                  {images.map(img => (
                    <button key={img} type="button" onClick={() => setSelectedVidImg(img)}
                      className={`w-12 h-12 rounded-lg overflow-hidden border-2 transition ${(selectedVidImg || images[0]) === img ? 'border-purple-500' : 'border-transparent'}`}>
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>

                {/* Prompt */}
                <input value={vidPrompt} onChange={e => setVidPrompt(e.target.value)}
                  placeholder="Optional prompt: rotate 360°, studio lighting…"
                  disabled={vidGenerating}
                  className="w-full border rounded-lg px-3 py-1.5 text-xs disabled:opacity-50" />

                {/* Status */}
                {vidGenerating && (
                  <div className="flex items-center gap-2 text-xs text-purple-700">
                    <span className="animate-spin">⟳</span>
                    {vidStatusLabel[vidStatus] ?? vidStatus}
                    <span className="text-gray-400 ml-auto">~30-60s</span>
                  </div>
                )}
                {vidError && <p className="text-xs text-red-600">{vidError}</p>}

                <button type="button" onClick={generateVideo} disabled={vidGenerating || images.length === 0}
                  className="w-full py-2 bg-purple-600 text-white text-xs font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-40 transition">
                  {vidGenerating ? 'Generating...' : '✦ Generate AI Video'}
                </button>
                <p className="text-[10px] text-gray-400 text-center">~$0.05 per video · 5s · 16:9 · Kling v2.1</p>
              </div>
            )}

            {/* Save */}
            <div className="space-y-3">
              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
              <button type="submit" disabled={saving}
                className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium text-sm transition-colors">
                <Save className="h-4 w-4" />
                {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Product'}
              </button>
              <button type="button" onClick={onCancel}
                className="w-full py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>

          </div>
        </div>
      </form>
    </div>
  );
}
