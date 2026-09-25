'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, PackageCheck, Plus, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { can } from '@/lib/access';
import { Button } from '@/components/ui/Button';
import { Dialog, dialogField, apiErrorMessage } from '@/components/erp/Dialog';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows, ErrorNote } from '@/components/erp/PageHeader';

interface Rule {
  id: string;
  name: string;
  sku: string;
  reorder_point: number;
  available: number;
  shortfall: number;
  below: boolean;
}

/**
 * Low stock: the rules and what they currently flag.
 *
 * A rule is a product's reorder point — when what is available (on hand minus
 * reserved, across all warehouses) falls to it or below, the product is flagged
 * here and in the notification bell. The threshold is company-wide for now;
 * per-warehouse minimum and maximum, as D365 keeps on item coverage, is the
 * recorded next step (see inventory.routes.ts).
 */
export default function LowStockPage() {
  const qc = useQueryClient();
  const permissions = useAuthStore((s) => s.user?.permissions);
  const canEdit = can(permissions, 'product.maintain');
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery<Rule[]>({
    queryKey: ['low-stock', 'all'],
    queryFn: () => api.get('/inventory/low-stock', { params: { scope: 'all' } }).then((r) => r.data.data),
  });
  const rules = data ?? [];
  const flagged = rules.filter((r) => r.below);
  const shown = showAll ? rules : flagged;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['low-stock'] });
    setError('');
  };
  const remove = useMutation({
    mutationFn: (id: string) => api.put(`/products/${id}`, { reorder_point: 0 }),
    onSuccess: refresh,
    onError: (e: any) => setError(apiErrorMessage(e, 'Could not remove the rule.')),
  });

  return (
    <div>
      <PageHeader
        title="Low stock"
        subtitle="Products at or below their reorder point. Available = on hand minus reserved, across all warehouses."
        actions={
          <>
            {flagged.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-3 py-1.5 text-caption font-semibold text-warning">
                <AlertTriangle className="h-4 w-4" aria-hidden /> {flagged.length} need attention
              </span>
            )}
            {canEdit && (
              <Button onClick={() => setEditing('new')}>
                <Plus className="h-4 w-4" aria-hidden /> New rule
              </Button>
            )}
          </>
        }
      />
      <ErrorNote message={error} />

      <div className="mb-3 flex items-center gap-2 text-caption">
        <button
          onClick={() => setShowAll(false)}
          aria-pressed={!showAll}
          className={`rounded-full px-3 py-1 ${!showAll ? 'bg-fg text-bg' : 'text-fg-muted hover:bg-surface-sunken'}`}
        >
          Needs attention ({flagged.length})
        </button>
        <button
          onClick={() => setShowAll(true)}
          aria-pressed={showAll}
          className={`rounded-full px-3 py-1 ${showAll ? 'bg-fg text-bg' : 'text-fg-muted hover:bg-surface-sunken'}`}
        >
          All rules ({rules.length})
        </button>
      </div>

      <TableShell>
        <thead>
          <tr>
            <Th>Product</Th>
            <Th>SKU</Th>
            <Th className="text-right">Available</Th>
            <Th className="text-right">Reorder point</Th>
            <Th className="text-right">Shortfall</Th>
            <Th className="w-56" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading && <LoadingRows cols={6} />}
          {!isLoading && shown.length === 0 && (
            <EmptyRow colSpan={6}>
              <PackageCheck className="mx-auto mb-2 h-8 w-8 text-success" aria-hidden />
              {rules.length === 0
                ? 'No product is monitored yet. Add a rule to be warned before it runs out.'
                : 'Every monitored product is above its reorder point.'}
            </EmptyRow>
          )}
          {shown.map((r) => {
            const critical = r.available === 0;
            return (
              <tr key={r.id} className={r.below ? (critical ? 'bg-danger-soft/40' : 'bg-warning-soft/30') : 'hover:bg-surface-sunken'}>
                <Td className="font-medium">{r.name}</Td>
                <Td className="font-mono text-caption text-fg-muted">{r.sku}</Td>
                <Td className={`text-right font-semibold ${r.below ? (critical ? 'text-danger' : 'text-warning') : 'text-fg'}`}>{r.available}</Td>
                <Td className="text-right text-fg-muted">{r.reorder_point}</Td>
                <Td className="text-right">
                  {r.shortfall > 0
                    ? <span className="rounded-full bg-danger-soft px-2 py-0.5 text-micro font-semibold text-danger">-{r.shortfall}</span>
                    : <span className="text-micro text-fg-subtle">—</span>}
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1.5">
                    {r.below && (
                      <Link href="/purchase/orders" className="inline-flex items-center gap-1 px-2 text-caption font-medium text-accent hover:underline">
                        <Truck className="h-3.5 w-3.5" aria-hidden /> Reorder
                      </Link>
                    )}
                    {canEdit && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
                        <Button
                          size="sm" variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => { if (window.confirm(`Stop monitoring ${r.sku}?`)) remove.mutate(r.id); }}
                        >
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>

      {editing && (
        <RuleDialog
          rule={editing === 'new' ? null : editing}
          monitored={new Set(rules.map((r) => r.id))}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function RuleDialog({
  rule, monitored, onClose, onSaved,
}: { rule: Rule | null; monitored: Set<string>; onClose: () => void; onSaved: () => void }) {
  const [productId, setProductId] = useState(rule?.id ?? '');
  const [point, setPoint] = useState(rule ? String(rule.reorder_point) : '');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const { data: products } = useQuery<Array<{ id: string; sku: string; name: string; product_type?: string }>>({
    queryKey: ['low-stock-products', search],
    queryFn: () => api.get('/products', { params: { limit: 50, ...(search ? { search } : {}) } }).then((r) => r.data.data ?? []),
    enabled: !rule,
  });
  const options = useMemo(
    () => (products ?? []).filter((p) => (p.product_type ?? 'physical') === 'physical' && !monitored.has(p.id)),
    [products, monitored],
  );

  const save = useMutation({
    mutationFn: () => api.put(`/products/${productId}`, { reorder_point: Number(point) }),
    onSuccess: onSaved,
    onError: (e: any) => setError(apiErrorMessage(e, 'Could not save the rule.')),
  });

  const blocked =
    !productId ? 'Choose a product.'
    : !(Number.isInteger(Number(point)) && Number(point) > 0) ? 'The reorder point is a whole number above zero.'
    : null;

  return (
    <Dialog
      title={rule ? `Reorder point — ${rule.sku}` : 'New low-stock rule'}
      description="When available stock falls to this quantity or below, the product is flagged here and in the notification bell."
      onClose={onClose}
      error={error}
      blockedReason={blocked}
      submitLabel={rule ? 'Save' : 'Add rule'}
      onSubmit={() => save.mutate()}
      submitting={save.isPending}
    >
      <div className="space-y-3">
        {!rule && (
          <>
            <div>
              <label htmlFor="lsr-search" className="mb-1 block text-caption text-fg-muted">Find a product</label>
              <input id="lsr-search" className={dialogField} placeholder="Name…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div>
              <label htmlFor="lsr-product" className="mb-1 block text-caption text-fg-muted">Product</label>
              <select id="lsr-product" className={dialogField} value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">— choose —</option>
                {options.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
              </select>
            </div>
          </>
        )}
        <div>
          <label htmlFor="lsr-point" className="mb-1 block text-caption text-fg-muted">Reorder point (units)</label>
          <input id="lsr-point" className={dialogField} type="number" min={1} step={1} value={point} onChange={(e) => setPoint(e.target.value)} autoFocus={!!rule} />
        </div>
      </div>
    </Dialog>
  );
}
