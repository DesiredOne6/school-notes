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
        Hide calendar events that duplicate my class times
        <span className="mt-0.5 block text-[var(--color-muted)]">
          Universities often publish class times to Google, which would otherwise show every
          lecture twice. Only events at the same time as one of your classes are hidden.
        </span>
      </span>
    </label>
  );
}
