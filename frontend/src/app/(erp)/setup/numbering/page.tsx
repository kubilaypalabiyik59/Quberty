'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AlertTriangle, Lock } from 'lucide-react';
import { dialogField, apiErrorMessage } from '@/components/erp/Dialog';
import { PageHeader, ErrorNote } from '@/components/erp/PageHeader';

/**
 * Number sequences — how every document in the system gets its number.
 *
 * **[OFFICIAL]** D365 puts both of the switches on this page on the SEQUENCE
 * itself rather than in a module parameter: "On the General FastTab, specify
 * whether the number sequence is manual, and continuous or non-continuous."
 * learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/organization-administration/tasks/set-up-number-sequences-individual-basis
 *
 * That placement is the point, not a detail. It is what lets the legal invoice
 * series be entered by hand from pre-printed stock while credit notes stay
 * automatic, in the same tenant, without a second setting to keep in sync.
 *
 * ── Why this page had to exist ─────────────────────────────────────────────
 * Migration 023 handed the factura series to this framework. Before it, three
 * modules each kept their own copy of a raw counter query and none of the
 * behaviour was configurable at all. Moving the legal series into a framework
 * that could only be edited by running a script would have been a downgrade —
 * a capability is not a product feature until somebody can configure it without
 * the repository.
 *
 * ── Why the warnings are shown before the switch, not after ────────────────
 * Every field here can break document creation at the till, and the damage is
 * not symmetrical: a series that resumes too LOW hands out a number the unique
 * constraint rejects, and the failure surfaces to a cashier mid-sale. So the
 * screen states the cost next to the control, and the API refuses the
 * unrecoverable case outright rather than trusting the warning to be read.
 */

/** Only these are safe to describe; anything else is shown verbatim. */
const REFERENCE_NOTES: Record<string, string> = {
  FACTURA:
    'The legal invoice series. Bolivian law may require this to be gapless — that question is still open, so it ships continuous, which is the safe direction.',
  CREDIT_NOTE: 'Notas de crédito. Not yet wired: returns currently draw from the factura series.',
  JOURNAL_VOUCHER: 'General ledger vouchers. One series for every posting in the system.',
};

export default function NumberingSetupPage() {
  const qc = useQueryClient();
  const [error, setError] = useState('');

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['number-sequences'],
    queryFn: () => api.get('/setup/number-sequences').then((r) => r.data.data ?? []),
  });

  const save = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) =>
      api.put(`/setup/number-sequences/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['number-sequences'] });
      setError('');
    },
    onError: (e: any) => setError(apiErrorMessage(e, 'Could not save the number sequence.')),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Number sequences"
        subtitle="How each document gets its number — and which ones a person types instead"
      />

      <ErrorNote message={error || (loadError ? 'Could not load number sequences.' : '')} />

      {isLoading && <div className="text-caption text-fg-muted">Loading…</div>}

      <div className="space-y-4">
        {(data ?? []).map((s: any) => (
          <SequenceCard
            key={s.id}
            seq={s}
            saving={save.isPending}
            onSave={(body) => save.mutate({ id: s.id, body })}
          />
        ))}
      </div>
    </div>
  );
}

function SequenceCard({
  seq,
  saving,
  onSave,
}: {
  seq: any;
  saving: boolean;
  onSave: (body: any) => void;
}) {
  const [format, setFormat] = useState<string>(seq.format);
  const [nextNumber, setNextNumber] = useState<string>(String(seq.next_number));

  const formatDirty = format !== seq.format;
  const nextDirty = nextNumber !== String(seq.next_number);

  // Only meaningful while the format renders digits. A series carrying a prefix
  // cannot be compared to a counter, so the hint is withheld rather than guessed.
  const issued: string | null = seq.highest_issued ?? null;
  const comparable = !!issued && /^\d+$/.test(issued);
  const behind =
    comparable && !seq.manual && Number(nextNumber) <= Number(issued);

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <span className="font-mono text-body font-medium text-fg">{seq.reference}</span>
          <span className="ml-2 text-caption text-fg-muted">{seq.name}</span>
        </div>
        <span className="font-mono text-caption text-fg-muted">
          next: {seq.manual ? '— typed —' : seq.preview}
        </span>
      </div>

      {REFERENCE_NOTES[seq.reference] && (
        <p className="mb-3 text-caption text-fg-muted">{REFERENCE_NOTES[seq.reference]}</p>
      )}

      <div className="space-y-3">
        {/* ── The switch Kubi asked for ─────────────────────────────────── */}
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-1"
            checked={seq.manual}
            disabled={saving}
            onChange={(e) => onSave({ manual: e.target.checked })}
          />
          <span className="text-caption">
            <span className="text-fg">Numbers are entered by hand</span>
            <span className="block text-fg-muted">
              {seq.manual
                ? 'Whoever creates the document types the number, and this counter is left alone. For pre-printed or authority-issued stock.'
                : 'The system generates each number from the format below. Turn this on only if the numbers come from somewhere outside this system.'}
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-1"
            checked={seq.continuous}
            disabled={saving || seq.manual}
            onChange={(e) => onSave({ continuous: e.target.checked })}
          />
          <span className="text-caption">
            <span className="text-fg">No gaps allowed (continuous)</span>
            <span className="block text-fg-muted">
              The number is held until the document commits, so a failed document returns it instead
              of burning it. Costs a lock for the length of each transaction — required where the law
              demands an unbroken series, unnecessary otherwise.
              {seq.manual && ' Not applicable while numbers are typed by hand.'}
            </span>
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-caption text-fg-muted">
            Format
            <input
              className={dialogField}
              value={format}
              disabled={saving || seq.manual}
              onChange={(e) => setFormat(e.target.value)}
              onBlur={() => formatDirty && onSave({ format })}
            />
            <span className="mt-1 block text-micro text-fg-muted">
              <span className="font-mono">{'{YYYY}'}</span> is the year,{' '}
              <span className="font-mono">{'{######}'}</span> the counter padded to that many digits.
            </span>
          </label>

          <label className="text-caption text-fg-muted">
            Next number
            <input
              className={dialogField}
              type="number"
              min={1}
              value={nextNumber}
              disabled={saving || seq.manual}
              onChange={(e) => setNextNumber(e.target.value)}
              onBlur={() => nextDirty && onSave({ next_number: Number(nextNumber) })}
            />
            {comparable && (
              <span className="mt-1 block text-micro text-fg-muted">
                Highest already issued: <span className="font-mono">{issued}</span>
              </span>
            )}
          </label>
        </div>

        {behind && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/50 bg-danger/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <span className="text-caption text-fg">
              {issued} has already been issued. Resuming at {nextNumber} would produce a duplicate and
              the next document would be refused — at the till, if this is the factura series. Resume
              at {Number(issued) + 1} or higher.
            </span>
          </div>
        )}

        {seq.manual && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span className="text-caption text-fg">
              While this is on, the format and counter are not used and are left exactly as they are.
              Switching back to automatic does not re-derive the counter — set{' '}
              <span className="font-medium">Next number</span> deliberately, above what has been
              issued.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
