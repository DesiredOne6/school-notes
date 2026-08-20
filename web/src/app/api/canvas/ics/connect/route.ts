import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchFeed } from '@/lib/canvas/ics-sync';
import { normalizeFeedUrl } from '@/lib/canvas/ics';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser, errorResponse } from '@/lib/api/guards';

const schema = z.object({ feedUrl: z.string().min(10) });

/**
 * Connects a Canvas calendar feed. Used when a Canvas administrator has
 * disabled personal access tokens, which blocks the REST API path.
 */
export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  try {
    const { feedUrl } = schema.parse(await request.json());
    const normalized = normalizeFeedUrl(feedUrl);

    // Verify the feed parses before saving, so a bad paste fails loudly here
    // rather than silently importing nothing later.
    const items = await fetchFeed(normalized);

    const db = createAdminClient();
    const host = new URL(normalized).host;

    const { data: integration, error } = await db
      .from('integrations')
      .upsert(
        {
          user_id: user.id,
          provider: 'ics',
          external_account_id: host,
          status: 'connected',
          account_label: host,
          config: { host },
          last_error: null,
        },
        { onConflict: 'user_id,provider,external_account_id' },
      )
      .select('id')
      .single();

    if (error || !integration) throw new Error(error?.message ?? 'could not save integration');

    // The feed URL is itself the credential - anyone holding it can read the
    // calendar - so it lives in integration_secrets, not in config.
    const { error: secretError } = await db
      .from('integration_secrets')
      .upsert(
        { integration_id: integration.id, access_token: normalized },
        { onConflict: 'integration_id' },
      );

    if (secretError) throw new Error(secretError.message);

    return NextResponse.json({ connected: true, host, assignmentsFound: items.length });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    return errorResponse(err, 400);
  }
}
