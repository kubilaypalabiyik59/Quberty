import { Building2, BookOpen, History, Layers } from 'lucide-react';

import { Reveal } from '@/app/(landing)/_components/Reveal';

import { LandingDictionary } from '@/app/(landing)/i18n/types';

const ICONS = [BookOpen, Layers, Building2, History] as const;

/** Foundation section: the company background and principles. */
export function Foundation({ t }: { t: LandingDictionary }) {
  return (
    <section className="bg-bg py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <h2 className="text-section font-semibold text-fg">{t.foundation.title}</h2>
              <p className="mt-4 max-w-xl text-lead text-fg-muted">{t.foundation.intro}</p>
            </div>
            <div className="space-y-8">
              {t.foundation.items.map((item, i) => {
                const Icon = ICONS[i];
                return (
                  <div key={item.title} className="flex gap-4">
                    <Icon aria-hidden className="mt-1 h-5 w-5 shrink-0 text-accent" />
                    <div>
                      <h3 className="text-title font-semibold text-fg">{item.title}</h3>
                      <p className="mt-2 text-body text-fg-muted">{item.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
