import { NextResponse } from 'next/server';
import { dispatchDueReminders } from '@/lib/reminders/dispatch';
import { verifyCronSecret, errorResponse } from '@/lib/api/guards';

export const maxDuration = 60;

/**
 * Sends all due reminders. Intended to run every 5 minutes:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" .../api/cron/reminders
 */
export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    return NextResponse.json(await dispatchDueReminders());
  } catch (err) {
    return errorResponse(err);
  }
}
