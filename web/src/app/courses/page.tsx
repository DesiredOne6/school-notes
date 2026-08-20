import { createServerSupabase } from '@/lib/supabase/server';
import { CourseManager, type CourseWithMeetings } from '@/components/CourseManager';

export const dynamic = 'force-dynamic';

export default async function CoursesPage() {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('courses')
    .select('id, code, title, color, course_meetings(id, kind, weekday, starts_at, ends_at, location)')
    .is('archived_at', null)
    .order('code', { ascending: true, nullsFirst: false });

  if (error) {
    return (
      <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        Could not load courses: {error.message}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Courses</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Class meeting times appear on your calendar every week.
        </p>
      </div>

      <CourseManager courses={(data ?? []) as unknown as CourseWithMeetings[]} />
    </div>
  );
}
