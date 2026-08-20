-- Full-text search for notes.
--
-- The original index was on an expression, to_tsvector(title || body). That
-- works for raw SQL but PostgREST can only run textSearch against a real
-- column, so searching from the app was impossible. A generated column fixes
-- that and keeps the vector in sync automatically.

alter table public.notes
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) stored;

-- Title matches should outrank body matches, hence the setweight above.
drop index if exists public.notes_search_idx;
create index if not exists notes_search_vector_idx
  on public.notes using gin(search_vector);

-- Ordering the notes list by recency is the common read.
create index if not exists notes_updated_idx
  on public.notes(user_id, updated_at desc)
  where archived_at is null;
