import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { NoteEditor, type NoteRecord } from '@/components/notes/NoteEditor';
import { HandwritingPage } from '@/components/notes/HandwritingPage';
import type { InkDrawing } from '@/lib/ink/strokes';
import type { InkBackground } from '@/components/notes/InkSurface';

export const dynamic = 'force-dynamic';

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) notFound();

  const { data: note } = await supabase
    .from('notes')
    .select('id, title, body, tags, course_id, kind, updated_at')
    .eq('id', id)
    .maybeSingle();

  if (!note) notFound();

  // --- Full-page handwriting ------------------------------------------------
  if (note.kind === 'handwritten') {
    const { data: attachment } = await supabase
      .from('attachments')
      .select('ink_metadata')
      .eq('note_id', id)
      .eq('kind', 'ink')
      .maybeSingle();

    const metadata = (attachment?.ink_metadata ?? null) as {
      vector_path?: string;
      background?: InkBackground;
    } | null;

    let drawing: InkDrawing | null = null;

    if (metadata?.vector_path) {
      // Loading the strokes here means the client gets the drawing with the
      // page, rather than a blank canvas that fills in a moment later.
      const { data: file } = await supabase.storage
        .from('notes')
        .download(metadata.vector_path);

      if (file) {
        try {
          drawing = JSON.parse(await file.text()) as InkDrawing;
        } catch {
          // A corrupt vector file shouldn't block opening the page; the PNG
          // still exists and the user can start again.
          drawing = null;
        }
      }
    }

    return (
      <HandwritingPage
        noteId={note.id}
        initialTitle={note.title}
        initialDrawing={drawing}
        initialBackground={metadata?.background ?? 'ruled'}
        userId={auth.user.id}
      />
    );
  }

  // --- Markdown note --------------------------------------------------------
  const [coursesRes, titlesRes, backlinksRes] = await Promise.all([
    supabase.from('courses').select('id, code, title').is('archived_at', null).order('code'),
    supabase.from('notes').select('id, title').is('archived_at', null),
    supabase
      .from('note_links')
      .select('source_note_id, notes!note_links_source_note_id_fkey(id, title)')
      .eq('target_note_id', id),
  ]);

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
