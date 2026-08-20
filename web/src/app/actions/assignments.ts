'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';

/**
 * Mutations run through the user's own session, so row-level security applies.
 * Nothing here uses the service-role key.
 */

const assignmentSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  courseId: z.string().uuid().nullable(),
  kind: z.enum(['assignment', 'quiz', 'exam', 'project', 'reading', 'lab', 'discussion', 'other']),
  // A datetime-local value, interpreted in the browser's timezone.
  dueAt: z.string().nullable(),
  points: z.number().nullable(),
  estimatedMinutes: z.number().int().positive().nullable(),
  priority: z.number().int().min(1).max(4),
  notes: z.string().max(5000).nullable(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createAssignment(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const data = parsed.data;
  const supabase = await createServerSupabase();

  const { error } = await supabase.from('assignments').insert({
    user_id: user.id,
    title: data.title,
    course_id: data.courseId,
    kind: data.kind,
    due_at: data.dueAt,
    points: data.points,
    estimated_minutes: data.estimatedMinutes,
    priority: data.priority,
    description: data.notes,
    source: 'manual',
  });

  if (error) return { ok: false, error: error.message };

  // The insert trigger has already queued reminders; refresh both views.
  revalidatePath('/');
  revalidatePath('/calendar');
  return { ok: true };
}

/**
 * Marks work done or reopens it. Setting the status is what clears or restores
 * the pending reminders, via the database trigger.
 */
const updateSchema = assignmentSchema.extend({
  status: z.enum(['todo', 'in_progress', 'submitted', 'graded', 'dropped']),
  score: z.number().nullable(),
});

/** Edits every field of an assignment, including ones Canvas normally owns. */
export async function updateAssignment(
  assignmentId: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const data = parsed.data;
  const supabase = await createServerSupabase();

  const { error } = await supabase
    .from('assignments')
    .update({
      title: data.title,
      course_id: data.courseId,
      kind: data.kind,
      status: data.status,
      due_at: data.dueAt,
      points: data.points,
      score: data.score,
      estimated_minutes: data.estimatedMinutes,
      priority: data.priority,
      description: data.notes,
      completed_at:
        data.status === 'submitted' || data.status === 'graded'
          ? new Date().toISOString()
          : null,
      // A Canvas-imported row edited by hand must not be silently reverted on
      // the next sync, so clear the fingerprint to force a fresh comparison.
      source_hash: null,
    })
    .eq('id', assignmentId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/');
  revalidatePath('/calendar');
  revalidatePath(`/assignments/${assignmentId}`);
  return { ok: true };
}

export async function setAssignmentStatus(
  assignmentId: string,
  done: boolean,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const supabase = await createServerSupabase();

  const { error } = await supabase
    .from('assignments')
    .update({
      status: done ? 'submitted' : 'todo',
      completed_at: done ? new Date().toISOString() : null,
    })
    .eq('id', assignmentId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/');
  revalidatePath('/calendar');
  return { ok: true };
}

export async function deleteAssignment(assignmentId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('assignments').delete().eq('id', assignmentId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/');
  revalidatePath('/calendar');
  return { ok: true };
}
