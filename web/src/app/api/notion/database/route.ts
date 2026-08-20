import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ensureNotionDatabase, listAccessiblePages } from '@/lib/notion/sync';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser, errorResponse } from '@/lib/api/guards';

const schema = z.object({ parentPageId: z.string().min(10) });

/** Chooses where the assignments database lives, then creates it. */
export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  try {
    const { parentPageId } = schema.parse(await request.json());
    const db = createAdminClient();

    const { data: integration } = await db
      .from('integrations')
      .select('id, config')
      .eq('user_id', user.id)
      .eq('provider', 'notion')
      .maybeSingle();

    if (!integration) throw new Error('Notion is not connected');

    const config = (integration.config ?? {}) as Record<string, unknown>;

    await db
      .from('integrations')
      .update({ config: { ...config, parent_page_id: parentPageId } })
      .eq('id', integration.id);

    const { databaseId } = await ensureNotionDatabase(user.id, integration.id);

    return NextResponse.json({ databaseId });
  } catch (err) {
    return errorResponse(err, 400);
  }
}

/** Re-lists pages the integration can see, for the picker. */
export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response;

  try {
    const db = createAdminClient();

    const { data: integration } = await db
      .from('integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'notion')
      .maybeSingle();

    if (!integration) return NextResponse.json({ pages: [] });

    const { data: secret } = await db
      .from('integration_secrets')
      .select('access_token')
      .eq('integration_id', integration.id)
      .maybeSingle();

    if (!secret?.access_token) return NextResponse.json({ pages: [] });

    return NextResponse.json({ pages: await listAccessiblePages(secret.access_token) });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
