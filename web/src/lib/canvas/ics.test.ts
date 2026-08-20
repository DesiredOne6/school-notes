import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  parseIcs,
  parseIcsDate,
  unfoldLines,
  unescapeText,
  splitSummary,
  extractCanvasIds,
  toFeedItems,
  normalizeFeedUrl,
} from '@/lib/canvas/ics';

// Shaped after a real Canvas feed, including CRLF line endings, a folded
// DESCRIPTION, a URL parameter, an all-day event, a TZID event, and a
// non-assignment calendar event that must be filtered out.
const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'CALSCALE:GREGORIAN',
  'PRODID:iCalendar-Ruby',
  'X-WR-CALNAME:Canvas Calendar (student@school.edu)',
  'BEGIN:VEVENT',
  'DTSTAMP:20260301T120000Z',
  'UID:event-assignment-1234567@school.instructure.com',
  'DTSTART:20260315T035900Z',
  'DTEND:20260315T035900Z',
  'URL;VALUE=URI:https://school.instructure.com/courses/45678/assignments/1234567',
  'SUMMARY:Problem Set 4 [CS 3410]',
  'DESCRIPTION:Complete chapters 3-5. Show all work\\, and cite',
  '  any sources you use.',
  'CLASS:PUBLIC',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTAMP:20260301T120000Z',
  'UID:event-assignment-7654321@school.instructure.com',
  'DTSTART;VALUE=DATE:20260401',
  'URL;VALUE=URI:https://school.instructure.com/courses/45678/assignments/7654321',
  'SUMMARY:Reading Journal [CS 3410]',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTAMP:20260301T120000Z',
  'UID:event-assignment-5555555@school.instructure.com',
  'DTSTART;TZID=America/New_York:20260320T235900',
  'URL;VALUE=URI:https://school.instructure.com/courses/99999/assignments/5555555',
  'SUMMARY:Midterm Exam [PHYS 2213]',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTAMP:20260301T120000Z',
  'UID:event-calendar-event-888@school.instructure.com',
  'DTSTART:20260316T150000Z',
  'SUMMARY:Lecture [CS 3410]',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('unfoldLines rejoins folded continuation lines', () => {
  const lines = unfoldLines('DESCRIPTION:hello\r\n  world\r\nSUMMARY:next');
  assert.deepEqual(lines, ['DESCRIPTION:hello world', 'SUMMARY:next']);
});

test('unescapeText handles escaped commas, semicolons, and newlines', () => {
  assert.equal(unescapeText('a\\, b'), 'a, b');
  assert.equal(unescapeText('a\; b'), 'a; b');
  assert.equal(unescapeText('line1\\nline2'), 'line1\nline2');
  // An escaped backslash must not then be read as an escape itself.
  assert.equal(unescapeText('path\\\\nfile'), 'path\\nfile');
  // Bare semicolons are left alone.
  assert.equal(unescapeText('a; b'), 'a; b');
});

test('parseIcsDate reads UTC, date-only, and TZID values', () => {
  const utc = parseIcsDate('20260315T035900Z');
  assert.equal(utc.date?.toISOString(), '2026-03-15T03:59:00.000Z');
  assert.equal(utc.isAllDay, false);

  const allDay = parseIcsDate('20260401', { VALUE: 'DATE' });
  assert.equal(allDay.date?.toISOString(), '2026-04-01T00:00:00.000Z');
  assert.equal(allDay.isAllDay, true);

  // 23:59 EDT on 20 March 2026 is 03:59 UTC the next day.
  const zoned = parseIcsDate('20260320T235900', { TZID: 'America/New_York' });
  assert.equal(zoned.date?.toISOString(), '2026-03-21T03:59:00.000Z');
});

test('parseIcsDate survives an unknown timezone', () => {
  const result = parseIcsDate('20260320T235900', { TZID: 'Mars/Olympus_Mons' });
  assert.equal(result.date?.toISOString(), '2026-03-20T23:59:00.000Z');
});

test('parseIcs extracts every VEVENT', () => {
  const events = parseIcs(FEED);
  assert.equal(events.length, 4);
  assert.equal(events[0].summary, 'Problem Set 4 [CS 3410]');
  assert.equal(
    events[0].description,
    'Complete chapters 3-5. Show all work, and cite any sources you use.',
  );
  assert.equal(events[0].url, 'https://school.instructure.com/courses/45678/assignments/1234567');
});

test('splitSummary separates the course code Canvas appends', () => {
  assert.deepEqual(splitSummary('Problem Set 4 [CS 3410]'), {
    title: 'Problem Set 4',
    courseCode: 'CS 3410',
  });
  assert.deepEqual(splitSummary('No course code here'), {
    title: 'No course code here',
    courseCode: null,
  });
});

test('extractCanvasIds recovers ids that match the REST importer', () => {
  const events = parseIcs(FEED);
  const ids = extractCanvasIds(events[0]);
  // Same id the REST path would store, so the two sources dedupe together.
  assert.equal(ids.canvasAssignmentId, 1234567);
  assert.equal(ids.canvasCourseId, 45678);
});

test('toFeedItems keeps assignments and drops plain calendar events', () => {
  const items = toFeedItems(parseIcs(FEED));

  assert.equal(items.length, 3, 'the lecture calendar event should be excluded');
  assert.deepEqual(items.map((i) => i.title), [
    'Problem Set 4',
    'Reading Journal',
    'Midterm Exam',
  ]);

  assert.equal(items[1].isAllDay, true);
  assert.equal(items[2].canvasCourseId, 99999);
  assert.equal(items[2].dueAt?.toISOString(), '2026-03-21T03:59:00.000Z');
});

test('normalizeFeedUrl converts the webcal:// link Canvas hands out', () => {
  assert.equal(
    normalizeFeedUrl('webcal://school.instructure.com/feeds/calendars/user_abc123.ics'),
    'https://school.instructure.com/feeds/calendars/user_abc123.ics',
  );
  assert.equal(
    normalizeFeedUrl('  https://school.instructure.com/feeds/calendars/user_abc123.ics  '),
    'https://school.instructure.com/feeds/calendars/user_abc123.ics',
  );
  assert.equal(
    normalizeFeedUrl('school.instructure.com/feeds/calendars/user_abc.ics'),
    'https://school.instructure.com/feeds/calendars/user_abc.ics',
  );
});
