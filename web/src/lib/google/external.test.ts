import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isAppManagedCalendar } from '@/lib/google/external';
import { APP_CALENDAR_NAME } from '@/lib/google/calendar';

test('the calendar named in config is app-managed', () => {
  assert.equal(
    isAppManagedCalendar({ id: 'cal-123', summary: 'Anything' }, 'cal-123'),
    true,
  );
});

test('an orphaned app calendar is still recognised by name', () => {
  // Regression: a reconnect once overwrote config.calendar_id, orphaning the
  // calendar the app had created. It was then imported as an external calendar,
  // so every assignment showed up twice — once as a deadline, once as an event.
  assert.equal(
    isAppManagedCalendar({ id: 'old-orphan', summary: APP_CALENDAR_NAME }, 'new-calendar-id'),
    true,
  );
  assert.equal(
    isAppManagedCalendar({ id: 'old-orphan', summary: APP_CALENDAR_NAME }, null),
    true,
  );
});

test("the user's own calendars are never treated as app-managed", () => {
  for (const summary of ['onimisi@umich.edu', 'NSBE-UM', 'Holidays in United States', 'School']) {
    assert.equal(
      isAppManagedCalendar({ id: 'cal-999', summary }, 'cal-123'),
      false,
      summary,
    );
  }
});

test('a missing summary does not match', () => {
  assert.equal(isAppManagedCalendar({ id: 'x', summary: null }, 'cal-123'), false);
  assert.equal(isAppManagedCalendar({ id: 'x' }, undefined), false);
});
