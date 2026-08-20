import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { AssignmentEditor, type AssignmentRecord } from '@/components/AssignmentEditor';

export const dynamic = 'force-dynamic';

/**
 * Assignment detail and editing.
 *
 * Reminder notifications deep-link here, so this route existing is what makes
 * tapping a notification useful rather than a dead end.
 */
export default async function AssignmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [assignmentRes, coursesRes, remindersRes] = await Promise.all([
    supabase
      .from('assignments')
      .select(
        'id, title, description, kind, status, due_at, due_is_all_day, points, score,' +
          ' priority, estimated_minutes, url, source, course_id',
      )
      .eq('id', id)
      .maybeSingle(),
    supabase.from('courses').select('id, code, title').is('archived_at', null).order('code'),
    supabase
      .from('reminders')
      .select('id, remind_at, offset_minutes, status')
      .eq('assignment_id', id)
      .order('remind_at'),
  ]);

  const assignment = assignmentRes.data;
  if (!assignment) notFound();

  return (
    <div className="space-y-5">
      <Link href="/" className="text-xs text-[var(--color-muted)] hover:text-white">
        ← Dashboard
      </Link>

      <AssignmentEditor
        assignment={assignment as unknown as AssignmentRecord}
        courses={coursesRes.data ?? []}
        reminders={remindersRes.data ?? []}
      />
    </div>
  );
}
