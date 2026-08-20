import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { google } from 'googleapis';
import { createOAuthClient } from '@/lib/google/calendar';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/api/guards';

export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response;

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;

  const jar = await cookies();
  const expectedState = jar.get('google_oauth_state')?.value;
  jar.delete('google_oauth_state');

  if (url.searchParams.get('error')) {
    return NextResponse.redirect(`${appUrl}/settings?google=denied`);
  }

  if (!code || !state || state !== expectedState) {
    return NextResponse.redirect(`${appUrl}/settings?google=invalid_state`);
  }

  try {
    const client = createOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    if (!tokens.refresh_token) {
      // Nothing usable for background sync; make the user redo consent.
      return NextResponse.redirect(`${appUrl}/settings?google=no_refresh_token`);
    }

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const me = await oauth2.userinfo.get();

    const db = createAdminClient();

    const accountId = me.data.id ?? me.data.email;
    if (!accountId) throw new Error('Google did not identify the account');

    // Reconnecting must preserve existing config - it holds calendar_id, and
    // losing that orphans the app's calendar and creates a duplicate.
    const { data: priorAccounts } = await db
      .from('integrations')
      .select('id, external_account_id, config')
      .eq('user_id', user.id)
      .eq('provider', 'google');

    const existing = (priorAccounts ?? []).find((a) => a.external_account_id === accountId);
    const priorConfig = (existing?.config ?? {}) as Record<string, unknown>;

    // The first account connected becomes the one assignment events write to.
    const isFirstAccount = (priorAccounts ?? []).length === 0;

    const { data: integration, error } = await db
      .from('integrations')
      .upsert(
        {
          user_id: user.id,
          provider: 'google',
          external_account_id: accountId,
          status: 'connected',
          account_label: me.data.email ?? null,
          last_error: null,
          config: {
            ...priorConfig,
            is_primary_calendar: isFirstAccount || priorConfig.is_primary_calendar === true,
          },
        },
        { onConflict: 'user_id,provider,external_account_id' },
      )
      .select('id')
      .single();

    if (error || !integration) throw new Error(error?.message ?? 'could not save integration');

    await db.from('integration_secrets').upsert(
      {
        integration_id: integration.id,
        access_token: tokens.access_token ?? null,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        scopes: tokens.scope?.split(' ') ?? null,
      },
      { onConflict: 'integration_id' },
    );

    return NextResponse.redirect(`${appUrl}/settings?google=connected`);
  } catch {
    return NextResponse.redirect(`${appUrl}/settings?google=error`);
  }
}
