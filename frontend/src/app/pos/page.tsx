'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { usePosSessionStore } from '@/stores/posSessionStore';
import { api } from '@/lib/api';

export default function PosIndexPage() {
  const router   = useRouter();
  const { user, isLoading } = useAuthStore();
  const { session, terminalName, setSession } = usePosSessionStore();

  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace('/pos/login'); return; }

    // Check if there is an open session on the server
    api.get('/pos/sessions/current', { params: { terminal_name: terminalName } })
      .then((res) => {
        const s = res.data.data;
        if (s) {
          setSession(s);
          router.replace('/pos/main');
        } else {
          router.replace('/pos/open-register');
        }
      })
      .catch(() => {
        // No session or error — go to open register
        router.replace('/pos/open-register');
      });
  }, [user, isLoading]); // eslint-disable-line

  return (
    <div className="flex items-center justify-center h-full">
      <span className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
    </div>
  );
}
