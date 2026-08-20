/**
 * Grouping for recurring meeting times.
 *
 * A class that meets Tuesday and Thursday is stored as two rows, one per
 * weekday, because that is what the calendar needs to expand. Showing them as
 * two lines reads badly — "Tue, Thu 12:00–2:30 PM" is how a timetable is
 * actually written — so rows that differ only by weekday are folded together
 * for display.
 */

export type MeetingLike = {
  id: string;
  kind: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  location: string | null;
  url?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
};

export type MeetingGroup = {
  kind: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  url: string | null;
  startsOn: string | null;
  endsOn: string | null;
  /** Sorted with the week starting on Monday, as a timetable reads. */
  weekdays: number[];
  /** Every underlying row, so deleting the group removes all of them. */
  ids: string[];
};

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Monday first: a Friday discussion should not sort above a Tuesday lecture. */
function weekOrder(weekday: number): number {
  return weekday === 0 ? 6 : weekday - 1;
}

export function groupMeetings(meetings: MeetingLike[]): MeetingGroup[] {
  const groups = new Map<string, MeetingGroup>();

  for (const meeting of meetings) {
    // Everything except the weekday forms the identity of a group.
    // Term bounds are part of a group's identity too: a lecture that runs all
    // semester is not the same meeting as one limited to a few weeks.
    const key = [
      meeting.kind,
      meeting.starts_at,
      meeting.ends_at,
      meeting.location ?? '',
      meeting.url ?? '',
      meeting.starts_on ?? '',
      meeting.ends_on ?? '',
    ].join('|');

    const existing = groups.get(key);

    if (existing) {
      existing.weekdays.push(meeting.weekday);
      existing.ids.push(meeting.id);
    } else {
      groups.set(key, {
        kind: meeting.kind,
        startsAt: meeting.starts_at,
        endsAt: meeting.ends_at,
        location: meeting.location,
        url: meeting.url ?? null,
        startsOn: meeting.starts_on ?? null,
        endsOn: meeting.ends_on ?? null,
        weekdays: [meeting.weekday],
        ids: [meeting.id],
      });
    }
  }

  const result = [...groups.values()];

  for (const group of result) {
    group.weekdays.sort((a, b) => weekOrder(a) - weekOrder(b));
  }

  // Earliest day first, then earliest time, so the week reads top to bottom.
  return result.sort((a, b) => {
    const dayDiff = weekOrder(a.weekdays[0]) - weekOrder(b.weekdays[0]);
    return dayDiff !== 0 ? dayDiff : a.startsAt.localeCompare(b.startsAt);
  });
}

/** "Tue, Thu" */
export function formatWeekdays(weekdays: number[]): string {
  return weekdays.map((d) => DAY_LABEL[d]).join(', ');
}

/** "12:00 PM – 2:30 PM" */
export function formatTimeRange(startsAt: string, endsAt: string): string {
  return `${formatClock(startsAt)} – ${formatClock(endsAt)}`;
}

/** "14:30:00" -> "2:30 PM" */
export function formatClock(value: string): string {
  const [h, m] = value.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Meeting types worth distinguishing on a timetable. */
export const MEETING_KINDS = [
  { value: 'lecture', label: 'Lecture' },
  { value: 'discussion', label: 'Discussion' },
  { value: 'lab', label: 'Lab' },
  { value: 'recitation', label: 'Recitation' },
  { value: 'seminar', label: 'Seminar' },
  { value: 'studio', label: 'Studio' },
  { value: 'review', label: 'Review session' },
];

export function meetingKindLabel(kind: string): string {
  return MEETING_KINDS.find((k) => k.value === kind)?.label ?? kind;
}
