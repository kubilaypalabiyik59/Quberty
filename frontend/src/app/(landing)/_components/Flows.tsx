import { ChevronDown, ChevronRight } from 'lucide-react';

import { Reveal } from '@/app/(landing)/_components/Reveal';

import { SECTION_IDS } from '@/app/(landing)/content';
import type { LandingDictionary } from '@/app/(landing)/i18n/types';

/** How section: the selling and buying flows. */
export function Flows({ t }: { t: LandingDictionary }) {
  return (
    <section id={SECTION_IDS.how} className="scroll-mt-16 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <h2 className="text-section font-semibold text-fg">{t.flows.title}</h2>
          <p className="mt-4 max-w-2xl text-lead text-fg-muted">{t.flows.intro}</p>
          {[t.flows.selling, t.flows.buying].map((flow) => (
            <div key={flow.label} className="mt-12">
              <h3 className="text-title font-semibold text-fg">{flow.label}</h3>
              <ol className="mt-4 flex flex-col items-start gap-2 md:flex-row md:flex-wrap md:items-center">
                {flow.steps.map((step, i) => (
                  <li key={step} className="flex flex-col items-start gap-2 md:flex-row md:items-center">
                    <span className="rounded-control border border-border bg-surface/60 backdrop-blur-md px-3 py-2 text-body text-fg">
                      {step}
                    </span>
                    {i < flow.steps.length - 1 && (
                      <>
                        <ChevronDown aria-hidden className="h-4 w-4 text-fg-subtle md:hidden" />
                        <ChevronRight aria-hidden className="hidden h-4 w-4 text-fg-subtle md:block" />
                      </>
                    )}
                  </li>
                ))}
              </ol>
              <p className="mt-4 max-w-2xl text-body text-fg-muted">{flow.note}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
