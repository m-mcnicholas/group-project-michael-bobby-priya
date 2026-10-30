const test = require("node:test");
const assert = require("node:assert/strict");
const Model = require("../landing/planner-model.js");
const Store = require("../landing/planner-store.js");

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key), data };
}
const defaultClasses = () => [
  { id: "calculus", name: "Calculus", color: "#538fc5", code: "M", teacher: "Ms. Nguyen", period: "Period 2" },
  { id: "personal", name: "Personal", color: "#c48b34", code: "★", teacher: "Personal", period: "Anytime" },
];
const defaultTasks = () => [{ id: "demo-1", title: "Demo", className: "Calculus", dueDate: "2026-10-30", dueTime: "17:00", priority: "High", completed: false }];

// A tiny stand-in for supabase-js that records every call and serves rows from memory.
function fakeSupabase({ user = null, tables = {}, failOn = null } = {}) {
  const calls = [];
  const rows = { classes: [], items: [], ...tables };
  const channels = [];
  let authListener = null;
  function builder(table) {
    const query = { table, op: "select", filters: [] };
    const run = () => {
      calls.push(query);
      if (failOn && failOn(query)) return { data: null, error: new Error("boom") };
      if (query.op !== "select") return { data: null, error: null };
      let data = rows[table].filter((row) => query.filters.every(([kind, column, value]) => (kind === "is" ? (row[column] ?? null) === value : row[column] === value)));
      if (query.range) data = data.slice(query.range[0], query.range[1] + 1);
      return { data, error: null };
    };
    const api = {
      select() { return api; },
      order() { return api; },
      range(from, to) { query.range = [from, to]; return api; },
      is(column, value) { query.filters.push(["is", column, value]); return api; },
      eq(column, value) { query.filters.push(["eq", column, value]); return api; },
      upsert(payload) { Object.assign(query, { op: "upsert", payload }); return api; },
      insert(payload) { Object.assign(query, { op: "insert", payload }); return api; },
      update(payload) { Object.assign(query, { op: "update", payload }); return api; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return api;
  }
  const client = {
    calls, rows, channels,
    from: builder,
    auth: {
      getSession: async () => ({ data: { session: user ? { user } : null } }),
      onAuthStateChange: (listener) => { authListener = listener; },
      signOut: async () => {},
    },
    channel(name) {
      const channel = { name, handlers: [], on(type, filter, handler) { channel.handlers.push({ filter, handler }); return channel; }, subscribe() { return channel; } };
      channels.push(channel);
      return channel;
    },
    removeChannel() {},
    emitAuth(nextUser) { authListener("SIGNED_IN", nextUser ? { user: nextUser } : null); },
  };
  return client;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
function makeStore(options = {}) {
  return Store.createPlannerStore({ storage: options.storage || memoryStorage(), model: Model, defaultClasses, defaultTasks, ...options });
}

test("maps database rows to planner tasks and back without losing the deadline/schedule split", () => {
  const row = { id: "a", class_id: "c", type: "test", title: "Quiz", notes: "", priority: "high", due_date: "2026-11-03", due_time: "08:30:00", scheduled_start: "2026-11-02T19:00:00", duration_minutes: 60, completed: false, source: "axis", axis_missing: false };
  const task = Store.rowToTask(row);
  assert.equal(task.priority, "High");
  assert.equal(task.dueTime, "08:30");
  assert.equal(task.scheduledStart, "2026-11-02T19:00");
  const back = Store.taskToRow(task);
  assert.equal(back.priority, "high");
  assert.equal(back.due_date, "2026-11-03");
  assert.equal(back.scheduled_start, "2026-11-02T19:00");
  assert.ok(!("source" in back) && !("axis_uid" in back), "the browser never rewrites Axis bookkeeping");
  assert.equal(Store.taskToRow({ title: "x", dueDate: "", dueTime: "" }).due_date, null);
});

test("softColor tints a class color toward white", () => {
  assert.equal(Store.softColor("#000000"), "#d6d6d6");
  assert.equal(Store.softColor("bad"), Store.NO_CLASS.soft);
});

test("range filtering matches either the deadline or the scheduled work date", () => {
  const task = { dueDate: "2026-11-10", scheduledStart: "2026-11-02T10:00" };
  assert.equal(Store.taskInRange(task, { from: "2026-11-01", to: "2026-11-03" }), true);
  assert.equal(Store.taskInRange(task, { from: "2026-11-04", to: "2026-11-09" }), false);
  assert.equal(Store.taskInRange(task), true);
});

test("local mode migrates legacy className tasks to class ids and persists edits", async () => {
  const legacy = [{ id: "old", title: "Old", className: "Calculus", dueDate: "2026-10-30", dueTime: "09:00" }];
  const storage = memoryStorage({ "duckplan-demo-tasks-v1": JSON.stringify(legacy) });
  const store = makeStore({ storage });
  await store.init();
  assert.equal(store.mode, "local");
  const [task] = store.listItems();
  assert.equal(task.classId, "calculus");
  assert.equal(task.scheduledStart, null, "migration never invents a schedule from a due time");
  assert.equal(store.classById(task.classId).name, "Calculus");

  const added = await store.upsertItem({ title: "New", classId: "personal", dueDate: "2026-10-31" });
  await store.toggleComplete("old", true);
  const saved = JSON.parse(storage.getItem("duckplan-demo-tasks-v1"));
  assert.equal(saved.length, 2);
  assert.equal(saved.find((item) => item.id === "old").completed, true);
  assert.match(added.id, /^[0-9a-f-]{36}$/);
  await store.deleteItem(added.id);
  assert.equal(JSON.parse(storage.getItem("duckplan-demo-tasks-v1")).length, 1);
});

test("without Supabase settings the store stays local and account calls explain why", async () => {
  const store = makeStore({ config: { url: "", anonKey: "" } });
  await store.init();
  assert.equal(store.configured, false);
  await assert.rejects(store.signInWithEmail("a@b.test"), /isn't set up/);
  assert.deepEqual(await store.axisStatus(), { connected: false, lastSyncedAt: null, lastError: null });
});

test("planLocalImport reuses classes by name, creates the rest, and remaps every task", () => {
  let next = 0;
  const plan = Store.planLocalImport({
    localTasks: [{ id: "t1", title: "A", classId: "calculus", scheduledStart: null, dueDate: "2026-11-01", dueTime: "17:00" }, { id: "t2", title: "B", classId: "personal" }],
    localClasses: defaultClasses(),
    cloudClasses: [{ id: "cloud-calc", name: "calculus" }],
    makeId: () => `id-${++next}`,
  });
  assert.deepEqual(plan.classRows.map((row) => [row.id, row.name]), [["id-1", "Personal"]]);
  assert.deepEqual(plan.itemRows.map((row) => [row.id, row.class_id]), [["id-2", "cloud-calc"], ["id-3", "id-1"]]);
  assert.equal(plan.itemRows[0].scheduled_start, null);
});

const user = { id: "user-a" };
const cloudConfig = { url: "https://example.supabase.co", anonKey: "anon" };

test("signed-in mode reads from Supabase and soft-deletes", async () => {
  const client = fakeSupabase({ user, tables: { classes: [{ id: "c1", name: "Calc", color: "#538fc5" }], items: [{ id: "i1", title: "Cloud task", class_id: "c1", priority: "medium", completed: false, deleted_at: null }] } });
  const store = makeStore({ config: cloudConfig, createClient: () => client });
  await store.init();
  assert.equal(store.mode, "cloud");
  assert.deepEqual(store.listItems().map((task) => task.title), ["Cloud task"]);
  assert.equal(store.listClasses()[0].soft, Store.softColor("#538fc5"));

  await store.deleteItem("i1");
  const deletion = client.calls.at(-1);
  assert.equal(deletion.op, "update");
  assert.ok(deletion.payload.deleted_at, "deletes set deleted_at instead of removing the row");
  assert.equal(store.listItems().length, 0);
});

test("a failed cloud write rolls back and reloads", async () => {
  const client = fakeSupabase({ user, tables: { items: [{ id: "i1", title: "Keep me", priority: "low", completed: false, deleted_at: null }] }, failOn: (query) => query.op === "update" });
  const store = makeStore({ config: cloudConfig, createClient: () => client });
  await store.init();
  const reasons = [];
  store.subscribe(({ reason }) => reasons.push(reason));
  await assert.rejects(store.toggleComplete("i1", true), /boom/);
  assert.equal(store.listItems()[0].completed, false);
  assert.deepEqual(reasons, ["local", "error"]);
});

test("realtime changes from another device update the cache", async () => {
  const client = fakeSupabase({ user });
  const store = makeStore({ config: cloudConfig, createClient: () => client });
  await store.init();
  const itemHandler = client.channels[0].handlers.find((entry) => entry.filter.table === "items");
  assert.equal(itemHandler.filter.filter, "user_id=eq.user-a");
  itemHandler.handler({ eventType: "INSERT", new: { id: "r1", title: "From phone", priority: "medium", completed: false, deleted_at: null } });
  assert.deepEqual(store.listItems().map((task) => task.title), ["From phone"]);
  itemHandler.handler({ eventType: "UPDATE", new: { id: "r1", title: "From phone", priority: "medium", completed: false, deleted_at: "2026-10-30T00:00:00Z" } });
  assert.equal(store.listItems().length, 0, "a soft delete elsewhere removes the task here");
});

test("signing in switches from local data to the account and offers a one-time import", async () => {
  const storage = memoryStorage();
  const client = fakeSupabase();
  const store = makeStore({ storage, config: cloudConfig, createClient: () => client });
  await store.init();
  assert.equal(store.mode, "local");
  client.emitAuth(user);
  await tick();
  assert.equal(store.mode, "cloud");
  assert.equal(await store.localImportOffer(), 1);
  assert.equal(await store.importLocalTasks(), 1);
  const inserts = client.calls.filter((call) => call.op === "insert");
  assert.deepEqual(inserts.map((call) => call.table), ["classes", "items"]);
  assert.equal(await store.localImportOffer(), 0, "the offer only appears once per account");
});
