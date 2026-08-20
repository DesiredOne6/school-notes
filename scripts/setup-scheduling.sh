#!/usr/bin/env bash
#
# Schedules the app's background jobs inside Postgres using pg_cron.
#
# Why not Vercel Cron: the Hobby (free) plan allows cron jobs only ONCE PER DAY,
# and a more frequent expression fails at deploy time. Reminders need a ~5 minute
# cadence, so scheduling lives in Supabase, which is always on and has no such
# limit. It also means reminders keep firing even if the web app is redeployed
# or moved off Vercel entirely.
#
# Usage:
#   ./scripts/setup-scheduling.sh https://your-app.vercel.app
#
# Requires DATABASE_PASSWORD and CRON_SECRET in the environment, or reads
# CRON_SECRET from web/.env.local.
set -euo pipefail

APP_URL="${1:-}"
if [ -z "$APP_URL" ]; then
  echo "Usage: $0 <app-url>   e.g. $0 https://school-notes.vercel.app" >&2
  exit 1
fi

APP_URL="${APP_URL%/}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="/opt/homebrew/opt/postgresql@17/bin"
[ -d "$PGBIN" ] && export PATH="$PGBIN:$PATH"

# Pull CRON_SECRET from the local env file unless it's already set.
if [ -z "${CRON_SECRET:-}" ] && [ -f "$ROOT/web/.env.local" ]; then
  CRON_SECRET="$(grep -E '^CRON_SECRET=' "$ROOT/web/.env.local" | cut -d= -f2-)"
fi

: "${CRON_SECRET:?CRON_SECRET is not set}"
: "${SUPABASE_DB_HOST:=db.djphnnjnxkmrgfrryonw.supabase.co}"
: "${PGPASSWORD:?Set PGPASSWORD to your Supabase database password}"

psql -h "$SUPABASE_DB_HOST" -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
-- pg_cron schedules; pg_net makes the outbound HTTP call.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Keep the bearer token in Vault rather than inline in the job definition.
do \$\$
begin
  if exists (select 1 from vault.secrets where name = 'app_cron_secret') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'app_cron_secret'),
      '${CRON_SECRET}'
    );
  else
    perform vault.create_secret(
      '${CRON_SECRET}', 'app_cron_secret', 'Bearer token for the app cron endpoints'
    );
  end if;
end \$\$;

-- Replacing a schedule is safe: unschedule ignores jobs that don't exist.
select cron.unschedule('dispatch-reminders') where exists (
  select 1 from cron.job where jobname = 'dispatch-reminders'
);
select cron.unschedule('sync-integrations') where exists (
  select 1 from cron.job where jobname = 'sync-integrations'
);

-- Reminders: every 5 minutes. The dispatcher is a no-op when nothing is due.
select cron.schedule(
  'dispatch-reminders',
  '*/5 * * * *',
  \$job\$
  select net.http_post(
    url := '${APP_URL}/api/cron/reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'app_cron_secret'
      )
    ),
    timeout_milliseconds := 30000
  );
  \$job\$
);

-- Canvas pull + Google push: hourly is plenty for assignment data.
select cron.schedule(
  'sync-integrations',
  '7 * * * *',
  \$job\$
  select net.http_post(
    url := '${APP_URL}/api/cron/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'app_cron_secret'
      )
    ),
    timeout_milliseconds := 120000
  );
  \$job\$
);

select jobname, schedule, active from cron.job order by jobname;
SQL

echo
echo "✓ Scheduled against ${APP_URL}"
echo "  Check recent runs with:"
echo "    select jobname, status, start_time from cron.job_run_details order by start_time desc limit 10;"
