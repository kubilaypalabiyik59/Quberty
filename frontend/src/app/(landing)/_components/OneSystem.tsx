import { LayoutDashboard, ShoppingBag, Store, Warehouse } from 'lucide-react';

import { Reveal } from '@/app/(landing)/_components/Reveal';

import { SECTION_IDS } from '@/app/(landing)/content';
import type { LandingDictionary } from '@/app/(landing)/i18n/types';

const ICONS = [LayoutDashboard, Store, ShoppingBag, Warehouse] as const;

/** One-system section: the four channels and the shared-ledger line. */
export function OneSystem({ t }: { t: LandingDictionary }) {
  return (
    <section id={SECTION_IDS.product} className="bg-bg py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <h2 className="text-section font-semibold text-fg">{t.oneSystem.title}</h2>
          <p className="mt-4 max-w-2xl text-lead text-fg-muted">{t.oneSystem.intro}</p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.oneSystem.tiles.map((tile, i) => {
              const Icon = ICONS[i];
              return (
                <div key={tile.title} className="rounded-surface border border-border bg-surface p-6">
                  <Icon aria-hidden className="h-5 w-5 text-accent" />
                  <h3 className="mt-4 text-title font-semibold text-fg">{tile.title}</h3>
                  <p className="mt-2 text-body text-fg-muted">{tile.body}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-4 rounded-surface border border-border bg-surface px-6 py-4 text-center text-lead text-fg">
            {t.oneSystem.ledgerLine}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
