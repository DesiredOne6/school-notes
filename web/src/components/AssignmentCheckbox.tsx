'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAssignmentStatus } from '@/app/actions/assignments';

/** Marks work done. Clearing the status also clears its pending reminders. */
export function AssignmentCheckbox({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      aria-label="Mark as done"
      title="Mark as done"
      disabled={pending}
      onClick={async () => {
        await setAssignmentStatus(assignmentId, true);
        startTransition(() => router.refresh());
      }}
      className="h-4 w-4 shrink-0 rounded border border-[var(--color-border)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 disabled:opacity-40"
    />
  );
}
