'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setHideDuplicateClasses } from '@/app/actions/calendars';

export function CalendarPrefs({ hideDuplicates }: { hideDuplicates: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  return (
    <label className="flex items-start gap-2 text-xs">
      <input
        type="checkbox"
        checked={hideDuplicates}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          await setHideDuplicateClasses(e.target.checked);
          setBusy(false);
          startTransition(() => router.refresh());
        }}
        className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-accent)]"
      />
      <span>
        Hide calendar events that duplicate something already shown
        <span className="mt-0.5 block text-[var(--color-muted)]">
          Universities publish class times to Google, and a Canvas calendar subscribed there
          repeats every assignment — both would otherwise appear twice. Only events that line
          up in time <em>and</em> are identifiably the same thing are hidden; a genuine clash
          stays visible, and your assignments are never hidden.
        </span>
      </span>
    </label>
  );
}
