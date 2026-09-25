import { cookies, headers } from 'next/headers';
import { LANG_COOKIE } from '../content';
import { isLocale, type Locale } from './types';

/**
 * Reduce an `Accept-Language` header to the most preferred supported locale,
 * or `undefined` when nothing supported is present.
 *
 * Entries are split on commas, weighted by their `q=` value (default 1, non-
 * numeric weights treated as 0), sorted by weight descending while preserving
 * the original header order for ties, then each tag is reduced to its primary
 * subtag (lower-cased) and matched against the supported locales.
 */
export function pickFromAcceptLanguage(header: string | null): Locale | undefined {
  if (!header) {
    return undefined;
  }

  const parsed = header
    .split(',')
    .map((entry) => {
      const [tag, ...rest] = entry.trim().split(';');
      const qPart = rest.join(';').trim();
      const qMatch = qPart.match(/^q=(.+)$/);
      const weight = qMatch
        ? Number.isNaN(Number(qMatch[1].trim()))
          ? 0
          : Number(qMatch[1].trim())
        : 1;
      if (weight === 0) {
        return null;
      }
      const primary = tag.split('-')[0].trim().toLowerCase();
      return { primary, weight };
    })
    .filter((entry): entry is { primary: string; weight: number } => entry !== null)
    .sort((a, b) => b.weight - a.weight);

  const matchIndex = parsed.findIndex((entry) => isLocale(entry.primary));
  const match = matchIndex >= 0 ? parsed[matchIndex] : undefined;
  return match ? match.primary as Locale : undefined;
}

/**
 * Resolve the active locale from the search params, the shared-language cookie,
 * and finally the `Accept-Language` header, falling back to `'en'`.
 */
export function getLocale(searchParams: { lang?: string | string[] }): Locale {
  const fromSearch = Array.isArray(searchParams.lang) ? searchParams.lang[0] : searchParams.lang;
  if (fromSearch && isLocale(fromSearch.trim().toLowerCase())) {
    return fromSearch.trim().toLowerCase() as Locale;
  }

  const fromCookie = cookies().get(LANG_COOKIE)?.value;
  if (fromCookie && isLocale(fromCookie.trim().toLowerCase())) {
    return fromCookie.trim().toLowerCase() as Locale;
  }

  const fromHeader = pickFromAcceptLanguage(headers().get('accept-language'));
  if (fromHeader) {
    return fromHeader;
  }

  return 'en';
}
