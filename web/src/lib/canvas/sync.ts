import { createHash } from 'node:crypto';
import { CanvasClient, type CanvasAssignment, type CanvasQuiz } from './client';
import { createAdminClient } from '@/lib/supabase/admin';
import type { WorkKind } from '@/lib/types/db';

export type SyncResult = {
  coursesCreated: number;
  coursesUpdated: number;
  assignmentsCreated: number;
  assignmentsUpdated: number;
  assignmentsSkipped: number;
  errors: string[];
};

/**
 * Canvas has no "exam" type - a midterm is just an assignment or a quiz. These
 * patterns promote obvious exams so they can be styled and prioritised
 * differently from weekly homework. Titles that don't match keep their base
 * type, and the user can always change it by hand.
 */
const EXAM_PATTERN = /\b(exam|midterm|final|test\s*\d*|prelim)\b/i;

/** True when a title reads like an exam. Shared with the ICS importer. */
export function looksLikeExam(title: string): boolean {
  return EXAM_PATTERN.test(title);
}

export function classifyAssignment(a: CanvasAssignment): WorkKind {
  if (EXAM_PATTERN.test(a.name)) return 'exam';
  if (a.is_quiz_assignment || a.quiz_id) return 'quiz';
  if (a.submission_types?.includes('online_quiz')) return 'quiz';
  if (a.submission_types?.includes('discussion_topic')) return 'discussion';
  return 'assignment';
}

export function classifyQuiz(q: CanvasQuiz): WorkKind {
  if (EXAM_PATTERN.test(q.title)) return 'exam';
  if (q.quiz_type === 'survey' || q.quiz_type === 'graded_survey') return 'other';
  return 'quiz';
}

/**
 * Fingerprints the upstream fields we mirror. If this is unchanged since the
 * last sync we skip the row entirely, which keeps sync cheap and avoids
 * bumping updated_at on hundreds of untouched assignments.
 */
function fingerprint(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

/**
 * Pulls courses, assignments, and quizzes from Canvas into the database.
 *
 * Local edits are preserved: `status`, `priority`, and `estimated_minutes` are
 * user-owned and never overwritten, except that a Canvas submission promotes an
 * item to 'submitted' (that's upstream truth, and it's the whole point of
 * syncing).
 */
export async function syncCanvasForUser(userId: string): Promise<SyncResult> {
  const db = createAdminClient();
  const result: SyncResult = {
    coursesCreated: 0,
    coursesUpdated: 0,
    assignmentsCreated: 0,
    assignmentsUpdated: 0,
    assignmentsSkipped: 0,
    errors: [],
  };

  const { data: integration, error: intErr } = await db
    .from('integrations')
    .select('id, config')
    .eq('user_id', userId)
    .eq('provider', 'canvas')
    .maybeSingle();

  if (intErr) throw new Error(`loading canvas integration: ${intErr.message}`);
  if (!integration) throw new Error('Canvas is not connected for this user');

  const { data: secret } = await db
    .from('integration_secrets')
    .select('access_token')
    .eq('integration_id', integration.id)
    .maybeSingle();

  const token = secret?.access_token;
  const baseUrl = (integration.config as { base_url?: string })?.base_url;
  if (!token || !baseUrl) throw new Error('Canvas credentials are incomplete');

  const { data: run } = await db
    .from('sync_runs')
    .insert({ user_id: userId, provider: 'canvas', direction: 'pull' })
    .select('id')
    .single();

  const canvas = new CanvasClient(baseUrl, token);

  try {
    const courses = await canvas.activeCourses();

    // Map Canvas course id -> local course id, creating rows as needed.
    const courseIds = new Map<number, string>();

    for (const c of courses) {
      const { data: existing } = await db
        .from('courses')
        .select('id')
        .eq('user_id', userId)
        .eq('canvas_course_id', c.id)
        .maybeSingle();

      if (existing) {
        courseIds.set(c.id, existing.id);
        result.coursesUpdated += 1;
      } else {
        const { data: created, error } = await db
          .from('courses')
          .insert({
            user_id: userId,
            title: c.name,
            code: c.course_code,
            canvas_course_id: c.id,
          })
          .select('id')
          .single();

        if (error || !created) {
          result.errors.push(`course ${c.name}: ${error?.message}`);
          continue;
        }

        courseIds.set(c.id, created.id);
        result.coursesCreated += 1;

        // Seed instructors from the Canvas teacher list on first import only,
        // so we don't re-add someone the user deliberately deleted.
        for (const t of c.teachers ?? []) {
          await db.from('instructors').insert({
            user_id: userId,
            course_id: created.id,
            name: t.display_name,
            role: 'professor',
          });
        }
      }
    }

    for (const c of courses) {
      const localCourseId = courseIds.get(c.id);
      if (!localCourseId) continue;

      let items: Array<{
        canvasId: number;
        title: string;
        description: string | null;
        kind: WorkKind;
        dueAt: string | null;
        availableAt: string | null;
        lockAt: string | null;
        points: number | null;
        url: string | null;
        submittedAt: string | null;
        score: number | null;
      }> = [];

      try {
        const assignments = await canvas.courseAssignments(c.id);

        items = assignments
          .filter((a) => a.published !== false)
          .map((a) => ({
            canvasId: a.id,
            title: a.name,
            description: a.description,
            kind: classifyAssignment(a),
            dueAt: a.due_at,
            availableAt: a.unlock_at,
            lockAt: a.lock_at,
            points: a.points_possible,
            url: a.html_url,
            submittedAt: a.submission?.submitted_at ?? null,
            score: a.submission?.score ?? null,
          }));

        // Classic quizzes that aren't backed by an assignment row don't appear
        // in the assignments list, so they'd be missed entirely.
        const quizzes = await canvas.courseQuizzes(c.id);
        const seen = new Set(assignments.map((a) => a.quiz_id).filter(Boolean));

        for (const q of quizzes) {
          if (q.assignment_id || seen.has(q.id) || q.published === false) continue;
          items.push({
            // Offset quiz ids into a separate range so they can't collide with
            // assignment ids in the canvas_assignment_id column.
            canvasId: -q.id,
            title: q.title,
            description: q.description,
            kind: classifyQuiz(q),
            dueAt: q.due_at,
            availableAt: q.unlock_at,
            lockAt: q.lock_at,
            points: q.points_possible,
            url: q.html_url,
            submittedAt: null,
            score: null,
          });
        }
      } catch (err) {
        result.errors.push(`course ${c.name}: ${(err as Error).message}`);
        continue;
      }

      for (const item of items) {
        const hash = fingerprint([
          item.title, item.dueAt, item.points, item.lockAt,
          item.availableAt, item.url, item.submittedAt, item.score,
        ]);

        const { data: existing } = await db
          .from('assignments')
          .select('id, source_hash, status')
          .eq('user_id', userId)
          .eq('canvas_assignment_id', item.canvasId)
          .maybeSingle();

        if (existing?.source_hash === hash) {
          result.assignmentsSkipped += 1;
          continue;
        }

        // Upstream truth: if Canvas says it's submitted, reflect that. Otherwise
        // leave whatever the user set locally.
        const statusPatch =
          item.submittedAt && existing?.status !== 'graded'
            ? { status: 'submitted' as const, completed_at: item.submittedAt }
            : {};

        const upstream = {
          title: item.title,
          description: item.description,
          kind: item.kind,
          due_at: item.dueAt,
          available_at: item.availableAt,
          lock_at: item.lockAt,
          points: item.points,
          score: item.score,
          url: item.url,
          source: 'canvas' as const,
          source_hash: hash,
          course_id: localCourseId,
          ...statusPatch,
        };

        if (existing) {
          const { error } = await db
            .from('assignments')
            .update(upstream)
            .eq('id', existing.id);

          if (error) result.errors.push(`${item.title}: ${error.message}`);
          else result.assignmentsUpdated += 1;
        } else {
          const { error } = await db.from('assignments').insert({
            user_id: userId,
            canvas_assignment_id: item.canvasId,
            ...upstream,
          });

          if (error) result.errors.push(`${item.title}: ${error.message}`);
          else result.assignmentsCreated += 1;
        }
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
