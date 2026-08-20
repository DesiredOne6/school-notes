'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createNote } from '@/app/actions/notes';

export function NewNoteButton({
  courses,
  defaultTitle = '',
  /** When set, the note is created for this course and the picker is hidden. */
  lockedCourseId,
  label = '+ New note',
}: {
  courses: Array<{ id: string; code: string | null; title: string }>;
  defaultTitle?: string;
  lockedCourseId?: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [courseId, setCourseId] = useState(lockedCourseId ?? '');
  const [kind, setKind] = useState<'page' | 'handwritten'>('page');
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
        {label}
      </button>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await createNote({
          title: title || 'Untitled',
          courseId: courseId || null,
          body: '',
          kind,
        });

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
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setKind('page')}
          className={`flex-1 rounded-lg px-3 py-2 text-left text-xs ${
            kind === 'page'
              ? 'border border-[var(--color-accent)] bg-[var(--color-accent)]/20'
              : 'border border-[var(--color-border)]'
          }`}
        >
          <span className="block text-sm">📝 Typed page</span>
          <span className="text-[var(--color-muted)]">Markdown, images, links</span>
        </button>
        <button
          type="button"
          onClick={() => setKind('handwritten')}
          className={`flex-1 rounded-lg px-3 py-2 text-left text-xs ${
            kind === 'handwritten'
              ? 'border border-[var(--color-accent)] bg-[var(--color-accent)]/20'
              : 'border border-[var(--color-border)]'
          }`}
        >
          <span className="block text-sm">✍️ Handwritten</span>
          <span className="text-[var(--color-muted)]">Full page for your S Pen</span>
        </button>
      </div>

      {!lockedCourseId && (
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className={inputClass}>
          <option value="">No course</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code ? `${c.code} — ${c.title}` : c.title}
            </option>
          ))}
        </select>
      )}

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
