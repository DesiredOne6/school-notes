-- Reminder generation, row-level security, and private storage buckets.

-- Rebuilds the auto-generated reminders for one assignment from the user's
-- preferred offsets. Manual reminders are never touched.
create or replace function public.sync_assignment_reminders(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.assignments;
  offsets int[];
  o int;
  target timestamptz;
begin
  select * into a from public.assignments where id = p_assignment_id;
  if not found then
    return;
  end if;

  delete from public.reminders
   where assignment_id = a.id
     and is_manual = false
     and status = 'pending';

  -- Nothing to remind about: no deadline, archived, or already handed in.
  if a.due_at is null
     or a.archived_at is not null
     or a.status in ('submitted', 'graded', 'dropped') then
    return;
  end if;

  select default_reminder_offsets into offsets from public.profiles where id = a.user_id;
  if offsets is null then
    offsets := '{1440, 120}';
  end if;

  foreach o in array offsets loop
    target := a.due_at - make_interval(mins => o);
    -- Skip offsets already in the past; a reminder for a deadline 20 minutes
    -- out shouldn't also fire the "one week before" notification.
    if target > now() then
      insert into public.reminders (user_id, assignment_id, offset_minutes, remind_at, channel)
      values (a.user_id, a.id, o, target, 'push')
      on conflict (assignment_id, offset_minutes, channel) do update
        set remind_at = excluded.remind_at,
            status    = 'pending',
            error     = null;
    end if;
  end loop;
end;
$$;

create or replace function public.assignments_reminder_trigger()
returns trigger
language plpgsql
as $$
begin
  perform public.sync_assignment_reminders(new.id);
  return new;
end;
$$;

create trigger assignments_sync_reminders
  after insert or update of due_at, status, archived_at on public.assignments
  for each row execute function public.assignments_reminder_trigger();

-- ---------------------------------------------------------------------------
-- Row-level security. Every table is owner-scoped; nothing is world-readable.
-- ---------------------------------------------------------------------------

alter table public.profiles              enable row level security;
alter table public.terms                 enable row level security;
alter table public.courses               enable row level security;
alter table public.instructors           enable row level security;
alter table public.office_hours          enable row level security;
alter table public.course_meetings       enable row level security;
alter table public.course_links          enable row level security;
alter table public.assignments           enable row level security;
alter table public.notes                 enable row level security;
alter table public.note_links            enable row level security;
alter table public.attachments           enable row level security;
alter table public.documents             enable row level security;
alter table public.integrations          enable row level security;
alter table public.integration_secrets   enable row level security;
alter table public.calendar_event_links  enable row level security;
alter table public.reminders             enable row level security;
alter table public.push_subscriptions    enable row level security;
alter table public.sync_runs             enable row level security;

create policy profiles_owner on public.profiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy terms_owner on public.terms
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy courses_owner on public.courses
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy instructors_owner on public.instructors
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy office_hours_owner on public.office_hours
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy course_meetings_owner on public.course_meetings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy course_links_owner on public.course_links
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy assignments_owner on public.assignments
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notes_owner on public.notes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy attachments_owner on public.attachments
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy documents_owner on public.documents
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy integrations_owner on public.integrations
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy calendar_links_owner on public.calendar_event_links
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy reminders_owner on public.reminders
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subs_owner on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sync_runs_owner on public.sync_runs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- note_links has no user_id; ownership is inherited from the source note.
create policy note_links_owner on public.note_links
  for all to authenticated
  using (exists (
    select 1 from public.notes n
     where n.id = note_links.source_note_id and n.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.notes n
     where n.id = note_links.source_note_id and n.user_id = auth.uid()
  ));

-- integration_secrets deliberately has NO policy. RLS is on, so anon and
-- authenticated are denied outright; only the service role can read tokens.

-- ---------------------------------------------------------------------------
-- Storage: private buckets, each user confined to a folder named by their uid.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('notes', 'notes', false), ('documents', 'documents', false)
on conflict (id) do nothing;

create policy notes_bucket_owner on storage.objects
  for all to authenticated
  using (bucket_id = 'notes' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'notes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy documents_bucket_owner on storage.objects
  for all to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
