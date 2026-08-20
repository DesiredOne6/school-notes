-- Assignments/tests, notes (typed + handwritten), and file attachments.

create type public.work_kind as enum (
  'assignment', 'quiz', 'exam', 'project', 'reading', 'lab', 'discussion', 'other'
);

create type public.work_status as enum (
  'todo', 'in_progress', 'submitted', 'graded', 'dropped'
);

create type public.work_source as enum ('manual', 'canvas', 'gradescope', 'ics');

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  title text not null,
  description text,
  kind public.work_kind not null default 'assignment',
  status public.work_status not null default 'todo',
  due_at timestamptz,
  -- Canvas exposes "all day"/date-only deadlines; the UI must not imply a
  -- precise time when there isn't one.
  due_is_all_day boolean not null default false,
  available_at timestamptz,
  lock_at timestamptz,
  points numeric(8,2),
  score numeric(8,2),
  priority int not null default 2 check (priority between 1 and 4),  -- 1 = highest
  estimated_minutes int,
  url text,
  source public.work_source not null default 'manual',
  canvas_assignment_id bigint,
  -- Snapshot of the last synced upstream payload, used to detect real changes
  -- and to avoid clobbering fields the user edited locally.
  source_hash text,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assignments_user_due_idx on public.assignments(user_id, due_at);
create index assignments_course_idx on public.assignments(course_id);
create index assignments_status_idx on public.assignments(user_id, status) where archived_at is null;
create unique index assignments_canvas_unique on public.assignments(user_id, canvas_assignment_id)
  where canvas_assignment_id is not null;

create type public.note_kind as enum ('page', 'handwritten', 'mixed');

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  -- Self-reference gives Obsidian-style nesting (unit -> lecture -> subtopic).
  parent_id uuid references public.notes(id) on delete cascade,
  title text not null default 'Untitled',
  kind public.note_kind not null default 'page',
  -- Markdown source of truth for typed content. Handwritten pages keep this
  -- for OCR/transcribed text so search covers ink too.
  body text not null default '',
  -- Free-form tags; indexed with gin for cheap tag filters.
  tags text[] not null default '{}',
  -- Set when this note is the notes-for-a-specific-class-session.
  session_date date,
  is_pinned boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_user_idx on public.notes(user_id);
create index notes_course_idx on public.notes(course_id);
create index notes_parent_idx on public.notes(parent_id);
create index notes_tags_idx on public.notes using gin(tags);
-- Full-text search across title and body (including ink transcriptions).
create index notes_search_idx on public.notes
  using gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,'')));

-- Wiki-style [[links]] between notes, resolved on save. Enables backlinks and
-- a graph view without parsing every note body at read time.
create table public.note_links (
  source_note_id uuid not null references public.notes(id) on delete cascade,
  target_note_id uuid not null references public.notes(id) on delete cascade,
  primary key (source_note_id, target_note_id)
);
create index note_links_target_idx on public.note_links(target_note_id);

create type public.attachment_kind as enum ('image', 'pdf', 'ink', 'audio', 'file');

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid references public.notes(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  kind public.attachment_kind not null,
  -- Path within the private 'notes' storage bucket.
  storage_path text not null,
  filename text,
  mime_type text,
  byte_size bigint,
  width int,
  height int,
  -- PencilKit PKDrawing data lives in storage; this holds the stroke count and
  -- canvas size so the web app can render a placeholder without downloading it.
  ink_metadata jsonb,
  page_index int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index attachments_note_idx on public.attachments(note_id);
create index attachments_course_idx on public.attachments(course_id);

-- Syllabi, slide decks, readings: course-level documents that aren't notes.
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  kind text not null default 'other',  -- syllabus | slides | reading | rubric | other
  -- Either an uploaded file or an external link.
  storage_path text,
  url text,
  mime_type text,
  byte_size bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_needs_target check (storage_path is not null or url is not null)
);
create index documents_course_idx on public.documents(course_id);

create trigger touch_assignments before update on public.assignments
  for each row execute function public.touch_updated_at();
create trigger touch_notes before update on public.notes
  for each row execute function public.touch_updated_at();
create trigger touch_attachments before update on public.attachments
  for each row execute function public.touch_updated_at();
create trigger touch_documents before update on public.documents
  for each row execute function public.touch_updated_at();
