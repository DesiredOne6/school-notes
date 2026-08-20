import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { Instructors, type InstructorRow } from '@/components/course-hub/Instructors';
import { Links, type LinkRow } from '@/components/course-hub/Links';
import { Documents, type DocumentRow } from '@/components/course-hub/Documents';
import { DAY_LABEL, formatClock } from '@/components/course-hub/shared';
import { formatDue, relativeDue } from '@/lib/util/dates';

export const dynamic = 'force-dynamic';

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

  const [courseRes, instructorsRes, linksRes, documentsRes, assignmentsRes] = await Promise.all([
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
      .select('id, title, kind, due_at, due_is_all_day, url')
      .eq('course_id', id)
      .in('status', ['todo', 'in_progress'])
      .is('archived_at', null)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(10),
  ]);

  const course = courseRes.data;
  if (!course) notFound();

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

      <Panel title="Open work">
        {(assignmentsRes.data ?? []).length === 0 ? (
          <p className="text-xs text-[var(--color-muted)]">Nothing due for this course.</p>
        ) : (
          <ul className="space-y-1.5">
            {(assignmentsRes.data ?? []).map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{a.title}</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {formatDue(a.due_at, a.due_is_all_day)}
                  </p>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-[var(--color-muted)]">
                  {relativeDue(a.due_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
