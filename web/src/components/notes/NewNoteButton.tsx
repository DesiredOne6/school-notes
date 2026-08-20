'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createNote } from '@/app/actions/notes';

export function NewNoteButton({
  courses,
  defaultTitle = '',
}: {
  courses: Array<{ id: string; code: string | null; title: string }>;
  defaultTitle?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [courseId, setCourseId] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const inputClass =
    'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
      >
        + New note
      </button>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await createNote({ title: title || 'Untitled', courseId: courseId || null, body: '' });

        if (result.ok) {
          startTransition(() => {
            router.push(`/notes/${result.id}`);
            router.refresh();
          });
        } else {
          setError(result.error);
        }
      }}
      className="w-full max-w-md space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Note title"
        autoFocus
        className={inputClass}
      />
      <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className={inputClass}>
        <option value="">No course</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code ? `${c.code} — ${c.title}` : c.title}
          </option>
        ))}
      </select>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
