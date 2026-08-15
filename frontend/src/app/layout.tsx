import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';
import { ThemeProvider, themeBootstrapScript } from '@/components/ThemeProvider';

/**
 * IBM Plex, not Inter.
 *
 * Inter is the safe default every admin tool reaches for. Plex was drawn for
 * enterprise software, carries real tabular figures — which matters on every
 * ledger, invoice and stock table in this product — and its mono is a genuine
 * companion rather than a separate family bolted on.
 */
const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Quberty ERP',
  description: 'Operations, inventory and finance for growing retail businesses.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Paints the correct theme before hydration, so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className={`${sans.variable} ${mono.variable} font-sans text-body antialiased`}>
        <ThemeProvider>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
