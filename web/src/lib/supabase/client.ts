'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/types/db';

/** Browser-side Supabase client. Subject to RLS as the signed-in user. */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
