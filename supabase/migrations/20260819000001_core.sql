-- Core academic structures: terms, courses, and the reference info that
-- makes a course page useful (instructors, office hours, meetings, links).

create extension if not exists "pgcrypto";

-- Keeps updated_at honest without app-layer discipline.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  -- All reminder/calendar math is done in this zone, not UTC, so "due at
  -- midnight" means midnight where the user actually is.
  timezone text not null default 'America/New_York',
  -- Minutes before due_at to fire reminders, e.g. {10080, 1440, 120}.
  default_reminder_offsets int[] not null default '{1440, 120}',
  quiet_hours_start time,
  quiet_hours_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.terms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  starts_on date,
  ends_on date,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index terms_user_idx on public.terms(user_id);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  term_id uuid references public.terms(id) on delete set null,
  code text,                      -- "CS 3410"
  title text not null,            -- "Computer System Organization"
  section text,
  color text not null default '#6366f1',
  credits numeric(3,1),
  location text,
  notes text,
  canvas_course_id bigint,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index courses_user_idx on public.courses(user_id);
-- One local course per Canvas course, so re-syncing updates instead of duplicating.
create unique index courses_canvas_unique on public.courses(user_id, canvas_course_id)
  where canvas_course_id is not null;

create table public.instructors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null,
  role text not null default 'professor',  -- professor | ta | grader | advisor
  email text,
  phone text,
  office text,
  pronouns text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index instructors_course_idx on public.instructors(course_id);

create table public.office_hours (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),  -- 0 = Sunday
  starts_at time not null,
  ends_at time not null,
  location text,
  url text,
  by_appointment boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index office_hours_instructor_idx on public.office_hours(instructor_id);

-- Recurring class meetings, used to render a weekly timetable.
create table public.course_meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  kind text not null default 'lecture',   -- lecture | lab | discussion | review
  weekday int not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  location text,
  url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index course_meetings_course_idx on public.course_meetings(course_id);

-- Zoom/Meet/LMS/textbook links. Kept as rows rather than columns so a course
-- can have any number of them without schema churn.
create table public.course_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  kind text not null default 'other',  -- zoom | meet | lms | syllabus | textbook | drive | other
  label text not null,
  url text not null,
  passcode text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index course_links_course_idx on public.course_links(course_id);

create trigger touch_profiles before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger touch_terms before update on public.terms
  for each row execute function public.touch_updated_at();
create trigger touch_courses before update on public.courses
  for each row execute function public.touch_updated_at();
create trigger touch_instructors before update on public.instructors
  for each row execute function public.touch_updated_at();
create trigger touch_office_hours before update on public.office_hours
  for each row execute function public.touch_updated_at();
create trigger touch_course_meetings before update on public.course_meetings
  for each row execute function public.touch_updated_at();
create trigger touch_course_links before update on public.course_links
  for each row execute function public.touch_updated_at();

-- Give every new auth user a profile row so the app never has to handle a
-- missing-profile case.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
