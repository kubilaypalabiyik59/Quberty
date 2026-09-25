import {
  BarChart3,
  Contact,
  Landmark,
  Package,
  ShoppingCart,
  ShieldCheck,
  Users,
  Warehouse,
} from 'lucide-react';

import { Reveal } from '@/app/(landing)/_components/Reveal';

import { SECTION_IDS } from '@/app/(landing)/content';
import type { LandingDictionary } from '@/app/(landing)/i18n/types';

const ICONS = [Contact, ShoppingCart, Package, Warehouse, Landmark, Users, BarChart3, ShieldCheck] as const;

/** Capabilities section: the eight modules and what each includes. */
export function Capabilities({ t }: { t: LandingDictionary }) {
  return (
    <section id={SECTION_IDS.capabilities} className="scroll-mt-16 bg-bg py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <h2 className="text-section font-semibold text-fg">{t.capabilities.title}</h2>
          <p className="mt-4 max-w-2xl text-lead text-fg-muted">{t.capabilities.intro}</p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.capabilities.items.map((item, i) => {
              const Icon = ICONS[i];
              return (
                <div key={item.title} className="rounded-surface border border-border bg-surface p-6">
                  <Icon aria-hidden className="h-5 w-5 text-accent" />
                  <h3 className="mt-4 text-title font-semibold text-fg">{item.title}</h3>
                  <p className="mt-2 text-body text-fg-muted">{item.body}</p>
                  <ul className="mt-4 list-disc space-y-1 pl-4 text-caption text-fg-muted marker:text-accent">
                    {item.includes.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
