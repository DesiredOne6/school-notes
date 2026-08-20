-- Multiple accounts per provider, external calendar subscriptions, and the
-- cached events that back the in-app calendar view.

-- ---------------------------------------------------------------------------
-- 1. Allow more than one account per provider (e.g. a personal Google account
--    alongside a university one).
-- ---------------------------------------------------------------------------

alter table public.integrations
  add column if not exists external_account_id text not null default '';

-- Existing rows predate the column; the account label is the best identifier
-- we already have for them.
update public.integrations
   set external_account_id = coalesce(account_label, '')
 where external_account_id = '';

alter table public.integrations drop constraint if exists integrations_user_id_provider_key;

-- One row per (user, provider, account). Two Google accounts now coexist.
create unique index if not exists integrations_account_unique
  on public.integrations(user_id, provider, external_account_id);

-- ---------------------------------------------------------------------------
-- 2. Calendar links must be per-integration, not per-provider, now that a user
--    can have two Google accounts.
-- ---------------------------------------------------------------------------

alter table public.calendar_event_links
  add column if not exists integration_id uuid references public.integrations(id) on delete cascade;

update public.calendar_event_links l
   set integration_id = i.id
  from public.integrations i
 where l.integration_id is null
   and i.user_id = l.user_id
   and i.provider = l.provider;

alter table public.calendar_event_links
  drop constraint if exists calendar_event_links_assignment_id_provider_key;

create unique index if not exists calendar_links_assignment_integration_unique
  on public.calendar_event_links(assignment_id, integration_id);

-- ---------------------------------------------------------------------------
-- 3. External calendars the user subscribes to (class schedule, clubs, etc.).
-- ---------------------------------------------------------------------------

create table if not exists public.external_calendars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  -- Google's calendar id, e.g. an email address or "...@group.calendar.google.com".
  external_id text not null,
  name text not null,
  description text,
  -- Colour Google reports; the user can override it locally.
  color text,
  color_override text,
  timezone text,
  is_primary boolean not null default false,
  -- Whether this calendar is drawn in the app's calendar view.
  is_visible boolean not null default true,
  -- Whether we pull its events at all. Off by default for noisy calendars.
  sync_enabled boolean not null default true,
  -- True for the "School — Assignments & Tests" calendar this app itself
  -- writes to; it must never be re-imported as external events or every
  -- assignment would appear twice in the calendar view.
  is_app_managed boolean not null default false,
  access_role text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, external_id)
);
create index if not exists external_calendars_user_idx on public.external_calendars(user_id);

-- ---------------------------------------------------------------------------
-- 4. Cached events from those calendars.
--
--    Google recurrence rules are expanded server-side (singleEvents=true), so
--    each row here is one concrete occurrence. That keeps the calendar view a
--    simple range query instead of an RRULE evaluator.
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_id uuid not null references public.external_calendars(id) on delete cascade,
  external_event_id text not null,
  title text not null default '(no title)',
  description text,
  location text,
  url text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_all_day boolean not null default false,
  status text,
  -- Present when this row is one instance of a recurring series.
  recurring_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (calendar_id, external_event_id)
);
create index if not exists calendar_events_user_range_idx
  on public.calendar_events(user_id, starts_at);
create index if not exists calendar_events_calendar_idx
  on public.calendar_events(calendar_id);

-- ---------------------------------------------------------------------------
-- 5. Class meetings need to be visible on the calendar too. course_meetings
--    already stores the weekly pattern; these columns bound it to the weeks the
--    class actually runs, so a Tuesday lecture doesn't render over the summer.
-- ---------------------------------------------------------------------------

alter table public.course_meetings
  add column if not exists starts_on date,
  add column if not exists ends_on date;

-- ---------------------------------------------------------------------------
-- 6. RLS for the new tables.
-- ---------------------------------------------------------------------------

alter table public.external_calendars enable row level security;
alter table public.calendar_events    enable row level security;

drop policy if exists external_calendars_owner on public.external_calendars;
create policy external_calendars_owner on public.external_calendars
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists calendar_events_owner on public.calendar_events;
create policy calendar_events_owner on public.calendar_events
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists touch_external_calendars on public.external_calendars;
create trigger touch_external_calendars before update on public.external_calendars
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_calendar_events on public.calendar_events;
create trigger touch_calendar_events before update on public.calendar_events
  for each row execute function public.touch_updated_at();
