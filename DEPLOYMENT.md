# Owner action: upgrade the existing DuckPlan server

**Ready to deploy from this repository's `main` branch.** The mobile/template problem is an older hosted release, not a lack of mobile-device support. Publishing this handoff has not deployed or migrated production.

## Problem and confirmed blocker

Read-only checks on **November 15, 2026 (Pacific)** found:

- `https://duckplan.duckplan-cloudflare.workers.dev/service-worker.js` returns the old `duckplan-app-motion-preview-v13` cache.
- `/planner-library.js` returns HTTP404: the hosted assets lack the new template UI.
- The Cloudflare account signed in on the development Mac cannot access the configured production D1 database. Listing migrations returns error7404, database not found. The authenticated production schema could not be inspected; the owner must check which migrations are actually missing.

Main already contains the template/resource API and migrations through `0008`, plus the matching website with cache **version67**. The separately verified native fallback app uses version68; that fallback is not required to deploy this server repair. Updating GitHub or running Xcode does not deploy the Worker or migrate D1.

## Owner deployment steps

Use the account that owns the **existing** Worker `duckplan` and D1 `duckplan-prod`. Preserve its accounts, records, bindings, secrets and public URL. If error7404 persists, verify the selected account and existing database binding with the owner before proceeding; do not create an empty replacement database.

From a clean checkout:

```sh
git clone https://github.com/m-mcnicholas/group-project-michael-bobby-priya.git
cd group-project-michael-bobby-priya
git switch main
git pull --ff-only origin main
git rev-parse HEAD
cd cloudflare
npm ci
npx wrangler login
npx wrangler whoami
npx wrangler d1 migrations list duckplan-prod --remote --env production
```

An existing clean clone can start at `git switch main`. Authorize the owner's Cloudflare account; an unrelated existing login is not enough. Check `cloudflare/wrangler.jsonc` against the actual existing production resources. Do not change identifiers merely to bypass an access error.

Record the currently deployed Worker version for rollback and take an owner-managed private database backup before applying migrations. Keep database exports, cookies and secrets outside Git. All tracked migrations `0001`–`0008` are required. The expected pending group on the previously observed old baseline was `0004`–`0008`; the successful owner-side migrations list is authoritative.

Review the production bundle without publishing:

```sh
npx wrangler deploy --dry-run --env production --outdir /tmp/duckplan-owner-dry-run
```

Then, when the owner is ready to change production, run these **in order** from `cloudflare/`. Stop if either command fails:

```sh
npm run db:migrate:prod
npm run deploy:prod
```

These commands update the real database and public Worker. Never run the demo seed, reset/drop tables, replace the database, or change the app's API origin for this repair. Preserve existing Google/VAPID/APNs secrets. Closed-app native background push has separate signing/server requirements in [the activation guide](docs/account-device-sync/OWNER-ACTIVATION.md).

## Verify before calling it fixed

1. Reload the existing public URL. The service worker must contain cache **version67** for this main release. `/planner-library.js` and `/calendar-date-presentation.js` must return200 with JavaScript, not a fallback HTML page. If a later code release changes the cache version, compare against that release's `landing/service-worker.js` instead.
2. Sign into a dedicated owner-authorized test account. `/api/planner` must include arrays `templates`, `resources`, `goals`, `habits`, `habit_checkins`, `notes`; an `organization` object; and true flags `work_alerts_supported`, `task_details_supported`, `settings_adoption_supported`. Anonymous401 or working static assets alone do not prove the authenticated schema works.
3. Create and edit a template. **Add to tasks** must reveal one independent unscheduled task; **Schedule** must create a separate timed copy while retaining the template and its saved settings. Reload/relaunch and confirm persistence. Use two signed-in clients to check shared templates, tasks and alert settings. Signing out must not expose them to another account.
4. Refresh or reopen the latest native app after the server update. Its device-only template fallback automatically uploads to the same account once library support is detected. Confirm its notice disappears and the template is not duplicated. Install the intended app build with Xcode Run if the phone has an older version; a GitHub push does not update an installed phone.
5. Check a resource, existing tasks and personal features. On phone and iPad, timed deadlines belong at exact schedule minutes; date-only deadlines stay date-only. Default Personal/no-class work blocks are light yellow; custom class colors remain intact. Follow the [platform testing procedure](docs/platform-testing/README.md) and record actual results.

The optional read-only contract checker runs from the repository root:

```sh
node tools/check-server-compatibility.mjs --origin https://duckplan.duckplan-cloudflare.workers.dev --cookie-file /absolute/private/path/test-session.cookie
```

Supply the dedicated test account's Cookie header value in that private file, never in Git, and remove it afterward. Exit0 checks the contract only; it does not replace action/persistence tests.

## Recovery and existing verification

If the Worker regresses, restore the previously recorded healthy Worker version using the owner's Cloudflare rollback procedure and verify it against the migrated schema. Worker rollback does not undo database migrations. Use the private backup/recovery plan if data recovery is needed; do not improvise destructive down-migrations.

The main release's [verification record](docs/design-parity-library/README.md) and [build manifest](docs/design-parity-library/build-manifest.json) cover local browser/native checks, not a production repair. The latest native fallback is backed up separately on [the TEST app branch](https://github.com/bobbyzhang133-star/Duck-Plan-Test/tree/codex/ios-template-fallback-20261115), with [its verification record](https://github.com/bobbyzhang133-star/Duck-Plan-Test/blob/codex/ios-template-fallback-20261115/docs/native-template-fallback/README.md).

The older owner ZIP contains the earlier verified website release. Use this repository's current `main` and this guide as the deployment handoff so the source, commands and version checks stay together.
