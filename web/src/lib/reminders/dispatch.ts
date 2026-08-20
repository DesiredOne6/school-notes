import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';

let configured = false;

function configurePush() {
  if (configured) return;

  const { NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;

  if (!NEXT_PUBLIC_VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error('VAPID keys are not configured; run: npx web-push generate-vapid-keys');
  }

  webpush.setVapidDetails(
    VAPID_SUBJECT ?? 'mailto:noreply@example.com',
    NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );

  configured = true;
}

/** Human-readable "in 2 hours" / "tomorrow" for the notification body. */
export function describeLeadTime(offsetMinutes: number | null): string {
  if (offsetMinutes === null) return 'coming up';
  if (offsetMinutes < 60) return `in ${offsetMinutes} minutes`;
  if (offsetMinutes < 1440) {
    const h = Math.round(offsetMinutes / 60);
    return `in ${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Math.round(offsetMinutes / 1440);
  return d === 1 ? 'tomorrow' : `in ${d} days`;
}

/**
 * True when `at` falls inside the user's quiet hours. Handles windows that wrap
 * midnight (e.g. 22:00 to 07:00), which is the common case.
 */
export function inQuietHours(
  at: Date,
  timezone: string,
  start: string | null,
  end: string | null,
): boolean {
  if (!start || !end) return false;

  // Read the wall-clock hour/minute in the user's own timezone.
  const local = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);

  const [h, m] = local.split(':').map(Number);
  const minutes = h * 60 + m;
  const toMinutes = (t: string) => {
    const [hh, mm] = t.split(':').map(Number);
    return hh * 60 + mm;
  };

  const s = toMinutes(start);
  const e = toMinutes(end);

  return s <= e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/**
 * Shape of the embedded reminder query below. Declared by hand because the
 * hand-written Database types carry no relationship metadata for supabase-js to
 * infer nested selects from.
 */
type DueReminder = {
  id: string;
  user_id: string;
  offset_minutes: number | null;
  remind_at: string;
  channel: string;
  assignments: {
    id: string;
    title: string;
    due_at: string | null;
    status: string;
    archived_at: string | null;
    courses: { code: string | null; title: string } | null;
  } | null;
};

export type DispatchResult = {
  sent: number;
  failed: number;
  deferred: number;
  skipped: number;
  prunedSubscriptions: number;
};

/**
 * Sends every reminder that has come due.
 *
 * Called on a schedule (see /api/cron/reminders). Reminders landing in quiet
 * hours are pushed forward rather than dropped, so a 2am deadline warning
 * arrives at 7am instead of waking the user.
 */
export async function dispatchDueReminders(limit = 200): Promise<DispatchResult> {
  configurePush();

  const db = createAdminClient();
  const result: DispatchResult = {
    sent: 0, failed: 0, deferred: 0, skipped: 0, prunedSubscriptions: 0,
  };

  const { data, error } = await db
    .from('reminders')
    .select(
      'id, user_id, offset_minutes, remind_at, channel,' +
        ' assignments(id, title, due_at, status, archived_at, courses(code, title))',
    )
    .eq('status', 'pending')
    .lte('remind_at', new Date().toISOString())
    .order('remind_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`loading due reminders: ${error.message}`);

  const due = (data ?? []) as unknown as DueReminder[];
  if (!due.length) return result;

  // Cache per-user data so a batch of reminders for one user hits the DB once.
  const profiles = new Map<string, { timezone: string; qs: string | null; qe: string | null }>();
  const subscriptions = new Map<
    string,
    Array<{ id: string; endpoint: string; p256dh: string; auth: string }>
  >();

  for (const reminder of due) {
    const assignment = reminder.assignments;

    // The assignment was finished or archived after the reminder was queued.
    if (
      !assignment ||
      assignment.archived_at ||
      ['submitted', 'graded', 'dropped'].includes(assignment.status)
    ) {
      await db.from('reminders').update({ status: 'skipped' }).eq('id', reminder.id);
      result.skipped += 1;
      continue;
    }

    if (!profiles.has(reminder.user_id)) {
      const { data: p } = await db
        .from('profiles')
        .select('timezone, quiet_hours_start, quiet_hours_end')
        .eq('id', reminder.user_id)
        .maybeSingle();

      profiles.set(reminder.user_id, {
        timezone: p?.timezone ?? 'America/New_York',
        qs: p?.quiet_hours_start ?? null,
        qe: p?.quiet_hours_end ?? null,
      });
    }

    const profile = profiles.get(reminder.user_id)!;

    if (inQuietHours(new Date(), profile.timezone, profile.qs, profile.qe)) {
      // Defer to the end of the quiet window. Recomputing the exact local
      // instant is fiddly; nudging forward 30 minutes and re-checking on the
      // next tick converges without extra date math.
      await db
        .from('reminders')
        .update({ remind_at: new Date(Date.now() + 30 * 60_000).toISOString() })
        .eq('id', reminder.id);

      result.deferred += 1;
      continue;
    }

    if (!subscriptions.has(reminder.user_id)) {
      const { data: subs } = await db
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .eq('user_id', reminder.user_id);

      subscriptions.set(reminder.user_id, subs ?? []);
    }

    const subs = subscriptions.get(reminder.user_id)!;

    if (!subs.length) {
      await db
        .from('reminders')
        .update({ status: 'failed', error: 'no push subscriptions registered' })
        .eq('id', reminder.id);

      result.failed += 1;
      continue;
    }

    const courseLabel = assignment.courses?.code ?? assignment.courses?.title ?? 'School';
    const payload = JSON.stringify({
      title: `${courseLabel}: ${assignment.title}`,
      body: `Due ${describeLeadTime(reminder.offset_minutes)}.`,
      url: `/assignments/${assignment.id}`,
      tag: `assignment-${assignment.id}`,
    });

    let anyDelivered = false;
    const errors: string[] = [];

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );

        anyDelivered = true;
        await db
          .from('push_subscriptions')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', sub.id);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;

        // 404/410 mean the browser dropped the subscription for good.
        if (status === 404 || status === 410) {
          await db.from('push_subscriptions').delete().eq('id', sub.id);
          result.prunedSubscriptions += 1;
        } else {
          errors.push(`${status ?? 'error'}: ${(err as Error).message}`);
        }
      }
    }

    if (anyDelivered) {
      await db
        .from('reminders')
        .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
        .eq('id', reminder.id);

      result.sent += 1;
    } else {
      await db
        .from('reminders')
        .update({
          status: 'failed',
          error: errors.join('; ').slice(0, 500) || 'all subscriptions expired',
        })
        .eq('id', reminder.id);

      result.failed += 1;
    }
  }

  return result;
}
