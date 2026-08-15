'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'motion/react';
import { useAuthStore } from '@/stores/authStore';
import LoginForm from '@/components/ui/login-form';
import WelcomeCurtain from '@/components/ui/WelcomeCurtain';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [welcoming, setWelcoming] = useState(false);
  const login = useAuthStore((s) => s.login);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  const handleSubmit = async (email: string, password: string) => {
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      // Prefetch while the curtain is up, so the hold is spent doing something
      // useful and the dashboard is ready the moment it lifts.
      router.prefetch('/dashboard');
      setWelcoming(true);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Invalid email or password');
      setLoading(false);
    }
    // `loading` deliberately stays true on success — the button must not return
    // to its idle state behind the curtain.
  };

  return (
    <>
      <LoginForm onSubmit={handleSubmit} error={error} loading={loading} />
      <AnimatePresence>
        {welcoming ? (
          <WelcomeCurtain
            name={user?.first_name}
            onDone={() => router.push('/dashboard')}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}
