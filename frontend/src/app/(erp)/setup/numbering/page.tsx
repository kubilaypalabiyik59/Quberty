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

/**
 * TEMPORARY — the Android POS package does not send `factura_number`, so manual
 * FACTURA numbering stops that till completing sales. The ERP and the web POS
 * both support it.
 *
 * This is a DEPLOYMENT blocker for switching a tenant to manual numbering, not a
 * blocker on this branch. Flip to `false` and delete the warning block below
 * when the separate Android work item lands; nothing else reads this.
 */
const ANDROID_POS_MANUAL_UNSUPPORTED = true;

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

  // The server decides whether the issued numbers can be ordered at all — it is
  // the only side that can see every one of them. This screen must never derive
  // that from the single value it was handed: a lexicographic maximum looks like
  // a perfectly good number, and '99' beats '100'.
  const issued: string | null = seq.highest_issued ?? null;
  const issuedNumeric: number | null = seq.highest_issued_numeric ?? null;
  const comparable = seq.highest_issued_comparable !== false && issued !== null;
  const nonComparable = seq.highest_issued_comparable === false;
  const minimumNext: number | null = seq.minimum_next_number ?? null;

  // Below the server's minimum is a duplicate waiting to happen, whichever mode
  // the sequence is in right now — it is the number the counter would resume
  // from the moment it becomes automatic.
  const belowMinimum =
    minimumNext !== null && nextNumber !== '' && Number(nextNumber) < minimumNext;
  const behind = belowMinimum && !seq.manual;

  // Returning to automatic after hand-typed numbers: possible, but only when a
  // person states the series and takes responsibility for it.
  const needsAck = seq.automatic_resume_requires_acknowledgement === true;
  const automaticImpossible = seq.automatic_resume_possible === false;
  const [acknowledged, setAcknowledged] = useState(false);

  /**
   * The acknowledgement is a statement about ONE request — that a person has
   * just looked at the issued invoices and chosen a resumption point — so it
   * must not survive the thing it was given for.
   *
   * The bug: this card is keyed by `seq.id` and survives every refetch, so after
   * a completed manual → automatic → manual cycle `acknowledged` was still true.
   * The switch would then be enabled immediately, and clicking it would send
   * `acknowledge_unverifiable_resume: true` for a decision nobody had made this
   * time — with a DIFFERENT set of issued invoices behind it, since going manual
   * again is precisely how new hand-typed numbers get issued.
   *
   * Reset on the identity the acknowledgement was about — the row, its mode, and
   * what the server currently says about resuming it — adjusted DURING RENDER so
   * the stale `true` is never committed, not in an effect that runs after a
   * paint in which the button is already live.
   */
  const ackSubject = `${seq.id}|${seq.manual}|${seq.automatic_resume_code}`;
  const [prevAckSubject, setPrevAckSubject] = useState(ackSubject);
  if (ackSubject !== prevAckSubject) {
    setPrevAckSubject(ackSubject);
    setAcknowledged(false);
  }

  /**
   * Turning manual OFF. On a non-comparable history the API requires the
   * acknowledgement AND both values in the same request, so they are sent
   * together rather than relying on whatever happens to be stored.
   */
  const switchToAutomatic = () => {
    // Belt and braces against a stale tick: the checkbox is also disabled while
    // `needsAck && !acknowledged`, but a request that CLAIMS an acknowledgement
    // nobody gave is the one thing this screen must never send.
    if (needsAck && !acknowledged) return;
    if (needsAck) {
      onSave({
        manual: false,
        format,
        next_number: Number(nextNumber),
        acknowledge_unverifiable_resume: true,
      });
      return;
    }
    onSave({ manual: false });
  };

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
            // Blocked only where returning to automatic is genuinely impossible,
            // or where it needs a confirmation that has not been given yet.
            disabled={
              saving ||
              (seq.manual && automaticImpossible) ||
              (seq.manual && needsAck && !acknowledged)
            }
            onChange={(e) => (e.target.checked ? onSave({ manual: true }) : switchToAutomatic())}
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

        {/* ────────────────────────────────────────────────────────────────
            TEMPORARY COMPATIBILITY WARNING — Android POS
            Remove this block, and ANDROID_POS_MANUAL_UNSUPPORTED above, once the
            separate Android POS work item adds factura_number to that package.
            Nothing else depends on either.
            ──────────────────────────────────────────────────────────────── */}
        {ANDROID_POS_MANUAL_UNSUPPORTED && seq.reference === 'FACTURA' && (
          <div className="ml-6 flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span className="text-caption text-fg">
              <span className="font-medium">The Android till cannot do this yet.</span> Manual
              invoice numbering works in the ERP and in the web POS. The Android POS package
              currently installed on the tablets does not send a typed number, so turning this on
              will stop that till completing sales until it is updated.
            </span>
          </div>
        )}

        {/* Genuinely impossible, and no confirmation can change it: either the
            counter column cannot hold a value above what has been issued
            (COUNTER_LIMIT_REACHED), or the series resets yearly and its issued
            history cannot be read at all (FISCAL_YEAR_RESUME_UNSUPPORTED).

            Worded by CURRENT mode, because the two are different warnings. On a
            manual series it is a wall; on an automatic one it is a one-way door,
            and saying "cannot be switched back" about a series that is already
            automatic would read as though it were broken. */}
        {seq.reference === 'FACTURA' && automaticImpossible && (
          <div className="ml-6 flex items-start gap-2 rounded-lg border border-danger/50 bg-danger/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <span className="text-caption text-fg">
              <span className="font-medium">
                {seq.manual
                  ? 'This series cannot be switched back to automatic.'
                  : 'Switching this series to manual would be one-way — it could not be switched back.'}
              </span>{' '}
              {seq.automatic_resume_reason}
            </span>
          </div>
        )}

        {/* Possible, but the system will not choose the resumption point. A
            person who has checked the issued documents must. */}
        {seq.reference === 'FACTURA' && seq.manual && needsAck && (
          <div className="ml-6 space-y-2 rounded-lg border border-warning/50 bg-warning/10 p-3">
            <p className="text-caption text-fg">{seq.automatic_resume_reason}</p>
            <p className="text-caption text-fg-muted">
              Set the format and the next number above first — they are sent with this confirmation,
              not read from what is stored.
            </p>
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-1"
                checked={acknowledged}
                disabled={saving}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              <span className="text-caption text-fg">
                I have checked the invoices already issued by hand. They cannot be ordered against
                the counter below, and I accept responsibility for the format and next number I have
                chosen for this series.
              </span>
            </label>
          </div>
        )}

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
              // Editable while manual ON PURPOSE. Preparing a valid automatic
              // format is a prerequisite for going back to automatic, so
              // disabling it here made the instruction to "set them deliberately
              // first" impossible to follow. Saving a format allocates nothing.
              disabled={saving}
              onChange={(e) => setFormat(e.target.value)}
              onBlur={() => formatDirty && onSave({ format })}
            />
            <span className="mt-1 block text-micro text-fg-muted">
              <span className="font-mono">{'{YYYY}'}</span> is the year,{' '}
              <span className="font-mono">{'{######}'}</span> the counter padded to that many digits.
              {seq.manual && ' Prepare this before switching back to automatic.'}
            </span>
          </label>

          <label className="text-caption text-fg-muted">
            Next number
            <input
              className={dialogField}
              type="number"
              min={minimumNext ?? 1}
              value={nextNumber}
              // Editable while manual for the same reason. Writing the counter
              // does not consume or advance it — nothing is allocated here.
              disabled={saving}
              onChange={(e) => setNextNumber(e.target.value)}
              onBlur={() => nextDirty && !belowMinimum && onSave({ next_number: Number(nextNumber) })}
            />
            {minimumNext !== null && (
              <span className="mt-1 block text-micro text-fg-muted">
                Lowest safe next number: <span className="font-mono">{minimumNext}</span>
              </span>
            )}
            {belowMinimum && (
              <span className="mt-1 block text-micro text-danger">
                {minimumNext} or higher is required — a lower value would reissue a number that
                already exists. Not saved.
              </span>
            )}
            {comparable && (
              <span className="mt-1 block text-micro text-fg-muted">
                Highest already issued: <span className="font-mono">{issued}</span>
              </span>
            )}
            {nonComparable && (
              <span className="mt-1 block text-micro text-fg-muted">
                Highest already issued: <span className="italic">cannot be determined</span> — this
                tenant has issued manually typed numbers
                {(seq.highest_issued_examples ?? []).length > 0 && (
                  <> such as <span className="font-mono">{seq.highest_issued_examples[0]}</span></>
                )}
                , which cannot be ordered against a counter. Check the issued invoices before
                resuming an automatic series.
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
              at {(issuedNumeric ?? 0) + 1} or higher.
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
