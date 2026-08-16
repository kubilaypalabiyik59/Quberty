'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Dialog, dialogField, apiErrorMessage } from '@/components/erp/Dialog';

/**
 * The item model group's parameter screen.
 *
 * Written after a first attempt shipped only `costing method` + `stocked` and
 * seeded them as `FIFO (stocked)` / `SERVICE (standard, not stocked)`, which read
 * as "standard cost means it is a service". It does not. The panels below are
 * grouped by the QUESTION each setting answers, so their independence is visible
 * on the screen rather than implied by the seed data:
 *
 *   Valuation      how is it costed
 *   Inventory      does it have an inventory subledger at all
 *   Ledger         which updates raise a voucher, and when
 *   Process gates  what must happen before what
 *
 * [OFFICIAL] "Yes, you can use different costing models for each item… a
 * periodic costing model for raw materials and standard cost for semi-finished
 * and finished goods", and "enable Accrue liability on product receipt for all
 * item model groups, regardless of whether you have a stocked product or a
 * not-stocked product".
 * learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-costing-faq
 */

const COSTING = [
  { v: 'FIFO', label: 'FIFO — first in, first out', note: 'Periodic. Implemented.' },
  { v: 'LIFO', label: 'LIFO — last in, first out', note: 'Periodic. Not implemented yet.' },
  { v: 'WEIGHTED_AVG', label: 'Weighted average', note: 'Periodic. Not implemented yet.' },
  { v: 'MOVING_AVG', label: 'Moving average', note: 'Perpetual. Not implemented yet.' },
  { v: 'STANDARD', label: 'Standard cost', note: 'Perpetual, with variances. Not implemented yet.' },
];

type Settings = Record<string, any>;

const TOGGLES: { section: string; hint: string; items: { key: string; label: string; note: string }[] }[] = [
  {
    section: 'Inventory',
    hint: 'Whether this item has an inventory subledger at all. Independent of how it is costed.',
    items: [
      {
        key: 'stocked',
        label: 'Stocked product',
        note:
          'Off means no inventory transactions are kept and the cost is expensed straight to the ledger. ' +
          'A service that appears on a BOM must be STOCKED — "not stocked" is not the same as "a service".',
      },
    ],
  },
  {
    section: 'Valuation detail',
    hint: 'Refinements to the costing method chosen above.',
    items: [
      {
        key: 'include_physical_value',
        label: 'Include physical value',
        note: 'Include physically-updated receipts in the running average cost.',
      },
      {
        key: 'fixed_receipt_price',
        label: 'Fixed receipt price',
        note: 'Treat the receipt price as standard and post the difference as a purchase price variance.',
      },
    ],
  },
  {
    section: 'Ledger',
    hint: 'A physical update and a financial update raise separate vouchers. These decide whether each one does.',
    items: [
      { key: 'post_physical_inventory', label: 'Post physical inventory', note: 'Product receipt / packing slip raises a voucher.' },
      { key: 'post_financial_inventory', label: 'Post financial inventory', note: 'Vendor invoice / sales invoice raises a voucher.' },
      {
        key: 'accrue_liability_on_receipt',
        label: 'Accrue liability on product receipt',
        note: 'Recommended for ALL groups, stocked or not — it is what recognises the liability between receipt and invoice.',
      },
      {
        key: 'post_deferred_revenue_on_delivery',
        label: 'Post deferred revenue on sales delivery',
        note: 'Recognise revenue at the packing slip instead of the invoice. Only useful when the two are far apart.',
      },
    ],
  },
  {
    section: 'Process gates',
    hint: 'Each blocks a step until its predecessor has happened. Applies to ALL receipts or issues, not just orders.',
    items: [
      { key: 'registration_requirements', label: 'Registration requirements', note: 'No product receipt until arrival registration is posted.' },
      { key: 'receiving_requirements', label: 'Receiving requirements', note: 'No vendor invoice until a product receipt is posted.' },
      { key: 'picking_requirements', label: 'Picking requirements', note: 'No packing slip until a picking list is posted.' },
      { key: 'deduction_requirements', label: 'Deduction requirements', note: 'No sales invoice until a packing slip is posted.' },
    ],
  },
];

export function ItemModelGroupDialog({
  group,
  onClose,
  onSaved,
}: {
  /** Existing group to edit, or undefined to create one. */
  group?: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(group?.id);
  const [error, setError] = useState('');
  const [form, setForm] = useState<Settings>({
    code: group?.code ?? '',
    name: group?.name ?? '',
    description: group?.description ?? '',
    costing_method: group?.costing_method ?? 'FIFO',
    stocked: group?.stocked ?? true,
    include_physical_value: group?.include_physical_value ?? false,
    fixed_receipt_price: group?.fixed_receipt_price ?? false,
    post_physical_inventory: group?.post_physical_inventory ?? true,
    post_financial_inventory: group?.post_financial_inventory ?? true,
    accrue_liability_on_receipt: group?.accrue_liability_on_receipt ?? true,
    post_deferred_revenue_on_delivery: group?.post_deferred_revenue_on_delivery ?? false,
    registration_requirements: group?.registration_requirements ?? false,
    receiving_requirements: group?.receiving_requirements ?? false,
    picking_requirements: group?.picking_requirements ?? false,
    deduction_requirements: group?.deduction_requirements ?? false,
  });

  const save = useMutation({
    mutationFn: (force?: boolean) =>
      editing
        ? api.put(`/products/setup/item-model-groups/${group.id}${force ? '?force=true' : ''}`, form)
        : api.post('/products/setup/item-model-groups', form),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e: any) => {
      if (e?.response?.data?.error?.code === 'MODEL_GROUP_CHANGE_AFTER_TRANSACTIONS') {
        const msg = apiErrorMessage(e, '');
        if (window.confirm(`${msg}\n\nProceed anyway?`)) { save.mutate(true); return; }
        setError('');
        return;
      }
      setError(apiErrorMessage(e, 'Could not save the item model group.'));
    },
  });

  const set = (k: string, v: any) => setForm({ ...form, [k]: v });

  const blocked = !form.code?.trim()
    ? 'A code is required.'
    : !form.name?.trim()
      ? 'A name is required.'
      : null;

  return (
    <Dialog
      title={editing ? `Item model group ${group.code}` : 'New item model group'}
      description="How the item is valued and controlled. Every setting here is independent of the others."
      width="max-w-3xl"
      onClose={onClose}
      error={error}
      blockedReason={blocked}
      submitLabel={editing ? 'Save' : 'Create group'}
      submitting={save.isPending}
      onSubmit={() => save.mutate(undefined)}
    >
      <div className="mb-4 grid grid-cols-2 gap-2.5">
        <label className="text-caption text-fg-muted">
          Code *
          <input
            className={dialogField}
            value={form.code}
            disabled={editing}
            onChange={(e) => set('code', e.target.value)}
          />
        </label>
        <label className="text-caption text-fg-muted">
          Name *
          <input className={dialogField} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="col-span-2 text-caption text-fg-muted">
          Description
          <input className={dialogField} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </label>
      </div>

      <section className="mb-4 rounded-surface border border-border bg-surface-sunken p-3">
        <div className="text-micro font-semibold uppercase tracking-wide text-fg-muted">Valuation</div>
        <p className="mb-2 mt-0.5 text-micro text-fg-subtle">
          How the item is costed. <strong className="text-fg-muted">Independent of whether it is stocked</strong> —
          a tangible item tracked in inventory can be valued at standard cost.
        </p>
        <select
          className={dialogField}
          value={form.costing_method}
          onChange={(e) => set('costing_method', e.target.value)}
        >
          {COSTING.map((c) => (
            <option key={c.v} value={c.v}>{c.label}</option>
          ))}
        </select>
        <p className="mt-1 text-micro text-fg-subtle">
          {COSTING.find((c) => c.v === form.costing_method)?.note}
        </p>
      </section>

      {TOGGLES.map((sec) => (
        <section key={sec.section} className="mb-4 rounded-surface border border-border bg-surface-sunken p-3">
          <div className="text-micro font-semibold uppercase tracking-wide text-fg-muted">{sec.section}</div>
          <p className="mb-2 mt-0.5 text-micro text-fg-subtle">{sec.hint}</p>
          <div className="space-y-2">
            {sec.items.map((it) => (
              <label key={it.key} className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={Boolean(form[it.key])}
                  onChange={(e) => set(it.key, e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border accent-accent"
                />
                <span className="text-caption">
                  <span className="text-fg">{it.label}</span>
                  <span className="block text-micro text-fg-subtle">{it.note}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      ))}

      {editing && group?._count?.products > 0 && (
        <p className="text-micro text-fg-subtle">
          {group._count.products} product(s) use this group. Changing the costing method or the stocked
          flag once they have posted transactions would value history and future differently — the
          system will ask before allowing it.
        </p>
      )}
    </Dialog>
  );
}

export default ItemModelGroupDialog;
