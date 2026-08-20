'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/** Passwordless sign-in. One less credential to manage. */
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setStatus('sending');

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setStatus('error');
      setMessage(error.message);
    } else {
      setStatus('sent');
      setMessage(`Check ${email} for a sign-in link.`);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        We&apos;ll email you a link — no password needed.
      </p>

      <form onSubmit={signIn} className="mt-6 space-y-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@school.edu"
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="submit"
          disabled={status === 'sending' || status === 'sent'}
          className="w-full rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {status === 'sending' ? 'Sending…' : 'Send sign-in link'}
        </button>
      </form>

      {message && (
        <p
          className={`mt-4 text-sm ${status === 'error' ? 'text-red-400' : 'text-green-400'}`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
