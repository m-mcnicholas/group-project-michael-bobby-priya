// axis-sync: imports a student's Axis (Blackbaud Podium) iCal feed into classes and items.
//
// POST { mode: "connect", icalUrl }  signed-in user saves their feed link, then syncs
// POST { mode: "sync" }              signed-in user's "Sync now"
// POST { mode: "all" }               pg_cron re-sync of every connection (x-cron-secret header)
//
// The feed link works like a password: it is only stored in axis_connections, which the browser
// can't read, and it is never echoed back in responses or errors.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import "./ical-parser.js";

// deno-lint-ignore no-explicit-any
const Ical = (globalThis as any).DuckAxisIcal;
const MAX_FEED_BYTES = 5_000_000;
const MIN_SYNC_INTERVAL_MS = 60_000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class UserFacingError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function fetchFeed(icalUrl: string): Promise<string> {
  const url = Ical.normalizeFeedUrl(icalUrl);
  let response: Response;
  try {
    // No redirects: a redirect could point outside myschoolapp.com and get around the host check.
    response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { Accept: "text/calendar" } });
  } catch {
    throw new UserFacingError("Couldn't reach Axis. Try again in a few minutes.", 502);
  }
  if (!response.ok) throw new UserFacingError(`Axis answered with status ${response.status}. Check that the feed link is still valid.`, 502);
  const text = await response.text();
  if (text.length > MAX_FEED_BYTES) throw new UserFacingError("The Axis feed is unexpectedly large.", 502);
  if (!text.includes("BEGIN:VCALENDAR")) throw new UserFacingError("That link didn't return an Axis calendar feed.", 502);
  return text;
}

function chunks<T>(list: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, (index + 1) * size));
}

async function syncUser(admin: SupabaseClient, userId: string, icalUrl: string) {
  const { data: run, error: runError } = await admin.from("sync_runs").insert({ user_id: userId }).select("id").single();
  if (runError) throw runError;
  try {
    const feed = Ical.parseAxisFeed(await fetchFeed(icalUrl));
    const [classesResult, itemsResult] = await Promise.all([
      admin.from("classes").select("id, axis_key").eq("user_id", userId).not("axis_key", "is", null),
      admin.from("items").select("id, axis_uid, title, due_date, class_id, notes, completed, deleted_at, axis_missing").eq("user_id", userId).not("axis_uid", "is", null),
    ]);
    if (classesResult.error) throw classesResult.error;
    if (itemsResult.error) throw itemsResult.error;
    const { count: classCount } = await admin.from("classes").select("id", { count: "exact", head: true }).eq("user_id", userId);

    const plan = Ical.planAxisSync({
      feed,
      // Every existing class counts toward the color index, so new Axis classes don't repeat manual colors.
      existingClasses: [...classesResult.data, ...Array(Math.max(0, (classCount ?? 0) - classesResult.data.length)).fill({})],
      existingItems: itemsResult.data,
      newId: () => crypto.randomUUID(),
    });
    const owned = <T extends object>(rows: T[]) => rows.map((row) => ({ ...row, user_id: userId }));

    if (plan.classInserts.length) {
      const { error } = await admin.from("classes").upsert(owned(plan.classInserts), { onConflict: "user_id,axis_key", ignoreDuplicates: true });
      if (error) throw error;
    }
    for (const batch of chunks(owned(plan.itemInserts), 200)) {
      const { error } = await admin.from("items").upsert(batch, { onConflict: "user_id,axis_uid", ignoreDuplicates: true });
      if (error) throw error;
    }
    // Upserting on id only rewrites the columns sent, which are the Axis-owned fields.
    for (const batch of chunks(owned(plan.itemUpdates), 200)) {
      const { error } = await admin.from("items").upsert(batch, { onConflict: "id" });
      if (error) throw error;
    }
    for (const batch of chunks(plan.itemsMissing as string[], 200)) {
      const { error } = await admin.from("items").update({ axis_missing: true }).eq("user_id", userId).in("id", batch);
      if (error) throw error;
    }

    const finishedAt = new Date().toISOString();
    await admin.from("sync_runs").update({ status: "ok", finished_at: finishedAt, ...plan.counts }).eq("id", run.id);
    await admin.from("axis_connections").update({ last_synced_at: finishedAt, last_error: null }).eq("user_id", userId);
    return { ...plan.counts, classesAdded: plan.classInserts.length, lastSyncedAt: finishedAt };
  } catch (error) {
    const message = error instanceof UserFacingError ? error.message : "Sync failed unexpectedly.";
    console.error("axis-sync failed", userId, error instanceof Error ? error.message : error);
    await admin.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), error: message }).eq("id", run.id);
    await admin.from("axis_connections").update({ last_error: message }).eq("user_id", userId);
    throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const body = await request.json().catch(() => ({}));

  try {
    if (body.mode === "all") {
      const secret = Deno.env.get("AXIS_CRON_SECRET");
      if (!secret || request.headers.get("x-cron-secret") !== secret) return json({ error: "Not allowed." }, 401);
      const { data, error } = await admin.from("axis_connections").select("user_id, ical_url");
      if (error) throw error;
      const results = { ok: 0, failed: 0 };
      for (const connection of data) {
        try { await syncUser(admin, connection.user_id, connection.ical_url); results.ok += 1; } catch { results.failed += 1; }
      }
      return json(results);
    }

    const jwt = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    const { data: userData } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
    const user = userData?.user;
    if (!user) return json({ error: "Sign in to connect Axis." }, 401);

    if (body.mode === "connect") {
      let icalUrl: string;
      try { icalUrl = Ical.normalizeFeedUrl(body.icalUrl); } catch (error) { throw new UserFacingError((error as Error).message); }
      Ical.parseAxisFeed(await fetchFeed(icalUrl));
      const { error } = await admin.from("axis_connections").upsert({ user_id: user.id, ical_url: icalUrl, last_error: null });
      if (error) throw error;
      return json(await syncUser(admin, user.id, icalUrl));
    }

    if (body.mode === "sync") {
      const { data: connection, error } = await admin.from("axis_connections").select("ical_url, last_synced_at").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      if (!connection) throw new UserFacingError("Connect Axis first.", 404);
      if (connection.last_synced_at && Date.now() - Date.parse(connection.last_synced_at) < MIN_SYNC_INTERVAL_MS) {
        throw new UserFacingError("Axis just synced. Try again in a minute.", 429);
      }
      return json(await syncUser(admin, user.id, connection.ical_url));
    }

    return json({ error: "Unknown mode." }, 400);
  } catch (error) {
    if (error instanceof UserFacingError) return json({ error: error.message }, error.status);
    console.error("axis-sync error", error instanceof Error ? error.message : error);
    return json({ error: "Sync failed unexpectedly." }, 500);
  }
});
