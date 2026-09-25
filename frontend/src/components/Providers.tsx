'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { CurrencyProvider } from '@/components/CurrencyProvider';

function AuthLoader({ children }: { children: React.ReactNode }) {
  const loadUser = useAuthStore((s) => s.loadUser);
  const loaded = useRef(false);

  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      loadUser();
    }
  }, [loadUser]);

  return <>{children}</>;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthLoader>
        {/* One currency for every screen that renders an amount — read from the
            ledger, never a literal (WORK-025). */}
        <CurrencyProvider>{children}</CurrencyProvider>
      </AuthLoader>
    </QueryClientProvider>
  );
}
