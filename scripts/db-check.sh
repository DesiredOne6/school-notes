#!/usr/bin/env bash
# Validates supabase/migrations against a throwaway Postgres cluster and runs
# the SQL behaviour tests. Requires: brew install postgresql@17
set -euo pipefail

PGBIN="/opt/homebrew/opt/postgresql@17/bin"
[ -d "$PGBIN" ] && export PATH="$PGBIN:$PATH"

# Postgres 17 on macOS refuses to start without an explicit locale.
export LC_ALL=C LANG=C

# Fixed path, not $TMPDIR: macOS gives each shell a different $TMPDIR, which
# would leave orphaned clusters holding the port between runs.
PGDIR="/tmp/schoolnotes_pg"
PORT=55432
SOCK=/tmp
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  pg_ctl -D "$PGDIR" stop -m immediate >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [ ! -f "$PGDIR/PG_VERSION" ]; then
  rm -rf "$PGDIR"
  initdb -D "$PGDIR" -U postgres --auth=trust >/dev/null
fi

pg_ctl -D "$PGDIR" stop -m immediate >/dev/null 2>&1 || true
pg_ctl -D "$PGDIR" -o "-p $PORT -k $SOCK" -l "$PGDIR/server.log" start >/dev/null
sleep 2

psql() { command psql -h "$SOCK" -p "$PORT" -U postgres "$@"; }

psql -tAc "drop database if exists schoolnotes;" >/dev/null
psql -tAc "create database schoolnotes;" >/dev/null

echo "→ applying local Supabase shim"
psql -d schoolnotes -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/00_supabase_shim.sql"

for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ $(basename "$migration")"
  psql -d schoolnotes -v ON_ERROR_STOP=1 -q -f "$migration"
done

for test in "$ROOT"/supabase/tests/[0-9][1-9]_*.sql; do
  [ -f "$test" ] || continue
  echo "→ test $(basename "$test")"
  psql -d schoolnotes -v ON_ERROR_STOP=1 -q -f "$test"
done

echo "✓ schema and tests passed"
