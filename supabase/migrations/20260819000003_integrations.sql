-- External integrations (Canvas, Google Calendar, Notion), the calendar-sync
-- ledger, and the reminder queue.

create type public.integration_provider as enum ('canvas', 'google', 'notion', 'gradescope', 'ics');
create type public.integration_status as enum ('connected', 'expired', 'error', 'disconnected');

-- Non-secret connection metadata. Safe for the client to read so the UI can
-- show "Canvas: connected, last synced 4 minutes ago".
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider public.integration_provider not null,
  status public.integration_status not null default 'connected',
  -- Which account this is, for display: "canvas.instructure.com" / an email.
  account_label text,
  -- Provider-specific non-secret config, e.g. {"base_url": "...", "calendar_id": "..."}.
  config jsonb not null default '{}',
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
create index integrations_user_idx on public.integrations(user_id);

-- Tokens live in a separate table with NO row-level policies, so the anon and
-- authenticated roles can never read them even with a valid JWT. Only the
-- service role (server-side code and Edge Functions) bypasses RLS to reach it.
create table public.integration_secrets (
  integration_id uuid primary key references public.integrations(id) on delete cascade,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scopes text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Maps a local assignment to the event it created in an external calendar, so
-- repeated syncs update one event instead of creating duplicates.
create table public.calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  provider public.integration_provider not null,
  external_calendar_id text,
  external_event_id text not null,
  -- Hash of the pushed payload; lets sync skip unchanged events cheaply.
  content_hash text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, provider)
);
create index calendar_links_user_idx on public.calendar_event_links(user_id);

create type public.reminder_channel as enum ('push', 'email');
create type public.reminder_status as enum ('pending', 'sent', 'failed', 'skipped', 'cancelled');

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  -- Minutes before due_at this reminder represents; kept so regeneration can
  -- tell an auto-generated reminder from one the user added by hand.
  offset_minutes int,
  remind_at timestamptz not null,
  channel public.reminder_channel not null default 'push',
  status public.reminder_status not null default 'pending',
  sent_at timestamptz,
  error text,
  is_manual boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Prevents duplicate reminders for the same assignment/offset/channel.
  unique (assignment_id, offset_minutes, channel)
);
-- The dispatcher's hot path: find everything due to fire.
create index reminders_due_idx on public.reminders(remind_at) where status = 'pending';
create index reminders_user_idx on public.reminders(user_id);

-- Web Push endpoints, one per browser/device.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device_label text,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index push_subs_user_idx on public.push_subscriptions(user_id);

-- Observability for every background sync, so a silent Canvas failure is
-- visible in the UI rather than just missing assignments.
create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider public.integration_provider not null,
  direction text not null default 'pull',  -- pull | push
  status text not null default 'running',  -- running | success | error
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items_created int not null default 0,
  items_updated int not null default 0,
  items_skipped int not null default 0,
  error text
);
create index sync_runs_user_idx on public.sync_runs(user_id, started_at desc);

create trigger touch_integrations before update on public.integrations
  for each row execute function public.touch_updated_at();
create trigger touch_integration_secrets before update on public.integration_secrets
  for each row execute function public.touch_updated_at();
create trigger touch_calendar_links before update on public.calendar_event_links
  for each row execute function public.touch_updated_at();
create trigger touch_reminders before update on public.reminders
  for each row execute function public.touch_updated_at();
