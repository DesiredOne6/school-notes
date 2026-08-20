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
