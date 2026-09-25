import { Check } from 'lucide-react';

import { CtaLink } from '@/app/(landing)/_components/CtaLink';

import { DEMO_EMAIL, SECTION_IDS } from '@/app/(landing)/content';
import type { LandingDictionary } from '@/app/(landing)/i18n/types';

export function Hero({ t }: { t: LandingDictionary }) {
  return (
    <section className="relative flex min-h-[calc(100svh-4rem)] items-center">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div className="max-w-3xl lg:w-3/5">
          <p className="text-caption font-medium uppercase tracking-widest text-accent">
            {t.hero.eyebrow}
          </p>
          <h1 className="mt-4 text-hero font-semibold text-fg">{t.hero.title}</h1>
          <p className="mt-6 max-w-xl text-lead text-fg-muted">{t.hero.subtitle}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <CtaLink href={`mailto:${DEMO_EMAIL}`} variant="primary" size="lg">
              {t.hero.primary}
            </CtaLink>
            <CtaLink href={`#${SECTION_IDS.how}`} variant="outline" size="lg">
              {t.hero.secondary}
            </CtaLink>
          </div>
          <ul className="mt-8 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6">
            {t.hero.proof.map((line) => (
              <li key={line} className="flex items-center gap-2 text-caption text-fg-muted">
                <Check aria-hidden className="h-4 w-4 text-accent" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
