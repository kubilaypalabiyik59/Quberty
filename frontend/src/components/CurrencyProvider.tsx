'use client';

import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { formatMoney, formatAmount, safeLocale, type TenantCurrency } from '@/lib/money';

/**
 * The tenant's currency, once, for every screen that renders an amount.
 *
 * It comes from `GET /tenant/currency`, a read-only projection of the ledger:
 * Finance owns the value and changes it through Setup → Currencies. The route
 * needs authentication and no permission, because a cashier at the till and a
 * shopper in the storefront both see prices while neither may read the finance
 * setup.
 *
 * `money()` returns an empty string until the currency is known. That is
 * deliberate: a number with no currency, or with somebody else's symbol, is worse
 * than a blank that fills in a moment later — and it is what a `Bs.` literal did
 * to every non-Bolivian tenant.
 */

interface CurrencyContextValue {
  currency: TenantCurrency | null;
  isLoading: boolean;
  /** Amount with its currency, e.g. `Bs. 1.299,00`. Empty while unknown. */
  money: (amount: number | string | null | undefined) => string;
  /** Amount alone, for a column whose header already names the currency. */
  amount: (value: number | string | null | undefined) => string;
  /** For a header or a label: the code, e.g. `BOB`. Empty while unknown. */
  code: string;
  /**
   * Why there may be no currency. `unconfigured` (no ledger yet) and `error` are
   * not "still loading": a till that shows blank totals must say which it is.
   */
  status: 'idle' | 'loading' | 'ready' | 'unconfigured' | 'error';
  /**
   * The tenant's formatting locale, for dates and month names — the same
   * hard-coded `es-BO` sat on those too. `undefined` falls back to the browser's
   * own locale, which is the right answer while the tenant's is unknown.
   */
  locale: string | undefined;
  /**
   * A quantity, not an amount — no currency, and trailing zeros trimmed.
   * Here because eight purchase screens each carried their own `es-BO` copy of
   * it beside their money helper, and they are the same locale decision.
   */
  quantity: (value: number | string | null | undefined) => string;
  /** A date in the tenant's locale. Same reason as `quantity`. */
  date: (value: string | Date | null | undefined) => string;
}

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: null,
  isLoading: true,
  money: () => '',
  amount: () => '',
  code: '',
  status: 'idle',
  locale: undefined,
  quantity: () => '',
  date: () => '—',
});

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const tenantId = useAuthStore((s) => s.tenantId);

  const { data, isLoading, isError } = useQuery<TenantCurrency | null>({
    // The tenant is part of the key. The QueryClient outlives a client-side
    // logout, so a key without it would hand one tenant's currency to the next
    // for the whole staleTime — the reason useTaxPreview keys on it too.
    queryKey: ['tenant-currency', tenantId],
    // Only once somebody is signed in to a tenant: the route is tenant-scoped and
    // authenticated, and an anonymous call would just 401 on every page load.
    enabled: !!user && !!tenantId,
    // The ledger currency cannot change once anything has posted, so this is as
    // static as tenant data gets.
    staleTime: 60 * 60_000,
    queryFn: () => api.get('/tenant/currency').then((r) => r.data.data ?? null),
  });

  const active = !!user && !!tenantId;
  const currency = data ?? null;
  const locale = safeLocale(currency?.locale);
  const status: CurrencyContextValue['status'] = !active
    ? 'idle'
    : isLoading ? 'loading'
    : isError ? 'error'
    : currency ? 'ready' : 'unconfigured';

  const value: CurrencyContextValue = {
    currency,
    isLoading: isLoading && active,
    status,
    money: (a) => (currency ? formatMoney(a, currency) : ''),
    amount: (a) => (currency ? formatAmount(a, currency) : ''),
    code: currency?.code ?? '',
    locale,
    quantity: (v) => Number(v ?? 0).toLocaleString(locale, { maximumFractionDigits: 2 }),
    date: (v) => (v ? new Date(v).toLocaleDateString(locale) : '—'),
  };

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

/**
 * The message a money-dense screen shows when amounts cannot be rendered, or
 * null when they can (or are still on their way).
 */
export function currencyBlockingReason(status: CurrencyContextValue['status']): string | null {
  if (status === 'unconfigured') return 'The ledger currency is not set up yet — ask Finance to configure it under Setup → Currencies. No amounts can be shown until then.';
  if (status === 'error') return 'The currency could not be loaded, so amounts are hidden. Check the connection and reload.';
  return null;
}

export function useMoney() {
  return useContext(CurrencyContext);
}
