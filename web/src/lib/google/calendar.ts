import { createHash } from 'node:crypto';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Scopes, kept as tight as the features allow.
 *
 * - `calendar.app.created` — create and manage ONLY the calendar this app
 *   makes. Assignment events are written here; the app cannot modify anything
 *   else the user owns.
 * - `calendar.readonly` — read the user's other calendars so class times, club
 *   meetings, and personal events can be shown in the in-app calendar view.
 *   Read-only: the app can display them but never edit or delete them.
 *
 * Deliberately NOT requested is `.../auth/calendar`, which would grant full
 * write access to every calendar the user can reach.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

/** Name of the calendar this app creates and owns. */
export const APP_CALENDAR_NAME = 'School — Assignments & Tests';
const CALENDAR_NAME = APP_CALENDAR_NAME;

/** How long a due-date event appears to last on the calendar. */
const EVENT_MINUTES = 30;

export function createOAuthClient(): OAuth2Client {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error('Google OAuth environment variables are not configured');
  }

  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

export type GoogleIntegration = {
  id: string;
  account_label: string | null;
  external_account_id: string;
  config: Record<string, unknown>;
};

/** Every Google account the user has connected, oldest first. */
export async function listGoogleIntegrations(userId: string): Promise<GoogleIntegration[]> {
  const db = createAdminClient();

  const { data } = await db
    .from('integrations')
    .select('id, account_label, external_account_id, config')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .neq('status', 'disconnected')
    .order('created_at', { ascending: true });

  return (data ?? []) as GoogleIntegration[];
}

/**
 * The account that receives assignment events.
 *
 * With several accounts connected we must write to exactly one, or every
 * deadline would appear twice. The user can nominate one; otherwise the
 * first-connected account wins.
 */
export async function primaryGoogleIntegration(
  userId: string,
): Promise<GoogleIntegration | null> {
  const all = await listGoogleIntegrations(userId);
  if (all.length === 0) return null;

  return all.find((i) => (i.config as { is_primary_calendar?: boolean })?.is_primary_calendar) ?? all[0];
}

/**
 * Builds an authenticated client for one integration, refreshing the access
 * token when it is within two minutes of expiry.
 */
export async function getAuthorizedClient(integrationId: string): Promise<OAuth2Client> {
  const db = createAdminClient();

  const { data: secret } = await db
    .from('integration_secrets')
    .select('access_token, refresh_token, expires_at')
    .eq('integration_id', integrationId)
    .maybeSingle();

  if (!secret?.refresh_token) {
    throw new Error('Google refresh token is missing; reconnect this account');
  }

  const client = createOAuthClient();
  client.setCredentials({
    access_token: secret.access_token ?? undefined,
    refresh_token: secret.refresh_token,
    expiry_date: secret.expires_at ? new Date(secret.expires_at).getTime() : undefined,
  });

  const expiresSoon =
    !secret.expires_at || new Date(secret.expires_at).getTime() - Date.now() < 120_000;

  if (expiresSoon) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);

    await db
      .from('integration_secrets')
      .update({
        access_token: credentials.access_token ?? null,
        // Google returns a refresh token only on first consent; keep the old one.
        refresh_token: credentials.refresh_token ?? secret.refresh_token,
        expires_at: credentials.expiry_date
          ? new Date(credentials.expiry_date).toISOString()
          : null,
      })
      .eq('integration_id', integrationId);
  }

  return client;
}

/** Returns the app's dedicated calendar for one account, creating it if needed. */
export async function ensureSchoolCalendar(
  userId: string,
  integration: GoogleIntegration,
): Promise<string> {
  const db = createAdminClient();
  const config = (integration.config ?? {}) as { calendar_id?: string };

  const auth = await getAuthorizedClient(integration.id);
  const calendar = google.calendar({ version: 'v3', auth });

  if (config.calendar_id) {
    try {
      await calendar.calendars.get({ calendarId: config.calendar_id });
      return config.calendar_id;
    } catch {
      // Deleted on Google's side; fall through and recreate.
    }
  }

  // Before creating one, look for a calendar this app already made on this
  // account. Without this, any loss of config.calendar_id (a reconnect, a
  // cleared config) silently produces a second "School" calendar and orphans
  // the first.
  try {
    const list = await calendar.calendarList.list({ maxResults: 250 });
    const match = (list.data.items ?? []).find(
      (entry) => entry.summary === CALENDAR_NAME && entry.accessRole === 'owner',
    );

    if (match?.id) {
      await db
        .from('integrations')
        .update({ config: { ...config, calendar_id: match.id } })
        .eq('id', integration.id);
      return match.id;
    }
  } catch {
    // calendarList needs the read scope, which may not be granted yet.
    // Falling through to create a calendar is still correct.
  }

  const { data: profile } = await db
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .maybeSingle();

  const created = await calendar.calendars.insert({
    requestBody: {
      summary: CALENDAR_NAME,
      timeZone: profile?.timezone ?? 'America/New_York',
      description: 'Managed automatically. Edits here are overwritten on sync.',
    },
  });

  const calendarId = created.data.id;
  if (!calendarId) throw new Error('Google did not return a calendar id');

  await db
    .from('integrations')
    .update({ config: { ...config, calendar_id: calendarId } })
    .eq('id', integration.id);

  return calendarId;
}

type SyncableAssignment = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  status: string;
  due_at: string | null;
  due_is_all_day: boolean;
  url: string | null;
  archived_at: string | null;
  courses: { code: string | null; title: string } | null;
};

function eventBody(a: SyncableAssignment, timezone: string) {
  const label = a.courses?.code ?? a.courses?.title ?? null;
  const prefix = label ? `[${label}] ` : '';
  const isExam = a.kind === 'exam' || a.kind === 'quiz';
  const summary = `${prefix}${a.title}${isExam ? '' : ' — due'}`;

  const due = new Date(a.due_at!);

  const descriptionParts = [
    a.url ? `Canvas: ${a.url}` : null,
    a.description ? stripHtml(a.description).slice(0, 900) : null,
  ].filter(Boolean);

  if (a.due_is_all_day) {
    const day = due.toISOString().slice(0, 10);
    const next = new Date(due.getTime() + 86_400_000).toISOString().slice(0, 10);
    return {
      summary,
      description: descriptionParts.join('\n\n') || undefined,
      // Google treats an all-day `end` as exclusive.
      start: { date: day },
      end: { date: next },
    };
  }

  const start = new Date(due.getTime() - EVENT_MINUTES * 60_000);

  return {
    summary,
    description: descriptionParts.join('\n\n') || undefined,
    start: { dateTime: start.toISOString(), timeZone: timezone },
    end: { dateTime: due.toISOString(), timeZone: timezone },
  };
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Removes every assignment event this app wrote to one account, and forgets the
 * links.
 *
 * Called when an account stops being the assignment target - otherwise its
 * events linger on a calendar nothing updates any more, and the user sees the
 * same deadline on two calendars.
 */
export async function removeAssignmentEventsFor(
  userId: string,
  integrationId: string,
): Promise<number> {
  const db = createAdminClient();

  const { data: links } = await db
    .from('calendar_event_links')
    .select('id, external_calendar_id, external_event_id')
    .eq('user_id', userId)
    .eq('integration_id', integrationId);

  if (!links?.length) return 0;

  try {
    const auth = await getAuthorizedClient(integrationId);
    const calendar = google.calendar({ version: 'v3', auth });

    for (const link of links) {
      if (!link.external_calendar_id) continue;
      try {
        await calendar.events.delete({
          calendarId: link.external_calendar_id,
          eventId: link.external_event_id,
        });
      } catch {
        // Already deleted upstream; dropping our link is still correct.
      }
    }
  } catch {
    // Token unusable (revoked, expired). Still drop the links so the app's
    // view of what exists stays accurate.
  }

  await db
    .from('calendar_event_links')
    .delete()
    .eq('user_id', userId)
    .eq('integration_id', integrationId);

  return links.length;
}

export type CalendarSyncResult = {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  errors: string[];
};

/**
 * Pushes every dated assignment in the sync window to the primary Google
 * account's dedicated calendar.
 *
 * Idempotent: each assignment maps to one event per integration via
 * calendar_event_links, and unchanged events are skipped by content hash.
 */
export async function syncAssignmentsToGoogle(
  userId: string,
  options: { pastDays?: number; futureDays?: number } = {},
): Promise<CalendarSyncResult> {
  const { pastDays = 7, futureDays = 120 } = options;
  const db = createAdminClient();
  const result: CalendarSyncResult = {
    created: 0, updated: 0, deleted: 0, skipped: 0, errors: [],
  };

  const integration = await primaryGoogleIntegration(userId);
  if (!integration) throw new Error('Google Calendar is not connected');

  // Any account that is no longer the assignment target must not keep events.
  const others = (await listGoogleIntegrations(userId)).filter((i) => i.id !== integration.id);
  for (const other of others) {
    result.deleted += await removeAssignmentEventsFor(userId, other.id);
  }

  const calendarId = await ensureSchoolCalendar(userId, integration);
  const auth = await getAuthorizedClient(integration.id);
  const calendar = google.calendar({ version: 'v3', auth });

  const { data: profile } = await db
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .maybeSingle();
  const timezone = profile?.timezone ?? 'America/New_York';

  const windowStart = new Date(Date.now() - pastDays * 86_400_000).toISOString();
  const windowEnd = new Date(Date.now() + futureDays * 86_400_000).toISOString();

  const { data: assignments, error } = await db
    .from('assignments')
    .select(
      'id, title, description, kind, status, due_at, due_is_all_day, url, archived_at,' +
        ' courses(code, title)',
    )
    .eq('user_id', userId)
    .not('due_at', 'is', null)
    .gte('due_at', windowStart)
    .lte('due_at', windowEnd);

  if (error) throw new Error(`loading assignments: ${error.message}`);

  const { data: links } = await db
    .from('calendar_event_links')
    .select('assignment_id, external_event_id, content_hash')
    .eq('user_id', userId)
    .eq('integration_id', integration.id);

  const linkByAssignment = new Map((links ?? []).map((l) => [l.assignment_id, l]));

  const run = await db
    .from('sync_runs')
    .insert({ user_id: userId, provider: 'google', direction: 'push' })
    .select('id')
    .single();

  for (const a of (assignments ?? []) as unknown as SyncableAssignment[]) {
    const link = linkByAssignment.get(a.id);
    const finished = a.archived_at !== null || a.status === 'graded' || a.status === 'dropped';

    if (finished) {
      if (link) {
        try {
          await calendar.events.delete({ calendarId, eventId: link.external_event_id });
        } catch {
          // Already gone on Google's side; dropping our link is still correct.
        }
        await db
          .from('calendar_event_links')
          .delete()
          .eq('assignment_id', a.id)
          .eq('integration_id', integration.id);
        result.deleted += 1;
      }
      continue;
    }

    const body = eventBody(a, timezone);
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32);

    if (link?.content_hash === hash) {
      result.skipped += 1;
      continue;
    }

    try {
      if (link) {
        await calendar.events.update({
          calendarId,
          eventId: link.external_event_id,
          requestBody: body,
        });

        await db
          .from('calendar_event_links')
          .update({ content_hash: hash, synced_at: new Date().toISOString() })
          .eq('assignment_id', a.id)
          .eq('integration_id', integration.id);

        result.updated += 1;
      } else {
        const created = await calendar.events.insert({ calendarId, requestBody: body });
        if (!created.data.id) throw new Error('Google returned no event id');

        await db.from('calendar_event_links').insert({
          user_id: userId,
          assignment_id: a.id,
          provider: 'google',
          integration_id: integration.id,
          external_calendar_id: calendarId,
          external_event_id: created.data.id,
          content_hash: hash,
        });

        result.created += 1;
      }
    } catch (err) {
      result.errors.push(`${a.title}: ${(err as Error).message}`);
    }
  }

  await db
    .from('integrations')
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: result.errors.length ? result.errors.slice(0, 3).join('; ') : null,
    })
    .eq('id', integration.id);

  if (run.data) {
    await db
      .from('sync_runs')
      .update({
        status: result.errors.length ? 'error' : 'success',
        finished_at: new Date().toISOString(),
        items_created: result.created,
        items_updated: result.updated,
        items_skipped: result.skipped,
        error: result.errors.length ? result.errors.join('; ').slice(0, 2000) : null,
      })
      .eq('id', run.data.id);
  }

  return result;
}
