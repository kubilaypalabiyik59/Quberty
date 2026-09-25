'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMoney } from '@/components/CurrencyProvider';
import { Dialog, apiErrorMessage } from '@/components/erp/Dialog';
import { TableShell, Th, Td, EmptyRow, LoadingRows } from '@/components/erp/PageHeader';

/**
 * Open payable per supplier from the AP subledger (VendorOpenTransaction):
 * vendor invoices are credits (owed to the supplier), payments and supplier
 * credits are debits; what is still open on each nets to the balance.
 */
export function openPayableBySupplier(rows: any[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const open = Number(r.open_amount ?? 0);
    if (!open) continue;
    const signed = r.direction === 'CREDIT' ? open : -open;
    out.set(r.supplier_id, Math.round(((out.get(r.supplier_id) ?? 0) + signed) * 100) / 100);
  }
  return out;
}

const SOURCE_LABEL: Record<string, string> = {
  INVOICE: 'Vendor invoice',
  PAYMENT: 'Payment',
  SUPPLIER_CREDIT: 'Supplier credit',
  PAYMENT_REVERSAL: 'Payment reversal',
};

/**
 * A supplier's statement: the AP subledger lines (what was invoiced, paid and
 * credited, and what is still open) and the recent purchase orders. It replaces
 * the Transactions button, which listed stock movements.
 */
export function SupplierStatement({ supplier, onClose }: { supplier: any; onClose: () => void }) {
  const { money } = useMoney();
  const ap = useQuery({
    queryKey: ['vendor-open-transactions', supplier.id],
    queryFn: () => api.get('/purchase/open-transactions', { params: { supplier_id: supplier.id } }).then((r) => r.data.data as any[]),
    retry: false,
  });
  const orders = useQuery({
    queryKey: ['supplier-orders', supplier.id],
    queryFn: () => api.get('/purchase/orders', { params: { supplier_id: supplier.id, limit: 20 } }).then((r) => r.data.data as any[]),
    retry: false,
  });

  const lines = (ap.data ?? []).filter((r) => !r.reverses_transaction_id);
  const sum = (pred: (r: any) => boolean) =>
    Math.round(lines.filter(pred).reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
  const invoiced = sum((r) => r.source_type === 'INVOICE');
  const paid = sum((r) => r.source_type === 'PAYMENT');
  const credited = sum((r) => r.source_type === 'SUPPLIER_CREDIT');
  const open = openPayableBySupplier(ap.data ?? []).get(supplier.id) ?? 0;

  return (
    <Dialog
      title={`Statement — ${supplier.name}`}
      description={`${supplier.code} · ${supplier.currency} · ${supplier.payment_terms ?? 30} days`}
      onClose={onClose}
      error={ap.error ? apiErrorMessage(ap.error, 'Could not load the payables.') : undefined}
      submitLabel="Close"
      onSubmit={onClose}
      width="max-w-4xl"
    >
      <div className="mb-4 grid grid-cols-4 gap-2">
        {([['Invoiced', invoiced], ['Paid', paid], ['Credited', credited], ['Open payable', open]] as const).map(([label, v]) => (
          <div key={label} className="rounded-control border border-border bg-surface-sunken px-3 py-2">
            <div className="text-micro uppercase tracking-wide text-fg-muted">{label}</div>
            <div className={`font-mono text-body font-semibold ${label === 'Open payable' && v > 0 ? 'text-warning' : 'text-fg'}`}>
              {ap.isLoading ? '…' : money(v)}
            </div>
          </div>
        ))}
      </div>

      <h3 className="mb-1.5 text-caption font-semibold text-fg">Payables</h3>
      <div className="mb-4 max-h-[30vh] overflow-y-auto">
        <TableShell>
          <thead>
            <tr><Th>Posted</Th><Th>Document</Th><Th>Reference</Th><Th className="text-right">Amount</Th><Th className="text-right">Open</Th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ap.isLoading && <LoadingRows cols={5} rows={3} />}
            {!ap.isLoading && lines.length === 0 && <EmptyRow colSpan={5}>Nothing invoiced or paid yet.</EmptyRow>}
            {lines.map((r) => (
              <tr key={r.id}>
                <Td className="text-caption text-fg-muted">{new Date(r.posting_date).toLocaleDateString()}</Td>
                <Td className="text-caption">{SOURCE_LABEL[r.source_type] ?? r.source_type}</Td>
                <Td className="font-mono text-caption">{r.invoice?.invoice_number ?? r.invoice?.internal_number ?? '—'}</Td>
                <Td className={`text-right font-mono text-caption ${r.direction === 'DEBIT' ? 'text-success' : ''}`}>
                  {r.direction === 'DEBIT' ? '−' : ''}{money(Number(r.amount))}
                </Td>
                <Td className="text-right font-mono text-caption">{r.is_open ? money(Number(r.open_amount)) : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </div>

      <h3 className="mb-1.5 text-caption font-semibold text-fg">Recent purchase orders</h3>
      <div className="max-h-[25vh] overflow-y-auto">
        <TableShell>
          <thead>
            <tr><Th>Order</Th><Th>Date</Th><Th>Status</Th><Th className="text-right">Total</Th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orders.isLoading && <LoadingRows cols={4} rows={3} />}
            {!orders.isLoading && (orders.data ?? []).length === 0 && <EmptyRow colSpan={4}>No purchase orders.</EmptyRow>}
            {(orders.data ?? []).map((o) => (
              <tr key={o.id}>
                <Td className="font-mono text-caption">{o.po_number}</Td>
                <Td className="text-caption text-fg-muted">{new Date(o.created_at).toLocaleDateString()}</Td>
                <Td className="text-caption">{o.status}</Td>
                <Td className="text-right font-mono text-caption">{money(Number(o.total_amount))}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </div>
    </Dialog>
  );
}
