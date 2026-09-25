/** The locales this site ships copy for, in priority order. */
export const LOCALES = ['en', 'tr', 'es'] as const;

/** A supported locale string. */
export type Locale = (typeof LOCALES)[number];

/** The landing-page copy shape; derived from the English source of truth. */
import type { en } from './en';
export type LandingDictionary = typeof en;

/**
 * Type guard that accepts only the three supported locale strings.
 * `LOCALES.includes(value)` does not type-check for a `string`, so we cast.
 */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
