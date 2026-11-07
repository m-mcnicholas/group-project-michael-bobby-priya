# DuckPlan reminder integration plan

Status: local TEST implementation and read-only architecture plan. No deployment, production secret, shared-repository edit, service worker, or native wrapper is included.

Reference points:

- TEST baseline: `28ff18a18244f346a42f816084de49d18896dfd5`
- Shared backend reference: `304bcefc4600c641b92241a5c12315719eefc803`
- Shared backend was inspected at that exact commit. It was not modified.

## Confirmed defects and local corrections

| Finding | Local TEST correction |
| --- | --- |
| `refreshReminders()` removed every task as soon as its deadline passed | `reminder-domain.js` uses an explicit one-hour missed-reminder grace after the deadline |
| Browser-local `new Date(date + time)` had implicit zone and DST behavior | Wall-clock deadlines resolve against an explicit IANA time zone; DST gaps are invalid and overlaps choose the earlier instant |
| Seen state mixed occurrence identity and delivery state | `reminder-ledger.js` stores `claimed`, `submitted`, `failed`, and `acknowledged` states separately |
| A successful `new Notification()` call was called delivery | The adapter reports only `submitted`; the UI says device display is unconfirmed |
| Display tags did not include reminder-lead revisions | Occurrence identity includes task, deadline, lead, and zone; a separate hashed display tag follows that identity |
| Multiple open tabs could independently alert | The ledger uses `navigator.locks` when available plus a local-storage claim/lease record |
| Completion, deletion, or edits could leave stale seen records | Every refresh prunes records that no longer match an active occurrence; undo can become eligible again |
| Permission checks ignored secure context and unusable constructors | Capability states now include unsupported and permission-granted-but-unusable delivery |
| Notification click routing trusted stale task IDs | Routing resolves the current task, focuses its card, announces success, and handles missing tasks |

The local fallback remains deliberately limited. It can show an in-app reminder in the foreground and can ask the browser to display a notification while the page is still running in the background. It is not web push, closed-app delivery, offline delivery, an exact alarm, or confirmation that a person saw the reminder.

## Reusable reminder domain

`landing/reminder-domain.js` is UI- and storage-independent. Its inputs are:

- stable task ID;
- due date and optional due time;
- effective lead minutes and reminder enablement;
- evaluation time and IANA time zone;
- completion and deletion state;
- bounded missed-reminder grace.

It returns the normalized deadline, trigger, grace end, stable occurrence identity, display tag, eligibility, and one of: `disabled`, `deleted`, `completed`, `missing-deadline`, `invalid-*`, `pending`, `due`, `missed`, or `expired`.

The default for an untimed deadline is 11:59 PM in the scheduling zone. That matches current TEST copy, but main should expose this as an account policy before Axis all-day deadlines are scheduled server-side.

## Exact main-backend integration map

The shared main architecture at the reference commit already contains authenticated Worker APIs, D1, `DuckPlannerStore`, user-scoped queries, Axis imports, and a `PlannerLive` Durable Object. Preserve those pieces.

| TEST concept | Shared-main destination |
| --- | --- |
| `className` task display | Resolve through `classId` / `class_id`; never copy TEST task objects over main objects |
| local string task IDs | Existing cloud UUIDs |
| task `reminderChoice` | Add backward-compatible fields to `rowToTask()`, `taskToRow()`, `cleanItem()`, item upsert, and import |
| local Settings default | Authenticated account setting using `users.settings` or a typed user preference column |
| browser time zone | `users.time_zone`, updated through an authenticated settings endpoint |
| local occurrence calculator | Shared reminder-domain module called by planner-store for preview and Worker code for authoritative scheduling |
| local delivery ledger | D1 occurrence/attempt ledger for cloud delivery; retain local ledger only for local-only mode |
| open-tab polling | Worker scheduler plus push or native delivery adapters |
| local notification click | Service-worker/native click payload resolving the current cloud item UUID |

Main's current `taskToRow()` omits reminder preferences. Its D1 `items` table omits them too. The existing `reminders` table has `item_id`, `offset_minutes`, `fire_at`, and `sent_at`, but no user ownership column, task revision, device target, atomic claim, retry state, or delivery attempt history. The current scheduled Worker handler only calls Axis `syncDueConnections()`, and the configured cron is every 30 minutes.

## Proposed D1 migrations

Implement migrations in main only after review. A safe shape is:

1. Extend `items` with a nullable per-task reminder override and a revision number.
   - `reminder_mode TEXT` constrained to `default`, `off`, or `custom`.
   - `reminder_offset_minutes INTEGER` nullable and bounded.
   - `revision INTEGER NOT NULL DEFAULT 1`, incremented when deadline/reminder/completion/deletion changes.
2. Store account defaults and the all-day deadline policy.
   - Prefer validated fields in `users.settings`: `reminders.enabled`, `reminders.default_offset_minutes`, and `reminders.untimed_due_time`.
   - Keep `users.time_zone` as the scheduling zone and validate it at the Worker boundary.
3. Replace or migrate `reminders` into durable occurrences.
   - Add `user_id`, `task_revision`, `occurrence_key`, `deadline_at`, `state`, `claim_token`, `claim_expires_at`, `attempt_count`, `next_attempt_at`, `submitted_at`, `canceled_at`, `last_error`, and timestamps.
   - Unique index on `(user_id, occurrence_key)`.
   - Due index on `(state, fire_at, next_attempt_at)`.
   - Retain item foreign-key cascade and add explicit user ownership checks.
4. Add `push_subscriptions`.
   - `id`, `user_id`, device label, endpoint, encrypted/auth keys, expiration, created/updated/revoked timestamps.
   - Unique endpoint identity and user-scoped access.
   - Never log endpoints or subscription keys.
5. Optionally add append-only `reminder_delivery_attempts` for transport, provider response class, and timestamps without storing sensitive endpoint data.

Do not treat `sent_at` as proof of device display or human receipt. A cloud state such as `submitted` should mean only that the push provider accepted the request.

## Proposed authenticated APIs

- `GET /api/reminder-settings`
- `PATCH /api/reminder-settings` with default lead, enablement, untimed policy, and time zone
- Existing item PUT/PATCH extended with reminder mode and offset
- `POST /api/push-subscriptions` to register or rotate a device subscription
- `DELETE /api/push-subscriptions/:id` to revoke the current user's device
- Optional `POST /api/reminders/test` with rate limiting, returning submission status rather than “delivered”

Every query must remain scoped to the signed-in `user.id`, following the existing D1 access rule. Item edits, completion, deletion, Axis resynchronization, time-zone changes, and reminder-setting changes must transactionally cancel or recalculate affected occurrences.

## Durable web-push path

### Installable PWA shell

1. Add a manifest with stable app identity, name, theme/background colors, standalone display, start URL, and purpose-built icons.
2. Add a narrowly scoped service worker. Cache versioned static shell assets only. Do not cache authenticated API responses, sign-in pages, recovery codes, or user planner JSON.
3. Provide install guidance only when the platform exposes it. Installability alone does not enable reminders.

### Push lifecycle

1. Ask for notification permission only after an explicit user action.
2. Register the service worker and create a Push API subscription only after permission is granted.
3. Send the subscription to the authenticated Worker and associate it with the current user/device.
4. Rotate changed subscriptions, revoke them on sign-out/device removal, and delete provider-expired endpoints.
5. The service worker handles `push` and `notificationclick`; click opens or focuses `/#home`, then resolves the item UUID against current data.

### Scheduling and delivery

1. Recalculate an occurrence from the item's local wall-clock deadline, `users.time_zone`, account default, and task override.
2. Change reminder cron precision from the Axis-only 30-minute cadence. Use a separately observable reminder dispatcher with a cadence that matches the promised precision; do not advertise minute precision until measured.
3. Claim due rows atomically using a lease. One scheduler owns an occurrence at a time.
4. Submit to each active device, classify retryable/permanent failures, and back off bounded retries.
5. Mark only provider submission, not display or receipt. Cancel claims when the item revision changes.
6. Coordinate foreground pages with push: a visible page may render an in-app alert, but the server remains authoritative for occurrence identity and multi-device idempotency.

Required secrets such as VAPID private material belong in Cloudflare secrets, never source or D1. No secret was created for this TEST work.

## Capacitor/native path

Do not wrap the site until the shared reminder domain and cloud persistence are stable. Reuse one UI and one reminder service with adapters:

- foreground web toast: local UI only;
- browser notification: best-effort while the page runs;
- service-worker web push: server-triggered background delivery where supported;
- native local notification: schedule accepted task occurrences on the device for offline reminders;
- native push: server-triggered changes, cross-device updates, and occurrence invalidation.

On save/sync, native clients should schedule or cancel local notifications using stable occurrence IDs. The server should send changes and maintain cloud idempotency. Reconcile local schedules after sign-in, task edits, completion/deletion, time-zone changes, and Axis sync.

Android exact alarms require platform-specific permission and policy handling and may fall back to inexact scheduling. iOS local notifications are managed by the operating system and are not an unrestricted alarm-clock API. Product copy should promise reminders, not guaranteed exact alarms, until real-device evidence supports a stronger claim.

## Verification matrix

| Scenario | Automated locally | Browser inspected | Real device / closed app |
| --- | --- | --- | --- |
| Pending, due, missed, expired | Yes | Planned in local preview | Not required for calculation |
| Invalid date, zone, DST gap/overlap | Yes | Not applicable | Not applicable |
| Multiple due reminders | Ledger/domain tests | Planned in local preview | Not verified |
| Two tabs / reload | Shared-storage lock tests | Planned where practical | Not verified |
| Reschedule / lead edit | Identity and prune tests | Planned in local preview | Not verified |
| Complete / delete / undo | Prune tests | Planned in local preview | Not verified |
| Modal-open deferral | Ledger/app behavior | Planned in local preview | Not verified |
| Permission default / unsupported copy | Adapter tests | Local browser default state | Not verified |
| Permission granted / denied | Adapter tests | Requires user-controlled browser permission | Not verified |
| Hidden open tab | Adapter/ledger tests | Requires permission and controlled backgrounding | Not verified |
| Closed PWA, offline, mobile push | No implementation | No | Not implemented |
| Native local/push notifications | No implementation | No | Not implemented |

Unit and desktop-browser evidence must remain separate from device-delivery claims.
