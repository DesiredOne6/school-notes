'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Connects a Canvas calendar feed — the path that works when an administrator
 * has disabled personal access tokens.
 */
export function CanvasFeedForm({ connected }: { connected: string | null }) {
  const router = useRouter();
  const [feedUrl, setFeedUrl] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState('saving');
    setMessage('');

    const res = await fetch('/api/canvas/ics/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedUrl }),
    });

    const body = await res.json();

    if (res.ok) {
      setState('idle');
      setFeedUrl('');
      setMessage(`Connected — ${body.assignmentsFound} assignments visible in the feed.`);
      router.refresh();
    } else {
      setState('error');
      setMessage(body.error ?? 'Could not connect');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {connected && <p className="text-xs text-green-400">Connected to {connected}.</p>}

      <input
        value={feedUrl}
        onChange={(e) => setFeedUrl(e.target.value)}
        placeholder="webcal://yourschool.instructure.com/feeds/calendars/user_xxx.ics"
        required
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-muted)]">
        <p className="mb-1 font-medium text-[#e9e9f0]">Where to find this</p>
        <p>
          In Canvas, open <strong>Calendar</strong> → scroll the right sidebar to the bottom →
          click <strong>Calendar Feed</strong> → copy the URL.
        </p>
        <p className="mt-2">
          Treat it like a password: anyone with the link can read your schedule. It&apos;s stored
          server-side and never shown again.
        </p>
      </div>

      <button
        type="submit"
        disabled={state === 'saving'}
        className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {state === 'saving' ? 'Checking feed…' : connected ? 'Update feed URL' : 'Connect feed'}
      </button>

      {message && (
        <p className={`text-xs ${state === 'error' ? 'text-red-400' : 'text-green-400'}`}>
          {message}
        </p>
      )}
    </form>
  );
}
