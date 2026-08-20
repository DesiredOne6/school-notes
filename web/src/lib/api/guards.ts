import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getCurrentUser } from '@/lib/supabase/server';

/** Rejects unauthenticated callers with 401. */
export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    return { user: null, response: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  }

  return { user, response: null };
}

/**
 * Guards the cron endpoints with a shared secret, compared in constant time so
 * the comparison itself can't be used to recover the secret.
 */
export function verifyCronSecret(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = request.headers.get('authorization') ?? '';
  const provided = header.replace(/^Bearer\s+/i, '');

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}

export function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : 'Unexpected error';
  return NextResponse.json({ error: message }, { status });
}
