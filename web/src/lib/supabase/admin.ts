import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/db';

/**
 * Service-role client. Bypasses RLS entirely, so it must never be imported
 * into client components. Used by sync jobs and the reminder dispatcher, which
 * need to read integration_secrets and act on behalf of a user.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
