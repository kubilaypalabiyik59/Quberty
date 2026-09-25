/**
 * Money formatting.
 *
 * There is deliberately **no default currency**. Every screen gets the tenant's
 * currency from `CurrencyProvider`, which reads it from the ledger; a component
 * that has not been given one renders no amount rather than an unqualified number
 * or somebody else's symbol. The old `formatCurrency(amount, currencyCode = 'USD')`
 * had exactly one consumer — its own definition — because every page ignored it in
 * favour of a `Bs.` literal, and that is the hard-coding WORK-025 removes.
 *
 * The number of decimals comes from the currency's own rounding precision, which
 * Finance configures per currency (0.01 → 2, 1 → 0). The symbol, when Finance has
 * configured one, wins over the one Intl would pick: it is data the tenant owns.
 */

export interface TenantCurrency {
  code: string;
  symbol: string | null;
  /** Decimal string, e.g. "0.0100". */
  rounding_precision: string | number;
  rounding_method: string;
  /** BCP 47 tag, e.g. `es-BO`: the tenant's language and, when set, its country. */
  locale: string;
}

/**
 * A locale Intl will accept, or `undefined` (the browser's own).
 *
 * `Tenant.language` is free text on older tenants, and `toLocaleString('es_BO')`
 * throws a RangeError — which, called during render, took down every page that
 * shows an amount, the till included. A bad locale must degrade, never crash.
 */
export function safeLocale(locale: string | null | undefined): string | undefined {
  if (!locale) return undefined;
  try {
    return Intl.getCanonicalLocales(locale)[0];
  } catch {
    return undefined;
  }
}

export function fractionDigits(precision: string | number): number {
  const text = String(precision);
  const dot = text.indexOf('.');
  if (dot === -1) return 0;
  const decimals = text.slice(dot + 1).replace(/0+$/, '');
  return decimals.length;
}

/**
 * `1299.5` in a BOB tenant whose locale is `es-BO` and symbol `Bs.` → `Bs. 1.299,50`;
 * in a TRY tenant (`tr-TR`, `₺`) → `₺1.299,50`.
 */
export function formatMoney(amount: number | string | null | undefined, currency: TenantCurrency): string {
  const value = Number(amount ?? 0);
  const digits = fractionDigits(currency.rounding_precision);
  const locale = safeLocale(currency.locale);
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).formatToParts(value);
    const symbol = currency.symbol?.trim();
    return parts.map((p) => (p.type === 'currency' && symbol ? symbol : p.value)).join('');
  } catch {
    // A currency Intl does not carry: still qualified, never a bare number.
    const formatted = value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return `${currency.symbol ?? currency.code} ${formatted}`;
  }
}

/** The amount alone, for table cells that carry the currency in their header. */
export function formatAmount(amount: number | string | null | undefined, currency: TenantCurrency): string {
  const digits = fractionDigits(currency.rounding_precision);
  return Number(amount ?? 0).toLocaleString(safeLocale(currency.locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
