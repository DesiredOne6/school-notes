'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { EditForm, type Field, type FieldValue } from '@/components/ui/EditForm';
import {
  groupMeetings,
  formatWeekdays,
  formatTimeRange,
  meetingKindLabel,
  MEETING_KINDS,
} from '@/lib/util/meetings';
import {
  createCourse,
  addCourseMeetings,
  deleteCourseMeetings,
  updateCourseMeetings,
  updateCourse,
  getCourseImpact,
  setCourseArchived,
  deleteCourse,
  type CourseImpact,
} from '@/app/actions/courses';

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

const COURSE_FIELDS: Field[] = [
  { name: 'code', label: 'Code', type: 'text', placeholder: 'EECS 203' },
  { name: 'title', label: 'Title', type: 'text', required: true },
  { name: 'location', label: 'Room', type: 'text', span: 2 },
  { name: 'color', label: 'Colour', type: 'color', options: PALETTE, span: 2 },
];

const MEETING_FIELDS: Field[] = [
  { name: 'weekdays', label: 'Days', type: 'weekdays', span: 2 },
  { name: 'startsAt', label: 'Starts', type: 'time', required: true },
  { name: 'endsAt', label: 'Ends', type: 'time', required: true },
  {
    name: 'kind',
    label: 'Type',
    type: 'select',
    options: MEETING_KINDS.map((k) => ({ value: k.value, label: k.label })),
  },
  { name: 'location', label: 'Room', type: 'text' },
  { name: 'url', label: 'Zoom / Meet link', type: 'text', span: 2 },
  { name: 'startsOn', label: 'Term starts', type: 'date' },
  { name: 'endsOn', label: 'Term ends', type: 'date' },
];

const inputClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

export type CourseWithMeetings = {
  id: string;
  code: string | null;
  title: string;
  color: string;
  archived_at: string | null;
  course_meetings: Array<{
    id: string;
    kind: string;
    weekday: number;
    starts_at: string;
    ends_at: string;
    location: string | null;
    url: string | null;
    starts_on: string | null;
    ends_on: string | null;
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
            {MEETING_KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
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

/**
 * Removal controls. Deleting a course cascades to its assignments and
 * documents, so the counts are fetched and shown before confirming rather than
 * relying on the user to know what a cascade does.
 */
function RemoveCourse({ course }: { course: CourseWithMeetings }) {
  const router = useRouter();
  const [impact, setImpact] = useState<CourseImpact | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, startTransition] = useTransition();

  const refresh = () => startTransition(() => router.refresh());

  async function begin() {
    setBusy(true);
    setError('');
    const result = await getCourseImpact(course.id);
    setImpact(result);
    setConfirming(true);
    setBusy(false);
  }

  if (!confirming) {
    return (
      <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
        <button
          onClick={async () => {
            setBusy(true);
            await setCourseArchived(course.id, !course.archived_at);
            setBusy(false);
            refresh();
          }}
          disabled={busy}
          className="rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-xs hover:border-[var(--color-accent)] disabled:opacity-50"
        >
          {course.archived_at ? 'Unarchive' : 'Archive'}
        </button>
        <button
          onClick={begin}
          disabled={busy}
          className="rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-muted)] hover:border-red-400 hover:text-red-400 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    );
  }

  const willDelete = [
    impact?.assignments ? `${impact.assignments} assignment${impact.assignments === 1 ? '' : 's'}` : null,
    impact?.documents ? `${impact.documents} document${impact.documents === 1 ? '' : 's'}` : null,
    impact?.meetings ? `${impact.meetings} meeting time${impact.meetings === 1 ? '' : 's'}` : null,
    impact?.instructors ? `${impact.instructors} person/people` : null,
    impact?.links ? `${impact.links} link${impact.links === 1 ? '' : 's'}` : null,
  ].filter(Boolean);

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3">
      <p className="text-xs font-medium text-red-300">
        Delete {course.code ?? course.title}?
      </p>

      {willDelete.length > 0 ? (
        <p className="text-xs text-red-300">
          This also deletes {willDelete.join(', ')}.
        </p>
      ) : (
        <p className="text-xs text-red-300">Nothing else is attached to this course.</p>
      )}

      {Boolean(impact?.notes) && (
        <p className="text-xs text-[var(--color-muted)]">
          {impact!.notes} note{impact!.notes === 1 ? '' : 's'} will be kept, but lose their course.
        </p>
      )}

      <p className="text-xs text-[var(--color-muted)]">
        Archiving hides it instead and keeps everything.
      </p>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={async () => {
            setBusy(true);
            const result = await deleteCourse(course.id);
            setBusy(false);
            if (result.ok) refresh();
            else setError(result.error);
          }}
          disabled={busy}
          className="rounded-lg bg-red-500/80 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Deleting…' : 'Delete permanently'}
        </button>
        <button
          onClick={async () => {
            setBusy(true);
            await setCourseArchived(course.id, true);
            setBusy(false);
            setConfirming(false);
            refresh();
          }}
          disabled={busy}
          className="rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-xs disabled:opacity-50"
        >
          Archive instead
        </button>
        <button
          onClick={() => { setConfirming(false); setError(''); }}
          className="rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-xs"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function CourseManager({ courses }: { courses: CourseWithMeetings[] }) {
  const router = useRouter();
  const [editingMeeting, setEditingMeeting] = useState<string | null>(null);
  const [editingCourse, setEditingCourse] = useState<string | null>(null);
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
          className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4 ${
            course.archived_at ? 'opacity-60' : ''
          }`}
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
                {course.archived_at && <span className="mr-1 text-amber-400">Archived ·</span>}
                {course.course_meetings.length === 0
                  ? 'No meeting times set'
                  : `${course.course_meetings.length} meeting time${course.course_meetings.length === 1 ? '' : 's'}`}
              </p>
            </div>

            <button
              onClick={() => setEditingCourse(course.id)}
              className="shrink-0 rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-xs hover:border-[var(--color-accent)]"
            >
              Edit
            </button>

            <Link
              href={`/courses/${course.id}`}
              className="shrink-0 rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-xs hover:border-[var(--color-accent)]"
            >
              Open hub →
            </Link>
          </div>

          {editingCourse === course.id && (
            <div className="mt-3">
              <EditForm
                fields={COURSE_FIELDS}
                initial={{
                  code: course.code ?? '',
                  title: course.title,
                  location: '',
                  color: course.color,
                }}
                onSave={async (v: Record<string, FieldValue>) => {
                  const result = await updateCourse(course.id, {
                    title: String(v.title ?? ''),
                    code: String(v.code ?? '') || null,
                    color: String(v.color ?? course.color),
                    location: String(v.location ?? '') || null,
                  });

                  if (result.ok) {
                    setEditingCourse(null);
                    startTransition(() => router.refresh());
                  }
                  return result;
                }}
                onCancel={() => setEditingCourse(null)}
              />
            </div>
          )}

          {course.course_meetings.length > 0 && (
            <ul className="mt-3 space-y-1">
              {groupMeetings(course.course_meetings).map((group) => {
                const key = group.ids.join(',');

                if (editingMeeting === key) {
                  return (
                    <li key={key}>
                      <EditForm
                        fields={MEETING_FIELDS}
                        initial={{
                          weekdays: group.weekdays,
                          startsAt: group.startsAt.slice(0, 5),
                          endsAt: group.endsAt.slice(0, 5),
                          kind: group.kind,
                          location: group.location ?? '',
                          url: group.url ?? '',
                          startsOn: group.startsOn ?? '',
                          endsOn: group.endsOn ?? '',
                        }}
                        onSave={async (v: Record<string, FieldValue>) => {
                          const result = await updateCourseMeetings(group.ids, {
                            courseId: course.id,
                            kind: String(v.kind),
                            weekdays: (v.weekdays as number[]) ?? [],
                            startsAt: String(v.startsAt),
                            endsAt: String(v.endsAt),
                            location: String(v.location ?? '') || null,
                            url: String(v.url ?? '') || null,
                            startsOn: String(v.startsOn ?? '') || null,
                            endsOn: String(v.endsOn ?? '') || null,
                          });

                          if (result.ok) {
                            setEditingMeeting(null);
                            startTransition(() => router.refresh());
                          }
                          return result;
                        }}
                        onCancel={() => setEditingMeeting(null)}
                      />
                    </li>
                  );
                }

                return (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs"
                  >
                    <span className="min-w-0">
                      <span className="mr-2 rounded bg-[var(--color-panel)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-muted)]">
                        {meetingKindLabel(group.kind)}
                      </span>
                      <strong>{formatWeekdays(group.weekdays)}</strong>{' '}
                      {formatTimeRange(group.startsAt, group.endsAt)}
                      {group.location && ` · ${group.location}`}
                    </span>

                    <span className="flex shrink-0 gap-2">
                      <button
                        onClick={() => setEditingMeeting(key)}
                        className="text-[var(--color-accent)] hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={async () => {
                          await deleteCourseMeetings(group.ids);
                          startTransition(() => router.refresh());
                        }}
                        className="text-[var(--color-muted)] hover:text-red-400"
                        aria-label="Remove meeting time"
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-3">
            <MeetingForm courseId={course.id} />
          </div>

          <RemoveCourse course={course} />
        </section>
      ))}
    </div>
  );
}
