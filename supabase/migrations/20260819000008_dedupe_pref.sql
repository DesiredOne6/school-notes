-- Whether to hide external calendar events that duplicate a class already on
-- the timetable.
--
-- On by default: a university publishing class times to Google is common, and
-- seeing every lecture twice makes the calendar useless. Off is available for
-- anyone whose events don't actually duplicate.

alter table public.profiles
  add column if not exists hide_duplicate_class_events boolean not null default true;
