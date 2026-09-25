'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'motion/react';
import { useAuthStore } from '@/stores/authStore';
import { markActivity, takeSignoutReason } from '@/lib/sessionActivity';
import LoginForm from '@/components/ui/login-form';
import WelcomeCurtain from '@/components/ui/WelcomeCurtain';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [welcoming, setWelcoming] = useState(false);
  const login = useAuthStore((s) => s.login);
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const router = useRouter();
  const submitted = useRef(false);
  const [notice, setNotice] = useState<string>();

  // Read once: a reload of the sign-in page should not repeat the explanation.
  useEffect(() => {
    if (takeSignoutReason() === 'idle') setNotice('You were signed out after a period of inactivity.');
  }, []);

  // Someone who still has a live session is not asked to sign in again. Only a
  // session found on arrival counts: a user who just signed in here goes
  // through the welcome curtain instead.
  useEffect(() => {
    if (!isLoading && user && !submitted.current) router.replace('/dashboard');
  }, [isLoading, user, router]);

  const handleSubmit = async (email: string, password: string) => {
    submitted.current = true;
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      markActivity();
      // Prefetch while the curtain is up, so the hold is spent doing something
      // useful and the dashboard is ready the moment it lifts.
      router.prefetch('/dashboard');
      setWelcoming(true);
    } catch (err: any) {
      submitted.current = false;
      setError(err.response?.data?.message ?? 'Invalid email or password');
      setLoading(false);
    }
    // `loading` deliberately stays true on success — the button must not return
    // to its idle state behind the curtain.
  };

  // Restoring a session: show nothing rather than flash a form that is about
  // to be replaced.
  if (isLoading || (user && !submitted.current)) return null;

  return (
    <>
      <LoginForm onSubmit={handleSubmit} error={error} notice={notice} loading={loading} />
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
