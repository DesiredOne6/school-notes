import { test } from 'vitest';
import assert from 'node:assert/strict';
import { inQuietHours, describeLeadTime } from '@/lib/reminders/dispatch';

const TZ = 'America/New_York';

test('quiet hours that wrap midnight are handled', () => {
  // 22:00 -> 07:00 local. 03:00 EST is 08:00 UTC.
  const at3am = new Date('2026-03-10T08:00:00Z');
  assert.equal(inQuietHours(at3am, TZ, '22:00', '07:00'), true);

  // 14:00 EST is 19:00 UTC - well outside the window.
  const at2pm = new Date('2026-03-10T18:00:00Z');
  assert.equal(inQuietHours(at2pm, TZ, '22:00', '07:00'), false);
});

test('a same-day quiet window does not wrap', () => {
  // 09:00 -> 17:00. 13:00 EDT is 17:00 UTC.
  const at1pm = new Date('2026-03-10T17:00:00Z');
  assert.equal(inQuietHours(at1pm, TZ, '09:00', '17:00'), true);

  const at8pm = new Date('2026-03-11T00:00:00Z');
  assert.equal(inQuietHours(at8pm, TZ, '09:00', '17:00'), false);
});

test('quiet hours are off when unset', () => {
  const now = new Date('2026-03-10T08:00:00Z');
  assert.equal(inQuietHours(now, TZ, null, null), false);
  assert.equal(inQuietHours(now, TZ, '22:00', null), false);
});

test('the window boundary is inclusive at the start, exclusive at the end', () => {
  // 22:00 EDT == 02:00 UTC next day.
  assert.equal(inQuietHours(new Date('2026-03-11T02:00:00Z'), TZ, '22:00', '07:00'), true);
  // 07:00 EDT == 11:00 UTC - the window has ended.
  assert.equal(inQuietHours(new Date('2026-03-10T11:00:00Z'), TZ, '22:00', '07:00'), false);
});

test('describeLeadTime reads naturally', () => {
  assert.equal(describeLeadTime(30), 'in 30 minutes');
  assert.equal(describeLeadTime(60), 'in 1 hour');
  assert.equal(describeLeadTime(120), 'in 2 hours');
  assert.equal(describeLeadTime(1440), 'tomorrow');
  assert.equal(describeLeadTime(10080), 'in 7 days');
  assert.equal(describeLeadTime(null), 'coming up');
});
