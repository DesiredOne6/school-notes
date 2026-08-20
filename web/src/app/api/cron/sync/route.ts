import { NextResponse } from 'next/server';
import { syncCanvasForUser } from '@/lib/canvas/sync';
import { syncIcsForUser } from '@/lib/canvas/ics-sync';
import { syncAssignmentsToGoogle } from '@/lib/google/calendar';
import { syncExternalCalendars } from '@/lib/google/external';
import { syncAssignmentsToNotion } from '@/lib/notion/sync';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyCronSecret, errorResponse } from '@/lib/api/guards';

export const maxDuration = 300;

/**
 * Pulls from Canvas then pushes to Google for every connected user. Runs on a
 * schedule (hourly is plenty for assignment data).
 *
 * One user's failure must not abort the rest, so every step is caught per user.
 */
export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const db = createAdminClient();

    const { data: integrations, error } = await db
      .from('integrations')
      .select('user_id, provider')
      .in('provider', ['canvas', 'ics', 'google', 'notion'])
      .neq('status', 'disconnected');

    if (error) throw new Error(error.message);

    const canvasUsers = new Set<string>();
    const icsUsers = new Set<string>();
    const googleUsers = new Set<string>();
    const notionUsers = new Set<string>();

    for (const row of integrations ?? []) {
      if (row.provider === 'canvas') canvasUsers.add(row.user_id);
      if (row.provider === 'ics') icsUsers.add(row.user_id);
      if (row.provider === 'google') googleUsers.add(row.user_id);
      if (row.provider === 'notion') notionUsers.add(row.user_id);
    }

    const report: Record<string, unknown> = { canvas: {}, ics: {}, google: {}, notion: {} };

    for (const userId of canvasUsers) {
      try {
        (report.canvas as Record<string, unknown>)[userId] = await syncCanvasForUser(userId);
      } catch (err) {
        (report.canvas as Record<string, unknown>)[userId] = {
          error: (err as Error).message,
        };
      }
    }

    for (const userId of icsUsers) {
      try {
        (report.ics as Record<string, unknown>)[userId] = await syncIcsForUser(userId);
      } catch (err) {
        (report.ics as Record<string, unknown>)[userId] = { error: (err as Error).message };
      }
    }

    // Google runs last so it picks up whatever Canvas and the feed just imported.
    for (const userId of googleUsers) {
      try {
        (report.google as Record<string, unknown>)[userId] = {
          push: await syncAssignmentsToGoogle(userId),
          pull: await syncExternalCalendars(userId),
        };
      } catch (err) {
        (report.google as Record<string, unknown>)[userId] = {
          error: (err as Error).message,
        };
      }
    }

    // Notion runs after the pulls, for the same reason Google does.
    for (const userId of notionUsers) {
      try {
        (report.notion as Record<string, unknown>)[userId] =
          await syncAssignmentsToNotion(userId);
      } catch (err) {
        (report.notion as Record<string, unknown>)[userId] = { error: (err as Error).message };
      }
    }

    return NextResponse.json(report);
  } catch (err) {
    return errorResponse(err);
  }
}
