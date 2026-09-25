import { DEMO_EMAIL } from '@/app/(landing)/content';

import { CtaLink } from '@/app/(landing)/_components/CtaLink';

import { Reveal } from '@/app/(landing)/_components/Reveal';

import type { LandingDictionary } from '@/app/(landing)/i18n/types';

/** Final CTA: the closing offer to reach out. */
export function FinalCta({ t }: { t: LandingDictionary }) {
  return (
    <section className="py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <div className="mx-auto max-w-3xl rounded-surface border border-border bg-surface/60 backdrop-blur-md p-10 text-center sm:p-16">
            <h2 className="text-section font-semibold text-fg">{t.finalCta.title}</h2>
            <p className="mx-auto mt-4 max-w-xl text-lead text-fg-muted">{t.finalCta.body}</p>
            <div className="mt-8">
              <CtaLink href={`mailto:${DEMO_EMAIL}`} variant="primary" size="lg">
                {t.finalCta.primary}
              </CtaLink>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
