import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireUser } from '@/lib/api/guards';

/**
 * Serves an image from the private notes bucket.
 *
 * Note bodies embed this stable path rather than a signed URL, because signed
 * URLs expire and would rot inside saved markdown. Each request mints a fresh
 * short-lived URL and redirects to it.
 */
export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  const path = new URL(request.url).searchParams.get('path');
  if (!path) return NextResponse.json({ error: 'Missing path' }, { status: 400 });

  // Defence in depth: storage policy already scopes to the user's folder, but
  // refuse anything outside it rather than relying on that alone.
  if (!path.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.storage.from('notes').createSignedUrl(path, 3600);

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl);
}
