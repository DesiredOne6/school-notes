/**
 * Parser for Canvas calendar (.ics) feeds.
 *
 * This is the fallback path when a Canvas administrator disables personal
 * access tokens. Every Canvas user can generate a private calendar feed URL
 * (Calendar -> Calendar Feed) without any admin involvement, and it carries
 * assignment and quiz due dates for every enrolled course.
 *
 * Trade-offs versus the REST API: the feed has no points, no submission state,
 * and no per-assignment description, and Canvas caps it at 1000 items. Due
 * dates - the thing reminders and calendar sync actually need - are all there.
 *
 * Written by hand rather than pulling in a full iCalendar library: Canvas emits
 * a narrow, predictable subset, and the alternative libraries drag in
 * moment-timezone or a whole timezone registry for parsing we can do with Intl.
 */

import { timeZoneOffsetMs } from '@/lib/util/timezone';

export type IcsEvent = {
  uid: string;
  summary: string;
  description?: string;
  url?: string;
  start?: Date;
  isAllDay: boolean;
};

export type CanvasFeedItem = {
  /** Canvas assignment id, from the UID or the assignment URL. */
  canvasAssignmentId: number | null;
  /** Canvas course id, parsed out of the event URL. */
  canvasCourseId: number | null;
  title: string;
  /** Course code Canvas appends to the summary, e.g. "CS 3410". */
  courseCode: string | null;
  dueAt: Date | null;
  isAllDay: boolean;
  url: string | null;
  description: string | null;
};

/**
 * Reverses RFC 5545 line folding. Continuation lines begin with a space or tab
 * and belong to the previous logical line.
 */
export function unfoldLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out: string[] = [];

  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }

  return out.filter((l) => l.length > 0);
}

/**
 * Unescapes RFC 5545 TEXT values.
 *
 * Done in a single pass: chained replaces would mangle input like "\\\\n",
 * where the backslash is itself escaped and the "n" is a literal character.
 */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, ch: string) =>
    ch === 'n' || ch === 'N' ? '\n' : ch,
  );
}

/** Splits "DTSTART;TZID=America/New_York" into a name and its parameters. */
function parsePropertyName(raw: string): { name: string; params: Record<string, string> } {
  const [name, ...paramParts] = raw.split(';');
  const params: Record<string, string> = {};

  for (const part of paramParts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }

  return { name: name.toUpperCase(), params };
}

/**
 * Converts a DATE-TIME value to a real instant.
 *
 * Handles the three forms Canvas emits: UTC (trailing Z), floating local time,
 * and TZID-qualified local time.
 */
export function parseIcsDate(
  value: string,
  params: Record<string, string> = {},
): { date: Date | null; isAllDay: boolean } {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);

  if (dateOnly || params.VALUE === 'DATE') {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!m) return { date: null, isAllDay: true };
    return {
      date: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
      isAllDay: true,
    };
  }

  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!dt) return { date: null, isAllDay: false };

  const [, y, mo, d, h, mi, s, zulu] = dt;
  const wallClockUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));

  if (zulu) return { date: new Date(wallClockUtc), isAllDay: false };

  const timeZone = params.TZID;
  if (!timeZone) {
    // Floating time: treat as UTC rather than guessing the server's zone.
    return { date: new Date(wallClockUtc), isAllDay: false };
  }

  try {
    // Correct the guess by the zone's offset, then re-check once so instants
    // near a DST transition resolve correctly.
    const firstOffset = timeZoneOffsetMs(new Date(wallClockUtc), timeZone);
    let result = wallClockUtc - firstOffset;
    const secondOffset = timeZoneOffsetMs(new Date(result), timeZone);
    if (secondOffset !== firstOffset) result = wallClockUtc - secondOffset;
    return { date: new Date(result), isAllDay: false };
  } catch {
    // Unknown TZID; fall back to treating the value as UTC.
    return { date: new Date(wallClockUtc), isAllDay: false };
  }
}

/** Extracts VEVENT blocks from a raw .ics document. */
export function parseIcs(text: string): IcsEvent[] {
  const lines = unfoldLines(text);
  const events: IcsEvent[] = [];
  let current: Partial<IcsEvent> | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = { isAllDay: false };
      continue;
    }

    if (line === 'END:VEVENT') {
      if (current?.uid) {
        events.push({
          uid: current.uid,
          summary: current.summary ?? '',
          description: current.description,
          url: current.url,
          start: current.start,
          isAllDay: current.isAllDay ?? false,
        });
      }
      current = null;
      continue;
    }

    if (!current) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;

    const { name, params } = parsePropertyName(line.slice(0, colon));
    const value = line.slice(colon + 1);

    switch (name) {
      case 'UID':
        current.uid = value;
        break;
      case 'SUMMARY':
        current.summary = unescapeText(value);
        break;
      case 'DESCRIPTION':
        current.description = unescapeText(value);
        break;
      case 'URL':
        current.url = value.replace(/\\/g, '');
        break;
      case 'DTSTART': {
        const { date, isAllDay } = parseIcsDate(value, params);
        if (date) current.start = date;
        current.isAllDay = isAllDay;
        break;
      }
    }
  }

  return events;
}

/**
 * Canvas summaries look like "Problem Set 4 [CS 3410]". Splitting the course
 * code off gives a clean title and a label to match the course by.
 */
export function splitSummary(summary: string): { title: string; courseCode: string | null } {
  const match = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(summary);
  if (!match) return { title: summary.trim(), courseCode: null };
  return { title: match[1].trim(), courseCode: match[2].trim() };
}

/**
 * Pulls Canvas ids out of an event.
 *
 * The UID carries the assignment id (`event-assignment-123@host`) and the URL
 * carries both course and assignment ids, so between them a feed row maps onto
 * the same `canvas_assignment_id` the REST importer would have used - meaning
 * the two paths dedupe against each other.
 */
export function extractCanvasIds(event: IcsEvent): {
  canvasAssignmentId: number | null;
  canvasCourseId: number | null;
} {
  let canvasAssignmentId: number | null = null;
  let canvasCourseId: number | null = null;

  const uidMatch = /event-assignment-(\d+)/.exec(event.uid);
  if (uidMatch) canvasAssignmentId = Number(uidMatch[1]);

  if (event.url) {
    const courseMatch = /\/courses\/(\d+)/.exec(event.url);
    if (courseMatch) canvasCourseId = Number(courseMatch[1]);

    if (canvasAssignmentId === null) {
      const assignmentMatch = /\/assignments\/(\d+)/.exec(event.url);
      if (assignmentMatch) canvasAssignmentId = Number(assignmentMatch[1]);
    }
  }

  return { canvasAssignmentId, canvasCourseId };
}

/** Converts a parsed feed into the assignment-shaped rows the importer needs. */
export function toFeedItems(events: IcsEvent[]): CanvasFeedItem[] {
  const items: CanvasFeedItem[] = [];

  for (const event of events) {
    // Calendar events (lectures, office hours) have their own UID prefix and
    // aren't graded work, so they don't belong in the assignment list.
    const isAssignment =
      event.uid.includes('event-assignment-') || /\/assignments\//.test(event.url ?? '');
    if (!isAssignment) continue;

    const { title, courseCode } = splitSummary(event.summary);
    const { canvasAssignmentId, canvasCourseId } = extractCanvasIds(event);

    items.push({
      canvasAssignmentId,
      canvasCourseId,
      title,
      courseCode,
      dueAt: event.start ?? null,
      isAllDay: event.isAllDay,
      url: event.url ?? null,
      description: event.description ?? null,
    });
  }

  return items;
}

/** Normalises a pasted feed URL. Canvas hands out webcal:// links. */
export function normalizeFeedUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('webcal://')) return `https://${trimmed.slice('webcal://'.length)}`;
  if (!/^https?:\/\//.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}
