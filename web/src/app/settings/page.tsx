import { createServerSupabase } from '@/lib/supabase/server';
import { CanvasConnectForm } from '@/components/CanvasConnectForm';
import { CanvasFeedForm } from '@/components/CanvasFeedForm';
import { NotificationToggle } from '@/components/NotificationToggle';
import { GoogleAccounts, type AccountRow } from '@/components/GoogleAccounts';

const GOOGLE_MESSAGES: Record<string, string> = {
  connected: 'Google Calendar connected.',
  denied: 'You declined the Google permission request.',
  invalid_state: 'That sign-in attempt expired. Please try again.',
  no_refresh_token: 'Google did not return a refresh token. Try again and accept all prompts.',
  error: 'Something went wrong talking to Google.',
};

function Panel({ title, description, children }: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 mb-4 text-xs text-[var(--color-muted)]">{description}</p>
      {children}
    </section>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabase();

  const [{ data: integrations }, { data: calendars }] = await Promise.all([
    supabase
      .from('integrations')
      .select('id, provider, status, account_label, last_synced_at, last_error, config'),
    supabase
      .from('external_calendars')
      .select('id, integration_id, name, color, is_visible, is_app_managed')
      .order('name'),
  ]);

  const all = integrations ?? [];
  const byProvider = new Map(all.map((i) => [i.provider, i]));
  const canvas = byProvider.get('canvas');
  const ics = byProvider.get('ics');

  const googleAccounts: AccountRow[] = all
    .filter((i) => i.provider === 'google')
    .map((i) => ({
      id: i.id,
      account_label: i.account_label,
      status: i.status,
      last_synced_at: i.last_synced_at,
      last_error: i.last_error,
      isPrimary: Boolean((i.config as { is_primary_calendar?: boolean })?.is_primary_calendar),
      calendars: (calendars ?? [])
        .filter((c) => c.integration_id === i.id)
        .map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          is_visible: c.is_visible,
          is_app_managed: c.is_app_managed,
        })),
    }));

  // With a single account and no explicit choice, it is the write target.
  if (googleAccounts.length === 1) googleAccounts[0].isPrimary = true;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      {params.google && GOOGLE_MESSAGES[params.google] && (
        <p
          className={`rounded-lg border p-3 text-sm ${
            params.google === 'connected'
              ? 'border-green-500/30 bg-green-500/10 text-green-300'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          }`}
        >
          {GOOGLE_MESSAGES[params.google]}
        </p>
      )}

      <Panel
        title="Canvas"
        description="Full import including points and submission status. Needs an access token, which some schools disable — if yours does, use the calendar feed below instead."
      >
        <CanvasConnectForm connected={canvas?.account_label ?? null} />
        {canvas?.last_error && (
          <p className="mt-3 text-xs text-red-400">Last sync error: {canvas.last_error}</p>
        )}
        {canvas?.last_synced_at && (
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Last synced {new Date(canvas.last_synced_at).toLocaleString()}
          </p>
        )}
      </Panel>

      <Panel
        title="Canvas calendar feed"
        description="Use this if your school disables Canvas API tokens. Imports due dates for every course — no administrator permission needed."
      >
        <CanvasFeedForm connected={ics?.account_label ?? null} />
        {ics?.last_error && (
          <p className="mt-3 text-xs text-red-400">Last sync error: {ics.last_error}</p>
        )}
        {ics?.last_synced_at && (
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Last synced {new Date(ics.last_synced_at).toLocaleString()}
          </p>
        )}
      </Panel>

      <Panel
        title="Google Calendar"
        description="Due dates are written to a dedicated 'School' calendar, so your own calendars are never edited. Your other calendars are read so class, club, and personal events appear in the calendar view."
      >
        <GoogleAccounts accounts={googleAccounts} />
      </Panel>

      <Panel
        title="Reminders"
        description="Browser notifications before each deadline. Enable this on every device you want to be reminded on."
      >
        <NotificationToggle />
      </Panel>
    </div>
  );
}
