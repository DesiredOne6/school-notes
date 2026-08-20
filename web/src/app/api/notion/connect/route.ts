import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyNotionToken, listAccessiblePages } from '@/lib/notion/sync';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser, errorResponse } from '@/lib/api/guards';

const schema = z.object({ token: z.string().trim().min(20) });

/** Validates a Notion integration token and stores it. */
export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  try {
    const { token } = schema.parse(await request.json());

    // Fail before persisting, so a bad token doesn't show as "connected".
    const workspace = await verifyNotionToken(token);
    const pages = await listAccessiblePages(token);

    const db = createAdminClient();

    const { data: integration, error } = await db
      .from('integrations')
      .upsert(
        {
          user_id: user.id,
          provider: 'notion',
          external_account_id: workspace.id,
          status: 'connected',
          account_label: workspace.name,
          last_error: null,
        },
        { onConflict: 'user_id,provider,external_account_id' },
      )
      .select('id')
      .single();

    if (error || !integration) throw new Error(error?.message ?? 'could not save integration');

    const { error: secretError } = await db
      .from('integration_secrets')
      .upsert(
        { integration_id: integration.id, access_token: token },
        { onConflict: 'integration_id' },
      );

    if (secretError) throw new Error(secretError.message);

    return NextResponse.json({
      connected: true,
      workspace: workspace.name,
      pages,
      // An empty list almost always means the user hasn't shared a page with
      // the integration, which is the usual first-run stumble.
      needsSharing: pages.length === 0,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Enter a valid Notion token' }, { status: 400 });
    }
    return errorResponse(err, 400);
  }
}
