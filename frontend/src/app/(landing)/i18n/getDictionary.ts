/** The locale copy objects, keyed by locale. */
import type { LandingDictionary, Locale } from './types';
import { es } from './es';
import { en } from './en';
import { tr } from './tr';

const DICTIONARIES: Record<Locale, LandingDictionary> = { en, tr, es };

/**
 * Return the landing copy for the given locale.
 */
export function getDictionary(locale: Locale): LandingDictionary {
  return DICTIONARIES[locale];
}
