'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog, dialogField, apiErrorMessage } from '@/components/erp/Dialog';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows, ErrorNote } from '@/components/erp/PageHeader';

/**
 * Exchange rates — one dated row per change.
 *
 * A rate applies from its date until the next row for the same pair, so history
 * never moves: a document posted last month keeps last month's rate. Adding a
 * rate is everyday work (store managers, finance approvers); correcting an
 * existing row is an administrator's job, so the people who enter rates cannot
 * quietly rewrite the one a document was valued at.
 */
export default function ExchangeRatesPage() {
  const qc = useQueryClient();
  const [typeId, setTypeId] = useState('');
  const [adding, setAdding] = useState(false);
  const [correcting, setCorrecting] = useState<any | null>(null);

  const types = useQuery({
    queryKey: ['exchange-rate-types'],
    queryFn: () => api.get('/finance/exchange-rate-types').then((r) => r.data.data ?? []),
  });
  const ledger = useQuery({
    queryKey: ['ledger-currencies'],
    queryFn: () => api.get('/finance/ledger-currencies').then((r) => r.data.data),
  });
  const selectedType = typeId || ledger.data?.accountingRateTypeId || '';

  const rates = useQuery({
    queryKey: ['exchange-rates', selectedType],
    enabled: !!selectedType,
    queryFn: () => api.get('/finance/exchange-rates', { params: { rate_type_id: selectedType } }).then((r) => r.data.data ?? []),
  });
  const currencies = useQuery({
    queryKey: ['tenant-currencies'],
    queryFn: () => api.get('/finance/currencies').then((r) => r.data.data ?? []),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['exchange-rates'] });

  return (
    <div className="space-y-6">
      <PageHeader title="Exchange rates" subtitle="Dated rates per rate type; the latest on or before a document's date applies" />
      <ErrorNote message={rates.error ? apiErrorMessage(rates.error, 'Could not load exchange rates.') : ''} />

      <div className="flex items-end justify-between gap-4">
        <label className="text-caption text-fg-muted">Rate type
          <select className={dialogField} value={selectedType} onChange={(e) => setTypeId(e.target.value)}>
            {(types.data ?? []).map((t: any) => (
              <option key={t.id} value={t.id}>{t.code} — {t.name}{t.id === ledger.data?.accountingRateTypeId ? ' (ledger)' : ''}</option>
            ))}
          </select>
        </label>
        <Button size="sm" disabled={!selectedType} onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add rate
        </Button>
      </div>

      <TableShell>
        <thead>
          <tr><Th>Valid from</Th><Th>From</Th><Th>To</Th><Th>Rate</Th><Th>Per</Th><Th>Source</Th><Th /></tr>
        </thead>
        <tbody>
          {rates.isLoading && <LoadingRows cols={7} />}
          {rates.data?.length === 0 && <EmptyRow colSpan={7}>No rates for this rate type yet.</EmptyRow>}
          {rates.data?.map((r: any) => (
            <tr key={r.id}>
              <Td className="font-mono">{String(r.valid_from).slice(0, 10)}</Td>
              <Td className="font-mono">{r.pair.from_currency_code}</Td>
              <Td className="font-mono">{r.pair.to_currency_code}</Td>
              <Td className="font-mono">{String(r.rate)}</Td>
              <Td>{String(r.pair.conversion_factor)}</Td>
              <Td>{r.source}</Td>
              <Td className="text-right">
                <Button size="sm" variant="secondary" onClick={() => setCorrecting(r)}>Correct</Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      {adding && (
        <AddRateDialog
          rateTypeId={selectedType}
          defaultTo={ledger.data?.accountingCurrency ?? ''}
          currencies={(currencies.data ?? []).filter((c: any) => c.is_active)}
          onClose={() => setAdding(false)}
          onSaved={refresh}
        />
      )}
      {correcting && <CorrectRateDialog rate={correcting} onClose={() => setCorrecting(null)} onSaved={refresh} />}
    </div>
  );
}

function AddRateDialog({
  rateTypeId, defaultTo, currencies, onClose, onSaved,
}: { rateTypeId: string; defaultTo: string; currencies: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    from: '', to: defaultTo, valid_from: new Date().toISOString().slice(0, 10), rate: '', factor: '1',
  });
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () => api.post('/finance/exchange-rates', {
      rate_type_id: rateTypeId,
      from_currency_code: f.from,
      to_currency_code: f.to,
      valid_from: f.valid_from,
      rate: Number(f.rate),
      conversion_factor: Number(f.factor),
    }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not add the rate.')),
  });

  const blockedReason = !f.from || !f.to ? 'Choose both currencies.'
    : f.from === f.to ? 'Choose two different currencies.'
    : !(Number(f.rate) > 0) ? 'The rate must be greater than zero.'
    : !(Number.isInteger(Number(f.factor)) && Number(f.factor) > 0) ? 'The factor must be a positive whole number.'
    : null;

  return (
    <Dialog
      title="Add exchange rate"
      description="How many units of the second currency one unit (or the factor's units) of the first is worth, from this date on."
      onClose={onClose} error={error} blockedReason={blockedReason}
      submitLabel="Add rate" submitting={create.isPending} onSubmit={() => create.mutate()}
    >
      <div className="grid grid-cols-2 gap-2.5">
        <label className="text-caption text-fg-muted">From *
          <select className={dialogField} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>
            <option value="">—</option>
            {currencies.map((c) => <option key={c.currency_code} value={c.currency_code}>{c.currency_code}</option>)}
          </select>
        </label>
        <label className="text-caption text-fg-muted">To *
          <select className={dialogField} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>
            <option value="">—</option>
            {currencies.map((c) => <option key={c.currency_code} value={c.currency_code}>{c.currency_code}</option>)}
          </select>
        </label>
        <label className="text-caption text-fg-muted">Valid from *
          <input type="date" className={dialogField} value={f.valid_from} onChange={(e) => setF({ ...f, valid_from: e.target.value })} />
        </label>
        <label className="text-caption text-fg-muted">Rate *
          <input className={dialogField} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
        </label>
        <label className="text-caption text-fg-muted">Per (conversion factor)
          <input className={dialogField} inputMode="numeric" value={f.factor} onChange={(e) => setF({ ...f, factor: e.target.value })} />
        </label>
      </div>
      <p className="mt-3 text-micro text-fg-subtle">
        A pair is quoted in one direction only; the reverse is computed. A rate for the same pair and
        date cannot be entered twice — correcting one is an administrator action.
      </p>
    </Dialog>
  );
}

function CorrectRateDialog({ rate, onClose, onSaved }: { rate: any; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(String(rate.rate));
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => api.put(`/finance/exchange-rates/${rate.id}`, { rate: Number(value) }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not correct the rate.')),
  });

  return (
    <Dialog
      title={`Correct ${rate.pair.from_currency_code}→${rate.pair.to_currency_code} from ${String(rate.valid_from).slice(0, 10)}`}
      description="Administrators only. Documents already posted keep the rate they were posted with."
      onClose={onClose} error={error} blockedReason={!(Number(value) > 0) ? 'The rate must be greater than zero.' : null}
      submitLabel="Save correction" submitting={save.isPending} onSubmit={() => save.mutate()}
    >
      <label className="text-caption text-fg-muted">Rate *
        <input className={dialogField} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
    </Dialog>
  );
}
