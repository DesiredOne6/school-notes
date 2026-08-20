'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const inputClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

type Page = { id: string; title: string };

export function NotionConnect({
  connected,
  hasDatabase,
}: {
  connected: string | null;
  hasDatabase: boolean;
}) {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [pages, setPages] = useState<Page[]>([]);
  const [needsSharing, setNeedsSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [, startTransition] = useTransition();

  function fail(text: string) { setIsError(true); setMessage(text); }
  function succeed(text: string) { setIsError(false); setMessage(text); }

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    try {
      const res = await fetch('/api/notion/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not connect');

      setToken('');
      setPages(body.pages ?? []);
      setNeedsSharing(Boolean(body.needsSharing));
      succeed(`Connected to ${body.workspace}.`);
      startTransition(() => router.refresh());
    } catch (err) {
      fail((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function loadPages() {
    setBusy(true);
    try {
      const res = await fetch('/api/notion/database');
      const body = await res.json();
      setPages(body.pages ?? []);
      setNeedsSharing((body.pages ?? []).length === 0);
    } finally {
      setBusy(false);
    }
  }

  async function chooseParent(pageId: string) {
    setBusy(true);
    setMessage('');

    try {
      const res = await fetch('/api/notion/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPageId: pageId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not create the database');

      succeed('Database ready. Hit "Sync now" on the dashboard to fill it.');
      setPages([]);
      startTransition(() => router.refresh());
    } catch (err) {
      fail((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {connected ? (
        <p className="text-xs text-green-400">
          Connected to {connected}.
          {hasDatabase ? ' Database ready.' : ' Choose where to put the database below.'}
        </p>
      ) : (
        <form onSubmit={connect} className="space-y-2">
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            type="password"
            placeholder="ntn_… integration token"
            required
            className={inputClass}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Connect Notion'}
          </button>
        </form>
      )}

      {connected && (
        <button
          onClick={loadPages}
          disabled={busy}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
        >
          {hasDatabase ? 'Move database' : 'Choose a page'}
        </button>
      )}

      {needsSharing && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          <p className="font-medium">No pages visible yet.</p>
          <p className="mt-1">
            Notion only shows an integration what you explicitly share with it. Open the Notion
            page you want to use → <strong>⋯ menu → Connections → </strong> add your integration,
            then click “Choose a page” again.
          </p>
        </div>
      )}

      {pages.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs text-[var(--color-muted)]">
            Put the assignments database inside:
          </p>
          <ul className="space-y-1">
            {pages.map((page) => (
              <li key={page.id}>
                <button
                  onClick={() => chooseParent(page.id)}
                  disabled={busy}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-left text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
                >
                  {page.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="text-xs text-[var(--color-muted)]">
        <summary className="cursor-pointer hover:text-white">How to get a token</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>
            Go to{' '}
            <a
              href="https://www.notion.so/my-integrations"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-accent)] hover:underline"
            >
              notion.so/my-integrations
            </a>{' '}
            → <strong>New integration</strong>
          </li>
          <li>Name it anything, pick your workspace, and create it</li>
          <li>Copy the <strong>Internal Integration Secret</strong> (starts with <code>ntn_</code>)</li>
          <li>
            Open the Notion page you want the database inside → <strong>⋯ → Connections</strong> →
            add your integration
          </li>
        </ol>
      </details>

      {message && (
        <p className={`text-xs ${isError ? 'text-red-400' : 'text-green-400'}`}>{message}</p>
      )}
    </div>
  );
}
