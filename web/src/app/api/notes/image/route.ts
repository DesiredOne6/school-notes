import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireUser } from '@/lib/api/guards';

/**
 * Serves an image from the private notes bucket.
 *
 * Note bodies embed this stable path rather than a signed URL, because signed
 * URLs expire and would rot inside saved markdown. Each request mints a fresh
 * short-lived URL and redirects to it.
 *
 * Accepts `?id=` (an attachments row) or the older `?path=`. The id form keeps
 * the markdown short and readable while editing; the path form is kept so
 * notes written before it still render.
 */
export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  const supabase = await createServerSupabase();

  let path = params.get('path');

  if (id) {
    // RLS already scopes attachments to the owner, so this cannot read
    // someone else's row.
    const { data } = await supabase
      .from('attachments')
      .select('storage_path')
      .eq('id', id)
      .maybeSingle();

    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    path = data.storage_path;
  }

  if (!path) return NextResponse.json({ error: 'Missing id or path' }, { status: 400 });

  // Defence in depth: the storage policy already confines each user to their
  // own folder, but refuse anything outside it rather than relying on that.
  if (!path.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase.storage.from('notes').createSignedUrl(path, 3600);

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl);
}
