#!/usr/bin/env bash
#
# Deploys the web app to Vercel and wires up production environment variables.
#
# Run `npx vercel login` first.
#
# Two-phase by necessity: GOOGLE_REDIRECT_URI and NEXT_PUBLIC_APP_URL must point
# at the deployment, whose URL isn't known until after the first deploy. So we
# deploy, read the URL, set the variables, then deploy again.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/web"

if ! npx --yes vercel whoami >/dev/null 2>&1; then
  echo "Not logged in. Run: npx vercel login" >&2
  exit 1
fi

# Values that don't depend on the deployment URL.
PASSTHROUGH=(
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  NEXT_PUBLIC_VAPID_PUBLIC_KEY
  VAPID_PRIVATE_KEY
  VAPID_SUBJECT
  CRON_SECRET
)

set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

echo "→ linking project"
npx --yes vercel link --yes >/dev/null

put_env() {
  local key="$1" value="$2"
  # Replacing is the only way to update a Vercel env var in place.
  npx --yes vercel env rm "$key" production --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | npx --yes vercel env add "$key" production >/dev/null
  echo "   set $key"
}

echo "→ pushing environment variables"
for key in "${PASSTHROUGH[@]}"; do
  put_env "$key" "${!key}"
done

echo "→ first deploy (to discover the production URL)"
npx --yes vercel deploy --prod --yes >/dev/null

# The stable production alias, NOT the per-deployment URL. A deployment URL
# like web-reehw7ri5-*.vercel.app changes on every deploy, which would break
# the Google redirect URI and require re-registering it each time.
URL="$(npx --yes vercel project ls 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const line = s.split("\n").find(l => /https:\/\/\S+\.vercel\.app/.test(l));
  const m = line && line.match(/https:\/\/(\S+\.vercel\.app)/);
  console.log(m ? m[1] : "");
});' || true)"

if [ -z "$URL" ]; then
  echo "Could not determine the stable production domain. Run 'npx vercel project ls'" >&2
  echo "and pass the URL to scripts/setup-scheduling.sh manually." >&2
  exit 1
fi

APP_URL="https://${URL#https://}"

echo "→ setting URL-dependent variables (${APP_URL})"
put_env NEXT_PUBLIC_APP_URL "$APP_URL"
put_env GOOGLE_REDIRECT_URI "${APP_URL}/api/google/callback"

echo "→ redeploying with the final configuration"
npx --yes vercel deploy --prod --yes >/dev/null

echo
echo "✓ Deployed: ${APP_URL}"
echo
echo "Now do these three things:"
echo "  1. Google Cloud Console → Credentials → your OAuth client →"
echo "     add redirect URI:  ${APP_URL}/api/google/callback"
echo "  2. Supabase → Authentication → URL Configuration →"
echo "     Site URL: ${APP_URL}   and add ${APP_URL}/** to Redirect URLs"
echo "  3. Schedule the background jobs:"
echo "     PGPASSWORD='...' ./scripts/setup-scheduling.sh ${APP_URL}"
