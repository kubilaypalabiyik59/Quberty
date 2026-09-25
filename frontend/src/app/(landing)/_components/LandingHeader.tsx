import Link from 'next/link';
import { QubertyWordmark } from '@/components/brand/QubertyWordmark';
import { LanguageSwitcher } from '@/app/(landing)/_components/LanguageSwitcher';
import { CtaLink } from '@/app/(landing)/_components/CtaLink';
import type { LandingDictionary, Locale } from '@/app/(landing)/i18n/types';
import { DEMO_EMAIL, SECTION_IDS } from '@/app/(landing)/content';

/** The sticky landing header with wordmark, nav, switcher and CTAs. */
export function LandingHeader({ t, locale }: { t: LandingDictionary; locale: Locale }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/70 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Quberty">
          <QubertyWordmark sweep="once" className="text-lg" />
        </Link>
        <nav aria-label={t.nav.product} className="hidden items-center gap-6 md:flex">
          <a href={`#${SECTION_IDS.product}`} className="text-body text-fg-muted transition-colors duration-quick hover:text-fg">
            {t.nav.product}
          </a>
          <a href={`#${SECTION_IDS.capabilities}`} className="text-body text-fg-muted transition-colors duration-quick hover:text-fg">
            {t.nav.capabilities}
          </a>
          <a href={`#${SECTION_IDS.how}`} className="text-body text-fg-muted transition-colors duration-quick hover:text-fg">
            {t.nav.how}
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <LanguageSwitcher locale={locale} label={t.nav.languageLabel} />
          <CtaLink href="/login" variant="ghost" className="hidden sm:inline-flex">
            {t.nav.signIn}
          </CtaLink>
          <CtaLink href={`mailto:${DEMO_EMAIL}`} variant="primary" className="hidden sm:inline-flex">
            {t.nav.demo}
          </CtaLink>
        </div>
      </div>
    </header>
  );
}
