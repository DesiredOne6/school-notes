'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { EditForm, type Field, type FieldValue } from '@/components/ui/EditForm';
import { updateAssignment, deleteAssignment } from '@/app/actions/assignments';
import { formatDue, relativeDue } from '@/lib/util/dates';

export type AssignmentRecord = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  status: string;
  due_at: string | null;
  due_is_all_day: boolean;
  points: number | null;
  score: number | null;
  priority: number;
  estimated_minutes: number | null;
  url: string | null;
  source: string;
  course_id: string | null;
};

const KINDS = ['assignment', 'quiz', 'exam', 'project', 'reading', 'lab', 'discussion', 'other'];
const STATUSES = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'graded', label: 'Graded' },
  { value: 'dropped', label: 'Dropped' },
];
const PRIORITIES = [
  { value: '1', label: 'Urgent' },
  { value: '2', label: 'Normal' },
  { value: '3', label: 'Low' },
  { value: '4', label: 'Someday' },
];

/** An ISO instant as the local wall-clock string a datetime-local input wants. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AssignmentEditor({
  assignment,
  courses,
  reminders,
}: {
  assignment: AssignmentRecord;
  courses: Array<{ id: string; code: string | null; title: string }>;
  reminders: Array<{ id: string; remind_at: string; offset_minutes: number | null; status: string }>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [, startTransition] = useTransition();

  const fields: Field[] = [
    { name: 'title', label: 'Title', type: 'text', required: true, span: 2 },
    {
      name: 'courseId',
      label: 'Course',
      type: 'select',
      options: [
        { value: '', label: 'No course' },
        ...courses.map((c) => ({
          value: c.id,
          label: c.code ? `${c.code} — ${c.title}` : c.title,
        })),
      ],
    },
    {
      name: 'kind',
      label: 'Type',
      type: 'select',
      options: KINDS.map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })),
    },
    { name: 'dueAt', label: 'Due', type: 'text', placeholder: 'YYYY-MM-DDTHH:MM' },
    { name: 'status', label: 'Status', type: 'select', options: STATUSES },
    { name: 'points', label: 'Points', type: 'number', min: 0, step: 0.5 },
    { name: 'score', label: 'Score', type: 'number', min: 0, step: 0.5 },
    { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES },
    { name: 'estimatedMinutes', label: 'Est. minutes', type: 'number', min: 1 },
    { name: 'notes', label: 'Notes', type: 'textarea', rows: 4, span: 2 },
  ];

  const courseLabel = courses.find((c) => c.id === assignment.course_id);

  if (editing) {
    return (
      <EditForm
        fields={fields}
        initial={{
          title: assignment.title,
          courseId: assignment.course_id ?? '',
          kind: assignment.kind,
          dueAt: toLocalInput(assignment.due_at),
          status: assignment.status,
          points: assignment.points,
          score: assignment.score,
          priority: String(assignment.priority),
          estimatedMinutes: assignment.estimated_minutes,
          notes: assignment.description ?? '',
        }}
        onSave={async (values: Record<string, FieldValue>) => {
          const due = String(values.dueAt ?? '').trim();

          const result = await updateAssignment(assignment.id, {
            title: String(values.title ?? ''),
            courseId: values.courseId ? String(values.courseId) : null,
            kind: String(values.kind),
            status: String(values.status),
            // A datetime-local value is wall-clock in the browser's zone.
            dueAt: due ? new Date(due).toISOString() : null,
            points: values.points === null || values.points === '' ? null : Number(values.points),
            score: values.score === null || values.score === '' ? null : Number(values.score),
            priority: Number(values.priority),
            estimatedMinutes:
              values.estimatedMinutes === null || values.estimatedMinutes === ''
                ? null
                : Number(values.estimatedMinutes),
            notes: String(values.notes ?? '') || null,
          });

          if (result.ok) {
            setEditing(false);
            startTransition(() => router.refresh());
          }
          return result;
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{assignment.title}</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {courseLabel?.code ?? courseLabel?.title ?? 'No course'} · {assignment.kind} ·{' '}
            {formatDue(assignment.due_at, assignment.due_is_all_day)}
            {assignment.due_at && ` · ${relativeDue(assignment.due_at)}`}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setEditing(true)}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
          >
            Edit
          </button>
          <button
            onClick={async () => {
              if (!confirm('Delete this assignment?')) return;
              const result = await deleteAssignment(assignment.id);
              if (result.ok) {
                router.push('/');
                router.refresh();
              } else {
                setError(result.error);
              }
            }}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:border-red-400 hover:text-red-400"
          >
            Delete
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <dl className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4 text-sm sm:grid-cols-3">
        {[
          ['Status', assignment.status.replace('_', ' ')],
          ['Priority', PRIORITIES.find((p) => p.value === String(assignment.priority))?.label],
          ['Points', assignment.points === null ? '—' : String(assignment.points)],
          ['Score', assignment.score === null ? '—' : String(assignment.score)],
          ['Estimated', assignment.estimated_minutes ? `${assignment.estimated_minutes} min` : '—'],
          ['Source', assignment.source],
        ].map(([label, value]) => (
          <div key={label as string}>
            <dt className="text-xs text-[var(--color-muted)]">{label}</dt>
            <dd className="mt-0.5">{value ?? '—'}</dd>
          </div>
        ))}
      </dl>

      {assignment.url && (
        <a
          href={assignment.url}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm text-[var(--color-accent)] hover:underline"
        >
          Open in Canvas →
        </a>
      )}

      {assignment.description && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Details
          </h2>
          <p className="whitespace-pre-wrap text-sm">{assignment.description}</p>
        </div>
      )}

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
          Reminders
        </h2>
        {reminders.length === 0 ? (
          <p className="text-xs text-[var(--color-muted)]">
            None queued — reminders are only created for open work with a due date.
          </p>
        ) : (
          <ul className="space-y-1 text-xs">
            {reminders.map((r) => (
              <li key={r.id} className="flex justify-between">
                <span>{new Date(r.remind_at).toLocaleString()}</span>
                <span className="text-[var(--color-muted)]">{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
