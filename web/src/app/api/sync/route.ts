import { NextResponse } from 'next/server';
import { syncCanvasForUser } from '@/lib/canvas/sync';
import { syncIcsForUser } from '@/lib/canvas/ics-sync';
import { syncAssignmentsToGoogle } from '@/lib/google/calendar';
import { syncExternalCalendars } from '@/lib/google/external';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser, errorResponse } from '@/lib/api/guards';

export const maxDuration = 120;

/**
 * Runs every integration the user has connected, in dependency order: pull
 * assignments in first, then push the resulting due dates to Google.
 *
 * One provider failing must not hide another's success, so each is caught
 * independently and reported separately.
 */
export async function POST() {
  const { user, response } = await requireUser();
  if (!user) return response;

  try {
    const db = createAdminClient();

    const { data: integrations } = await db
      .from('integrations')
      .select('provider')
      .eq('user_id', user.id)
      .neq('status', 'disconnected');

    const connected = new Set((integrations ?? []).map((i) => i.provider));
    const report: Record<string, unknown> = {};

    if (connected.has('canvas')) {
      try {
        report.canvas = await syncCanvasForUser(user.id);
      } catch (err) {
        report.canvas = { error: (err as Error).message };
      }
    }

    if (connected.has('ics')) {
      try {
        report.ics = await syncIcsForUser(user.id);
      } catch (err) {
        report.ics = { error: (err as Error).message };
      }
    }

    if (connected.has('google')) {
      try {
        report.google = await syncAssignmentsToGoogle(user.id);
      } catch (err) {
        report.google = { error: (err as Error).message };
      }

      // Pulling the user's other calendars is independent of pushing
      // assignments, so a failure in one must not mask the other.
      try {
        report.calendars = await syncExternalCalendars(user.id);
      } catch (err) {
        report.calendars = { error: (err as Error).message };
      }
    }

    if (Object.keys(report).length === 0) {
      return NextResponse.json({ error: 'Nothing is connected yet' }, { status: 400 });
    }

    return NextResponse.json(report);
  } catch (err) {
    return errorResponse(err);
  }
}
