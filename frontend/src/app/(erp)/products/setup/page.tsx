'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { apiErrorMessage } from '@/components/erp/Dialog';
import { ItemModelGroupDialog } from '@/components/erp/ItemModelGroupDialog';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows, ErrorNote } from '@/components/erp/PageHeader';

/**
 * Released-product financial setup.
 *
 * Two groups are mandatory on a D365 released product and they answer different
 * questions — which is exactly the distinction users get wrong, so the page says
 * it rather than assuming it:
 *
 *   item MODEL group  HOW the item is valued and controlled
 *   item group        WHERE its money goes
 *
 * The coverage banner is the point of the page. A product with no item group can
 * only ever resolve the ALL-scope posting profile, so per-group accounts are
 * unreachable for it — which is invisible until someone asks why every product
 * posts to the same inventory account.
 *
 * Full setup order and the backlog it implies: docs/architecture/ERP_SETUP_CHECKLIST.md
 */
export default function ProductSetupPage() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: coverage } = useQuery({
    queryKey: ['product-setup-coverage'],
    queryFn: () => api.get('/products/setup/coverage').then((r) => r.data.data),
  });
  const { data: itemGroups, isLoading: igLoading } = useQuery({
    queryKey: ['item-groups'],
    queryFn: () => api.get('/products/setup/item-groups').then((r) => r.data.data),
  });
  const { data: modelGroups, isLoading: mgLoading } = useQuery({
    queryKey: ['item-model-groups'],
    queryFn: () => api.get('/products/setup/item-model-groups').then((r) => r.data.data),
  });
  const { data: products, isLoading: pLoading } = useQuery({
    queryKey: ['products-setup-list'],
    queryFn: () => api.get('/products', { params: { limit: 200 } }).then((r) => r.data.data ?? []),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['product-setup-coverage'] });
    qc.invalidateQueries({ queryKey: ['products-setup-list'] });
    qc.invalidateQueries({ queryKey: ['item-groups'] });
    qc.invalidateQueries({ queryKey: ['item-model-groups'] });
    setError('');
  };

  const assign = useMutation({
    mutationFn: ({ id, field, value, force }: { id: string; field: string; value: string; force?: boolean }) =>
      api.put(`/products/${id}${force ? '?force=true' : ''}`, { [field]: value || null }),
    onSuccess: refresh,
    onError: (e: any) => setError(apiErrorMessage(e, 'Could not assign the group.')),
  });

  /**
   * The 409 is not a failure to hide — it is the system telling the user that a
   * reclassification will split the ledger from the subledger. Surface the
   * sentence and let them confirm.
   */
  const assignWithGuard = (id: string, field: string, value: string) => {
    assign.mutate(
      { id, field, value },
      {
        onError: (e: any) => {
          const msg = apiErrorMessage(e, 'Could not assign the group.');
          if (e?.response?.data?.error?.code === 'ITEM_GROUP_CHANGE_AFTER_TRANSACTIONS') {
            if (window.confirm(`${msg}\n\nProceed anyway?`)) {
              assign.mutate({ id, field, value, force: true });
              return;
            }
            setError('');
            return;
          }
          setError(msg);
        },
      },
    );
  };

  const missing = (coverage?.missing_item_group ?? 0) + (coverage?.missing_item_model_group ?? 0);
  const field =
    'h-8 w-full rounded-control border border-border bg-surface px-2 text-caption text-fg focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <div>
      <PageHeader
        title="Product financial setup"
        subtitle="Every released product needs an item model group (how it is valued) and an item group (where its money goes)."
      />

      <ErrorNote message={error} />

      {coverage && (
        <div
          className={`mb-5 flex items-start gap-2.5 rounded-surface border px-3 py-2.5 text-caption ${
            missing === 0
              ? 'border-success/25 bg-success-soft text-success'
              : 'border-warning/25 bg-warning-soft text-warning'
          }`}
        >
          {missing === 0 ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <div>
            {missing === 0 ? (
              <span>All {coverage.products} products are classified.</span>
            ) : (
              <>
                <strong>
                  {coverage.missing_item_group} of {coverage.products} products have no item group
                  {coverage.missing_item_model_group > 0 && `, ${coverage.missing_item_model_group} no item model group`}.
                </strong>
                <div className="mt-1 opacity-90">
                  They fall back to the ALL-scope posting profile and to the tenant-wide costing
                  method — the behaviour that existed before groups were introduced, so nothing is
                  broken. But per-group GL accounts and per-item costing stay unreachable until they
                  are assigned.
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-end justify-between gap-2">
            <h2 className="text-body font-semibold text-fg">
              Item model groups <span className="font-normal text-fg-muted">— how it is valued and controlled</span>
            </h2>
            <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>New group</Button>
          </div>
          <TableShell>
            <thead>
              <tr>
                <Th>Code</Th>
                {/* The two axes sit in adjacent columns on purpose: every
                    combination of them is legal, and an earlier version of this
                    page implied otherwise. */}
                <Th>Valuation</Th>
                <Th>Inventory</Th>
                <Th>Gates</Th>
                <Th className="text-right">Products</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {mgLoading && <LoadingRows cols={6} rows={3} />}
              {(modelGroups ?? []).map((g: any) => {
                const gates = [
                  g.registration_requirements && 'registration',
                  g.receiving_requirements && 'receiving',
                  g.picking_requirements && 'picking',
                  g.deduction_requirements && 'deduction',
                ].filter(Boolean) as string[];
                return (
                  <tr key={g.id} className="hover:bg-surface-sunken">
                    <Td>
                      <div className="font-mono text-caption text-fg">{g.code}</div>
                      <div className="text-micro text-fg-subtle">{g.name}</div>
                    </Td>
                    <Td className="text-caption text-fg">{g.costing_method.replace('_', ' ')}</Td>
                    <Td className="text-caption">
                      {g.stocked ? (
                        <span className="text-fg">Stocked</span>
                      ) : (
                        <span className="text-fg-muted">Not stocked — expensed</span>
                      )}
                    </Td>
                    <Td className="text-caption text-fg-muted">
                      {gates.length ? gates.join(', ') : <span className="text-fg-subtle">none</span>}
                    </Td>
                    <Td className="text-right font-mono text-caption text-fg-muted">{g._count?.products ?? 0}</Td>
                    <Td className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(g)}>Settings</Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
          <p className="mt-1.5 text-micro text-fg-subtle">
            <strong className="text-fg-muted">Valuation and Inventory are independent axes.</strong> A
            tangible item tracked in inventory can be valued at standard cost, and a service that
            appears on a bill of materials must be <em>stocked</em>. Choosing a costing method never
            decides whether something is a service.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-body font-semibold text-fg">
            Item groups <span className="font-normal text-fg-muted">— where its money goes</span>
          </h2>
          <TableShell>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Description</Th>
                <Th className="text-right">Products</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {igLoading && <LoadingRows cols={4} rows={3} />}
              {(itemGroups ?? []).map((g: any) => (
                <tr key={g.id} className="hover:bg-surface-sunken">
                  <Td className="font-mono text-caption">{g.code}</Td>
                  <Td>{g.name}</Td>
                  <Td className="text-caption text-fg-muted">{g.description ?? '—'}</Td>
                  <Td className="text-right font-mono text-caption text-fg-muted">{g._count?.products ?? 0}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          <p className="mt-1.5 text-micro text-fg-subtle">
            Not the same as a product category. A category is merchandising; an item group is the
            ledger. Re-shuffling the shop must never repoint the accounts.
          </p>
        </div>
      </div>

      <h2 className="mb-2 text-body font-semibold text-fg">Assignment</h2>
      <TableShell>
        <thead>
          <tr>
            <Th>SKU</Th>
            <Th>Product</Th>
            <Th className="w-56">Item model group</Th>
            <Th className="w-56">Item group</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {pLoading && <LoadingRows cols={4} />}
          {!pLoading && (products ?? []).length === 0 && <EmptyRow colSpan={4}>No products.</EmptyRow>}
          {(products ?? []).map((p: any) => (
            <tr key={p.id} className="hover:bg-surface-sunken">
              <Td className="font-mono text-caption">{p.sku}</Td>
              <Td className="max-w-xs truncate">{p.name}</Td>
              <Td>
                <select
                  className={field}
                  aria-label={`Item model group for ${p.sku}`}
                  value={p.item_model_group_id ?? ''}
                  onChange={(e) => assignWithGuard(p.id, 'item_model_group_id', e.target.value)}
                >
                  <option value="">— none —</option>
                  {(modelGroups ?? []).map((g: any) => (
                    <option key={g.id} value={g.id}>{g.code} — {g.name}</option>
                  ))}
                </select>
              </Td>
              <Td>
                <select
                  className={field}
                  aria-label={`Item group for ${p.sku}`}
                  value={p.item_group_id ?? ''}
                  onChange={(e) => assignWithGuard(p.id, 'item_group_id', e.target.value)}
                >
                  <option value="">— none —</option>
                  {(itemGroups ?? []).map((g: any) => (
                    <option key={g.id} value={g.id}>{g.code} — {g.name}</option>
                  ))}
                </select>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      <p className="mt-3 text-micro text-fg-subtle">
        Changing a group on a product that already has posted transactions splits the ledger from the
        subledger: new postings go to the new accounts while existing ones stay where they are. The
        system will refuse and explain; confirming overrides it and writes a warning to the log.
      </p>

      {(editing || creating) && (
        <ItemModelGroupDialog
          group={editing ?? undefined}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
