import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { Instructors, type InstructorRow } from '@/components/course-hub/Instructors';
import { Links, type LinkRow } from '@/components/course-hub/Links';
import { Documents, type DocumentRow } from '@/components/course-hub/Documents';
import { DAY_LABEL, formatClock } from '@/components/course-hub/shared';
import { relativeDue } from '@/lib/util/dates';
import {
  expandMeetings,
  assignmentsToAgenda,
  eventsToAgenda,
  groupByDay,
  type MeetingRow,
  type AssignmentRow,
  type EventRow,
} from '@/lib/calendar/agenda';
import { zonedDateKey } from '@/lib/util/timezone';
import { toPlainPreview } from '@/lib/notes/wikilinks';
import { NewNoteButton } from '@/components/notes/NewNoteButton';

export const dynamic = 'force-dynamic';

/** How far ahead the hub's upcoming panel looks. */
const UPCOMING_DAYS = 14;

const ITEM_ICON: Record<string, string> = {
  class: '🎓',
  assignment: '📌',
  event: '📅',
};

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && (
        <p className="mt-1 mb-3 text-xs text-[var(--color-muted)]">{description}</p>
      )}
      <div className={description ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

export default async function CourseHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', auth.user.id)
    .maybeSingle();

  const timeZone = profile?.timezone ?? 'America/New_York';

  const [courseRes, instructorsRes, linksRes, documentsRes, assignmentsRes, notesRes] =
    await Promise.all([
    supabase
      .from('courses')
      .select('id, code, title, color, location, notes, course_meetings(id, kind, weekday, starts_at, ends_at, location, url)')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('instructors')
      .select('id, name, role, email, phone, office, pronouns, notes, office_hours(id, weekday, starts_at, ends_at, location, url, by_appointment, notes)')
      .eq('course_id', id)
      .order('role'),
    supabase
      .from('course_links')
      .select('id, kind, label, url, passcode')
      .eq('course_id', id)
      .order('sort_order'),
    supabase
      .from('documents')
      .select('id, title, kind, storage_path, url, byte_size')
      .eq('course_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('assignments')
      .select('id, title, kind, due_at, due_is_all_day, url, courses(code, title, color)')
      .eq('course_id', id)
      .in('status', ['todo', 'in_progress'])
      .is('archived_at', null)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(50),
    supabase
      .from('notes')
      .select('id, title, body, kind, updated_at')
      .eq('course_id', id)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(20),
  ]);

  const course = courseRes.data;
  if (!course) notFound();

  // --- Upcoming: classes, deadlines, and related calendar events ------------
  const now = new Date();
  const rangeEnd = new Date(now.getTime() + UPCOMING_DAYS * 86_400_000);

  // Google events carry no course id, so the only link back to a course is the
  // course code appearing in the title. That is a heuristic, not a guarantee —
  // it catches "EECS 281 review session" and misses anything unlabelled.
  const { data: relatedEvents } = course.code
    ? await supabase
        .from('calendar_events')
        .select(
          'id, title, starts_at, ends_at, is_all_day, location, url,' +
            ' external_calendars!inner(name, color, color_override, is_visible)',
        )
        .ilike('title', `%${course.code}%`)
        .gte('starts_at', now.toISOString())
        .lte('starts_at', rangeEnd.toISOString())
        .eq('external_calendars.is_visible', true)
    : { data: [] };

  const meetingsForAgenda = (course.course_meetings ?? []) as unknown as MeetingRow[];

  const upcomingItems = [
    ...expandMeetings(
      meetingsForAgenda.map((m) => ({
        ...m,
        courses: { code: course.code, title: course.title, color: course.color },
      })),
      now,
      rangeEnd,
      timeZone,
    ),
    ...assignmentsToAgenda(
      ((assignmentsRes.data ?? []) as unknown as AssignmentRow[]).filter(
        (a) => a.due_at && new Date(a.due_at) >= now && new Date(a.due_at) <= rangeEnd,
      ),
    ),
    ...eventsToAgenda((relatedEvents ?? []) as unknown as EventRow[]),
  ];

  const todayKey = zonedDateKey(now, timeZone);
  const upcoming = [...groupByDay(upcomingItems, timeZone).entries()].sort(
    ([a], [b]) => a.localeCompare(b),
  );

  // Cast via unknown: the hand-written Database types declare no relationship
  // metadata, so supabase-js cannot infer the shape of an embedded select.
  const meetings = (course.course_meetings ?? []) as unknown as Array<{
    id: string; kind: string; weekday: number; starts_at: string;
    ends_at: string; location: string | null; url: string | null;
  }>;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/courses" className="text-xs text-[var(--color-muted)] hover:text-white">
          ← All courses
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <span aria-hidden className="h-10 w-1.5 rounded-full" style={{ background: course.color }} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {course.code ?? course.title}
            </h1>
            {course.code && (
              <p className="text-sm text-[var(--color-muted)]">{course.title}</p>
            )}
          </div>
        </div>
      </div>

      <Panel title="Meeting times" description="Edit these from the Courses list.">
        {meetings.length === 0 ? (
          <p className="text-xs text-[var(--color-muted)]">No meeting times set.</p>
        ) : (
          <ul className="space-y-1">
            {meetings
              .slice()
              .sort((a, b) => a.weekday - b.weekday || a.starts_at.localeCompare(b.starts_at))
              .map((m) => (
                <li
                  key={m.id}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs"
                >
                  <strong>{DAY_LABEL[m.weekday]}</strong> {formatClock(m.starts_at)}–{formatClock(m.ends_at)}
                  {m.location && ` · ${m.location}`}
                  {m.kind !== 'lecture' && ` · ${m.kind}`}
                  {m.url && (
                    <a href={m.url} target="_blank" rel="noreferrer" className="ml-2 text-[var(--color-accent)] hover:underline">
                      join
                    </a>
                  )}
                </li>
              ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="People"
        description="Professor, TAs, and their office hours."
      >
        <Instructors
          courseId={id}
          instructors={(instructorsRes.data ?? []) as unknown as InstructorRow[]}
        />
      </Panel>

      <Panel
        title="Links"
        description="Zoom rooms, Canvas pages, textbooks — anything you open often."
      >
        <Links courseId={id} links={(linksRes.data ?? []) as LinkRow[]} />
      </Panel>

      <Panel
        title="Documents"
        description="Syllabus, slides, and readings. Files are private to you."
      >
        <Documents
          courseId={id}
          userId={auth.user.id}
          documents={(documentsRes.data ?? []) as DocumentRow[]}
        />
      </Panel>

      <Panel
        title="Notes"
        description="Everything you've written for this course."
      >
        <div className="space-y-2">
          {(notesRes.data ?? []).length === 0 ? (
            <p className="text-xs text-[var(--color-muted)]">
              No notes for this course yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {(notesRes.data ?? []).map((note) => (
                <li key={note.id}>
                  <Link
                    href={`/notes/${note.id}`}
                    className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 hover:border-[var(--color-accent)]"
                  >
                    <p className="truncate text-sm">
                      {note.kind === 'handwritten' && <span aria-hidden className="mr-1.5">✍️</span>}
                      {note.title}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-[var(--color-muted)]">
                      {note.kind === 'handwritten'
                        ? 'Handwritten page'
                        : toPlainPreview(note.body, 90) || 'Empty note'}
                      {' · '}
                      {new Date(note.updated_at).toLocaleDateString()}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <NewNoteButton courses={[]} lockedCourseId={id} label="+ New note for this course" />
            <Link
              href={`/notes?course=${id}`}
              className="text-xs text-[var(--color-accent)] hover:underline"
            >
              See all in Notes →
            </Link>
          </div>
        </div>
      </Panel>

      <Panel
        title="Upcoming"
        description="Classes, deadlines, and matching calendar events over the next two weeks."
      >
        {upcoming.length === 0 ? (
          <p className="text-xs text-[var(--color-muted)]">
            Nothing scheduled. Add meeting times above, or an assignment from the dashboard.
          </p>
        ) : (
          <div className="space-y-3">
            {upcoming.map(([dayKey, items]) => (
              <div key={dayKey}>
                <p className="mb-1 text-xs font-semibold text-[var(--color-muted)]">
                  {new Intl.DateTimeFormat('en-US', {
                    weekday: 'long', month: 'short', day: 'numeric', timeZone,
                  }).format(new Date(`${dayKey}T12:00:00Z`))}
                  {dayKey === todayKey && (
                    <span className="ml-2 text-[var(--color-accent)]">Today</span>
                  )}
                </p>

                <ul className="space-y-1">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span aria-hidden>{ITEM_ICON[item.kind]}</span>
                        <div className="min-w-0">
                          <p className="truncate text-sm">{item.title}</p>
                          <p className="text-xs text-[var(--color-muted)]">
                            {item.isAllDay
                              ? 'All day'
                              : new Intl.DateTimeFormat('en-US', {
                                  hour: 'numeric', minute: '2-digit', timeZone,
                                }).format(item.startsAt)}
                            {item.location && ` · ${item.location}`}
                            {item.subtitle && ` · ${item.subtitle}`}
                          </p>
                        </div>
                      </div>

                      {item.kind === 'assignment' && (
                        <span className="shrink-0 text-xs tabular-nums text-[var(--color-muted)]">
                          {relativeDue(item.startsAt.toISOString())}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
