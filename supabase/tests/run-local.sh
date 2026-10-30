#!/bin/sh
# Applies the migrations and seed to a throwaway Postgres container and runs the RLS test.
# Usage: sh supabase/tests/run-local.sh   (needs Docker and the postgres:16 image)
# With the Supabase CLI you can instead run `supabase db reset` against the local stack.
set -eu
cd "$(dirname "$0")/.."
name="duckplan-rls-test-$$"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=postgres postgres:16 >/dev/null
trap 'docker stop "$name" >/dev/null' EXIT
until docker exec "$name" pg_isready -U postgres -q 2>/dev/null; do sleep 1; done
sleep 2
run() { docker exec -i "$name" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
run < tests/local-auth-stub.sql
for file in migrations/*.sql; do
  case "$file" in
    *axis_sync_schedule*) echo "skip $file (pg_cron, pg_net, and Vault exist only on Supabase)"; continue ;;
  esac
  echo "apply $file"
  run < "$file"
done
echo "apply seed.sql"
run < seed.sql
run -c "select count(*) as seeded_items from public.items"
run < tests/rls.test.sql
