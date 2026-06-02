/**
 * Currency and number formatting utilities.
 * Uses Intl.NumberFormat for locale-aware formatting.
 */

export function formatCurrency(
  amount: number,
  currencyCode = 'USD',
  locale = 'en-US'
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style:                 'currency',
      currency:              currencyCode,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback for unknown currency codes
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

export function formatNumber(amount: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}
