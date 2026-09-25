import type { Metadata } from 'next';

import { LandingStage } from '@/app/(landing)/_components/LandingStage';
import { Capabilities } from '@/app/(landing)/_components/Capabilities';
import { FinalCta } from '@/app/(landing)/_components/FinalCta';
import { Flows } from '@/app/(landing)/_components/Flows';
import { Foundation } from '@/app/(landing)/_components/Foundation';
import { Hero } from '@/app/(landing)/_components/Hero';
import { LandingFooter } from '@/app/(landing)/_components/LandingFooter';
import { LandingHeader } from '@/app/(landing)/_components/LandingHeader';
import { OneSystem } from '@/app/(landing)/_components/OneSystem';
import { Problem } from '@/app/(landing)/_components/Problem';
import { getDictionary } from '@/app/(landing)/i18n/getDictionary';
import { getLocale } from '@/app/(landing)/i18n/getLocale';

type LandingPageProps = { searchParams: { lang?: string | string[] } };

/** Page title and description in the visitor's language. */
export function generateMetadata({ searchParams }: LandingPageProps): Metadata {
  const t = getDictionary(getLocale(searchParams));
  return { title: t.meta.title, description: t.meta.description };
}

/**
 * The public product page at `/`. Always dark, whatever theme the app uses: the `dark` class
 * rescopes the design tokens for this subtree. The brand stage is `position: fixed` behind
 * everything. The hero is transparent over it, and every later section is opaque.
 */
export default function LandingPage({ searchParams }: LandingPageProps) {
  const locale = getLocale(searchParams);
  const t = getDictionary(locale);

  return (
    <div lang={locale} className="dark relative min-h-screen bg-bg text-fg">
      <LandingStage />
      <LandingHeader t={t} locale={locale} />
      <main className="relative">
        <Hero t={t} />
        <Problem t={t} />
        <OneSystem t={t} />
        <Capabilities t={t} />
        <Flows t={t} />
        <Foundation t={t} />
        <FinalCta t={t} />
      </main>
      <LandingFooter t={t} />
    </div>
  );
}
