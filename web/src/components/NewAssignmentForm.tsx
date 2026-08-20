'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createAssignment } from '@/app/actions/assignments';

const KINDS = ['assignment', 'quiz', 'exam', 'project', 'reading', 'lab', 'discussion', 'other'] as const;

const PRIORITIES = [
  { value: 1, label: 'Urgent' },
  { value: 2, label: 'Normal' },
  { value: 3, label: 'Low' },
  { value: 4, label: 'Someday' },
];

export type CourseOption = { id: string; code: string | null; title: string };

const inputClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

/** Adds work by hand — for anything Canvas doesn't know about. */
export function NewAssignmentForm({ courses }: { courses: CourseOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('assignment');
  const [dueAt, setDueAt] = useState('');
  const [points, setPoints] = useState('');
  const [estimate, setEstimate] = useState('');
  const [priority, setPriority] = useState(2);
  const [notes, setNotes] = useState('');

  function reset() {
    setTitle('');
    setCourseId('');
    setKind('assignment');
    setDueAt('');
    setPoints('');
    setEstimate('');
    setPriority(2);
    setNotes('');
    setError('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');

    const result = await createAssignment({
      title,
      courseId: courseId || null,
      kind,
      // A datetime-local value is wall-clock in the browser's zone; the Date
      // constructor reads it that way, so this lands on the right instant.
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      points: points ? Number(points) : null,
      estimatedMinutes: estimate ? Number(estimate) : null,
      priority,
      notes: notes || null,
    });

    if (result.ok) {
      reset();
      setOpen(false);
      startTransition(() => router.refresh());
    } else {
      setError(result.error);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
      >
        + Add assignment
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="w-full space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What's due?"
        required
        autoFocus
        className={inputClass}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-[var(--color-muted)]">Course</span>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className={inputClass}>
            <option value="">No course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ? `${c.code} — ${c.title}` : c.title}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-[var(--color-muted)]">Type</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
            className={inputClass}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k[0].toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-[var(--color-muted)]">Due</span>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-[var(--color-muted)]">Priority</span>
          <select
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className={inputClass}
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-[var(--color-muted)]">Points (optional)</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-[var(--color-muted)]">Est. minutes (optional)</span>
          <input
            type="number"
            min="1"
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        rows={2}
        className={inputClass}
      />

      <p className="text-xs text-[var(--color-muted)]">
        Reminders are queued automatically — 1 day and 2 hours before the due time.
      </p>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Add assignment'}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
