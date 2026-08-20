'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { removeAssignmentEventsFor } from '@/lib/google/calendar';
import type { ActionResult } from './assignments';

/** Shows or hides one external calendar in the in-app calendar view. */
export async function setCalendarVisibility(
  calendarId: string,
  isVisible: boolean,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('external_calendars')
    .update({ is_visible: isVisible })
    .eq('id', calendarId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/calendar');
  revalidatePath('/settings');
  return { ok: true };
}

/**
 * Chooses which Google account receives assignment events.
 *
 * Exactly one account may hold this flag; writing to several would duplicate
 * every deadline across calendars.
 */
export async function setPrimaryCalendarAccount(integrationId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const supabase = await createServerSupabase();

  const { data: accounts, error: readError } = await supabase
    .from('integrations')
    .select('id, config')
    .eq('user_id', user.id)
    .eq('provider', 'google');

  if (readError) return { ok: false, error: readError.message };

  for (const account of accounts ?? []) {
    const config = (account.config ?? {}) as Record<string, unknown>;
    const { error } = await supabase
      .from('integrations')
      .update({ config: { ...config, is_primary_calendar: account.id === integrationId } })
      .eq('id', account.id);

    if (error) return { ok: false, error: error.message };
  }

  // Pull the app's events off every account that is no longer the target, so
  // the same deadline never sits on two calendars.
  for (const account of accounts ?? []) {
    if (account.id !== integrationId) {
      await removeAssignmentEventsFor(user.id, account.id);
    }
  }

  revalidatePath('/settings');
  return { ok: true };
}

/** Disconnects one account and removes its cached calendars and events. */
export async function disconnectIntegration(integrationId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const supabase = await createServerSupabase();

  // external_calendars and calendar_events cascade from the integration row.
  const { error } = await supabase.from('integrations').delete().eq('id', integrationId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/settings');
  revalidatePath('/calendar');
  return { ok: true };
}
