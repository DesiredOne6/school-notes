'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import type { ActionResult } from './assignments';

/** Trims to null so empty form fields don't become empty strings in the DB. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable();

// --- Instructors -----------------------------------------------------------

const instructorSchema = z.object({
  courseId: z.string().uuid(),
  name: z.string().trim().min(1, 'Name is required').max(200),
  role: z.enum(['professor', 'ta', 'grader', 'advisor']),
  email: optionalText(200),
  phone: optionalText(60),
  office: optionalText(200),
  pronouns: optionalText(60),
  notes: optionalText(2000),
});

export async function addInstructor(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = instructorSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const { courseId, ...rest } = parsed.data;
  const supabase = await createServerSupabase();

  const { error } = await supabase
    .from('instructors')
    .insert({ user_id: user.id, course_id: courseId, ...rest });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/courses/${courseId}`);
  return { ok: true };
}

export async function deleteInstructor(id: string, courseId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('instructors').delete().eq('id', id);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/courses/${courseId}`);
  return { ok: true };
}

// --- Office hours ----------------------------------------------------------

const officeHoursSchema = z.object({
  instructorId: z.string().uuid(),
  courseId: z.string().uuid(),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day'),
  startsAt: z.string().regex(/^\d{2}:\d{2}$/, 'Start time is required'),
  endsAt: z.string().regex(/^\d{2}:\d{2}$/, 'End time is required'),
  location: optionalText(200),
  url: optionalText(500),
  byAppointment: z.boolean(),
  notes: optionalText(500),
});

export async function addOfficeHours(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = officeHoursSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const h = parsed.data;
  if (h.endsAt <= h.startsAt) {
    return { ok: false, error: 'The end time must be after the start time' };
  }

  const supabase = await createServerSupabase();

  const { error } = await supabase.from('office_hours').insert(
    h.weekdays.map((weekday) => ({
      user_id: user.id,
      instructor_id: h.instructorId,
      weekday,
      starts_at: h.startsAt,
      ends_at: h.endsAt,
      location: h.location,
      url: h.url,
      by_appointment: h.byAppointment,
      notes: h.notes,
    })),
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/courses/${h.courseId}`);
  return { ok: true };
}

export async function deleteOfficeHours(id: string, courseId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('office_hours').delete().eq('id', id);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/courses/${courseId}`);
  return { ok: true };
}

// --- Links -----------------------------------------------------------------

const linkSchema = z.object({
  courseId: z.string().uuid(),
  kind: z.enum(['zoom', 'meet', 'lms', 'syllabus', 'textbook', 'drive', 'other']),
  label: z.string().trim().min(1, 'Label is required').max(120),
  url: z.string().trim().url('Enter a valid URL').max(1000),
  passcode: optionalText(100),
});

export async function addCourseLink(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const { courseId, ...rest } = parsed.data;
  const supabase = await createServerSupabase();

  const { error } = await supabase
    .from('course_links')
    .insert({ user_id: user.id, course_id: courseId, ...rest });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/courses/${courseId}`);
  return { ok: true };
}

export async function deleteCourseLink(id: string, courseId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('course_links').delete().eq('id', id);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/courses/${courseId}`);
  return { ok: true };
}

// --- Documents -------------------------------------------------------------

const documentSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().trim().min(1, 'Title is required').max(200),
  kind: z.enum(['syllabus', 'slides', 'reading', 'rubric', 'other']),
  storagePath: z.string().max(500).nullable(),
  url: optionalText(1000),
  mimeType: optionalText(120),
  byteSize: z.number().int().nonnegative().nullable(),
});

/**
 * Records a document. The file itself is uploaded straight from the browser to
 * Supabase Storage, which keeps large files off the server entirely; this only
 * stores the resulting path.
 */
export async function addDocument(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const { courseId, storagePath, mimeType, byteSize, ...rest } = parsed.data;

  if (!storagePath && !rest.url) {
    return { ok: false, error: 'Attach a file or provide a link' };
  }

  const supabase = await createServerSupabase();

  const { error } = await supabase.from('documents').insert({
    user_id: user.id,
    course_id: courseId,
    storage_path: storagePath,
    mime_type: mimeType,
    byte_size: byteSize,
    ...rest,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/courses/${courseId}`);
  return { ok: true };
}

export async function deleteDocument(
  id: string,
  courseId: string,
  storagePath: string | null,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const supabase = await createServerSupabase();

  // Remove the stored file first; a failure there shouldn't orphan the row.
  if (storagePath) {
    await supabase.storage.from('documents').remove([storagePath]);
  }

  const { error } = await supabase.from('documents').delete().eq('id', id);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/courses/${courseId}`);
  return { ok: true };
}

/** Short-lived download link for a private document. */
export async function getDocumentUrl(storagePath: string): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createServerSupabase();
  const { data } = await supabase.storage.from('documents').createSignedUrl(storagePath, 300);

  return data?.signedUrl ?? null;
}
