import { google, type calendar_v3 } from 'googleapis';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthorizedClient, listGoogleIntegrations, stripHtml, APP_CALENDAR_NAME } from './calendar';

export type ExternalSyncResult = {
  calendarsFound: number;
  eventsUpserted: number;
  eventsRemoved: number;
  errors: string[];
};

/**
 * True when a calendar is one this app created and writes assignments to.
 *
 * Matches on the stored id OR the distinctive name. Name matching is the
 * important half: if `config.calendar_id` is ever lost (a reconnect that
 * overwrites config, a manual edit), the app's own calendar would otherwise be
 * imported as an external one and every assignment would appear twice - once as
 * a deadline and once as a mirrored event.
 */
export function isAppManagedCalendar(
  entry: { id?: string | null; summary?: string | null },
  appCalendarId: string | null | undefined,
): boolean {
  if (appCalendarId && entry.id === appCalendarId) return true;
  return entry.summary === APP_CALENDAR_NAME;
}

/** How much of the calendar we mirror locally. */
const PAST_DAYS = 30;
const FUTURE_DAYS = 180;

/**
 * Converts a Google event's start/end into instants.
 *
 * All-day events use `date` (no time), timed events use `dateTime`. Google
 * treats an all-day `end` as exclusive, which is also what a calendar grid
 * wants, so it passes through unchanged.
 */
function readTimes(event: calendar_v3.Schema$Event): {
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
} | null {
  const startDate = event.start?.date;
  const endDate = event.end?.date;

  if (startDate) {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = endDate ? new Date(`${endDate}T00:00:00Z`) : new Date(start.getTime() + 86_400_000);
    return { startsAt: start.toISOString(), endsAt: end.toISOString(), isAllDay: true };
  }

  const startTime = event.start?.dateTime;
  if (!startTime) return null;

  const start = new Date(startTime);
  const end = event.end?.dateTime
    ? new Date(event.end.dateTime)
    : new Date(start.getTime() + 3_600_000);

  return { startsAt: start.toISOString(), endsAt: end.toISOString(), isAllDay: false };
}

/**
 * Mirrors the user's Google calendars and their events into the local database.
 *
 * Recurrence is expanded by Google (`singleEvents: true`), so each stored row is
 * one concrete occurrence and the calendar view stays a plain range query
 * rather than an RRULE evaluator.
 *
 * Read-only: nothing here writes back to Google.
 */
export async function syncExternalCalendars(userId: string): Promise<ExternalSyncResult> {
  const db = createAdminClient();
  const result: ExternalSyncResult = {
    calendarsFound: 0, eventsUpserted: 0, eventsRemoved: 0, errors: [],
  };

  const integrations = await listGoogleIntegrations(userId);
  if (integrations.length === 0) throw new Error('No Google account is connected');

  const timeMin = new Date(Date.now() - PAST_DAYS * 86_400_000).toISOString();
  const timeMax = new Date(Date.now() + FUTURE_DAYS * 86_400_000).toISOString();

  const { data: run } = await db
    .from('sync_runs')
    .insert({ user_id: userId, provider: 'google', direction: 'pull' })
    .select('id')
    .single();

  for (const integration of integrations) {
    let calendar: calendar_v3.Calendar;

    try {
      const auth = await getAuthorizedClient(integration.id);
      calendar = google.calendar({ version: 'v3', auth });
    } catch (err) {
      result.errors.push(`${integration.account_label}: ${(err as Error).message}`);
      continue;
    }

    const appCalendarId = (integration.config as { calendar_id?: string })?.calendar_id;

    // --- 1. Mirror the calendar list ------------------------------------
    const calendars: calendar_v3.Schema$CalendarListEntry[] = [];

    try {
      let pageToken: string | undefined;
      do {
        const page = await calendar.calendarList.list({ maxResults: 250, pageToken });
        calendars.push(...(page.data.items ?? []));
        pageToken = page.data.nextPageToken ?? undefined;
      } while (pageToken);
    } catch (err) {
      const message = (err as Error).message;
      result.errors.push(
        message.includes('insufficient')
          ? `${integration.account_label}: reconnect this account to grant calendar read access`
          : `${integration.account_label}: ${message}`,
      );
      continue;
    }

    result.calendarsFound += calendars.length;

    for (const entry of calendars) {
      if (!entry.id) continue;

      const isAppManaged = isAppManagedCalendar(entry, appCalendarId);

      const { error } = await db.from('external_calendars').upsert(
        {
          user_id: userId,
          integration_id: integration.id,
          external_id: entry.id,
          name: entry.summaryOverride ?? entry.summary ?? entry.id,
          description: entry.description ?? null,
          color: entry.backgroundColor ?? null,
          timezone: entry.timeZone ?? null,
          is_primary: Boolean(entry.primary),
          access_role: entry.accessRole ?? null,
          is_app_managed: isAppManaged,
          // The app's own calendar must never be mirrored back in, or every
          // assignment would render twice in the calendar view.
          sync_enabled: !isAppManaged,
        },
        { onConflict: 'integration_id,external_id', ignoreDuplicates: false },
      );

      if (error) result.errors.push(`calendar ${entry.summary}: ${error.message}`);
    }

    // --- 2. Pull events from every enabled calendar ----------------------
    const { data: stored } = await db
      .from('external_calendars')
      .select('id, external_id, name')
      .eq('integration_id', integration.id)
      .eq('sync_enabled', true)
      .eq('is_app_managed', false);

    for (const cal of stored ?? []) {
      const seen = new Set<string>();

      try {
        let pageToken: string | undefined;

        do {
          const page = await calendar.events.list({
            calendarId: cal.external_id,
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 2500,
            pageToken,
          });

          const rows = [];

          for (const event of page.data.items ?? []) {
            if (!event.id || event.status === 'cancelled') continue;

            const times = readTimes(event);
            if (!times) continue;

            seen.add(event.id);
            rows.push({
              user_id: userId,
              calendar_id: cal.id,
              external_event_id: event.id,
              title: event.summary ?? '(no title)',
              description: event.description ? stripHtml(event.description).slice(0, 2000) : null,
              location: event.location ?? null,
              url: event.htmlLink ?? null,
              starts_at: times.startsAt,
              ends_at: times.endsAt,
              is_all_day: times.isAllDay,
              status: event.status ?? null,
              recurring_event_id: event.recurringEventId ?? null,
            });
          }

          if (rows.length > 0) {
            const { error } = await db
              .from('calendar_events')
              .upsert(rows, { onConflict: 'calendar_id,external_event_id' });

            if (error) result.errors.push(`${cal.name}: ${error.message}`);
            else result.eventsUpserted += rows.length;
          }

          pageToken = page.data.nextPageToken ?? undefined;
        } while (pageToken);

        // Drop locally-cached events that vanished upstream. Scoped to the
        // window we just refreshed so events outside it aren't touched.
        const { data: existing } = await db
          .from('calendar_events')
          .select('id, external_event_id')
          .eq('calendar_id', cal.id)
          .gte('starts_at', timeMin)
          .lte('starts_at', timeMax);

        const stale = (existing ?? []).filter((e) => !seen.has(e.external_event_id));

        if (stale.length > 0) {
          await db.from('calendar_events').delete().in('id', stale.map((e) => e.id));
          result.eventsRemoved += stale.length;
        }

        await db
          .from('external_calendars')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('id', cal.id);
      } catch (err) {
        result.errors.push(`${cal.name}: ${(err as Error).message}`);
      }
    }
  }

  if (run) {
    await db
      .from('sync_runs')
      .update({
        status: result.errors.length ? 'error' : 'success',
        finished_at: new Date().toISOString(),
        items_created: result.eventsUpserted,
        items_skipped: result.eventsRemoved,
        error: result.errors.length ? result.errors.join('; ').slice(0, 2000) : null,
      })
      .eq('id', run.id);
  }

  return result;
}
