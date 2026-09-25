'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useMoney } from '@/components/CurrencyProvider';
import { Dialog, dialogField, apiErrorMessage } from '@/components/erp/Dialog';

interface Line { product_id: string; quantity: string; unit_price: string; discount_pct: string }

/**
 * A priced offer with product lines — how an opportunity says what is being
 * sold. D365's quote-to-cash puts the lines on the quotation, not on the
 * opportunity (catalog 85, Prospect to Quote); the opportunity keeps the
 * estimate and the quotation carries the products.
 *
 * The party (customer or lead) comes from the opportunity. Prices start at the
 * product's selling price and can be changed per line.
 */
export function NewQuotationDialog({
  party, opportunityId, onClose, onCreated,
}: {
  party: { customer_id?: string | null; lead_id?: string | null };
  opportunityId?: string;
  onClose: () => void;
  onCreated: (quotationId: string) => void;
}) {
  const { money } = useMoney();
  const [lines, setLines] = useState<Line[]>([{ product_id: '', quantity: '1', unit_price: '', discount_pct: '0' }]);
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const { data: products } = useQuery<Array<{ id: string; sku: string; name: string; selling_price: number | string }>>({
    queryKey: ['quotation-products'],
    queryFn: () => api.get('/products', { params: { limit: 200 } }).then((r) => r.data.data ?? []),
  });
  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => {
    const q = Number(l.quantity) || 0, p = Number(l.unit_price) || 0, d = Number(l.discount_pct) || 0;
    return s + q * p * (1 - d / 100);
  }, 0);

  const create = useMutation({
    mutationFn: () =>
      api.post('/sales/quotations', {
        ...(party.customer_id ? { customer_id: party.customer_id } : { lead_id: party.lead_id }),
        ...(opportunityId ? { opportunity_id: opportunityId } : {}),
        ...(validUntil ? { valid_until: validUntil } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        lines: lines.filter((l) => l.product_id).map((l) => ({
          product_id: l.product_id,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          discount_pct: Number(l.discount_pct) || 0,
        })),
      }),
    onSuccess: (r) => onCreated(r.data.data.id),
    onError: (e: any) => setError(apiErrorMessage(e, 'Could not create the quotation.')),
  });

  const filled = lines.filter((l) => l.product_id);
  const blocked =
    !party.customer_id && !party.lead_id ? 'The opportunity has no customer or lead.'
    : filled.length === 0 ? 'Add at least one product.'
    : filled.some((l) => !(Number(l.quantity) > 0)) ? 'Every line needs a quantity above zero.'
    : filled.some((l) => l.unit_price === '' || Number(l.unit_price) < 0) ? 'Every line needs a price.'
    : filled.some((l) => Number(l.discount_pct) < 0 || Number(l.discount_pct) > 100) ? 'A discount is between 0 and 100 %.'
    : null;

  return (
    <Dialog
      title="New quotation"
      description="What is being offered, at what price. Sending it and confirming it happen on the quotation."
      onClose={onClose}
      error={error}
      blockedReason={blocked}
      submitLabel="Create quotation"
      onSubmit={() => create.mutate()}
      submitting={create.isPending}
      width="max-w-3xl"
    >
      <div className="mb-1 grid grid-cols-[1fr_5rem_7rem_5rem_2rem] gap-2 text-micro font-semibold uppercase tracking-wide text-fg-muted">
        <span>Product</span><span className="text-right">Qty</span><span className="text-right">Unit price</span><span className="text-right">Disc. %</span><span />
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_5rem_7rem_5rem_2rem] items-center gap-2">
            <select
              aria-label={`Product for line ${i + 1}`}
              className={dialogField}
              value={l.product_id}
              onChange={(e) => {
                const p = byId.get(e.target.value);
                setLine(i, { product_id: e.target.value, ...(p && l.unit_price === '' ? { unit_price: String(Number(p.selling_price)) } : {}) });
              }}
            >
              <option value="">— product —</option>
              {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
            <input aria-label={`Quantity for line ${i + 1}`} className={`${dialogField} text-right`} type="number" min={0} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
            <input aria-label={`Unit price for line ${i + 1}`} className={`${dialogField} text-right`} type="number" min={0} step="0.01" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} />
            <input aria-label={`Discount for line ${i + 1}`} className={`${dialogField} text-right`} type="number" min={0} max={100} value={l.discount_pct} onChange={(e) => setLine(i, { discount_pct: e.target.value })} />
            <button
              type="button"
              aria-label={`Remove line ${i + 1}`}
              disabled={lines.length === 1}
              onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              className="grid h-8 w-8 place-items-center rounded-control text-fg-muted hover:bg-surface-sunken disabled:opacity-30"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setLines((ls) => [...ls, { product_id: '', quantity: '1', unit_price: '', discount_pct: '0' }])}
        className="mt-2 inline-flex items-center gap-1 text-caption font-medium text-accent hover:underline"
      >
        <Plus className="h-3.5 w-3.5" /> Add line
      </button>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="nq-valid" className="mb-1 block text-caption text-fg-muted">Valid until</label>
          <input id="nq-valid" className={dialogField} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
        <div className="flex items-end justify-end">
          <div className="text-right">
            <div className="text-micro uppercase tracking-wide text-fg-muted">Lines total (before tax)</div>
            <div className="font-mono text-lead font-semibold text-fg">{money(Math.round(total * 100) / 100)}</div>
          </div>
        </div>
        <div className="col-span-2">
          <label htmlFor="nq-notes" className="mb-1 block text-caption text-fg-muted">Notes</label>
          <input id="nq-notes" className={dialogField} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Dialog>
  );
}
