# School Notes

A Notion/Obsidian-style app for school: notes, assignments, tests, course info,
Canvas import, calendar sync, and deadline reminders.

**Stack:** Next.js 16 (App Router) · Supabase (Postgres + Auth + Storage) ·
Google Calendar API · Notion API · Web Push.

Handwriting is built into the web app rather than a native tablet app. Stylus
input comes from the Pointer Events API, which exposes pressure and tilt for the
S Pen on Windows Ink and Apple Pencil in Safari alike — so one implementation
covers every device instead of an Apple-only one.

---

## What works today

| Area | Status |
| --- | --- |
| Database schema (courses, assignments, notes, attachments, integrations) | Built & tested |
| Passwordless sign-in (magic link) | Built |
| Canvas import via access token — courses, assignments, quizzes, exams | Built |
| Canvas import via calendar feed — works without admin permission | Built |
| Google Calendar push — one dedicated "School" calendar | Built |
| Reminders — auto-generated, quiet-hours aware, Web Push delivery | Built |
| "What's due" dashboard | Built |
| Manual assignment entry | Built |
| Weekly calendar — classes, deadlines, and external calendars | Built |
| Course & class-schedule management | Built |
| Multiple Google accounts (personal + university) | Built |
| Settings — connect Canvas/Google, enable notifications | Built |
| Notes editor — markdown, images, wiki-links, search | Built |
| Handwriting (stylus, pressure-sensitive) | Built — works with the S Pen |
| Notion sync | Built |

---

> **Working on this yourself?** [ARCHITECTURE.md](ARCHITECTURE.md) maps the
> codebase, lists the skills in the order they pay off, and has graded exercises
> to start with.

## Setup

### 1. Create a Supabase project

At [supabase.com](https://supabase.com/dashboard). Then from **Project Settings → API**
copy the project URL, the `anon` key, and the `service_role` key.

### 2. Configure environment

```bash
cp .env.example web/.env.local
```

Fill in the Supabase values. Generate the push keys with:

```bash
npx web-push generate-vapid-keys
```

Set `CRON_SECRET` to any long random string:

```bash
openssl rand -hex 32
```

### 3. Apply the database schema

**Quickest — no CLI needed.** Open the SQL Editor for your project, paste the
whole of [`supabase/schema.sql`](supabase/schema.sql), and run it. That file is a
validated concatenation of every migration and creates all 18 tables, the RLS
policies, the storage buckets, and the reminder triggers in one pass.

**Or via the CLI**, which is what you'll want for future migrations:

```bash
cd web
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npm run db:push
```

After adding a migration, regenerate the paste-ready file with:

```bash
SUPABASE_PROJECT_REF=your-ref ./scripts/build-schema.sh
```

### 4. Google Calendar (optional but recommended)

In the [Google Cloud Console](https://console.cloud.google.com): create a project,
enable the **Google Calendar API**, and create an **OAuth 2.0 Client ID** of type
*Web application* with the authorized redirect URI:

```
http://localhost:3000/api/google/callback
```

Add the client ID/secret to `.env.local`. While your OAuth consent screen is in
*Testing*, add your own email under **Test users**.

**Scopes requested — and what they can reach:**

| Scope | Grants |
| --- | --- |
| `calendar.app.created` | Create secondary calendars, and write events **only on calendars this app created**. Your own calendars can never be edited or deleted. |
| `calendar.readonly` | **Read** your other calendars, so class times, club meetings, and personal events appear in the in-app calendar view. Read-only. |
| `userinfo.email` | Your account email, shown in Settings so you know which account is connected. |

Writes are confined to one calendar the app creates, *School — Assignments &
Tests*. Everything else is read-only. Deliberately **not** requested is
`.../auth/calendar`, which would grant full read *and write* over every calendar
you can access.

You can connect **more than one Google account** (e.g. personal plus
university). All of their calendars can be displayed; exactly one account is
nominated in Settings to receive assignment events, so deadlines never appear
twice.

### 5. Canvas

There are two ways in. The app supports both, and they dedupe against each other
because they key on the same Canvas assignment ids.

**Option A — access token (fuller data).** In Canvas: **Account → Settings → New
Access Token**. Paste the token and your school's Canvas URL into Settings. This
imports points, submission status, and descriptions.

*Many schools disable this.* If there's no "New Access Token" button, your
administrator has turned it off — use Option B.

**Option B — calendar feed (no permission needed).** In Canvas: **Calendar** →
scroll the right sidebar to the bottom → **Calendar Feed** → copy the URL. Paste
it into Settings under *Canvas calendar feed*.

Every Canvas user can generate this feed; administrators don't gate it. What you
give up versus the token: no points, no submission status, and the feed is capped
at 1000 items. Due dates for every course — what reminders and calendar sync
actually run on — are all present.

> After enrolling in a new course, re-copy the feed URL. Canvas builds the feed
> from your enrollments at the time it's generated.

### 6. Run it

```bash
cd web
npm run dev
```

Open <http://localhost:3000>, sign in, then go to **Settings** to connect Canvas,
connect Google Calendar, and enable reminders.

> **iPhone/iPad notifications:** Safari only allows Web Push for apps added to the
> Home Screen. Open the site in Safari → Share → *Add to Home Screen*, then enable
> reminders from inside that installed app.

---

## Background jobs

Two endpoints do the recurring work. Both require the `CRON_SECRET` bearer token.

```bash
# Every 5 minutes — sends reminders that have come due
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app/api/cron/reminders

# Hourly — pulls from Canvas, then pushes due dates to Google Calendar
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app/api/cron/sync
```

### Scheduling them

**Do not use Vercel Cron on the free plan.** Hobby accounts are limited to cron
jobs that run *once per day*, and a more frequent expression **fails at deploy
time** with `Hobby accounts are limited to daily cron jobs`. Reminders need a
~5 minute cadence.

Instead, schedule from Postgres with `pg_cron`, which is always on, free, and
has no frequency limit:

```bash
PGPASSWORD='your-db-password' ./scripts/setup-scheduling.sh https://your-app.vercel.app
```

That enables `pg_cron` and `pg_net`, stores `CRON_SECRET` in Supabase Vault, and
registers two jobs: reminders every 5 minutes and integration sync hourly. It
also survives moving the app off Vercel — only the URL changes.

Inspect runs with:

```sql
select j.jobname, d.status, d.start_time
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
order by d.start_time desc limit 10;
```

> `cron.job_run_details` keys on `jobid`, not `jobname` — the name lives on
> `cron.job`.

---

## Commands

```bash
npm run dev         # dev server
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest
npm run db:check    # validate migrations + run SQL tests against a temp Postgres
npm run db:push     # apply migrations to the linked Supabase project
npm run db:types    # regenerate src/lib/types/db.generated.ts from the live schema
```

`db:check` needs Postgres locally (`brew install postgresql@17`). It spins up a
throwaway cluster, applies a shim for the Supabase-managed `auth`/`storage`
objects, runs every migration, then runs the SQL behaviour tests — no Docker and
no risk to your real project.

---

## How it fits together

```
Canvas REST  ──┐
               ├──pull──►  assignments ──trigger──► reminders ──cron──► Web Push
Canvas .ics  ──┘                │
                                └──push──► Google Calendar ("School" calendar)
```

Both Canvas paths write `canvas_assignment_id`, so an assignment seen by the
feed and later by the REST API resolves to one row, not two.

**Reminders are generated in the database, not the app.** A trigger on
`assignments` rebuilds them whenever a due date, status, or archive flag changes,
using each user's preferred offsets (`profiles.default_reminder_offsets`,
default: 1 day and 2 hours before). Offsets already in the past are skipped, and
manually-added reminders survive regeneration. See
`supabase/migrations/20260819000004_reminders_rls.sql`.

**Sync never clobbers your edits.** Canvas owns titles, due dates, points, and
URLs; you own status, priority, and time estimates. The one exception is that a
Canvas submission promotes an item to *submitted* — that's upstream truth. Each
row stores a hash of its upstream fields, so unchanged assignments are skipped
entirely.

**Calendar sync is idempotent.** Every assignment maps to exactly one event
through `calendar_event_links`, so re-syncing updates rather than duplicates.
Finished or archived work has its event removed. Events go to a dedicated
calendar so your personal ones are never touched.

**Security.** Every table is protected by row-level security scoped to
`auth.uid()`. OAuth tokens live in `integration_secrets`, which has RLS enabled
and *no policies at all* — the anon and authenticated roles can never read it,
even with a valid session. Only server-side code using the service role can.
Storage buckets are private, with each user confined to a folder named by their
user id.

---

## Layout

```
supabase/
  migrations/          # schema, applied in filename order
  tests/               # SQL behaviour tests + local Supabase shim
scripts/db-check.sh    # throwaway-Postgres validation harness
web/src/
  app/                 # routes: dashboard, settings, login, API handlers
  components/          # client components
  lib/
    calendar/agenda.ts # merges classes, deadlines, and events into one view
    canvas/            # Canvas REST client, ICS feed parser, and ingest
    google/            # OAuth + Calendar sync
    reminders/         # due-reminder dispatcher
    supabase/          # browser / server / service-role clients
    types/db.ts        # hand-written DB types (replace via npm run db:types)
    util/dates.ts      # urgency bucketing and formatting
    util/timezone.ts   # Intl-based zone math (no timezone database bundled)
  proxy.ts             # session refresh + auth gating (Next 16 "proxy")
```

---

## Next steps

1. **Handwriting refinements** — reopening a saved drawing to edit it (the
   vector JSON is already stored for this), and OCR so ink is searchable
   alongside typed notes via `notes.body`.
2. **Old: iPad companion** — SwiftUI + PencilKit, writing `PKDrawing` blobs to the
   `notes` storage bucket and rows to `attachments` (`kind = 'ink'`). Ink
   transcription goes into `notes.body` so handwriting is searchable.
2. **Notion sync** — the `integration_provider` enum and token storage already
   account for it.
3. **Handwriting** — `attachments.kind = 'ink'` and `ink_metadata` are reserved
   for PencilKit drawings; transcribed text goes into `notes.body` so ink is
   searchable alongside typed notes.
