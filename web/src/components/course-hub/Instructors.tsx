'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addInstructor,
  deleteInstructor,
  updateInstructor,
  addOfficeHours,
  deleteOfficeHours,
  updateOfficeHours,
} from '@/app/actions/course-hub';
import { inputClass, DAYS } from './shared';
import { EditForm, type Field, type FieldValue } from '@/components/ui/EditForm';
import { groupMeetings, formatWeekdays, formatTimeRange } from '@/lib/util/meetings';

const INSTRUCTOR_FIELDS: Field[] = [
  { name: 'name', label: 'Name', type: 'text', required: true },
  {
    name: 'role',
    label: 'Role',
    type: 'select',
    options: [
      { value: 'professor', label: 'Professor' },
      { value: 'ta', label: 'TA' },
      { value: 'grader', label: 'Grader' },
      { value: 'advisor', label: 'Advisor' },
    ],
  },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Phone', type: 'text' },
  { name: 'office', label: 'Office', type: 'text' },
  { name: 'pronouns', label: 'Pronouns', type: 'text' },
  { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
];

const OFFICE_HOURS_FIELDS: Field[] = [
  { name: 'weekdays', label: 'Days', type: 'weekdays', span: 2 },
  { name: 'startsAt', label: 'Starts', type: 'time', required: true },
  { name: 'endsAt', label: 'Ends', type: 'time', required: true },
  { name: 'location', label: 'Location', type: 'text' },
  { name: 'url', label: 'Zoom link', type: 'text' },
  { name: 'byAppointment', label: 'By appointment only', type: 'checkbox', span: 2 },
];

export type OfficeHourRow = {
  id: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  location: string | null;
  url: string | null;
  by_appointment: boolean;
  notes: string | null;
};

export type InstructorRow = {
  id: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  office: string | null;
  pronouns: string | null;
  notes: string | null;
  office_hours: OfficeHourRow[];
};

const ROLE_LABEL: Record<string, string> = {
  professor: 'Professor',
  ta: 'TA',
  grader: 'Grader',
  advisor: 'Advisor',
};

function OfficeHoursForm({
  instructorId,
  courseId,
  onDone,
}: {
  instructorId: string;
  courseId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [location, setLocation] = useState('');
  const [url, setUrl] = useState('');
  const [byAppointment, setByAppointment] = useState(false);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await addOfficeHours({
          instructorId, courseId, weekdays, startsAt, endsAt,
          location, url, byAppointment, notes: '',
        });

        if (result.ok) {
          onDone();
          startTransition(() => router.refresh());
        } else {
          setError(result.error);
        }
      }}
      className="mt-2 space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    >
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

      <div className="grid gap-2 sm:grid-cols-2">
        <input type="time" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required className={inputClass} />
        <input type="time" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required className={inputClass} />
      </div>

      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (e.g. BBB 2717)" className={inputClass} />
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Zoom link (optional)" className={inputClass} />

      <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
        <input
          type="checkbox"
          checked={byAppointment}
          onChange={(e) => setByAppointment(e.target.checked)}
          className="accent-[var(--color-accent)]"
        />
        By appointment only
      </label>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Save hours
        </button>
        <button type="button" onClick={onDone} className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-xs">
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddInstructorForm({ courseId, onDone }: { courseId: string; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [role, setRole] = useState('professor');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [office, setOffice] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await addInstructor({
          courseId, name, role, email, phone, office, pronouns, notes: '',
        });

        if (result.ok) {
          onDone();
          startTransition(() => router.refresh());
        } else {
          setError(result.error);
        }
      }}
      className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required autoFocus className={inputClass} />
        <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
          {Object.entries(ROLE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className={inputClass} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className={inputClass} />
        <input value={office} onChange={(e) => setOffice(e.target.value)} placeholder="Office" className={inputClass} />
        <input value={pronouns} onChange={(e) => setPronouns(e.target.value)} placeholder="Pronouns" className={inputClass} />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Add
        </button>
        <button type="button" onClick={onDone} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function Instructors({
  courseId,
  instructors,
}: {
  courseId: string;
  instructors: InstructorRow[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [hoursFor, setHoursFor] = useState<string | null>(null);
  const [editingPerson, setEditingPerson] = useState<string | null>(null);
  const [editingHours, setEditingHours] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const refresh = () => startTransition(() => router.refresh());

  return (
    <div className="space-y-3">
      {instructors.length === 0 && !adding && (
        <p className="text-xs text-[var(--color-muted)]">
          No one added yet. Add your professor, TA, or grader.
        </p>
      )}

      {instructors.map((person) => (
        <div
          key={person.id}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {person.name}
                <span className="ml-2 rounded bg-[var(--color-panel)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-muted)]">
                  {ROLE_LABEL[person.role] ?? person.role}
                </span>
                {person.pronouns && (
                  <span className="ml-2 text-xs text-[var(--color-muted)]">({person.pronouns})</span>
                )}
              </p>

              <div className="mt-1 space-y-0.5 text-xs text-[var(--color-muted)]">
                {person.email && (
                  <p>
                    <a href={`mailto:${person.email}`} className="text-[var(--color-accent)] hover:underline">
                      {person.email}
                    </a>
                  </p>
                )}
                {person.phone && <p>{person.phone}</p>}
                {person.office && <p>Office: {person.office}</p>}
              </div>
            </div>

            <span className="flex shrink-0 gap-2 text-xs">
              <button
                onClick={() => setEditingPerson(person.id)}
                className="text-[var(--color-accent)] hover:underline"
              >
                Edit
              </button>
              <button
                onClick={async () => {
                  await deleteInstructor(person.id, courseId);
                  refresh();
                }}
                className="text-[var(--color-muted)] hover:text-red-400"
                aria-label={`Remove ${person.name}`}
              >
                ✕
              </button>
            </span>
          </div>

          {editingPerson === person.id && (
            <div className="mt-2">
              <EditForm
                fields={INSTRUCTOR_FIELDS}
                initial={{
                  name: person.name,
                  role: person.role,
                  email: person.email ?? '',
                  phone: person.phone ?? '',
                  office: person.office ?? '',
                  pronouns: person.pronouns ?? '',
                  notes: person.notes ?? '',
                }}
                onSave={async (v: Record<string, FieldValue>) => {
                  const result = await updateInstructor(person.id, {
                    courseId,
                    name: String(v.name ?? ''),
                    role: String(v.role),
                    email: String(v.email ?? ''),
                    phone: String(v.phone ?? ''),
                    office: String(v.office ?? ''),
                    pronouns: String(v.pronouns ?? ''),
                    notes: String(v.notes ?? ''),
                  });

                  if (result.ok) {
                    setEditingPerson(null);
                    refresh();
                  }
                  return result;
                }}
                onCancel={() => setEditingPerson(null)}
              />
            </div>
          )}

          {person.office_hours.length > 0 && (
            <ul className="mt-2 space-y-1">
              {groupMeetings(
                // by_appointment folds into the group key so an appointment-only
                // slot never merges with a drop-in one at the same time.
                person.office_hours.map((h) => ({
                  id: h.id,
                  kind: h.by_appointment ? 'appointment' : 'dropin',
                  weekday: h.weekday,
                  starts_at: h.starts_at,
                  ends_at: h.ends_at,
                  location: h.location,
                  url: h.url,
                })),
              ).map((group) => {
                const key = group.ids.join(',');

                if (editingHours === key) {
                  return (
                    <li key={key}>
                      <EditForm
                        fields={OFFICE_HOURS_FIELDS}
                        initial={{
                          weekdays: group.weekdays,
                          startsAt: group.startsAt.slice(0, 5),
                          endsAt: group.endsAt.slice(0, 5),
                          location: group.location ?? '',
                          url: group.url ?? '',
                          byAppointment: group.kind === 'appointment',
                        }}
                        onSave={async (v: Record<string, FieldValue>) => {
                          const result = await updateOfficeHours(group.ids, {
                            instructorId: person.id,
                            courseId,
                            weekdays: (v.weekdays as number[]) ?? [],
                            startsAt: String(v.startsAt),
                            endsAt: String(v.endsAt),
                            location: String(v.location ?? ''),
                            url: String(v.url ?? ''),
                            byAppointment: Boolean(v.byAppointment),
                            notes: '',
                          });

                          if (result.ok) {
                            setEditingHours(null);
                            refresh();
                          }
                          return result;
                        }}
                        onCancel={() => setEditingHours(null)}
                      />
                    </li>
                  );
                }

                return (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                  >
                    <span className="min-w-0">
                      <strong>{formatWeekdays(group.weekdays)}</strong>{' '}
                      {formatTimeRange(group.startsAt, group.endsAt)}
                      {group.location && ` · ${group.location}`}
                      {group.kind === 'appointment' && ' · by appointment'}
                      {group.url && (
                        <a href={group.url} target="_blank" rel="noreferrer" className="ml-2 text-[var(--color-accent)] hover:underline">
                          join
                        </a>
                      )}
                    </span>

                    <span className="flex shrink-0 gap-2">
                      <button
                        onClick={() => setEditingHours(key)}
                        className="text-[var(--color-accent)] hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={async () => {
                          for (const id of group.ids) await deleteOfficeHours(id, courseId);
                          refresh();
                        }}
                        className="text-[var(--color-muted)] hover:text-red-400"
                        aria-label="Remove office hours"
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {hoursFor === person.id ? (
            <OfficeHoursForm
              instructorId={person.id}
              courseId={courseId}
              onDone={() => setHoursFor(null)}
            />
          ) : (
            <button
              onClick={() => setHoursFor(person.id)}
              className="mt-2 text-xs text-[var(--color-accent)] hover:underline"
            >
              + Add office hours
            </button>
          )}
        </div>
      ))}

      {adding ? (
        <AddInstructorForm courseId={courseId} onDone={() => setAdding(false)} />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-[var(--color-accent)] hover:underline"
        >
          + Add person
        </button>
      )}
    </div>
  );
}
