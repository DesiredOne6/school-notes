import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/lib/types/db';

/**
 * Server-side client that reads the user's session from cookies. Still subject
 * to RLS, so a bug here can't leak another user's data.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Session refresh is handled by middleware instead.
          }
        },
      },
    },
  );
}

/** Returns the signed-in user, or null. */
export async function getCurrentUser() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
