import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  groupMeetings,
  formatWeekdays,
  formatTimeRange,
  formatClock,
  meetingKindLabel,
  type MeetingLike,
} from '@/lib/util/meetings';

function meeting(overrides: Partial<MeetingLike> & { id: string; weekday: number }): MeetingLike {
  return {
    kind: 'lecture',
    starts_at: '12:00:00',
    ends_at: '14:30:00',
    location: 'DOW 1013',
    url: null,
    ...overrides,
  };
}

test('a Tue/Thu lecture folds into one row', () => {
  const groups = groupMeetings([
    meeting({ id: 'a', weekday: 2 }),
    meeting({ id: 'b', weekday: 4 }),
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].weekdays, [2, 4]);
  assert.deepEqual(groups[0].ids.sort(), ['a', 'b']);
  assert.equal(formatWeekdays(groups[0].weekdays), 'Tue, Thu');
});

test('lecture and discussion stay separate', () => {
  // EECS 203: lecture T/Th 12:00-2:30, discussion Fri 10:30-11:30.
  const groups = groupMeetings([
    meeting({ id: 'a', weekday: 2 }),
    meeting({ id: 'b', weekday: 4 }),
    meeting({
      id: 'c', weekday: 5, kind: 'discussion',
      starts_at: '10:30:00', ends_at: '11:30:00', location: 'BBB 1670',
    }),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].kind, 'lecture');
  assert.deepEqual(groups[0].weekdays, [2, 4]);
  assert.equal(groups[1].kind, 'discussion');
  assert.deepEqual(groups[1].weekdays, [5]);
});

test('same times in different rooms are not merged', () => {
  const groups = groupMeetings([
    meeting({ id: 'a', weekday: 2, location: 'Room A' }),
    meeting({ id: 'b', weekday: 4, location: 'Room B' }),
  ]);
  assert.equal(groups.length, 2, 'a room change is a real difference');
});

test('the same day at two different times stays separate', () => {
  const groups = groupMeetings([
    meeting({ id: 'a', weekday: 1, starts_at: '09:00:00', ends_at: '10:00:00' }),
    meeting({ id: 'b', weekday: 1, starts_at: '14:00:00', ends_at: '15:00:00' }),
  ]);
  assert.equal(groups.length, 2);
});

test('within a group, weeks read Monday first and Sunday last', () => {
  // Identical time, room, and kind, so these are one group — the ordering
  // being tested is of the days inside it.
  const groups = groupMeetings([
    meeting({ id: 'a', weekday: 0 }),
    meeting({ id: 'b', weekday: 1 }),
    meeting({ id: 'c', weekday: 5 }),
  ]);

  assert.equal(groups.length, 1, 'same time and place is one group');
  assert.equal(formatWeekdays(groups[0].weekdays), 'Mon, Fri, Sun');
});

test('across groups, Sunday sorts after the weekdays', () => {
  const groups = groupMeetings([
    meeting({ id: 'sun', weekday: 0, starts_at: '09:00:00', ends_at: '10:00:00' }),
    meeting({ id: 'mon', weekday: 1, starts_at: '11:00:00', ends_at: '12:00:00' }),
    meeting({ id: 'fri', weekday: 5, starts_at: '13:00:00', ends_at: '14:00:00' }),
  ]);

  assert.deepEqual(groups.map((g) => g.ids[0]), ['mon', 'fri', 'sun']);
});

test('groups sort by first day, then by time', () => {
  const groups = groupMeetings([
    meeting({ id: 'late', weekday: 3, starts_at: '15:00:00', ends_at: '16:00:00' }),
    meeting({ id: 'early', weekday: 3, starts_at: '08:00:00', ends_at: '09:00:00' }),
  ]);
  assert.deepEqual(groups.map((g) => g.ids[0]), ['early', 'late']);
});

test('weekdays within a group are ordered Monday first', () => {
  const groups = groupMeetings([
    meeting({ id: 'a', weekday: 5 }),
    meeting({ id: 'b', weekday: 1 }),
    meeting({ id: 'c', weekday: 3 }),
  ]);
  assert.equal(formatWeekdays(groups[0].weekdays), 'Mon, Wed, Fri');
});

test('times format as a readable range', () => {
  assert.equal(formatClock('12:00:00'), '12:00 PM');
  assert.equal(formatClock('00:30:00'), '12:30 AM');
  assert.equal(formatClock('14:30:00'), '2:30 PM');
  assert.equal(formatTimeRange('12:00:00', '14:30:00'), '12:00 PM – 2:30 PM');
});

test('meeting kinds have readable labels', () => {
  assert.equal(meetingKindLabel('lecture'), 'Lecture');
  assert.equal(meetingKindLabel('recitation'), 'Recitation');
  assert.equal(meetingKindLabel('something-custom'), 'something-custom');
});

test('an empty list groups to nothing', () => {
  assert.deepEqual(groupMeetings([]), []);
});
