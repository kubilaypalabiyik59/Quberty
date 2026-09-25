import { Boxes, Clock, FileSpreadsheet } from 'lucide-react';

import { Reveal } from '@/app/(landing)/_components/Reveal';

import type { LandingDictionary } from '@/app/(landing)/i18n/types';

const ICONS = [FileSpreadsheet, Boxes, Clock] as const;

/** "Sound familiar?" section: three pains of the spreadsheet stage. */
export function Problem({ t }: { t: LandingDictionary }) {
  return (
    <section className="py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <h2 className="text-section font-semibold text-fg">{t.problem.title}</h2>
          <p className="mt-4 max-w-2xl text-lead text-fg-muted">{t.problem.intro}</p>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {t.problem.items.map((item, i) => {
              const Icon = ICONS[i];
              return (
                <div key={item.title} className="rounded-surface border border-border bg-surface/60 backdrop-blur-md p-6">
                  <Icon aria-hidden className="h-5 w-5 text-accent" />
                  <h3 className="mt-4 text-title font-semibold text-fg">{item.title}</h3>
                  <p className="mt-2 text-body text-fg-muted">{item.body}</p>
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
