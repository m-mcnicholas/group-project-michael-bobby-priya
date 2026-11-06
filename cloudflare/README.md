# DuckPlan Cloudflare backend

Implements the **Backend Plan** in `plans.md` on Cloudflare (it replaced the earlier Supabase backend).
One Worker serves the static site in `landing/` **and** the API under `/api`, on the same origin, so
sign-in is a plain first-party HttpOnly cookie.

| Supabase piece (before)            | Cloudflare piece (now)                                         |
| ---------------------------------- | -------------------------------------------------------------- |
| Postgres + row-level security      | **D1** (SQLite); every query is scoped to the session's user   |
| Supabase Auth (magic link, Google) | Worker auth: **email + password** (PBKDF2) with recovery codes, + Google OIDC/PKCE. No email is ever sent. |
| Realtime on `items` / `classes`    | **Durable Object** `PlannerLive` per user (WebSocket hibernation) |
| `axis-sync` Edge Function          | `src/axis.js` in the same Worker                               |
| pg_cron + pg_net + Vault           | **Cron Trigger** (`*/30 * * * *`) — no shared secret needed    |
| Netlify static hosting             | Workers **static assets** (Netlify still works, local-only)    |

```
cloudflare/
  wrangler.jsonc            bindings: D1 (DB), Durable Object (LIVE), assets, cron; dev + production envs
  migrations/0001_initial_schema.sql   tables, ownership triggers, checks
  migrations/0002_password_sign_in.sql password + recovery-code columns, login_failures; drops login_tokens
  seed.sql                  demo user, classes, and tasks (local/dev only)
  src/index.js              router, /cloud-config.js, /api/live, scheduled()
  src/auth.js               sessions, passwords, recovery codes, Google sign-in
  src/planner.js            classes/items CRUD, local-task import
  src/axis.js               Axis connect / sync / cron (imports ../../landing/ical-parser.js directly)
  src/live.js               PlannerLive Durable Object + broadcast()
```

## API

All routes are JSON, need the session cookie (except auth), and reject cross-site `Origin`s.

| Route                                   | What it does                                          |
| --------------------------------------- | ----------------------------------------------------- |
| `GET /api/session`                      | `{ user, providers }`                                 |
| `POST /api/auth/sign-up` `{ email, password }` | creates the account, signs in, returns a one-time `recoveryCode` |
| `POST /api/auth/sign-in` `{ email, password }` | signs in (10 wrong tries per account per 15 min, then 429) |
| `POST /api/auth/recover` `{ email, recoveryCode, newPassword }` | forgot password: new password, signs out other devices, returns a new `recoveryCode` |
| `POST /api/auth/password` `{ currentPassword, newPassword }` | signed in: change (or, for Google accounts, add) a password; signs out other devices |
| `POST /api/auth/recovery-code` `{ password }` | signed in: replace the recovery code              |
| `GET /api/auth/google?next=/`           | Google sign-in (callback: `/api/auth/google/callback`)|
| `POST /api/auth/sign-out`               | ends the session                                      |
| `GET /api/planner`                      | `{ classes, items }` (soft-deleted items left out)    |
| `PUT/PATCH/DELETE /api/items/:id`       | upsert, `{ completed }`, soft delete                  |
| `PUT /api/classes/:id`                  | upsert (archive with `archived: true`)                |
| `POST /api/import` `{ classRows, itemRows }` | first-sign-in local import, one transaction      |
| `GET/POST/DELETE /api/axis`             | status, `{ mode: "connect", icalUrl }` / `{ mode: "sync" }`, disconnect |
| `GET /api/live` (WebSocket)             | `{ table, row }` and `{ reload: true }` messages      |

`landing/cloud-config.js` ships with `apiUrl: ""`, so any copy of the site **not** served by this
Worker (Netlify, `python3 -m http.server`) stays local-only. The Worker answers that file itself with
`apiUrl: "/api"`.

## Run it locally

```sh
cd cloudflare
npm install
cp .dev.vars.example .dev.vars      # optional: only needed for Google sign-in
npm run db:migrate:local
npm run db:seed:local               # optional: demo@duckplan.test / duckplan-demo with sample tasks
npm run dev                         # → http://127.0.0.1:8787/  (site + API, labeled local)
```

Use Settings → Account → Create account with any email and a password (nothing is emailed). Trigger the Axis cron locally
with `curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=*/30+*+*+*+*"`.

## Test

```sh
node --test tests/                  # from the repo root; includes tests/cloudflare-worker.test.mjs
npm run check                       # (in cloudflare/) wrangler dry-run bundle of dev and production
```

`tests/cloudflare-worker.test.mjs` runs the real migration on Node's built-in SQLite with D1's
limits (50-character LIKE/GLOB patterns, 100 bound parameters) and covers auth, user isolation (the
old RLS test), the Axis sync rules, cron, Google sign-in, and the browser store against the Worker.

## Hosted environments

**Status (2026-11-05):** both D1 databases exist (their ids are in `wrangler.jsonc`) and both have
`0001` and `0002` applied (no seed). Both Workers run the email + password build with the 30-minute Axis cron:

| Environment | Worker URL | D1 |
| --- | --- | --- |
| dev | <https://duckplan-dev.duckplan-cloudflare.workers.dev> | `duckplan-dev` |
| production | <https://duckplan.duckplan-cloudflare.workers.dev> | `duckplan-prod` |

Anyone can create an account on either site. Google sign-in stays hidden until its secrets are set.
The public Netlify site (<https://duckplan-mbp.netlify.app>) is separate and stays local-only.

## Set up the hosted environments (one time)

Needs only a Cloudflare account (the free plan is enough). No domain or email service is needed, because sign-in never sends email.

```sh
cd cloudflare
npx wrangler login
npx wrangler d1 create duckplan-dev        # paste the id into wrangler.jsonc (top-level d1_databases)
npx wrangler d1 create duckplan-prod       # paste the id into env.production.d1_databases
```

1. **Google (optional):** create an OAuth client (Web application) in Google Cloud. Add the redirect URI
   `https://<worker-host>/api/auth/google/callback` for each environment, then
   `npx wrangler secret put GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (add `--env production` for prod).
   The "Use Google" button only appears once these are set.
2. **Dev:** `npm run db:migrate:dev && npm run deploy:dev` → `https://duckplan-dev.<account>.workers.dev`.

**Prod is a deployment.** Under the local-first-release rule, `db:migrate:prod`, `deploy:prod`, and
moving the public site from Netlify to the Worker (or adding a custom domain) all need explicit approval.

## Rules the code relies on

- D1 has no row-level security: **every** SQL statement in `src/` filters or writes by the session's
  `user_id`. The schema adds a second lock (an item can only point at its owner's class; rows can't
  change owner). `tests/cloudflare-worker.test.mjs` checks user A can't read or change user B's rows.
- Deadlines are `due_date` `YYYY-MM-DD` + `due_time` `HH:MM` (local wall-clock), never time-zone timestamps.
- Ids come from the client (`crypto.randomUUID()`); deletes set `deleted_at`.
- Axis writes only `title`, `due_date`, `class_id`, `notes` (and `axis_missing`); it never touches
  `completed`, `scheduled_start`, or `priority`, and skips completed or deleted items.
- `axis_connections.ical_url` is never returned by any route or written to logs.
- Session and sign-in tokens are stored only as SHA-256 hashes.
- Keep LIKE/GLOB patterns under 50 characters (D1 rejects longer ones at write time).
- Never commit a real Axis feed or feed link; `tests/fixtures/axis-feed.ics` is made up.

## Sign-in without email

Sending email needs a paid domain, so the Worker never sends any:

- **Email + password.** The email is only a login name; it is never verified. Passwords are hashed with
  PBKDF2-SHA256 through Web Crypto (`PBKDF2_ITERATIONS` in `src/auth.js`, 50,000 to stay within the free
  plan's CPU limit; Workers caps it at 100,000). The count is stored in each hash, and accounts are
  re-hashed at the new count when they sign in, so it can be raised later.
- **Recovery code instead of "reset by email".** Sign-up shows a 20-character code once (only its SHA-256
  is stored). It resets a forgotten password and is then replaced. Signed-in users can make a new one.
  If someone loses both, the account owner can delete their `users` row in D1 so they can sign up again
  (this deletes their planner data).
- **Google can't take over a password account.** Because password emails are unverified, someone could
  register another student's address first. Google sign-in therefore refuses to join a password account
  with the same email, so the real owner's Google sign-in never lands in a planner someone else controls.
  The trade-off: whoever registers an address first owns it, and the owner can delete a squatted account.

