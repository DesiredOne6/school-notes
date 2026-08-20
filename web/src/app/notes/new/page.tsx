import { redirect } from 'next/navigation';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { normalizeTitle } from '@/lib/notes/wikilinks';

export const dynamic = 'force-dynamic';

/**
 * Creates a note and opens it. This is where an unresolved [[wiki link]] leads,
 * so writing a link is enough to bring the note into existence.
 *
 * If a note with that title already exists it opens that one instead, which
 * keeps a stale link from silently producing duplicates.
 */
export default async function NewNotePage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string; course?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const title = params.title?.trim() || 'Untitled';
  const supabase = await createServerSupabase();

  const { data: existing } = await supabase
    .from('notes')
    .select('id, title')
    .is('archived_at', null);

  const match = (existing ?? []).find(
    (n) => normalizeTitle(n.title) === normalizeTitle(title),
  );

  if (match) redirect(`/notes/${match.id}`);

  const { data, error } = await supabase
    .from('notes')
    .insert({
      user_id: user.id,
      title,
      course_id: params.course ?? null,
    })
    .select('id')
    .single();

  if (error || !data) redirect('/notes?error=could_not_create');

  redirect(`/notes/${data.id}`);
}
