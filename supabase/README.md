# DuckPlan Supabase backend

Implements the **Backend Plan** in `plans.md`. The static site in `landing/` talks to it through
`landing/planner-store.js`; with `landing/supabase-config.js` left empty the site stays local-only.

```
supabase/
  config.toml                         local stack settings (supabase start)
  migrations/
    20261030000000_initial_schema.sql tables, RLS, profile trigger, Axis status RPCs, realtime
    20261030000100_axis_sync_schedule.sql  pg_cron job that re-syncs Axis every 4 hours
  functions/axis-sync/
    index.ts                          Edge Function: connect / sync / scheduled sync-all
    ical-parser.js                    copy of landing/ical-parser.js (a test keeps them identical)
  seed.sql                            demo user, classes, and tasks (local/dev only)
  tests/
    rls.test.sql                      user A can't see or change user B's rows; feed links stay private
    local-auth-stub.sql, run-local.sh run the migrations + RLS test on a throwaway Docker Postgres
```

## Test

```sh
node --test tests/                 # parser, store, planner model, fur (no network or database)
sh supabase/tests/run-local.sh     # migrations + seed + RLS test (Docker, postgres:16 image)
```

## Set up the two hosted projects (one time)

Create **duckplan-dev** and **duckplan-prod** in the Supabase dashboard, then install the CLI
(`brew install supabase/tap/supabase`) and for each project:

```sh
supabase login
supabase link --project-ref <ref>
supabase db push                                   # applies supabase/migrations
supabase secrets set AXIS_CRON_SECRET=<long random string>
supabase functions deploy axis-sync --no-verify-jwt
```

In the SQL editor, store the two Vault secrets the cron job reads:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<same AXIS_CRON_SECRET>', 'axis_cron_secret');
```

In **Authentication → URL configuration**, add the site URLs (`http://127.0.0.1:8000/` for dev,
`https://duckplan-mbp.netlify.app/` for prod) to the redirect allow list. Email magic links work out of
the box; enable Google under **Authentication → Providers** once we know the school uses Google accounts.

Finally put the project URL and **anon** key into `landing/supabase-config.js` (never the service-role key).

**Prod is a deployment.** Under the local-first-release rule, `db push`, `functions deploy`, and pointing
the public site's config at prod all need explicit approval first. Use dev for everything else.

## Rules the code relies on

- Deadlines are `due_date date` + `due_time time` (local wall-clock), never time-zone timestamps.
- Ids come from the client (`crypto.randomUUID()`); deletes set `deleted_at`.
- Axis writes only `title`, `due_date`, `class_id`, `notes` (and `axis_missing`); it never touches
  `completed`, `scheduled_start`, or `priority`, and skips completed or deleted items.
- `axis_connections.ical_url` is readable only by the service role. The browser uses
  `axis_connection_status()` and `disconnect_axis()`.
- Never commit a real Axis feed or feed link; `tests/fixtures/axis-feed.ics` is made up.
