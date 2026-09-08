/**
 * Tax-preview STATE RULES — pure. This module imports nothing.
 *
 * It is separated from `useTaxPreview.ts` for the same reason
 * `backend/src/shared/services/numberSequenceRules.ts` is separated from the
 * service that uses it: every decision here is about whether a customer-facing
 * document may be produced, so all of it has to be checkable on its own, without
 * React, React Query, a browser or a network.
 *
 * The hook supplies the inputs and owns the effects. It contributes no rules.
 */

export interface TaxPreviewLine {
  code:     string;
  tax_type: string;
  base:     number;
  rate:     number;
  amount:   number;
}

export interface TaxPreview {
  subtotal: number;
  vat:      number;
  turnover: number;
  total:    number;
  /** One row per tax code that actually applied. Empty on the LEGACY fallback. */
  lines:    TaxPreviewLine[];
  /** LEGACY means the tenant has no tax engine configured and `Tenant.tax_config` answered. */
  source:   'ENGINE' | 'LEGACY';
}

export type TaxPreviewStatus =
  /** Disabled, or the amount is not something to preview (zero, blank, invalid). */
  | 'idle'
  /** In flight, or the amount/tenant has changed and the answer has not caught up. */
  | 'loading'
  /** `tax` describes exactly the amount that was asked about. */
  | 'ready'
  /** The engine could not be reached or refused. There is no figure. */
  | 'error';

/**
 * A tax code's rate, as a label: `0.13` → `13%`, `0.085` → `8.5%`.
 *
 * Shared so that every surface renders a rate the same way, and so that none of
 * them writes `13%` as a literal again. Trailing zeros are dropped because a
 * rate is a configured number, not a currency amount — `13.00%` reads as
 * spurious precision on a receipt.
 */
export function formatRate(rate: number): string {
  return `${Number((rate * 100).toFixed(2))}%`;
}

/**
 * The same rule the backend's `TaxPreviewQuerySchema` enforces, applied on the
 * client so a request that would certainly be refused is never sent.
 */
export function isPreviewableAmount(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function taxPreviewErrorMessage(err: unknown): string {
  const response = (err as { response?: { data?: { error?: { message?: string } } } })?.response;
  return (
    response?.data?.error?.message ??
    'The tax for this amount could not be calculated. The figure is not being shown rather than ' +
      'being guessed.'
  );
}

/** Everything the decision depends on, with nothing React-shaped in it. */
export interface TaxPreviewInputs {
  /** The consumer's own gate — a closed form, a document that needs no preview. */
  enabled: boolean;
  /** Null while unresolved (first render) or signed out. */
  tenantId: string | null;
  /** The amount being asked about right now. */
  amount: number;
  /** The amount the query key currently points at. */
  debouncedAmount: number;
  /** React Query's error flag. TRUE even when earlier data is still retained. */
  queryIsError: boolean;
  queryError: unknown;
  /** React Query's retained data, if any. May belong to a PREVIOUS amount. */
  queryData: TaxPreview | null;
  /**
   * Whether a request is in flight RIGHT NOW — React Query's `isFetching`,
   * equivalently `fetchStatus === 'fetching'`.
   *
   * This is not the same question as `queryData === null`. React Query keeps the
   * previous result while it refetches, so a remount, a window-focus refresh
   * after `staleTime` has elapsed, an invalidation or a manual retry all leave
   * data in hand while its replacement is still unresolved. Without this input
   * the decision cannot tell "answered" from "being re-asked".
   */
  queryIsFetching: boolean;
}

export interface TaxPreviewDecision {
  status: TaxPreviewStatus;
  /** Null unless `status === 'ready'`. There is no zero-valued stand-in. */
  tax: TaxPreview | null;
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
  /**
   * Whether a request may legitimately be issued or RETRIED right now. False
   * mid-debounce, so a retry cannot refresh an amount the user has typed past.
   */
  active: boolean;
}

/**
 * Whether a request may be sent at all.
 *
 * `tenantId !== null` is part of it: the query is keyed by tenant, and running
 * before that identity resolves would either mint an entry under a null tenant
 * or, worse, let one tenant's entry answer another's question.
 *
 * The debounce equality is the other half: while the debounced amount has not
 * caught up, the key points at the PREVIOUS amount, and neither a fetch nor a
 * retry against it means anything to the user.
 */
export function canRequest(i: Pick<TaxPreviewInputs, 'enabled' | 'tenantId' | 'amount' | 'debouncedAmount'>): boolean {
  return (
    i.enabled &&
    i.tenantId !== null &&
    isPreviewableAmount(i.amount) &&
    isPreviewableAmount(i.debouncedAmount) &&
    i.debouncedAmount === i.amount
  );
}

/**
 * The state a consumer sees.
 *
 * ── Order of the branches is the safety property ───────────────────────────
 *
 * 1. `idle` — the consumer switched this off, or there is no amount to price.
 *    Not an error and not a wait: there is simply nothing to ask.
 *
 * 2. `loading` while a request is IN FLIGHT — checked before both the error flag
 *    and any data. React Query retains the previous result while it refetches,
 *    so a focus refresh once `staleTime` has elapsed, a remount, an
 *    invalidation or a manual retry all leave a figure in hand whose replacement
 *    is still unresolved. Reporting `ready` there let `SalesOrderPDFButton`
 *    generate a customer-facing PDF from tax that was at that moment being
 *    re-asked — and might come back different, or fail outright. An unresolved
 *    figure is not a figure.
 *
 *    Ahead of `error` on purpose: while a retry is running, the previous failure
 *    is no longer the current truth, and a consumer showing "calculating" is
 *    describing what is actually happening. Both branches expose `tax: null`, so
 *    no safety property turns on which of the two wins.
 *
 * 3. `error` — checked before any data. React Query RETAINS `data` when a
 *    refetch fails: the status becomes 'error' while the previous successful
 *    result stays in the cache. Reading data first reported `ready`, hid the
 *    failure, and let the PDF button build a document from a figure whose
 *    refresh had failed. `tax` is null here whatever the cache still holds, so
 *    the only route back to a document is a retry that actually succeeds.
 *
 * 4. `ready` — data, settled, a resolved tenant, and nothing in flight. Between
 *    a keystroke and the debounce firing, the result in hand describes the
 *    previous amount and must not be presented as this one's.
 *
 *    The tenant condition is belt-and-braces rather than strictly necessary
 *    today: the tenant is part of the query key, so signing out changes the key
 *    and React Query has no data for the new one. But this rule must be safe on
 *    its own — it is the thing that decides whether a customer-facing document
 *    may be produced, and it must not depend on somebody remembering to keep the
 *    tenant in the key. With it, a figure computed for one session can never be
 *    presented in another, whatever the cache holds.
 *
 * 5. `loading` — everything else, including the window before the tenant
 *    identity resolves. That is a wait, not an absence of tax; reporting `idle`
 *    there would tell a consumer there is nothing to price.
 */
export function deriveTaxPreviewState(i: TaxPreviewInputs): TaxPreviewDecision {
  const active = canRequest(i);
  const settled = i.debouncedAmount === i.amount;

  if (!i.enabled || !isPreviewableAmount(i.amount)) {
    return { status: 'idle', tax: null, isReady: false, isLoading: false, error: null, active };
  }

  // In flight beats everything below it. Retained data is not an answer while
  // its replacement is being fetched, and a stale failure is not the current
  // truth while a retry is running.
  if (i.queryIsFetching) {
    return { status: 'loading', tax: null, isReady: false, isLoading: true, error: null, active };
  }

  if (i.queryIsError) {
    return {
      status: 'error',
      tax: null,
      isReady: false,
      isLoading: false,
      error: taxPreviewErrorMessage(i.queryError),
      active,
    };
  }

  if (settled && i.tenantId !== null && i.queryData) {
    return {
      status: 'ready',
      tax: i.queryData,
      isReady: true,
      isLoading: false,
      error: null,
      active,
    };
  }

  return { status: 'loading', tax: null, isReady: false, isLoading: true, error: null, active };
}
