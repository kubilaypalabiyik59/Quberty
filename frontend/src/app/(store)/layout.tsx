import { Fraunces } from 'next/font/google';
import { StoreNavbar } from '@/components/store/StoreNavbar';
import { StoreFooter } from '@/components/store/StoreFooter';

/** Editorial serif for storefront headlines; loaded for the store routes only. */
const display = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-store-display',
  display: 'swap',
});

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${display.variable} min-h-screen flex flex-col`}>
      <StoreNavbar />
      <main className="flex-1">{children}</main>
      <StoreFooter />
    </div>
  );
}
