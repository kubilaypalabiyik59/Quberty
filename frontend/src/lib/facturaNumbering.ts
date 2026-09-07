'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * The one place any screen learns whether the operator must type the factura
 * number, and the one place the typed value is validated.
 *
 * ── Why this is shared rather than inferred per screen ─────────────────────
 * Migration 023 made `manual` a property of the FACTURA number sequence, so
 * exactly three parent-repository surfaces can create a legal invoice — the
 * manual factura form, the sales-order invoice form, and the web POS payment —
 * and every one of them must agree about whether a number is required. Three
 * copies of that inference would drift, and the failure mode is not cosmetic: a
 * disagreement means a cashier discovers mid-sale that the till cannot issue an
 * invoice.
 *
 * ── Fail closed ────────────────────────────────────────────────────────────
 * While the configuration is loading, or if it cannot be read at all, this
 * reports a `blockingReason` and NO screen may submit. Assuming "automatic"
 * because the answer has not arrived yet is the specific bug this exists to
 * prevent: on a manual tenant it would send a request the backend rejects, after
 * the customer has already been asked to pay.
 *
 * ── Revalidated on every open, never served from cache ─────────────────────
 * The numbering mode is a decision about a LEGAL document, and an administrator
 * can change it on another device at any moment. A cached "automatic" that is
 * merely a few minutes old is therefore not good enough: a till could reopen,
 * trust it, take the customer's money, and only then be rejected by the backend.
 *
 * So every transition from closed to open re-asks the server, and the surface
 * stays blocked until that answer arrives — even though the cached value is
 * right there. The shared query key is kept, so the three surfaces still hold
 * one cache entry and one request in flight; what is not kept is the right to
 * ACT on a stale one. While every form is closed the query is disabled, so
 * nothing polls.
 */

export const MANUAL_FACTURA_NUMBER_MAX = 40;

export interface NumberSequence {
  id:          string;
  reference:   string;
  name:        string;
  format:      string;
  manual:      boolean;
  continuous:  boolean;
  is_active:   boolean;
  next_number: number;
  preview:     string;
  /** Null when nothing is issued yet, OR when issued numbers cannot be ordered. */
  highest_issued:            string | null;
  highest_issued_numeric:    number | null;
  /** False when a manual, non-numeric number is already issued. */
  highest_issued_comparable: boolean;
  highest_issued_examples:   string[];
  /**
   * False for the two refusals no acknowledgement can override:
   * COUNTER_LIMIT_REACHED (no storable number exists) and
   * FISCAL_YEAR_RESUME_UNSUPPORTED (the system cannot read a year-scoped invoice
   * history, so there is nothing for a person to be confirming).
   */
  automatic_resume_possible: boolean;
  automatic_resume_code:
    | 'OK'
    | 'ACKNOWLEDGEMENT_REQUIRED'
    | 'COUNTER_LIMIT_REACHED'
    | 'FISCAL_YEAR_RESUME_UNSUPPORTED';
  automatic_resume_reason:   string | null;
  /** True when returning to automatic needs an explicit administrator confirmation. */
  automatic_resume_requires_acknowledgement: boolean;
  /** Never a value the counter column cannot store. Null when unknown. */
  minimum_next_number:       number | null;
}

export interface FacturaSequenceState {
  status: 'loading' | 'error' | 'ready';
  /** Null until known. Never defaulted to `false` — see "fail closed". */
  manual: boolean | null;
  sequence: NumberSequence | null;
  /** Non-null means: do not let the user submit, and show this. */
  blockingReason: string | null;
  refetch: () => void;
}

export function useFacturaSequence(enabled = true): FacturaSequenceState {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['number-sequences'],
    enabled,
    // Deliberately zero. A cached numbering mode may be DISPLAYED, but a new
    // issuance attempt must never be authorised by one — see the header.
    staleTime: 0,
    queryFn: () =>
      api.get('/setup/number-sequences').then((r) => (r.data.data ?? []) as NumberSequence[]),
  });

  // ── The gate, closed DURING RENDER rather than in an effect ───────────────
  //
  // Effects run after the first paint. If the gate were only raised in one, a
  // surface opening with a cached value would render ONCE as ready — button
  // enabled, "automatic" believed — before the revalidation had even been
  // requested. That single render is enough for a fast cashier to submit.
  //
  // So the closed→open transition is detected during render, using React's
  // documented "adjust state while rendering" pattern: React re-renders
  // immediately with the new state and never commits the stale one.
  const [prevEnabled,  setPrevEnabled]  = useState(enabled);
  const [pendingOpen,  setPendingOpen]  = useState(enabled);
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    setPendingOpen(enabled);   // opening blocks; closing releases
  }

  const revalidate = useCallback(() => {
    setPendingOpen(true);
    return qc
      // `cancelRefetch: false` joins a fetch React Query already started for
      // this key instead of aborting it and issuing a second one.
      .refetchQueries({ queryKey: ['number-sequences'] }, { cancelRefetch: false })
      .finally(() => setPendingOpen(false));
  }, [qc]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    qc.refetchQueries({ queryKey: ['number-sequences'] }, { cancelRefetch: false }).finally(() => {
      if (!cancelled) setPendingOpen(false);
    });
    return () => { cancelled = true; };
  }, [enabled, qc]);

  if (!enabled) {
    return { status: 'loading', manual: null, sequence: null, blockingReason: null, refetch: revalidate };
  }
  // `isFetching` is blocking too, not just `isPending`: a cached query is never
  // "pending", so on its own that check would let stale data through.
  if (q.isPending || q.isFetching || pendingOpen) {
    return {
      status: 'loading',
      manual: null,
      sequence: null,
      blockingReason: 'Checking how this tenant numbers its invoices…',
      refetch: revalidate,
    };
  }
  if (q.isError) {
    return {
      status: 'error',
      manual: null,
      sequence: null,
      blockingReason:
        'The invoice numbering configuration could not be read, so it is not known whether a ' +
        'number must be entered by hand. Issuing is blocked until this is resolved.',
      refetch: revalidate,
    };
  }

  const sequence = (q.data ?? []).find((s) => s.reference === 'FACTURA') ?? null;

  if (!sequence) {
    // A tenant with no FACTURA sequence cannot invoice at all; `allocateNumber`
    // throws NUMBER_SEQUENCE_MISSING. Saying so here beats saying it after submit.
    return {
      status: 'error',
      manual: null,
      sequence: null,
      blockingReason:
        'No FACTURA number sequence is configured for this tenant. Set one up under ' +
        'Setup → Number sequences before issuing an invoice.',
      refetch: revalidate,
    };
  }
  if (!sequence.is_active) {
    return {
      status: 'error',
      manual: sequence.manual,
      sequence,
      blockingReason:
        'The FACTURA number sequence is inactive, so no invoice can be issued. Reactivate it ' +
        'under Setup → Number sequences.',
      refetch: revalidate,
    };
  }

  return { status: 'ready', manual: sequence.manual, sequence, blockingReason: null, refetch: revalidate };
}

/**
 * The trim/length/emptiness rules, in one place, matching `ManualDocumentNumber`
 * in the backend schema (`z.string().trim().min(1).max(40)`). Returns null when
 * the value is acceptable.
 */
export function manualFacturaNumberError(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0) return 'The invoice number printed on the form is required.';
  if (value.length > MANUAL_FACTURA_NUMBER_MAX) {
    return `The invoice number cannot be longer than ${MANUAL_FACTURA_NUMBER_MAX} characters.`;
  }
  return null;
}

/**
 * What to send. `undefined` on an automatic series so the field is omitted from
 * the request entirely — the backend REJECTS a supplied number on an automatic
 * sequence rather than ignoring it, which is deliberate and must not be tripped
 * by a client sending an empty string.
 */
export function manualFacturaNumberPayload(manual: boolean | null, raw: string): string | undefined {
  if (manual !== true) return undefined;
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}
