import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  expandMeetings,
  assignmentsToAgenda,
  eventsToAgenda,
  groupByDay,
  weekRange,
  dedupeClassEvents,
  type MeetingRow,
} from '@/lib/calendar/agenda';

const TZ = 'America/New_York';

const course = { code: 'EECS 281', title: 'Data Structures', color: '#f59e0b' };

function meeting(overrides: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: 'm1',
    kind: 'lecture',
    weekday: 1, // Monday
    starts_at: '10:00:00',
    ends_at: '11:30:00',
    location: 'DOW 1013',
    url: null,
    starts_on: null,
    ends_on: null,
    courses: course,
    ...overrides,
  };
}

test('a weekly class expands to one occurrence per matching weekday', () => {
  // Sun 15 Mar 2026 through Sat 21 Mar 2026.
  const start = new Date('2026-03-15T04:00:00Z');
  const end = new Date('2026-03-22T03:59:59Z');

  const items = expandMeetings([meeting()], start, end, TZ);

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'EECS 281');
  // 10:00 EDT on Monday 16 March is 14:00 UTC.
  assert.equal(items[0].startsAt.toISOString(), '2026-03-16T14:00:00.000Z');
  assert.equal(items[0].endsAt?.toISOString(), '2026-03-16T15:30:00.000Z');
});

test('class times hold local wall-clock across a DST transition', () => {
  // US DST began 8 March 2026. A 10:00 class is 10:00 local on both sides,
  // which is 15:00 UTC in EST and 14:00 UTC in EDT.
  const before = expandMeetings(
    [meeting()],
    new Date('2026-03-01T05:00:00Z'),
    new Date('2026-03-08T04:59:59Z'),
    TZ,
  );
  const after = expandMeetings(
    [meeting()],
    new Date('2026-03-15T04:00:00Z'),
    new Date('2026-03-22T03:59:59Z'),
    TZ,
  );

  assert.equal(before[0].startsAt.toISOString(), '2026-03-02T15:00:00.000Z', 'EST');
  assert.equal(after[0].startsAt.toISOString(), '2026-03-16T14:00:00.000Z', 'EDT');
});

test('term bounds keep a class off the calendar outside the term', () => {
  const start = new Date('2026-03-15T04:00:00Z');
  const end = new Date('2026-03-22T03:59:59Z');

  const ended = expandMeetings(
    [meeting({ ends_on: '2026-03-10' })], start, end, TZ,
  );
  assert.equal(ended.length, 0, 'should not render after the term ends');

  const notStarted = expandMeetings(
    [meeting({ starts_on: '2026-04-01' })], start, end, TZ,
  );
  assert.equal(notStarted.length, 0, 'should not render before the term starts');

  const inTerm = expandMeetings(
    [meeting({ starts_on: '2026-01-05', ends_on: '2026-04-30' })], start, end, TZ,
  );
  assert.equal(inTerm.length, 1);
});

test('a multi-week range produces one occurrence per week', () => {
  const items = expandMeetings(
    [meeting()],
    new Date('2026-03-01T05:00:00Z'),
    new Date('2026-03-29T03:59:59Z'),
    TZ,
  );
  assert.equal(items.length, 4);
});

test('assignments and events convert to agenda items', () => {
  const assignments = assignmentsToAgenda([
    {
      id: 'a1', title: 'Project 2', kind: 'project',
      due_at: '2026-03-16T03:59:00Z', due_is_all_day: false,
      url: 'https://example.edu/a/1', courses: course,
    },
    {
      id: 'a2', title: 'No deadline', kind: 'assignment',
      due_at: null, due_is_all_day: false, url: null, courses: course,
    },
  ]);

  assert.equal(assignments.length, 1, 'undated work is not on the calendar');
  assert.equal(assignments[0].endsAt, null, 'a deadline is an instant, not a span');
  assert.equal(assignments[0].subtitle, 'EECS 281');

  const events = eventsToAgenda([
    {
      id: 'e1', title: 'Robotics Club', starts_at: '2026-03-16T22:00:00Z',
      ends_at: '2026-03-16T23:00:00Z', is_all_day: false, location: 'BBB 1670',
      url: null,
      external_calendars: { name: 'Clubs', color: '#0ea5e9', color_override: null },
    },
  ]);

  assert.equal(events[0].color, '#0ea5e9');
  assert.equal(events[0].subtitle, 'Clubs');
});

test('a colour override beats the colour Google reports', () => {
  const events = eventsToAgenda([
    {
      id: 'e1', title: 'Study group', starts_at: '2026-03-16T22:00:00Z',
      ends_at: '2026-03-16T23:00:00Z', is_all_day: false, location: null, url: null,
      external_calendars: { name: 'Personal', color: '#0ea5e9', color_override: '#ef4444' },
    },
  ]);
  assert.equal(events[0].color, '#ef4444');
});

test('groupByDay buckets by local date and orders within the day', () => {
  const items = [
    ...eventsToAgenda([{
      id: 'e1', title: 'Club', starts_at: '2026-03-16T22:00:00Z',
      ends_at: '2026-03-16T23:00:00Z', is_all_day: false, location: null, url: null,
      external_calendars: { name: 'Clubs', color: null, color_override: null },
    }]),
    ...expandMeetings([meeting()], new Date('2026-03-15T04:00:00Z'), new Date('2026-03-22T03:59:59Z'), TZ),
    ...assignmentsToAgenda([{
      id: 'a1', title: 'Project 2', kind: 'project',
      due_at: '2026-03-16T14:00:00Z', due_is_all_day: false, url: null, courses: course,
    }]),
  ];

  const byDay = groupByDay(items, TZ);
  const monday = byDay.get('2026-03-16');

  assert.ok(monday);
  assert.equal(monday.length, 3);
  // Class and deadline share 14:00Z; the class sorts first, then the club at 22:00Z.
  assert.deepEqual(monday.map((i) => i.kind), ['class', 'assignment', 'event']);
});

test('an 11pm event lands on the local day, not the UTC one', () => {
  // 2026-03-16T03:30:00Z is 11:30pm on 15 March in New York.
  const byDay = groupByDay(
    eventsToAgenda([{
      id: 'e1', title: 'Late meeting', starts_at: '2026-03-16T03:30:00Z',
      ends_at: '2026-03-16T04:30:00Z', is_all_day: false, location: null, url: null,
      external_calendars: null,
    }]),
    TZ,
  );

  assert.ok(byDay.has('2026-03-15'), 'should bucket to the local calendar day');
  assert.equal(byDay.has('2026-03-16'), false);
});

test('weekRange spans Sunday 00:00 to Saturday 23:59 locally', () => {
  const { start, end } = weekRange(new Date('2026-03-18T16:00:00Z'), TZ);
  assert.equal(start.toISOString(), '2026-03-15T04:00:00.000Z');
  assert.equal(end.toISOString(), '2026-03-22T03:59:59.000Z');
});

test('a Google copy of a class already on the timetable is hidden', () => {
  // University calendars publish class times, so the same lecture arrives
  // from both the course schedule and Google.
  const classes = expandMeetings(
    [meeting()],
    new Date('2026-03-15T04:00:00Z'),
    new Date('2026-03-22T03:59:59Z'),
    TZ,
  );

  const googleCopy = eventsToAgenda([{
    id: 'g1', title: 'EECS 281 Lecture',
    starts_at: '2026-03-16T14:00:00Z', ends_at: '2026-03-16T15:30:00Z',
    is_all_day: false, location: null, url: null,
    external_calendars: { name: 'UMich', color: null, color_override: null },
  }]);

  const result = dedupeClassEvents([...classes, ...googleCopy]);

  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'class', 'the course meeting is kept, not the Google copy');
});

test('an unrelated event at the same time as class is kept', () => {
  // Starting together is not enough on its own — the title must match or the
  // slot must line up exactly, or real conflicts would vanish silently.
  const classes = expandMeetings(
    [meeting()],
    new Date('2026-03-15T04:00:00Z'),
    new Date('2026-03-22T03:59:59Z'),
    TZ,
  );

  const clash = eventsToAgenda([{
    id: 'g2', title: 'Dentist appointment',
    starts_at: '2026-03-16T14:00:00Z', ends_at: '2026-03-16T14:45:00Z',
    is_all_day: false, location: null, url: null, external_calendars: null,
  }]);

  const result = dedupeClassEvents([...classes, ...clash]);
  assert.equal(result.length, 2, 'a genuine clash must stay visible');
});

test('an event in the same slot is treated as a duplicate even if titled differently', () => {
  const classes = expandMeetings(
    [meeting()],
    new Date('2026-03-15T04:00:00Z'),
    new Date('2026-03-22T03:59:59Z'),
    TZ,
  );

  const sameSlot = eventsToAgenda([{
    id: 'g3', title: 'Data Structures',
    starts_at: '2026-03-16T14:00:00Z', ends_at: '2026-03-16T15:30:00Z',
    is_all_day: false, location: null, url: null, external_calendars: null,
  }]);

  const result = dedupeClassEvents([...classes, ...sameSlot]);
  assert.equal(result.length, 1);
});

test('an event a few minutes off still counts as the same class', () => {
  const classes = expandMeetings(
    [meeting()],
    new Date('2026-03-15T04:00:00Z'),
    new Date('2026-03-22T03:59:59Z'),
    TZ,
  );

  const slightlyOff = eventsToAgenda([{
    id: 'g4', title: 'EECS 281',
    starts_at: '2026-03-16T14:05:00Z', ends_at: '2026-03-16T15:35:00Z',
    is_all_day: false, location: null, url: null, external_calendars: null,
  }]);

  assert.equal(dedupeClassEvents([...classes, ...slightlyOff]).length, 1);
});

test('with no classes at all, every event survives', () => {
  const events = eventsToAgenda([{
    id: 'g5', title: 'Club meeting', starts_at: '2026-03-16T22:00:00Z',
    ends_at: '2026-03-16T23:00:00Z', is_all_day: false, location: null, url: null,
    external_calendars: null,
  }]);

  assert.deepEqual(dedupeClassEvents(events), events);
});
