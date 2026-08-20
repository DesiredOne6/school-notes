import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { createOAuthClient, GOOGLE_SCOPES } from '@/lib/google/calendar';
import { requireUser, errorResponse } from '@/lib/api/guards';

/** Kicks off the Google consent flow. */
export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response;

  try {
    const client = createOAuthClient();

    // CSRF guard: the callback must present this same value back to us.
    const state = randomBytes(24).toString('hex');
    const jar = await cookies();
    jar.set('google_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });

    const url = client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_SCOPES,
      // 'consent' because Google otherwise withholds the refresh token on
      // repeat consents, which silently breaks background sync.
      // 'select_account' so a second account can be added instead of silently
      // re-authorising the one already signed in.
      prompt: 'consent select_account',
      include_granted_scopes: true,
      state,
    });

    return NextResponse.redirect(url);
  } catch (err) {
    return errorResponse(err);
  }
}
