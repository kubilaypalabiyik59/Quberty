import Link from 'next/link';

import { QubertyWordmark } from '@/components/brand/QubertyWordmark';

import type { LandingDictionary } from '@/app/(landing)/i18n/types';

/** Footer: the wordmark, the rights line, and the sign-in link. */
export function LandingFooter({ t }: { t: LandingDictionary }) {
  const year = new Date().getFullYear();
  return (
    <footer className="relative border-t border-border bg-bg/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 sm:flex-row sm:px-6">
        <QubertyWordmark sweep="once" className="text-sm" />
        <p className="text-caption text-fg-subtle">
          © {year} Quberty. {t.footer.rights}
        </p>
        <Link href="/login" className="text-caption text-fg-muted transition-colors duration-quick hover:text-fg">
          {t.footer.signIn}
        </Link>
      </div>
    </footer>
  );
}
