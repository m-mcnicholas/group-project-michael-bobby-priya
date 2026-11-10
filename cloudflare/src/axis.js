// Axis sync: imports a student's Axis (Blackbaud Podium) iCal feed into classes and items.
// Replaces the Supabase axis-sync Edge Function and its pg_cron job.
//
//   GET    /api/axis                       connection status (never the link itself)
//   POST   /api/axis { mode: "connect", icalUrl }   save the feed link, then sync
//   POST   /api/axis { mode: "sync" }               "Sync now" (rate limited)
//   DELETE /api/axis                       forget the feed link; imported items stay
//   Cron Trigger                           re-syncs connections older than AXIS_SYNC_INTERVAL_HOURS
//
// The feed link works like a password: it is only stored in axis_connections and is never echoed
// back in responses, errors, or logs.
import Ical from "../../landing/ical-parser.js";
import { HttpError, json, nowIso, readJson } from "./http.js";
import { jsonInsert } from "./planner.js";
import { broadcast } from "./live.js";

const MAX_FEED_BYTES = 5_000_000;
const MIN_SYNC_INTERVAL_MS = 60_000;

async function fetchFeed(icalUrl, fetchImpl = fetch) {
  const url = Ical.normalizeFeedUrl(icalUrl);
  let response;
  try {
    // No redirects: a redirect could point outside myschoolapp.com and get around the host check.
    response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { Accept: "text/calendar" } });
  } catch {
    throw new HttpError(502, "Couldn't reach Axis. Try again in a few minutes.");
  }
  if (!response.ok) throw new HttpError(502, `Axis answered with status ${response.status}. Check that the feed link is still valid.`);
  if (Number(response.headers.get("Content-Length") || 0) > MAX_FEED_BYTES) throw new HttpError(502, "The Axis feed is unexpectedly large.");
  const text = await response.text();
  if (text.length > MAX_FEED_BYTES) throw new HttpError(502, "The Axis feed is unexpectedly large.");
  if (!text.includes("BEGIN:VCALENDAR")) throw new HttpError(502, "That link didn't return an Axis calendar feed.");
  return text;
}

// Axis only rewrites the fields it owns (title, due date, class, notes) and never touches
// completed or deleted items; planAxisSync in landing/ical-parser.js decides what changes.
const ITEM_UPDATES = `
UPDATE items SET title = j.title, due_date = j.due_date, class_id = j.class_id, notes = j.notes, axis_missing = 0, updated_at = ?3
FROM (
  SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.title') AS title, json_extract(value, '$.due_date') AS due_date,
         json_extract(value, '$.class_id') AS class_id, json_extract(value, '$.notes') AS notes
  FROM json_each(?1)
) AS j
WHERE items.id = j.id AND items.user_id = ?2 AND items.completed = 0 AND items.deleted_at IS NULL`;

export function validTimeZone(value) {
  if (typeof value !== "string" || !value || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true; } catch { return false; }
}

// The calendar date ('YYYY-MM-DD') it currently is for the student, since due dates are local wall-clock dates.
export function localDateKey(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function syncUser(env, userId, icalUrl, { fetchImpl, now = () => new Date() } = {}) {
  const db = env.DB;
  const runId = crypto.randomUUID();
  const startedAt = nowIso();
  await db.batch([
    db.prepare("INSERT INTO sync_runs (id, user_id, started_at) VALUES (?, ?, ?)").bind(runId, userId, startedAt),
    db.prepare("UPDATE axis_connections SET last_attempted_at = ?, updated_at = ? WHERE user_id = ?").bind(startedAt, startedAt, userId),
  ]);
  try {
    const feed = Ical.parseAxisFeed(await fetchFeed(icalUrl, fetchImpl));
    const [axisClasses, axisItems, classCount, profile] = await db.batch([
      db.prepare("SELECT id, axis_key FROM classes WHERE user_id = ? AND axis_key IS NOT NULL").bind(userId),
      db.prepare("SELECT id, axis_uid, title, due_date, class_id, notes, completed, deleted_at, axis_missing FROM items WHERE user_id = ? AND axis_uid IS NOT NULL").bind(userId),
      db.prepare("SELECT count(*) AS n FROM classes WHERE user_id = ?").bind(userId),
      db.prepare("SELECT time_zone FROM users WHERE id = ?").bind(userId),
    ]);
    const existingClasses = axisClasses.results;
    const timeZone = validTimeZone(profile.results[0]?.time_zone) ? profile.results[0].time_zone : "America/Los_Angeles";
    const clock = now();
    const plan = Ical.planAxisSync({
      feed,
      // Every existing class counts toward the color index, so new Axis classes don't repeat manual colors.
      existingClasses: [...existingClasses, ...Array(Math.max(0, classCount.results[0].n - existingClasses.length)).fill({})],
      existingItems: axisItems.results.map((row) => ({ ...row, completed: Boolean(row.completed), axis_missing: Boolean(row.axis_missing) })),
      newId: () => crypto.randomUUID(),
      // First import only: assignments due before today arrive already completed.
      today: localDateKey(clock, timeZone),
      completedAt: clock.toISOString(),
    });

    const finishedAt = nowIso();
    const statements = [];
    if (plan.classInserts.length) statements.push(jsonInsert(db, "classes", userId, plan.classInserts, "ON CONFLICT (user_id, axis_key) DO NOTHING"));
    if (plan.itemInserts.length) {
      const rows = plan.itemInserts.map((row) => ({ ...row, axis_missing: row.axis_missing ? 1 : 0, completed: row.completed ? 1 : 0 }));
      statements.push(jsonInsert(db, "items", userId, rows, "ON CONFLICT (user_id, axis_uid) DO NOTHING"));
    }
    if (plan.itemUpdates.length) statements.push(db.prepare(ITEM_UPDATES).bind(JSON.stringify(plan.itemUpdates), userId, finishedAt));
    if (plan.itemsMissing.length) {
      statements.push(db.prepare("UPDATE items SET axis_missing = 1, updated_at = ?1 WHERE user_id = ?2 AND id IN (SELECT value FROM json_each(?3))").bind(finishedAt, userId, JSON.stringify(plan.itemsMissing)));
    }
    statements.push(
      db.prepare("UPDATE sync_runs SET status = 'ok', finished_at = ?, added = ?, updated = ?, removed = ? WHERE id = ?").bind(finishedAt, plan.counts.added, plan.counts.updated, plan.counts.removed, runId),
      db.prepare("UPDATE axis_connections SET last_synced_at = ?, last_error = NULL, updated_at = ? WHERE user_id = ?").bind(finishedAt, finishedAt, userId),
    );
    // One transaction: a sync applies completely or not at all.
    await db.batch(statements);
    await broadcast(env, userId, { reload: true });
    return { ...plan.counts, classesAdded: plan.classInserts.length, lastSyncedAt: finishedAt };
  } catch (error) {
    const message = error instanceof HttpError ? error.message : "Sync failed unexpectedly.";
    console.error("axis sync failed", userId, error instanceof HttpError ? error.message : error?.message || error);
    const failedAt = nowIso();
    await db.batch([
      db.prepare("UPDATE sync_runs SET status = 'error', finished_at = ?, error = ? WHERE id = ?").bind(failedAt, message, runId),
      db.prepare("UPDATE axis_connections SET last_error = ?, updated_at = ? WHERE user_id = ?").bind(message, failedAt, userId),
    ]);
    throw error instanceof HttpError ? error : new HttpError(500, message);
  }
}

export async function axisStatus(env, userId) {
  const row = await env.DB.prepare("SELECT last_synced_at, last_error FROM axis_connections WHERE user_id = ?").bind(userId).first();
  return row ? { connected: true, lastSyncedAt: row.last_synced_at, lastError: row.last_error } : { connected: false, lastSyncedAt: null, lastError: null };
}

export async function handleAxis(request, env, path, user, options = {}) {
  if (path !== "/api/axis") return null;
  const db = env.DB;
  if (request.method === "GET") return json(await axisStatus(env, user.id));
  if (request.method === "DELETE") {
    await db.prepare("DELETE FROM axis_connections WHERE user_id = ?").bind(user.id).run();
    return json({ ok: true });
  }
  if (request.method !== "POST") return null;

  const body = await readJson(request);
  if (body.mode === "connect") {
    let icalUrl;
    try { icalUrl = Ical.normalizeFeedUrl(body.icalUrl); } catch (error) { throw new HttpError(400, error.message); }
    // The browser's zone decides what "before today" means for the first import (and later cron syncs).
    if (validTimeZone(body.timeZone)) {
      await db.prepare("UPDATE users SET time_zone = ?, updated_at = ? WHERE id = ?").bind(body.timeZone, nowIso(), user.id).run();
    }
    Ical.parseAxisFeed(await fetchFeed(icalUrl, options.fetchImpl)); // prove the link works before saving it
    const now = nowIso();
    await db.prepare(`INSERT INTO axis_connections (user_id, ical_url, updated_at) VALUES (?1, ?2, ?3)
      ON CONFLICT (user_id) DO UPDATE SET ical_url = excluded.ical_url, last_error = NULL, updated_at = excluded.updated_at`).bind(user.id, icalUrl, now).run();
    return json(await syncUser(env, user.id, icalUrl, options));
  }
  if (body.mode === "sync") {
    const connection = await db.prepare("SELECT ical_url, last_attempted_at FROM axis_connections WHERE user_id = ?").bind(user.id).first();
    if (!connection) throw new HttpError(404, "Connect Axis first.");
    if (connection.last_attempted_at && Date.now() - Date.parse(connection.last_attempted_at) < MIN_SYNC_INTERVAL_MS) {
      throw new HttpError(429, "Axis just synced. Try again in a minute.");
    }
    return json(await syncUser(env, user.id, connection.ical_url, options));
  }
  throw new HttpError(400, "Unknown mode.");
}

// Cron Trigger: each run re-syncs the few connections that have waited longest, which keeps every
// run well inside the Workers free plan's per-invocation query and subrequest limits.
export async function syncDueConnections(env, options = {}) {
  const hours = Number(env.AXIS_SYNC_INTERVAL_HOURS || 4);
  const limit = Math.max(1, Math.min(20, Number(env.AXIS_SYNC_PER_RUN || 4)));
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { results } = await env.DB.prepare("SELECT user_id, ical_url FROM axis_connections WHERE coalesce(last_attempted_at, '') < ? ORDER BY coalesce(last_attempted_at, '') LIMIT ?")
    .bind(cutoff, limit).all();
  const summary = { ok: 0, failed: 0 };
  for (const connection of results) {
    try { await syncUser(env, connection.user_id, connection.ical_url, options); summary.ok += 1; } catch { summary.failed += 1; }
  }
  return summary;
}
