'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import {
  canRequest,
  deriveTaxPreviewState,
  type TaxPreview,
  type TaxPreviewStatus,
} from '@/lib/taxPreviewState';

/**
 * What the tax on an amount would be, according to the engine that will post it.
 *
 * ── Why a client must never work this out itself ───────────────────────────
 * Several screens each ran `total / 1.13` for IVA and `subtotal * 0.03` for IT.
 * That arithmetic is recorded as a DEFECT in
 * `backend/src/__tests__/tax.service.test.ts`: on Bs 1 299 it yields 149,44 /
 * 34,49 where the configured engine yields 168,87 / 38,97, because Bolivian IVA
 * is *por dentro* — Ley 843 art. 5 makes the tax part of the invoiced price, so
 * it is 13% OF that price, not 13% added to a back-computed net.
 *
 * The consequence was not cosmetic. The till, the PDF the customer keeps, the
 * factura screen and the general ledger could each describe one sale
 * differently.
 *
 * It also hardcoded Bolivia into every client. Rates live in `TaxCode` rows,
 * date-effective, per tax group ∩ item tax group — so another country, or
 * Bolivia itself after Ley 1733, is a configuration change those screens would
 * have silently ignored.
 *
 * ── What this does NOT do ──────────────────────────────────────────────────
 * It previews under TODAY's tax codes, at document-header level.
 *
 * Redisplaying a document issued under an older rate needs the split stored on
 * the document itself. `Factura` stores `iva_amount` / `it_amount` and its
 * screens read those directly — **do not use this hook there.** `SalesOrder` has
 * a single `tax_amount` column that cannot hold a split, which is why its
 * screens preview instead, and why a tax-transaction line table is the next
 * schema step.
 *
 * ── Where the rules live ───────────────────────────────────────────────────
 * Every decision about WHICH state a consumer sees is in `lib/taxPreviewState.ts`,
 * which imports nothing and is therefore checkable without React, React Query,
 * a browser or a network — the same split as the backend's
 * `numberSequenceRules.ts`. This file owns the effects: debounce, the query, and
 * the guarded retry.
 *
 * ── The six defects this design exists to prevent ──────────────────────────
 * Earlier versions of this hook had all six, and each is a real failure a
 * customer would have seen:
 *
 * 1. **A request per keystroke.** It put `amount` in the query key and relied on
 *    `staleTime` to hold the traffic down. `staleTime` only helps a key that has
 *    already been fetched — every new amount is a new key, so typing "1299" is
 *    four cache misses and four requests. Fixed by debouncing the amount before
 *    it reaches the key.
 *
 * 2. **A false zero on failure.** It returned `q.data ?? { …all zeros… }`, so an
 *    API error produced a settled-looking "no tax on this sale". A wrong figure
 *    that looks confident is worse than a blank one, and this one could reach a
 *    PDF the customer keeps. `tax` is now NULL unless the preview succeeded — a
 *    consumer cannot render zeros by forgetting to check.
 *
 * 3. **A stale amount's answer shown against a new amount.** Between a keystroke
 *    and the debounce firing, the last successful result is still in hand. It
 *    describes the PREVIOUS amount. Fixed by reporting `ready` only while the
 *    debounced amount still equals the amount being asked about.
 *
 * 4. **A cache shared across tenants.** The QueryClient is created once at module
 *    scope in `components/Providers.tsx` and survives a client-side logout and
 *    login. With a key of amount/party/product/side only, tenant A could preview
 *    an amount, the operator could sign into tenant B, and inside the five-minute
 *    `staleTime` React Query would serve tenant A's figure without calling the
 *    API at all. The tenant is now the first element of the key, and the query
 *    does not run until that identity is resolved.
 *
 * 5. **A failed refetch reported as success.** React Query keeps `data` when a
 *    later refetch fails — the status becomes 'error' while the previous result
 *    is retained. Reading data before the error flag turned that into a settled
 *    `ready`. The error branch is now evaluated first; see
 *    `deriveTaxPreviewState`.
 *
 * 6. **An IN-FLIGHT refresh reported as success.** The same retention bites one
 *    step earlier: while a refetch is running — a focus refresh once
 *    `staleTime` has elapsed, a remount, an invalidation, a retry — the previous
 *    result is still in hand and nothing had told the decision that its
 *    replacement was unresolved. `SalesOrderPDFButton` could therefore produce a
 *    customer-facing PDF from tax that was at that moment being re-asked. The
 *    real fetching state is now passed in and outranks both data and the error
 *    flag.
 */

/**
 * Long enough to swallow typing, short enough that a cashier never waits for it.
 * A preview is not a keystroke-latency surface: nothing depends on it until the
 * operator stops to read the figure.
 */
export const TAX_PREVIEW_DEBOUNCE_MS = 300;

// Re-exported so consumers keep one import for the hook and the shapes it deals
// in. The definitions live in the pure module.
export {
  formatRate,
  isPreviewableAmount,
  deriveTaxPreviewState,
  canRequest,
} from '@/lib/taxPreviewState';
export type {
  TaxPreview,
  TaxPreviewLine,
  TaxPreviewStatus,
  TaxPreviewInputs,
  TaxPreviewDecision,
} from '@/lib/taxPreviewState';

export interface TaxPreviewState {
  status: TaxPreviewStatus;
  /**
   * NULL unless `status === 'ready'`. There is deliberately no zero-valued
   * stand-in: a consumer that forgets to check gets a type error rather than a
   * confident wrong number on a customer-facing document.
   */
  tax: TaxPreview | null;
  isReady: boolean;
  isLoading: boolean;
  /** Human-readable, only when `status === 'error'`. */
  error: string | null;
  /** Ask again. A no-op unless a request is legitimate right now. */
  retry: () => void;
}

/** Trailing debounce. Starts settled, so an amount that never changes fires at once. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (debounced === value) return;
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay, debounced]);

  return debounced;
}

export function useTaxPreview(
  amount: number,
  opts: {
    partyId?: string | null;
    productId?: string | null;
    side?: 'SALES' | 'PURCHASE';
    enabled?: boolean;
  } = {},
): TaxPreviewState {
  const { partyId = null, productId = null, side = 'SALES', enabled = true } = opts;

  // Non-secret, and reactive so that a sign-out re-renders every consumer. The
  // access token is deliberately NOT read here: a credential must never reach a
  // cache key. See defect 4 above.
  const tenantId = useAuthStore((s) => s.tenantId);

  const debouncedAmount = useDebounced(amount, TAX_PREVIEW_DEBOUNCE_MS);

  const active = canRequest({ enabled, tenantId, amount, debouncedAmount });

  const q = useQuery({
    // The TENANT comes first: it is what the backend scopes the answer by, so two
    // tenants can never collide on one entry however the rest of the key is
    // shaped. Party, product and side follow, because the same amount resolves to
    // different tax for a different customer's tax group or on the purchase side.
    // Only the DEBOUNCED amount is in the key, so typing does not mint a cache
    // entry and a request per character.
    queryKey: ['tax-preview', tenantId, debouncedAmount, partyId, productId, side],
    enabled: active,
    // Tax codes change on the order of years and on nothing the user is typing,
    // so a key that has been answered stays answered.
    staleTime: 5 * 60_000,
    queryFn: () =>
      api
        .get('/finance/tax/preview', {
          params: {
            amount: debouncedAmount,
            // Omitted rather than sent empty — the backend validates these as
            // UUIDs, and "no party" is an absence, not a value.
            ...(partyId ? { party_id: partyId } : {}),
            ...(productId ? { product_id: productId } : {}),
            side,
          },
        })
        .then((r) => r.data.data as TaxPreview),
  });

  const decision = deriveTaxPreviewState({
    enabled,
    tenantId,
    amount,
    debouncedAmount,
    queryIsError: q.isError,
    queryError: q.error,
    queryData: q.data ?? null,
    // The state React Query is ACTUALLY in, not one inferred from the presence
    // of data. `isFetching` is `fetchStatus === 'fetching'`: true for the first
    // load and equally for a refetch that is replacing a result already in hand.
    // Passing it is what stops a focus refresh, a remount, an invalidation or a
    // retry from leaving the previous tax available to the PDF button while its
    // replacement is unresolved.
    queryIsFetching: q.isFetching,
  });

  // Bound to `refetch`, whose identity React Query keeps stable, so a consumer
  // can hand this straight to an onClick without re-rendering on every tick.
  //
  // Guarded, not bare. `refetch` ignores `enabled` and would happily re-run the
  // query the key currently points at — which, mid-debounce, is the PREVIOUS
  // amount. Refreshing a figure the user has already typed past is worse than no
  // retry at all, so it does nothing unless a request is legitimate right now.
  const { refetch } = q;
  const retry = useCallback(() => {
    if (!decision.active) return;
    void refetch();
  }, [decision.active, refetch]);

  return {
    status: decision.status,
    tax: decision.tax,
    isReady: decision.isReady,
    isLoading: decision.isLoading,
    error: decision.error,
    retry,
  };
}
