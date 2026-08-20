import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { toFeedItems, parseIcs, normalizeFeedUrl, type CanvasFeedItem } from './ics';
import { looksLikeExam } from './sync';
import type { WorkKind } from '@/lib/types/db';

export type IcsSyncResult = {
  coursesCreated: number;
  assignmentsCreated: number;
  assignmentsUpdated: number;
  assignmentsSkipped: number;
  errors: string[];
};

/**
 * The feed gives us a title and nothing else to classify by, so quizzes can't
 * be distinguished from homework here - only exams, which are worth surfacing.
 */
function classifyFeedItem(item: CanvasFeedItem): WorkKind {
  return looksLikeExam(item.title) ? 'exam' : 'assignment';
}

/** Downloads and parses a Canvas calendar feed. */
export async function fetchFeed(feedUrl: string): Promise<CanvasFeedItem[]> {
  const res = await fetch(normalizeFeedUrl(feedUrl), {
    headers: { Accept: 'text/calendar, text/plain' },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Canvas feed returned ${res.status}. Check the URL is correct and current.`);
  }

  const body = await res.text();

  if (!body.includes('BEGIN:VCALENDAR')) {
    throw new Error('That URL did not return a calendar feed. Copy the link from Canvas → Calendar → Calendar Feed.');
  }

  return toFeedItems(parseIcs(body));
}

/**
 * Imports assignments from a user's Canvas calendar feed.
 *
 * Used when a Canvas administrator has disabled personal access tokens. Rows
 * are keyed on `canvas_assignment_id`, the same key the REST importer uses, so
 * switching between the two never produces duplicates.
 *
 * The feed carries no points or submission state, so those columns are left
 * untouched - a REST sync (or the user) may have filled them in.
 */
export async function syncIcsForUser(userId: string): Promise<IcsSyncResult> {
  const db = createAdminClient();
  const result: IcsSyncResult = {
    coursesCreated: 0,
    assignmentsCreated: 0,
    assignmentsUpdated: 0,
    assignmentsSkipped: 0,
    errors: [],
  };

  const { data: integration } = await db
    .from('integrations')
    .select('id')
    .eq('user_id', userId)
    .eq('provider', 'ics')
    .maybeSingle();

  if (!integration) throw new Error('No Canvas calendar feed is connected');

  const { data: secret } = await db
    .from('integration_secrets')
    .select('access_token')
    .eq('integration_id', integration.id)
    .maybeSingle();

  const feedUrl = secret?.access_token;
  if (!feedUrl) throw new Error('The saved feed URL is missing; reconnect it');

  const { data: run } = await db
    .from('sync_runs')
    .insert({ user_id: userId, provider: 'ics', direction: 'pull' })
    .select('id')
    .single();

  try {
    const items = await fetchFeed(feedUrl);

    // Resolve Canvas course ids to local courses once, creating any that are new.
    const courseIds = new Map<number, string>();

    for (const item of items) {
      if (item.canvasCourseId === null || courseIds.has(item.canvasCourseId)) continue;

      const { data: existing } = await db
        .from('courses')
        .select('id')
        .eq('user_id', userId)
        .eq('canvas_course_id', item.canvasCourseId)
        .maybeSingle();

      if (existing) {
        courseIds.set(item.canvasCourseId, existing.id);
        continue;
      }

      // The feed only exposes the course code, so it seeds both fields. The
      // user can rename the course later without breaking the id link.
      const label = item.courseCode ?? `Canvas course ${item.canvasCourseId}`;
      const { data: created, error } = await db
        .from('courses')
        .insert({
          user_id: userId,
          title: label,
          code: item.courseCode,
          canvas_course_id: item.canvasCourseId,
        })
        .select('id')
        .single();

      if (error || !created) {
        result.errors.push(`course ${label}: ${error?.message}`);
        continue;
      }

      courseIds.set(item.canvasCourseId, created.id);
      result.coursesCreated += 1;
    }

    for (const item of items) {
      if (item.canvasAssignmentId === null) {
        result.assignmentsSkipped += 1;
        continue;
      }

      const hash = createHash('sha256')
        .update(JSON.stringify([item.title, item.dueAt?.toISOString() ?? null, item.url]))
        .digest('hex')
        .slice(0, 32);

      const { data: existing } = await db
        .from('assignments')
        .select('id, source_hash, source')
        .eq('user_id', userId)
        .eq('canvas_assignment_id', item.canvasAssignmentId)
        .maybeSingle();

      if (existing?.source_hash === hash) {
        result.assignmentsSkipped += 1;
        continue;
      }

      const localCourseId =
        item.canvasCourseId !== null ? (courseIds.get(item.canvasCourseId) ?? null) : null;

      const upstream = {
        title: item.title,
        due_at: item.dueAt?.toISOString() ?? null,
        due_is_all_day: item.isAllDay,
        url: item.url,
        kind: classifyFeedItem(item),
        source: 'ics' as const,
        source_hash: hash,
        ...(localCourseId ? { course_id: localCourseId } : {}),
        ...(item.description ? { description: item.description } : {}),
      };

      if (existing) {
        // A row already imported over the REST API has richer data; don't
        // downgrade its `source` just because the feed also saw it.
        const patch = existing.source === 'canvas' ? { ...upstream, source: 'canvas' as const } : upstream;

        const { error } = await db.from('assignments').update(patch).eq('id', existing.id);
        if (error) result.errors.push(`${item.title}: ${error.message}`);
        else result.assignmentsUpdated += 1;
      } else {
        const { error } = await db.from('assignments').insert({
          user_id: userId,
          canvas_assignment_id: item.canvasAssignmentId,
          ...upstream,
        });

        if (error) result.errors.push(`${item.title}: ${error.message}`);
        else result.assignmentsCreated += 1;
      }
    }

    await db
      .from('integrations')
      .update({
        last_synced_at: new Date().toISOString(),
        status: 'connected',
        last_error: result.errors.length ? result.errors.slice(0, 3).join('; ') : null,
      })
      .eq('id', integration.id);

    if (run) {
      await db
        .from('sync_runs')
        .update({
          status: result.errors.length ? 'error' : 'success',
          finished_at: new Date().toISOString(),
          items_created: result.assignmentsCreated,
          items_updated: result.assignmentsUpdated,
          items_skipped: result.assignmentsSkipped,
          error: result.errors.length ? result.errors.join('; ').slice(0, 2000) : null,
        })
        .eq('id', run.id);
    }

    return result;
  } catch (err) {
    const message = (err as Error).message;

    await db
      .from('integrations')
      .update({ status: 'error', last_error: message })
      .eq('id', integration.id);

    if (run) {
      await db
        .from('sync_runs')
        .update({ status: 'error', finished_at: new Date().toISOString(), error: message })
        .eq('id', run.id);
    }

    throw err;
  }
}
