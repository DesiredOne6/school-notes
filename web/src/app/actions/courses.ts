'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import type { ActionResult } from './assignments';

const courseSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  code: z.string().trim().max(40).nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour'),
  location: z.string().trim().max(200).nullable(),
});

export async function updateCourse(
  courseId: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = courseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('courses').update(parsed.data).eq('id', courseId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/courses');
  revalidatePath(`/courses/${courseId}`);
  revalidatePath('/calendar');
  revalidatePath('/');
  return { ok: true };
}

export async function createCourse(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = courseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('courses').insert({
    user_id: user.id,
    ...parsed.data,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath('/courses');
  revalidatePath('/calendar');
  return { ok: true };
}

const meetingSchema = z.object({
  courseId: z.string().uuid(),
  kind: z.string().min(1).max(40),
  // Multiple weekdays at once: a class usually meets MWF at the same time.
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day'),
  startsAt: z.string().regex(/^\d{2}:\d{2}$/, 'Start time is required'),
  endsAt: z.string().regex(/^\d{2}:\d{2}$/, 'End time is required'),
  location: z.string().trim().max(200).nullable(),
  url: z.string().trim().max(500).nullable(),
  startsOn: z.string().nullable(),
  endsOn: z.string().nullable(),
});

export async function addCourseMeetings(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = meetingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const m = parsed.data;
  if (m.endsAt <= m.startsAt) {
    return { ok: false, error: 'The end time must be after the start time' };
  }

  const supabase = await createServerSupabase();

  const { error } = await supabase.from('course_meetings').insert(
    m.weekdays.map((weekday) => ({
      user_id: user.id,
      course_id: m.courseId,
      kind: m.kind,
      weekday,
      starts_at: m.startsAt,
      ends_at: m.endsAt,
      location: m.location,
      url: m.url,
      starts_on: m.startsOn,
      ends_on: m.endsOn,
    })),
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath('/courses');
  revalidatePath('/calendar');
  return { ok: true };
}

/**
 * Removes every row behind one displayed meeting. A Tue/Thu lecture shows as a
 * single line but is two rows, and deleting only one would silently leave half
 * the class on the calendar.
 */
/**
 * Replaces one grouped meeting time.
 *
 * Editing can change which weekdays are involved, so the old rows are removed
 * and new ones inserted rather than trying to reconcile them one by one.
 */
export async function updateCourseMeetings(
  meetingIds: string[],
  input: unknown,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = meetingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const m = parsed.data;
  if (m.endsAt <= m.startsAt) {
    return { ok: false, error: 'The end time must be after the start time' };
  }

  const supabase = await createServerSupabase();

  const { error: insertError } = await supabase.from('course_meetings').insert(
    m.weekdays.map((weekday) => ({
      user_id: user.id,
      course_id: m.courseId,
      kind: m.kind,
      weekday,
      starts_at: m.startsAt,
      ends_at: m.endsAt,
      location: m.location,
      url: m.url,
      starts_on: m.startsOn,
      ends_on: m.endsOn,
    })),
  );

  if (insertError) return { ok: false, error: insertError.message };

  // Only remove the old rows once the replacements are safely in.
  if (meetingIds.length > 0) {
    await supabase.from('course_meetings').delete().in('id', meetingIds);
  }

  revalidatePath('/courses');
  revalidatePath(`/courses/${m.courseId}`);
  revalidatePath('/calendar');
  return { ok: true };
}

export async function deleteCourseMeetings(meetingIds: string[]): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };
  if (meetingIds.length === 0) return { ok: true };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('course_meetings').delete().in('id', meetingIds);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/courses');
  revalidatePath('/calendar');
  return { ok: true };
}

export async function deleteCourseMeeting(meetingId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('course_meetings').delete().eq('id', meetingId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/courses');
  revalidatePath('/calendar');
  return { ok: true };
}

export type CourseImpact = {
  assignments: number;
  notes: number;
  documents: number;
  meetings: number;
  links: number;
  instructors: number;
};

/**
 * What deleting a course would take with it.
 *
 * Shown before the confirmation because the cascade is not obvious: assignments
 * and documents go with the course, while notes survive and simply lose their
 * course.
 */
export async function getCourseImpact(courseId: string): Promise<CourseImpact | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createServerSupabase();
  const count = async (table: string, column = 'course_id') => {
    const { count: n } = await supabase
      .from(table as 'assignments')
      .select('*', { count: 'exact', head: true })
      .eq(column, courseId);
    return n ?? 0;
  };

  const [assignments, notes, documents, meetings, links, instructors] = await Promise.all([
    count('assignments'),
    count('notes'),
    count('documents'),
    count('course_meetings'),
    count('course_links'),
    count('instructors'),
  ]);

  return { assignments, notes, documents, meetings, links, instructors };
}

/** Hides a finished course without destroying anything. */
export async function setCourseArchived(
  courseId: string,
  archived: boolean,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('courses')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', courseId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/courses');
  revalidatePath('/calendar');
  revalidatePath('/');
  return { ok: true };
}

/**
 * Deletes a course and everything that cascades from it.
 *
 * Stored files are removed first: the database cascade drops the document rows
 * but knows nothing about the objects in storage, which would otherwise be
 * orphaned and keep consuming quota forever.
 */
export async function deleteCourse(courseId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const supabase = await createServerSupabase();

  const { data: documents } = await supabase
    .from('documents')
    .select('storage_path')
    .eq('course_id', courseId);

  const paths = (documents ?? [])
    .map((d) => d.storage_path)
    .filter((p): p is string => Boolean(p));

  if (paths.length > 0) {
    await supabase.storage.from('documents').remove(paths);
  }

  const { error } = await supabase.from('courses').delete().eq('id', courseId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/courses');
  revalidatePath('/calendar');
  revalidatePath('/');
  revalidatePath('/notes');
  return { ok: true };
}
