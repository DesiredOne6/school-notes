import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  expandMeetings,
  assignmentsToAgenda,
  eventsToAgenda,
  groupByDay,
  weekRange,
  dedupeClassEvents,
  type AgendaItem,
  type MeetingRow,
  type AssignmentRow,
  type EventRow,
} from '@/lib/calendar/agenda';
import { zonedDateKey } from '@/lib/util/timezone';

export const dynamic = 'force-dynamic';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

/** Shifts a YYYY-MM-DD key by whole days without tripping over DST. */
function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

function ItemRow({ item, timeZone }: { item: AgendaItem; timeZone: string }) {
  const body = (
    <div className="flex gap-2">
      <span
        aria-hidden
        className="mt-0.5 w-1 shrink-0 self-stretch rounded-full"
        style={{ background: item.color }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium leading-tight">
          {item.kind === 'assignment' && <span aria-hidden className="mr-1">📌</span>}
          {item.title}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-[var(--color-muted)]">
          {item.isAllDay ? 'All day' : formatTime(item.startsAt, timeZone)}
          {item.endsAt && !item.isAllDay && ` – ${formatTime(item.endsAt, timeZone)}`}
          {item.subtitle && ` · ${item.subtitle}`}
        </p>
        {item.location && (
          <p className="truncate text-[10px] text-[var(--color-muted)]">{item.location}</p>
        )}
      </div>
    </div>
  );

  const className = 'block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2';

  return item.url ? (
    <a href={item.url} target="_blank" rel="noreferrer" className={`${className} hover:border-[var(--color-accent)]`}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabase();

  const { data: auth } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone, hide_duplicate_class_events')
    .eq('id', auth.user!.id)
    .maybeSingle();

  const timeZone = profile?.timezone ?? 'America/New_York';
  const hideDuplicates = profile?.hide_duplicate_class_events ?? true;

  // ?week=YYYY-MM-DD anchors the view; without it, this week.
  const anchor = params.week ? new Date(`${params.week}T12:00:00Z`) : new Date();
  const { start, end } = weekRange(anchor, timeZone);

  const [meetingsRes, assignmentsRes, eventsRes] = await Promise.all([
    supabase
      .from('course_meetings')
      .select('id, kind, weekday, starts_at, ends_at, location, url, starts_on, ends_on, courses(code, title, color)'),
    supabase
      .from('assignments')
      .select('id, title, kind, due_at, due_is_all_day, url, courses(code, title, color)')
      .in('status', ['todo', 'in_progress'])
      .is('archived_at', null)
      .gte('due_at', start.toISOString())
      .lte('due_at', end.toISOString()),
    supabase
      .from('calendar_events')
      .select('id, title, starts_at, ends_at, is_all_day, location, url, external_calendars!inner(name, color, color_override, is_visible)')
      .gte('starts_at', start.toISOString())
      .lte('starts_at', end.toISOString())
      .eq('external_calendars.is_visible', true),
  ]);

  const allItems: AgendaItem[] = [
    ...expandMeetings((meetingsRes.data ?? []) as unknown as MeetingRow[], start, end, timeZone),
    ...assignmentsToAgenda((assignmentsRes.data ?? []) as unknown as AssignmentRow[]),
    ...eventsToAgenda((eventsRes.data ?? []) as unknown as EventRow[]),
  ];

  // A university that publishes class times to Google would otherwise show
  // every lecture twice — once from the course schedule, once from the feed.
  const items = hideDuplicates ? dedupeClassEvents(allItems) : allItems;
  const hiddenCount = allItems.length - items.length;

  const byDay = groupByDay(items, timeZone);
  const startKey = zonedDateKey(start, timeZone);
  const todayKey = zonedDateKey(new Date(), timeZone);
  const dayKeys = Array.from({ length: 7 }, (_, i) => shiftDateKey(startKey, i));

  const monthLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(start);

  const hasAnything = items.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{monthLabel}</p>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/calendar?week=${shiftDateKey(startKey, -7)}`}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-1.5 hover:border-[var(--color-accent)]"
          >
            ← Prev
          </Link>
          <Link
            href="/calendar"
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-1.5 hover:border-[var(--color-accent)]"
          >
            Today
          </Link>
          <Link
            href={`/calendar?week=${shiftDateKey(startKey, 7)}`}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-1.5 hover:border-[var(--color-accent)]"
          >
            Next →
          </Link>
        </div>
      </div>

      {!hasAnything && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 text-center text-sm text-[var(--color-muted)]">
          <p>Nothing scheduled this week.</p>
          <p className="mt-2">
            Add your class times under{' '}
            <Link href="/courses" className="text-[var(--color-accent)] hover:underline">
              Courses
            </Link>
            , or connect a Google account in{' '}
            <Link href="/settings" className="text-[var(--color-accent)] hover:underline">
              Settings
            </Link>{' '}
            to pull in club and personal calendars.
          </p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {dayKeys.map((key) => {
          const dayItems = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const dayNumber = Number(key.slice(8, 10));
          const weekdayIndex = new Date(`${key}T12:00:00Z`).getUTCDay();

          return (
            <section
              key={key}
              className={`rounded-xl border p-2 ${
                isToday
                  ? 'border-[var(--color-accent)] bg-[var(--color-panel)]'
                  : 'border-[var(--color-border)] bg-[var(--color-panel)]'
              }`}
            >
              <header className="mb-2 flex items-baseline justify-between px-1">
                <span className={`text-xs font-semibold ${isToday ? 'text-[var(--color-accent)]' : ''}`}>
                  {DAY_NAMES[weekdayIndex].slice(0, 3)}
                </span>
                <span className={`text-xs ${isToday ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}`}>
                  {dayNumber}
                </span>
              </header>

              <div className="space-y-1.5">
                {dayItems.length === 0 ? (
                  <p className="px-1 py-2 text-[10px] text-[var(--color-muted)]">—</p>
                ) : (
                  dayItems.map((item) => (
                    <ItemRow key={item.id} item={item} timeZone={timeZone} />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-xs text-[var(--color-muted)]">
        📌 = assignment due · coloured bars match your course and calendar colours
        {hiddenCount > 0 && (
          <>
            {' · '}
            {hiddenCount} duplicate{hiddenCount === 1 ? '' : 's'} of your class times hidden (
            <Link href="/settings" className="text-[var(--color-accent)] hover:underline">
              change
            </Link>
            )
          </>
        )}
      </p>
    </div>
  );
}
