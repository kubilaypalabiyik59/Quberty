'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog, dialogField, apiErrorMessage } from '@/components/erp/Dialog';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows, ErrorNote } from '@/components/erp/PageHeader';

/**
 * Currencies — the ledger's currencies, the currencies this company uses, and the
 * rate types its exchange rates are quoted in.
 *
 * Nothing on this screen assumes a country. The ledger's accounting currency is
 * what every amount is posted in; it is chosen when the company is set up and,
 * as in Dynamics 365, cannot change once anything has posted. The screen shows
 * that lock and its reason instead of offering a button that would fail.
 *
 * Accounting setup: the server allows these changes to administrators only.
 */
export default function CurrenciesSetupPage() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [editingLedger, setEditingLedger] = useState(false);
  const [activating, setActivating] = useState(false);
  const [creatingType, setCreatingType] = useState(false);

  const ledger = useQuery({
    queryKey: ['ledger-currencies'],
    queryFn: () => api.get('/finance/ledger-currencies').then((r) => r.data.data),
  });
  const currencies = useQuery({
    queryKey: ['tenant-currencies'],
    queryFn: () => api.get('/finance/currencies').then((r) => r.data.data ?? []),
  });
  const rateTypes = useQuery({
    queryKey: ['exchange-rate-types'],
    queryFn: () => api.get('/finance/exchange-rate-types').then((r) => r.data.data ?? []),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ledger-currencies'] });
    qc.invalidateQueries({ queryKey: ['tenant-currencies'] });
    qc.invalidateQueries({ queryKey: ['exchange-rate-types'] });
    setError('');
  };

  const toggleCurrency = useMutation({
    mutationFn: ({ code, is_active }: { code: string; is_active: boolean }) =>
      api.put(`/finance/currencies/${code}`, { is_active }),
    onSuccess: refresh,
    onError: (e) => setError(apiErrorMessage(e, 'Could not change the currency.')),
  });
  const toggleType = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.put(`/finance/exchange-rate-types/${id}`, { is_active }),
    onSuccess: refresh,
    onError: (e) => setError(apiErrorMessage(e, 'Could not change the rate type.')),
  });

  const l = ledger.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Currencies"
        subtitle="The ledger's currencies, the currencies you trade in, and the rate types rates are quoted in"
      />
      <ErrorNote message={error || (ledger.error ? apiErrorMessage(ledger.error, 'Could not load the ledger currencies.') : '')} />

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-body font-medium text-fg">Ledger</h2>
            {l ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-caption">
                <dt className="text-fg-muted">Accounting currency</dt>
                <dd className="font-mono text-fg">{l.accountingCurrency}</dd>
                <dt className="text-fg-muted">Reporting currency</dt>
                <dd className="font-mono text-fg">{l.reportingCurrency}</dd>
                <dt className="text-fg-muted">Accounting rate type</dt>
                <dd className="text-fg">{l.accountingRateType ? `${l.accountingRateType.code} — ${l.accountingRateType.name}` : '—'}</dd>
                <dt className="text-fg-muted">Exchange-rate date</dt>
                <dd className="text-fg">{l.exchangeRateDateBasis === 'POSTING_DATE' ? 'Posting date' : 'Document date'}</dd>
              </dl>
            ) : (
              <p className="mt-2 text-caption text-fg-muted">{ledger.isLoading ? 'Loading…' : 'Not configured.'}</p>
            )}
            {l?.locked && (
              <p className="mt-3 flex items-center gap-1.5 text-caption text-fg-muted">
                <Lock className="h-3 w-3" />
                Transactions have been posted, so the ledger&apos;s currencies can no longer change.
              </p>
            )}
          </div>
          {l && (
            <Button size="sm" variant="secondary" onClick={() => setEditingLedger(true)}>
              Change
            </Button>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-body font-medium text-fg">Currencies in use</h2>
          <Button size="sm" onClick={() => setActivating(true)}>
            <Plus className="h-4 w-4" /> Activate currency
          </Button>
        </div>
        <TableShell>
          <thead>
            <tr><Th>Code</Th><Th>Name</Th><Th>Decimals</Th><Th>Rounding</Th><Th>Status</Th><Th /></tr>
          </thead>
          <tbody>
            {currencies.isLoading && <LoadingRows cols={6} />}
            {currencies.data?.length === 0 && <EmptyRow colSpan={6}>No currencies yet.</EmptyRow>}
            {currencies.data?.map((c: any) => {
              const inLedger = l && (c.currency_code === l.accountingCurrency || c.currency_code === l.reportingCurrency);
              return (
                <tr key={c.id}>
                  <Td className="font-mono">{c.currency_code}</Td>
                  <Td>{c.currency?.name}</Td>
                  <Td>{c.currency?.minor_unit}</Td>
                  <Td className="font-mono text-caption">{String(c.rounding_precision)} · {c.rounding_method}</Td>
                  <Td>{c.is_active ? 'Active' : 'Inactive'}{inLedger ? ' · ledger' : ''}</Td>
                  <Td className="text-right">
                    {!inLedger && (
                      <Button size="sm" variant="secondary"
                        onClick={() => toggleCurrency.mutate({ code: c.currency_code, is_active: !c.is_active })}>
                        {c.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-body font-medium text-fg">Exchange-rate types</h2>
          <Button size="sm" onClick={() => setCreatingType(true)}>
            <Plus className="h-4 w-4" /> New rate type
          </Button>
        </div>
        <TableShell>
          <thead>
            <tr><Th>Code</Th><Th>Name</Th><Th>Status</Th><Th /></tr>
          </thead>
          <tbody>
            {rateTypes.isLoading && <LoadingRows cols={4} />}
            {rateTypes.data?.length === 0 && <EmptyRow colSpan={4}>No rate types yet.</EmptyRow>}
            {rateTypes.data?.map((t: any) => {
              const inLedger = l && (t.id === l.accountingRateTypeId || t.id === l.reportingRateTypeId);
              return (
                <tr key={t.id}>
                  <Td className="font-mono">{t.code}</Td>
                  <Td>{t.name}</Td>
                  <Td>{t.is_active ? 'Active' : 'Inactive'}{inLedger ? ' · ledger' : ''}</Td>
                  <Td className="text-right">
                    {!inLedger && (
                      <Button size="sm" variant="secondary" onClick={() => toggleType.mutate({ id: t.id, is_active: !t.is_active })}>
                        {t.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      </section>

      {editingLedger && l && (
        <LedgerDialog
          ledger={l}
          currencies={(currencies.data ?? []).filter((c: any) => c.is_active)}
          rateTypes={(rateTypes.data ?? []).filter((t: any) => t.is_active)}
          onClose={() => setEditingLedger(false)}
          onSaved={refresh}
        />
      )}
      {activating && (
        <ActivateCurrencyDialog
          taken={(currencies.data ?? []).map((c: any) => c.currency_code)}
          onClose={() => setActivating(false)}
          onSaved={refresh}
        />
      )}
      {creatingType && <NewRateTypeDialog onClose={() => setCreatingType(false)} onSaved={refresh} />}
    </div>
  );
}

function LedgerDialog({
  ledger, currencies, rateTypes, onClose, onSaved,
}: { ledger: any; currencies: any[]; rateTypes: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ currency: ledger.accountingCurrency as string, rateTypeId: ledger.accountingRateTypeId as string });
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => api.put('/finance/ledger-currencies', {
      accounting_currency_code: f.currency,
      // A separate reporting currency needs vouchers that carry reporting amounts,
      // which arrive in the next release. Until then it follows the accounting one.
      reporting_currency_code: f.currency,
      accounting_rate_type_id: f.rateTypeId,
      exchange_rate_date_basis: 'POSTING_DATE',
    }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not change the ledger currencies.')),
  });

  const currencyChanges = f.currency !== ledger.accountingCurrency;
  const blockedReason = ledger.locked && currencyChanges
    ? 'Transactions have been posted; the accounting currency can no longer change.'
    : !f.currency ? 'Choose a currency.'
    : !f.rateTypeId ? 'Choose a rate type.'
    : null;

  return (
    <Dialog
      title="Ledger currencies"
      description="Every amount is posted in the accounting currency. It cannot change once anything has posted."
      onClose={onClose} error={error} blockedReason={blockedReason}
      submitLabel="Save" submitting={save.isPending} onSubmit={() => save.mutate()}
    >
      <div className="grid grid-cols-2 gap-2.5">
        <label className="text-caption text-fg-muted">Accounting currency *
          <select className={dialogField} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            {currencies.map((c) => <option key={c.currency_code} value={c.currency_code}>{c.currency_code} — {c.currency?.name}</option>)}
          </select>
        </label>
        <label className="text-caption text-fg-muted">Accounting rate type *
          <select className={dialogField} value={f.rateTypeId} onChange={(e) => setF({ ...f, rateTypeId: e.target.value })}>
            {rateTypes.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-3 text-micro text-fg-subtle">
        The reporting currency follows the accounting currency for now. A separate reporting currency
        needs journal lines that carry reporting amounts, which arrive in the next release.
      </p>
    </Dialog>
  );
}

function ActivateCurrencyDialog({
  taken, onClose, onSaved,
}: { taken: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ currency_code: '', symbol: '' });
  const [error, setError] = useState('');
  const iso = useQuery({
    queryKey: ['iso-currencies'],
    queryFn: () => api.get('/finance/currencies/iso').then((r) => r.data.data ?? []),
  });

  const create = useMutation({
    mutationFn: () => api.post('/finance/currencies', { currency_code: f.currency_code, symbol: f.symbol || null }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not activate the currency.')),
  });

  const options = (iso.data ?? []).filter((c: any) => !taken.includes(c.code) && c.minor_unit <= 2);

  return (
    <Dialog
      title="Activate a currency"
      description="Currencies with more than two decimals cannot be activated: amounts are stored with two."
      onClose={onClose} error={error} blockedReason={!f.currency_code ? 'Choose a currency.' : null}
      submitLabel="Activate" submitting={create.isPending} onSubmit={() => create.mutate()}
    >
      <div className="grid grid-cols-2 gap-2.5">
        <label className="text-caption text-fg-muted">Currency *
          <select className={dialogField} value={f.currency_code} onChange={(e) => setF({ ...f, currency_code: e.target.value })}>
            <option value="">—</option>
            {options.map((c: any) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
          </select>
        </label>
        <label className="text-caption text-fg-muted">Symbol
          <input className={dialogField} value={f.symbol} maxLength={8} onChange={(e) => setF({ ...f, symbol: e.target.value })} />
        </label>
      </div>
    </Dialog>
  );
}

function NewRateTypeDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: '', name: '', description: '' });
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () => api.post('/finance/exchange-rate-types', { ...f, description: f.description || null }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not create the rate type.')),
  });

  const blockedReason = !f.code ? 'A code is required.'
    : !/^[A-Z0-9_-]+$/.test(f.code) ? 'Use uppercase letters, digits, _ or -.'
    : !f.name ? 'A name is required.'
    : null;

  return (
    <Dialog
      title="New exchange-rate type"
      description="A named set of rates — for example the central bank's official rate."
      onClose={onClose} error={error} blockedReason={blockedReason}
      submitLabel="Create" submitting={create.isPending} onSubmit={() => create.mutate()}
    >
      <div className="grid grid-cols-2 gap-2.5">
        <label className="text-caption text-fg-muted">Code *
          <input className={dialogField} value={f.code} maxLength={20} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </label>
        <label className="text-caption text-fg-muted">Name *
          <input className={dialogField} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="col-span-2 text-caption text-fg-muted">Description
          <input className={dialogField} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </label>
      </div>
    </Dialog>
  );
}
