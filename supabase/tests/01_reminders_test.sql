-- Behavioural tests for automatic reminder generation.
-- Run via: npm run db:check

begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'student@example.edu');

do $$
declare
  n int;
begin
  -- The auth trigger should have created a profile automatically.
  select count(*) into n from public.profiles
   where id = '11111111-1111-1111-1111-111111111111';
  assert n = 1, format('expected auto-created profile, got %s rows', n);
end $$;

insert into public.courses (id, user_id, code, title) values
  ('22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111', 'CS 3410', 'Computer System Organization');

-- Case 1: a deadline far in the future gets both default reminders.
insert into public.assignments (id, user_id, course_id, title, due_at) values
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   'Problem Set 4', now() + interval '10 days');

do $$
declare
  n int;
  offs int[];
begin
  select count(*), array_agg(offset_minutes order by offset_minutes)
    into n, offs
    from public.reminders
   where assignment_id = '33333333-3333-3333-3333-333333333333';
  assert n = 2, format('expected 2 reminders, got %s', n);
  assert offs = '{120,1440}', format('expected offsets {120,1440}, got %s', offs);
end $$;

-- Case 2: moving the due date moves the reminders with it.
update public.assignments
   set due_at = now() + interval '20 days'
 where id = '33333333-3333-3333-3333-333333333333';

do $$
declare
  gap interval;
begin
  select (a.due_at - r.remind_at) into gap
    from public.reminders r
    join public.assignments a on a.id = r.assignment_id
   where r.assignment_id = '33333333-3333-3333-3333-333333333333'
     and r.offset_minutes = 1440;
  assert gap = interval '1440 minutes',
    format('reminder did not follow the due date; gap = %s', gap);
end $$;

-- Case 3: submitting the work clears its pending reminders.
update public.assignments
   set status = 'submitted'
 where id = '33333333-3333-3333-3333-333333333333';

do $$
declare
  n int;
begin
  select count(*) into n from public.reminders
   where assignment_id = '33333333-3333-3333-3333-333333333333';
  assert n = 0, format('expected reminders cleared after submit, got %s', n);
end $$;

-- Case 4: a deadline sooner than the shortest offset produces no reminder in
-- the past. Due in 30 minutes, offsets are 1440 and 120, so both are skipped.
insert into public.assignments (id, user_id, course_id, title, due_at) values
  ('44444444-4444-4444-4444-444444444444',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   'Late-added quiz', now() + interval '30 minutes');

do $$
declare
  n int;
begin
  select count(*) into n from public.reminders
   where assignment_id = '44444444-4444-4444-4444-444444444444'
     and remind_at < now();
  assert n = 0, format('created %s reminders in the past', n);
end $$;

-- Case 5: manual reminders survive regeneration.
insert into public.assignments (id, user_id, course_id, title, due_at) values
  ('55555555-5555-5555-5555-555555555555',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   'Final project', now() + interval '30 days');

insert into public.reminders (user_id, assignment_id, offset_minutes, remind_at, is_manual)
values ('11111111-1111-1111-1111-111111111111',
        '55555555-5555-5555-5555-555555555555',
        20160, now() + interval '16 days', true);

update public.assignments
   set due_at = now() + interval '31 days'
 where id = '55555555-5555-5555-5555-555555555555';

do $$
declare
  n int;
begin
  select count(*) into n from public.reminders
   where assignment_id = '55555555-5555-5555-5555-555555555555'
     and is_manual = true;
  assert n = 1, format('manual reminder was destroyed by regeneration (%s left)', n);
end $$;

-- Case 6: the Canvas dedupe index rejects a second row for the same upstream id.
insert into public.assignments (user_id, title, canvas_assignment_id, source)
values ('11111111-1111-1111-1111-111111111111', 'From Canvas', 98765, 'canvas');

do $$
declare
  failed boolean := false;
begin
  begin
    insert into public.assignments (user_id, title, canvas_assignment_id, source)
    values ('11111111-1111-1111-1111-111111111111', 'Duplicate', 98765, 'canvas');
  exception when unique_violation then
    failed := true;
  end;
  assert failed, 'duplicate canvas_assignment_id was allowed';
end $$;

select 'all reminder tests passed' as result;

rollback;
