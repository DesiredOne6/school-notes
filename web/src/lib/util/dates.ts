/**
 * Date grouping and formatting for the assignment views.
 *
 * All functions take an explicit `now` so they can be tested deterministically
 * and rendered consistently on the server and the client.
 */

export type UrgencyBucket = 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'later' | 'undated';

export const BUCKET_LABELS: Record<UrgencyBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  this_week: 'This week',
  later: 'Later',
  undated: 'No due date',
};

export const BUCKET_ORDER: UrgencyBucket[] = [
  'overdue', 'today', 'tomorrow', 'this_week', 'later', 'undated',
];

/** ISO timestamp `days` from now. Used to bound assignment queries. */
export function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** Calendar days between two instants, ignoring time of day. */
function calendarDayDiff(a: Date, b: Date): number {
  const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((startA.getTime() - startB.getTime()) / 86_400_000);
}

export function bucketFor(dueAt: string | null, now: Date = new Date()): UrgencyBucket {
  if (!dueAt) return 'undated';

  const due = new Date(dueAt);

  // Past the deadline is overdue regardless of which calendar day it fell on.
  if (due.getTime() < now.getTime()) return 'overdue';

  const days = calendarDayDiff(due, now);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 7) return 'this_week';
  return 'later';
}

export type Groupable = { due_at: string | null };

/** Buckets assignments by urgency, each bucket sorted by due date. */
export function groupByUrgency<T extends Groupable>(
  items: T[],
  now: Date = new Date(),
): Array<{ bucket: UrgencyBucket; label: string; items: T[] }> {
  const groups = new Map<UrgencyBucket, T[]>();

  for (const item of items) {
    const bucket = bucketFor(item.due_at, now);
    const list = groups.get(bucket) ?? [];
    list.push(item);
    groups.set(bucket, list);
  }

  return BUCKET_ORDER.filter((b) => groups.has(b)).map((bucket) => ({
    bucket,
    label: BUCKET_LABELS[bucket],
    items: groups.get(bucket)!.sort((x, y) => {
      if (!x.due_at) return 1;
      if (!y.due_at) return -1;
      return new Date(x.due_at).getTime() - new Date(y.due_at).getTime();
    }),
  }));
}

/** "Fri, Oct 3 at 11:59 PM" — or just the date for all-day deadlines. */
export function formatDue(
  dueAt: string | null,
  allDay = false,
  timezone?: string,
): string {
  if (!dueAt) return 'No due date';

  const due = new Date(dueAt);
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  };

  const datePart = new Intl.DateTimeFormat('en-US', dateOpts).format(due);
  if (allDay) return datePart;

  const timePart = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(due);

  return `${datePart} at ${timePart}`;
}

/** Compact relative label: "in 3h", "in 2d", "4h late". */
export function relativeDue(dueAt: string | null, now: Date = new Date()): string {
  if (!dueAt) return '';

  const diffMs = new Date(dueAt).getTime() - now.getTime();
  const late = diffMs < 0;
  const minutes = Math.round(Math.abs(diffMs) / 60_000);

  let value: string;
  if (minutes < 60) value = `${minutes}m`;
  else if (minutes < 1440) value = `${Math.round(minutes / 60)}h`;
  else value = `${Math.round(minutes / 1440)}d`;

  return late ? `${value} late` : `in ${value}`;
}
