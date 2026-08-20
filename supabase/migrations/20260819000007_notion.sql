-- Notion sync: maps assignments to the pages created for them.
--
-- Deliberately not reusing calendar_event_links: that table is keyed around
-- calendar semantics, and a table named for calendars holding Notion pages is
-- the kind of thing that misleads later.

create table if not exists public.notion_page_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  -- The Notion database the page lives in, and the page itself.
  database_id text not null,
  page_id text not null,
  -- Hash of the pushed properties; unchanged pages are skipped.
  content_hash text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, integration_id)
);
create index if not exists notion_links_user_idx on public.notion_page_links(user_id);

alter table public.notion_page_links enable row level security;

drop policy if exists notion_links_owner on public.notion_page_links;
create policy notion_links_owner on public.notion_page_links
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists touch_notion_links on public.notion_page_links;
create trigger touch_notion_links before update on public.notion_page_links
  for each row execute function public.touch_updated_at();
