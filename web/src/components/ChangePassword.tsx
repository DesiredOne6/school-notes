'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const inputClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Changes the password for the signed-in user. Requires no email, which
 * matters because Supabase's built-in SMTP is heavily rate limited.
 */
export function ChangePassword({ email }: { email: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    try {
      if (password.length < MIN_PASSWORD_LENGTH) {
        throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      }
      if (password !== confirm) throw new Error('Passwords do not match');

      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setPassword('');
      setConfirm('');
      setIsError(false);
      setMessage('Password updated.');
    } catch (err) {
      setIsError(true);
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-[var(--color-muted)]">Signed in as {email}</p>

      <input
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="New password"
        required
        className={inputClass}
      />
      <input
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirm new password"
        required
        className={inputClass}
      />

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Change password'}
      </button>

      {message && (
        <p className={`text-xs ${isError ? 'text-red-400' : 'text-green-400'}`}>{message}</p>
      )}
    </form>
  );
}
