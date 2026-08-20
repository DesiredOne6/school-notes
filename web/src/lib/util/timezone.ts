/**
 * Timezone helpers built on Intl, so no timezone database is bundled.
 *
 * Shared by the ICS parser (TZID-qualified due dates) and the calendar view
 * (weekly class meetings stored as local wall-clock times).
 */

/** Milliseconds to add to a UTC instant to get wall-clock time in `timeZone`. */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );

  return asUtc - instant.getTime();
}

/**
 * Converts a wall-clock time in `timeZone` to the instant it represents.
 *
 * Corrects twice, because the offset depends on the instant we're solving for:
 * a first guess can land on the wrong side of a DST transition.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  try {
    const first = timeZoneOffsetMs(new Date(wallClockUtc), timeZone);
    let result = wallClockUtc - first;
    const second_ = timeZoneOffsetMs(new Date(result), timeZone);
    if (second_ !== first) result = wallClockUtc - second_;
    return new Date(result);
  } catch {
    // Unknown zone: treat the wall-clock time as UTC rather than throwing.
    return new Date(wallClockUtc);
  }
}

/** The calendar date in `timeZone` for an instant, as {year, month, day}. */
export function zonedDateParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(instant);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: weekdayNames.indexOf(get('weekday')),
  };
}

/** "2026-08-19" for an instant, in the given zone. Used as a grouping key. */
export function zonedDateKey(instant: Date, timeZone: string): string {
  const { year, month, day } = zonedDateParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
