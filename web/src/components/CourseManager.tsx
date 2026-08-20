'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createCourse, addCourseMeetings, deleteCourseMeeting } from '@/app/actions/courses';

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const PALETTE = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#0ea5e9', '#a855f7', '#ec4899', '#84cc16'];

const inputClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

export type CourseWithMeetings = {
  id: string;
  code: string | null;
  title: string;
  color: string;
  course_meetings: Array<{
    id: string;
    kind: string;
    weekday: number;
    starts_at: string;
    ends_at: string;
    location: string | null;
  }>;
};

function NewCourseForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
      >
        + Add course
      </button>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await createCourse({
          title,
          code: code || null,
          color,
          location: location || null,
        });

        if (result.ok) {
          setTitle('');
          setCode('');
          setLocation('');
          setOpen(false);
          setError('');
          startTransition(() => router.refresh());
        } else {
          setError(result.error);
        }
      }}
      className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="EECS 281" className={inputClass} />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Data Structures and Algorithms"
          required
          className={inputClass}
        />
      </div>

      <input
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="Room (optional)"
        className={inputClass}
      />

      <div>
        <span className="mb-1.5 block text-xs text-[var(--color-muted)]">Colour</span>
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              onClick={() => setColor(c)}
              style={{ background: c }}
              className={`h-6 w-6 rounded-full ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-[var(--color-panel)]' : ''}`}
            />
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Save course
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

function MeetingForm({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [kind, setKind] = useState('lecture');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [location, setLocation] = useState('');
  const [url, setUrl] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-[var(--color-accent)] hover:underline"
      >
        + Add meeting time
      </button>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await addCourseMeetings({
          courseId,
          kind,
          weekdays,
          startsAt,
          endsAt,
          location: location || null,
          url: url || null,
          startsOn: startsOn || null,
          endsOn: endsOn || null,
        });

        if (result.ok) {
          setOpen(false);
          setWeekdays([]);
          setError('');
          startTransition(() => router.refresh());
        } else {
          setError(result.error);
        }
      }}
      className="mt-3 space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    >
      <div>
        <span className="mb-1.5 block text-xs text-[var(--color-muted)]">Days</span>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d) => {
            const active = weekdays.includes(d.value);
            return (
              <button
                key={d.value}
                type="button"
                onClick={() =>
                  setWeekdays((prev) =>
                    active ? prev.filter((v) => v !== d.value) : [...prev, d.value],
                  )
                }
                className={`rounded-md px-2 py-1 text-xs ${
                  active
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'border border-[var(--color-border)] text-[var(--color-muted)]'
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs text-[var(--color-muted)]">Starts</span>
          <input type="time" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-[var(--color-muted)]">Ends</span>
          <input type="time" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-[var(--color-muted)]">Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputClass}>
            <option value="lecture">Lecture</option>
            <option value="lab">Lab</option>
            <option value="discussion">Discussion</option>
            <option value="review">Review</option>
          </select>
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room" className={inputClass} />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Zoom / Meet link" className={inputClass} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-[var(--color-muted)]">Term starts (optional)</span>
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-[var(--color-muted)]">Term ends (optional)</span>
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={inputClass} />
        </label>
      </div>

      <p className="text-xs text-[var(--color-muted)]">
        Term dates keep the class off your calendar outside the semester.
      </p>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Save
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CourseManager({ courses }: { courses: CourseWithMeetings[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <NewCourseForm />

      {courses.length === 0 && (
        <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 text-center text-sm text-[var(--color-muted)]">
          No courses yet. Add one above, or connect Canvas in Settings to import them.
        </p>
      )}

      {courses.map((course) => (
        <section
          key={course.id}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4"
        >
          <div className="flex items-center gap-3">
            <span aria-hidden className="h-8 w-1 rounded-full" style={{ background: course.color }} />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">
                <Link href={`/courses/${course.id}`} className="hover:text-[var(--color-accent)]">
                  {course.code ? `${course.code} — ${course.title}` : course.title}
                </Link>
              </h2>
              <p className="text-xs text-[var(--color-muted)]">
                {course.course_meetings.length === 0
                  ? 'No meeting times set'
                  : `${course.course_meetings.length} meeting time${course.course_meetings.length === 1 ? '' : 's'}`}
              </p>
            </div>

            <Link
              href={`/courses/${course.id}`}
              className="shrink-0 rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-xs hover:border-[var(--color-accent)]"
            >
              Open hub →
            </Link>
          </div>

          {course.course_meetings.length > 0 && (
            <ul className="mt-3 space-y-1">
              {course.course_meetings
                .slice()
                .sort((a, b) => a.weekday - b.weekday || a.starts_at.localeCompare(b.starts_at))
                .map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs"
                  >
                    <span>
                      <strong>{DAY_LABEL[m.weekday]}</strong> {m.starts_at.slice(0, 5)}–{m.ends_at.slice(0, 5)}
                      {m.location && ` · ${m.location}`}
                      {m.kind !== 'lecture' && ` · ${m.kind}`}
                    </span>
                    <button
                      onClick={async () => {
                        await deleteCourseMeeting(m.id);
                        startTransition(() => router.refresh());
                      }}
                      className="text-[var(--color-muted)] hover:text-red-400"
                      aria-label="Remove meeting time"
                    >
                      ✕
                    </button>
                  </li>
                ))}
            </ul>
          )}

          <div className="mt-3">
            <MeetingForm courseId={course.id} />
          </div>
        </section>
      ))}
    </div>
  );
}
