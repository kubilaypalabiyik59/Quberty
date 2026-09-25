'use client';

import { useRouter } from 'next/navigation';
import { LOCALES, type Locale } from '@/app/(landing)/i18n/types';
import { LANG_COOKIE } from '@/app/(landing)/content';
import { cn } from '@/lib/utils';

/** A button group for switching the UI language. */
export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();

  return (
    <div role="group" aria-label={label} className="inline-flex rounded-control border border-border p-0.5">
      {LOCALES.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            lang={l}
            aria-pressed={active}
            className={cn(
              'rounded-control px-2 py-1 text-caption font-medium transition-colors duration-quick',
              active && 'bg-surface-raised text-fg',
              !active && 'text-fg-muted hover:text-fg'
            )}
            onClick={() => {
              if (l === locale) return;
              document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
              router.replace(`/?lang=${l}`, { scroll: false });
            }}
          >
            {l.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
