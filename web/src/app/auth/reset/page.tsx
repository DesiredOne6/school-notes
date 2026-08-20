'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const inputClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Sets a new password. Reached from the recovery email, which /auth/callback
 * has already exchanged for a session — so updateUser is authorised.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      if (password.length < MIN_PASSWORD_LENGTH) {
        throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      }
      if (password !== confirm) throw new Error('Passwords do not match');

      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      setDone(true);
      setTimeout(() => {
        router.push('/');
        router.refresh();
      }, 1200);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-2xl font-semibold">Choose a new password</h1>

      {done ? (
        <p className="mt-4 text-sm text-green-400">Password updated. Taking you in…</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              className={inputClass}
            />
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              className={inputClass}
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Set password'}
            </button>
          </form>

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        </>
      )}
    </div>
  );
}
