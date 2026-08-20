import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CanvasClient } from '@/lib/canvas/client';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser, errorResponse } from '@/lib/api/guards';

const schema = z.object({
  baseUrl: z.string().min(4),
  token: z.string().min(10),
});

/** Validates a Canvas token, then stores it for background syncing. */
export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  try {
    const body = schema.parse(await request.json());

    // Fail before persisting anything if the token is wrong - otherwise the
    // user sees "connected" and silent sync failures later.
    const canvas = new CanvasClient(body.baseUrl, body.token);
    const profile = await canvas.whoami();

    const db = createAdminClient();
    const normalizedUrl = body.baseUrl.trim().replace(/\/+$/, '');

    const { data: integration, error } = await db
      .from('integrations')
      .upsert(
        {
          user_id: user.id,
          provider: 'canvas',
          external_account_id: normalizedUrl,
          status: 'connected',
          account_label: profile.name,
          config: { base_url: normalizedUrl },
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
        { integration_id: integration.id, access_token: body.token },
        { onConflict: 'integration_id' },
      );

    if (secretError) throw new Error(secretError.message);

    return NextResponse.json({ connected: true, account: profile.name });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', issues: err.issues }, { status: 400 });
    }
    return errorResponse(err, 400);
  }
}
