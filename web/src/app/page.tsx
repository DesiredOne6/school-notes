import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { groupByUrgency, formatDue, relativeDue, isoDaysFromNow } from '@/lib/util/dates';
import { SyncButton } from '@/components/SyncButton';
import { NewAssignmentForm, type CourseOption } from '@/components/NewAssignmentForm';
import { AssignmentCheckbox } from '@/components/AssignmentCheckbox';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  title: string;
  kind: string;
  status: string;
  due_at: string | null;
  due_is_all_day: boolean;
  points: number | null;
  url: string | null;
  courses: { code: string | null; title: string; color: string } | null;
};

const KIND_STYLE: Record<string, string> = {
  exam: 'bg-red-500/15 text-red-300',
  quiz: 'bg-amber-500/15 text-amber-300',
  project: 'bg-violet-500/15 text-violet-300',
  reading: 'bg-sky-500/15 text-sky-300',
};

const BUCKET_ACCENT: Record<string, string> = {
  overdue: 'text-red-400',
  today: 'text-amber-300',
  tomorrow: 'text-yellow-200',
};

/**
 * Tells the user why the list is empty. "Nothing connected" and "connected but
 * your school hasn't posted anything yet" need very different messages.
 */
function EmptyState({
  hasIntegrations,
  lastSyncedAt,
}: {
  hasIntegrations: boolean;
  lastSyncedAt: string | null;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-8 text-center">
      {!hasIntegrations ? (
        <p className="text-sm text-[var(--color-muted)]">
          Nothing here yet. Add an assignment above, or connect Canvas in{' '}
          <Link href="/settings" className="text-[var(--color-accent)] hover:underline">
            Settings
          </Link>{' '}
          to import them automatically.
        </p>
      ) : (
        <div className="space-y-2 text-sm text-[var(--color-muted)]">
          <p className="font-medium text-[#e9e9f0]">You&apos;re all clear.</p>
          <p>
            Canvas is connected but hasn&apos;t returned any assignments
            {lastSyncedAt
              ? ` as of the last sync (${new Date(lastSyncedAt).toLocaleString()}).`
              : ' yet.'}{' '}
            That&apos;s normal before term starts, or before instructors publish their courses.
          </p>
          <p>Add anything you already know about with the button above.</p>
        </div>
      )}
    </div>
  );
}

export default async function Dashboard() {
  const supabase = await createServerSupabase();
  const horizon = isoDaysFromNow(120);

  const [assignmentsRes, coursesRes, integrationsRes] = await Promise.all([
    supabase
      .from('assignments')
      .select('id, title, kind, status, due_at, due_is_all_day, points, url, courses(code, title, color)')
      .in('status', ['todo', 'in_progress'])
      .is('archived_at', null)
      .or(`due_at.is.null,due_at.lte.${horizon}`)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(200),
    supabase.from('courses').select('id, code, title').is('archived_at', null).order('code'),
    supabase.from('integrations').select('provider, last_synced_at').in('provider', ['canvas', 'ics']),
  ]);

  if (assignmentsRes.error) {
    return (
      <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        Could not load assignments: {assignmentsRes.error.message}
      </p>
    );
  }

  const rows = (assignmentsRes.data ?? []) as unknown as Row[];
  const groups = groupByUrgency(rows);
  const courses = (coursesRes.data ?? []) as CourseOption[];
  const integrations = integrationsRes.data ?? [];

  const lastSyncedAt =
    integrations
      .map((i) => i.last_synced_at)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">What&apos;s due</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {rows.length === 0
              ? 'Nothing open right now.'
              : `${rows.length} open item${rows.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <SyncButton />
      </div>

      <NewAssignmentForm courses={courses} />

      {groups.length === 0 && (
        <EmptyState hasIntegrations={integrations.length > 0} lastSyncedAt={lastSyncedAt} />
      )}

      {groups.map((group) => (
        <section key={group.bucket}>
          <h2
            className={`mb-3 text-xs font-semibold uppercase tracking-wider ${
              BUCKET_ACCENT[group.bucket] ?? 'text-[var(--color-muted)]'
            }`}
          >
            {group.label}
            <span className="ml-2 font-normal opacity-60">{group.items.length}</span>
          </h2>

          <ul className="space-y-2">
            {group.items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3"
              >
                <AssignmentCheckbox assignmentId={item.id} />

                <span
                  aria-hidden
                  className="h-8 w-1 shrink-0 rounded-full"
                  style={{ background: item.courses?.color ?? '#3f3f52' }}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    {KIND_STYLE[item.kind] && (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${KIND_STYLE[item.kind]}`}
                      >
                        {item.kind}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
                    {item.courses?.code ?? item.courses?.title ?? 'No course'} ·{' '}
                    {formatDue(item.due_at, item.due_is_all_day)}
                    {item.points !== null && ` · ${item.points} pts`}
                  </p>
                </div>

                <span className="shrink-0 text-xs tabular-nums text-[var(--color-muted)]">
                  {relativeDue(item.due_at)}
                </span>

                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs text-[var(--color-accent)] hover:underline"
                  >
                    Open
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
