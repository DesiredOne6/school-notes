import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser, errorResponse } from '@/lib/api/guards';

const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
  deviceLabel: z.string().optional(),
});

/** Registers this browser to receive reminder notifications. */
export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  try {
    const body = schema.parse(await request.json());
    const db = createAdminClient();

    const { error } = await db.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        device_label: body.deviceLabel ?? null,
      },
      { onConflict: 'endpoint' },
    );

    if (error) throw new Error(error.message);

    return NextResponse.json({ subscribed: true });
  } catch (err) {
    return errorResponse(err, 400);
  }
}

/** Unsubscribes a browser (used when the user turns notifications off). */
export async function DELETE(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  try {
    const { endpoint } = z.object({ endpoint: z.string().url() }).parse(await request.json());
    const db = createAdminClient();

    await db
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', endpoint);

    return NextResponse.json({ subscribed: false });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
