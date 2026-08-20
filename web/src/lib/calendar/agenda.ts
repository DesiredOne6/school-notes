import { zonedTimeToUtc, zonedDateKey } from '@/lib/util/timezone';
import { meetingKindLabel } from '@/lib/util/meetings';

export type AgendaKind = 'assignment' | 'class' | 'event';

export type AgendaItem = {
  id: string;
  kind: AgendaKind;
  title: string;
  subtitle: string | null;
  startsAt: Date;
  /** Null for deadlines, which are instants rather than spans. */
  endsAt: Date | null;
  isAllDay: boolean;
  color: string;
  location: string | null;
  url: string | null;
};

export type MeetingRow = {
  id: string;
  kind: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  location: string | null;
  url: string | null;
  starts_on: string | null;
  ends_on: string | null;
  courses: { code: string | null; title: string; color: string } | null;
};

export type AssignmentRow = {
  id: string;
  title: string;
  kind: string;
  due_at: string | null;
  due_is_all_day: boolean;
  url: string | null;
  courses: { code: string | null; title: string; color: string } | null;
};

export type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
  location: string | null;
  url: string | null;
  external_calendars: { name: string; color: string | null; color_override: string | null } | null;
};

const DEFAULT_COURSE_COLOR = '#6366f1';
const DEFAULT_EVENT_COLOR = '#64748b';

/** "HH:MM:SS" or "HH:MM" from Postgres `time` — returns [h, m, s]. */
function parseClock(value: string): [number, number, number] {
  const [h = '0', m = '0', s = '0'] = value.split(':');
  return [Number(h), Number(m), Number(s)];
}

/** Every calendar date in the range, as UTC-midnight timestamps. */
function eachDate(rangeStart: Date, rangeEnd: Date, timeZone: string): number[] {
  const startKey = zonedDateKey(rangeStart, timeZone);
  const endKey = zonedDateKey(rangeEnd, timeZone);

  const [sy, sm, sd] = startKey.split('-').map(Number);
  const [ey, em, ed] = endKey.split('-').map(Number);

  const out: number[] = [];
  let cursor = Date.UTC(sy, sm - 1, sd);
  const last = Date.UTC(ey, em - 1, ed);

  // Pure-date arithmetic in UTC, so DST transitions can't shift the sequence.
  while (cursor <= last) {
    out.push(cursor);
    cursor += 86_400_000;
  }

  return out;
}

/**
 * Expands weekly class meetings into concrete occurrences within the range.
 *
 * Meeting times are stored as local wall-clock (a Postgres `time`), so 9am
 * class stays 9am across a DST boundary — which is what a timetable means.
 */
export function expandMeetings(
  meetings: MeetingRow[],
  rangeStart: Date,
  rangeEnd: Date,
  timeZone: string,
): AgendaItem[] {
  const items: AgendaItem[] = [];
  const dates = eachDate(rangeStart, rangeEnd, timeZone);

  for (const meeting of meetings) {
    const [sh, sm, ss] = parseClock(meeting.starts_at);
    const [eh, em, es] = parseClock(meeting.ends_at);

    for (const dateMs of dates) {
      const date = new Date(dateMs);
      if (date.getUTCDay() !== meeting.weekday) continue;

      const key = zonedDateKey(date, 'UTC');

      // Respect the term bounds, when set.
      if (meeting.starts_on && key < meeting.starts_on) continue;
      if (meeting.ends_on && key > meeting.ends_on) continue;

      const year = date.getUTCFullYear();
      const month = date.getUTCMonth() + 1;
      const day = date.getUTCDate();

      const startsAt = zonedTimeToUtc(year, month, day, sh, sm, ss, timeZone);
      const endsAt = zonedTimeToUtc(year, month, day, eh, em, es, timeZone);

      if (startsAt < rangeStart || startsAt > rangeEnd) continue;

      items.push({
        id: `${meeting.id}:${key}`,
        kind: 'class',
        title: meeting.courses?.code ?? meeting.courses?.title ?? 'Class',
        // Lecture is the default and adds nothing; a discussion or lab is
        // worth distinguishing at a glance on a crowded week.
        subtitle: meeting.kind === 'lecture' ? null : meetingKindLabel(meeting.kind),
        startsAt,
        endsAt,
        isAllDay: false,
        color: meeting.courses?.color ?? DEFAULT_COURSE_COLOR,
        location: meeting.location,
        url: meeting.url,
      });
    }
  }

  return items;
}

/** Assignment deadlines as agenda items. */
export function assignmentsToAgenda(assignments: AssignmentRow[]): AgendaItem[] {
  return assignments
    .filter((a) => a.due_at !== null)
    .map((a) => ({
      id: a.id,
      kind: 'assignment' as const,
      title: a.title,
      subtitle: a.courses?.code ?? a.courses?.title ?? null,
      startsAt: new Date(a.due_at!),
      endsAt: null,
      isAllDay: a.due_is_all_day,
      color: a.courses?.color ?? DEFAULT_COURSE_COLOR,
      location: null,
      url: a.url,
    }));
}

/** Google calendar events as agenda items. */
export function eventsToAgenda(events: EventRow[]): AgendaItem[] {
  return events.map((e) => ({
    id: e.id,
    kind: 'event' as const,
    title: e.title,
    subtitle: e.external_calendars?.name ?? null,
    startsAt: new Date(e.starts_at),
    endsAt: new Date(e.ends_at),
    isAllDay: e.is_all_day,
    color:
      e.external_calendars?.color_override ??
      e.external_calendars?.color ??
      DEFAULT_EVENT_COLOR,
    location: e.location,
    url: e.url,
  }));
}

/** Loose title comparison for duplicate detection. */
function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Drops external calendar events that duplicate something the app already
 * shows.
 *
 * Two sources of doubling, both common:
 *
 * 1. A university publishes class times to Google, so a class the user also
 *    entered as a course meeting appears twice.
 * 2. The Canvas calendar feed is subscribed inside Google, so every assignment
 *    arrives again as a calendar event.
 *
 * In both cases the app's own record wins, because it carries what the copy
 * does not: room and meeting type for a class, status and points for an
 * assignment.
 *
 * The rules are deliberately conservative — an event must line up in time AND
 * be identifiably the same thing. Overlapping in time alone is never enough,
 * or a genuine clash (a dentist appointment during a lecture, an interview
 * while an essay is due) would vanish silently.
 *
 * Assignments themselves are never removed. Only items of kind 'event' are
 * ever candidates, so a deadline that falls during class always survives.
 */
export function dedupeClassEvents(
  items: AgendaItem[],
  toleranceMinutes = 15,
): AgendaItem[] {
  const classes = items.filter((i) => i.kind === 'class');
  const assignments = items.filter((i) => i.kind === 'assignment');
  if (classes.length === 0 && assignments.length === 0) return items;

  const toleranceMs = toleranceMinutes * 60_000;

  return items.filter((item) => {
    if (item.kind !== 'event') return true;

    const eventTitle = normalizeForMatch(item.title);

    // --- Duplicate of a class -----------------------------------------
    const duplicatesClass = classes.some((klass) => {
      const startsTogether =
        Math.abs(item.startsAt.getTime() - klass.startsAt.getTime()) <= toleranceMs;
      if (!startsTogether) return false;

      const mentionsCourse = eventTitle.includes(normalizeForMatch(klass.title));

      const endsTogether =
        item.endsAt !== null &&
        klass.endsAt !== null &&
        Math.abs(item.endsAt.getTime() - klass.endsAt.getTime()) <= toleranceMs;

      return mentionsCourse || endsTogether;
    });

    if (duplicatesClass) return false;

    // --- Duplicate of an assignment -----------------------------------
    // The Canvas feed titles events "Problem Set 4 [EECS 281]", so the event
    // title contains the assignment title. A title match is required here:
    // unlike a class, an assignment has no duration to corroborate it.
    const duplicatesAssignment = assignments.some((assignment) => {
      const dueTogether =
        Math.abs(item.startsAt.getTime() - assignment.startsAt.getTime()) <= toleranceMs;
      if (!dueTogether) return false;

      const title = normalizeForMatch(assignment.title);
      return title.length > 0 && eventTitle.includes(title);
    });

    return !duplicatesAssignment;
  });
}

/**
 * Groups agenda items by calendar day in the user's timezone.
 *
 * All-day items sort first within a day; the rest sort by start time, with
 * deadlines after any spanning event that starts at the same instant.
 */
export function groupByDay(
  items: AgendaItem[],
  timeZone: string,
): Map<string, AgendaItem[]> {
  const byDay = new Map<string, AgendaItem[]>();

  for (const item of items) {
    const key = zonedDateKey(item.startsAt, timeZone);
    const list = byDay.get(key) ?? [];
    list.push(item);
    byDay.set(key, list);
  }

  for (const list of byDay.values()) {
    list.sort((a, b) => {
      if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
      const diff = a.startsAt.getTime() - b.startsAt.getTime();
      if (diff !== 0) return diff;
      // Deadlines read better after the class they follow.
      const rank = { class: 0, event: 1, assignment: 2 };
      return rank[a.kind] - rank[b.kind];
    });
  }

  return byDay;
}

/** The Sunday-anchored week containing `date`, in the user's timezone. */
export function weekRange(date: Date, timeZone: string): { start: Date; end: Date } {
  const key = zonedDateKey(date, timeZone);
  const [y, m, d] = key.split('-').map(Number);

  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const sunday = new Date(Date.UTC(y, m - 1, d - weekday));

  const start = zonedTimeToUtc(
    sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate(), 0, 0, 0, timeZone,
  );

  const saturday = new Date(sunday.getTime() + 6 * 86_400_000);
  const end = zonedTimeToUtc(
    saturday.getUTCFullYear(), saturday.getUTCMonth() + 1, saturday.getUTCDate(), 23, 59, 59, timeZone,
  );

  return { start, end };
}
