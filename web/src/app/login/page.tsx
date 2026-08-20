'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/client';

const inputClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

/** Supabase's own floor is 6; 8 is a more sensible minimum. */
const MIN_PASSWORD_LENGTH = 8;

type Mode = 'password' | 'signup' | 'magic' | 'forgot';

const TITLES: Record<Mode, string> = {
  password: 'Sign in',
  signup: 'Create your account',
  magic: 'Sign in with a link',
  forgot: 'Reset your password',
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/';

  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  function fail(text: string) {
    setIsError(true);
    setMessage(text);
  }

  function succeed(text: string) {
    setIsError(false);
    setMessage(text);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const supabase = createClient();

    try {
      if (mode === 'password') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // Full reload so the server components pick up the new session cookie.
        router.push(next);
        router.refresh();
        return;
      }

      if (mode === 'signup') {
        if (password.length < MIN_PASSWORD_LENGTH) {
          throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
        }
        if (password !== confirm) throw new Error('Passwords do not match');

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;

        // With email confirmation on, there's no session until they confirm.
        if (data.session) {
          router.push(next);
          router.refresh();
        } else {
          succeed(`Check ${email} to confirm your account, then sign in.`);
        }
        return;
      }

      if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        succeed(`Check ${email} for a sign-in link.`);
        return;
      }

      // forgot
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset`,
      });
      if (error) throw error;
      succeed(`Check ${email} for a link to set a new password.`);
    } catch (err) {
      fail((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const showPassword = mode === 'password' || mode === 'signup';

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-2xl font-semibold">{TITLES[mode]}</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        {mode === 'magic' && "We'll email you a link — no password needed."}
        {mode === 'forgot' && "We'll email you a link to choose a new password."}
        {mode === 'signup' && 'Use your school email address.'}
        {mode === 'password' && 'Welcome back.'}
      </p>

      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@school.edu"
          className={inputClass}
        />

        {showPassword && (
          <input
            type="password"
            required
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className={inputClass}
          />
        )}

        {mode === 'signup' && (
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            className={inputClass}
          />
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy
            ? 'Working…'
            : mode === 'password'
              ? 'Sign in'
              : mode === 'signup'
                ? 'Create account'
                : mode === 'magic'
                  ? 'Send sign-in link'
                  : 'Send reset link'}
        </button>
      </form>

      {message && (
        <p className={`mt-4 text-sm ${isError ? 'text-red-400' : 'text-green-400'}`}>{message}</p>
      )}

      <div className="mt-6 space-y-2 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-muted)]">
        {mode === 'password' && (
          <>
            <button onClick={() => { setMode('forgot'); setMessage(''); }} className="block hover:text-white">
              Forgot your password?
            </button>
            <button onClick={() => { setMode('magic'); setMessage(''); }} className="block hover:text-white">
              Email me a sign-in link instead
            </button>
            <button onClick={() => { setMode('signup'); setMessage(''); }} className="block hover:text-white">
              Create an account
            </button>
          </>
        )}

        {mode !== 'password' && (
          <button onClick={() => { setMode('password'); setMessage(''); }} className="block hover:text-white">
            ← Back to password sign-in
          </button>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
