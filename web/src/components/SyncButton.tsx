'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type ProviderReport = {
  error?: string;
  assignmentsCreated?: number;
  assignmentsUpdated?: number;
  created?: number;
  updated?: number;
};

/** Summarises one provider's result for the status line under the button. */
function describe(name: string, report: ProviderReport): string {
  if (report.error) return `${name}: ${report.error}`;

  if (report.assignmentsCreated !== undefined) {
    return `${name}: ${report.assignmentsCreated} new, ${report.assignmentsUpdated ?? 0} updated`;
  }

  if (report.created !== undefined) {
    return `${name}: ${report.created + (report.updated ?? 0)} events`;
  }

  return `${name}: done`;
}

/** Runs every connected integration and reports what changed. */
export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  async function run() {
    setBusy(true);
    setNotes([]);

    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const body = await res.json();

      if (!res.ok) throw new Error(body.error ?? 'Sync failed');

      const labels: Record<string, string> = {
        canvas: 'Canvas',
        ics: 'Canvas feed',
        google: 'Calendar',
      };

      setNotes(
        Object.entries(body).map(([key, value]) =>
          describe(labels[key] ?? key, value as ProviderReport),
        ),
      );

      startTransition(() => router.refresh());
    } catch (err) {
      setNotes([(err as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <button
        onClick={run}
        disabled={busy || pending}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
      >
        {busy ? 'Syncing…' : 'Sync now'}
      </button>

      {notes.length > 0 && (
        <ul className="mt-1.5 max-w-xs space-y-0.5 text-xs text-[var(--color-muted)]">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
