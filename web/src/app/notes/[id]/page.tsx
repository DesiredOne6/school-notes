import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { NoteEditor, type NoteRecord } from '@/components/notes/NoteEditor';

export const dynamic = 'force-dynamic';

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) notFound();

  const [noteRes, coursesRes, titlesRes, backlinksRes] = await Promise.all([
    supabase
      .from('notes')
      .select('id, title, body, tags, course_id, updated_at')
      .eq('id', id)
      .maybeSingle(),
    supabase.from('courses').select('id, code, title').is('archived_at', null).order('code'),
    // Title index drives [[wiki link]] resolution in the preview.
    supabase.from('notes').select('id, title').is('archived_at', null),
    // Notes pointing at this one, resolved from the link table rather than by
    // scanning every note body.
    supabase
      .from('note_links')
      .select('source_note_id, notes!note_links_source_note_id_fkey(id, title)')
      .eq('target_note_id', id),
  ]);

  const note = noteRes.data;
  if (!note) notFound();

  const backlinks = ((backlinksRes.data ?? []) as unknown as Array<{
    notes: { id: string; title: string } | null;
  }>)
    .map((row) => row.notes)
    .filter((n): n is { id: string; title: string } => Boolean(n));

  return (
    <NoteEditor
      note={note as NoteRecord}
      courses={coursesRes.data ?? []}
      titleIndex={titlesRes.data ?? []}
      backlinks={backlinks}
      userId={auth.user.id}
    />
  );
}
