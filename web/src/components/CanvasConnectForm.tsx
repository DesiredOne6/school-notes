'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Collects a Canvas base URL + personal access token and verifies it. */
export function CanvasConnectForm({ connected }: { connected: string | null }) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState('saving');
    setMessage('');

    const res = await fetch('/api/canvas/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, token }),
    });

    const body = await res.json();

    if (res.ok) {
      setState('idle');
      setToken('');
      router.refresh();
    } else {
      setState('error');
      setMessage(body.error ?? 'Could not connect');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {connected && (
        <p className="text-xs text-green-400">Connected as {connected}. Re-submit to replace the token.</p>
      )}

      <input
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder="yourschool.instructure.com"
        required
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />

      <input
        value={token}
        onChange={(e) => setToken(e.target.value)}
        type="password"
        placeholder="Canvas access token"
        required
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />

      <p className="text-xs text-[var(--color-muted)]">
        Canvas → Account → Settings → <em>New Access Token</em>. Stored server-side and never
        exposed to the browser again.
      </p>

      <button
        type="submit"
        disabled={state === 'saving'}
        className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {state === 'saving' ? 'Verifying…' : connected ? 'Update token' : 'Connect Canvas'}
      </button>

      {message && <p className="text-xs text-red-400">{message}</p>}
    </form>
  );
}
