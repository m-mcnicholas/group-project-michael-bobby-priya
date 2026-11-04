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
function makeStore(options = {}) {
  return Store.createPlannerStore({ storage: options.storage || memoryStorage(), model: Model, defaultClasses, defaultTasks, ...options });
}

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

test("migrates legacy className tasks to class ids and persists edits", async () => {
  const legacy = [{ id: "old", title: "Old", className: "Calculus", dueDate: "2026-10-30", dueTime: "09:00" }];
  const storage = memoryStorage({ "duckplan-demo-tasks-v1": JSON.stringify(legacy) });
  const store = makeStore({ storage });
  await store.init();
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

test("classes are saved without their derived soft color, and unknown ids fall back to No class", async () => {
  const storage = memoryStorage();
  const store = makeStore({ storage });
  await store.init();
  const added = await store.upsertClass({ name: "Physics", color: "#000000", code: "P" });
  assert.equal(added.soft, "#d6d6d6");
  const saved = JSON.parse(storage.getItem("duckplan-demo-classes-v1")).find((item) => item.id === added.id);
  assert.ok(saved && !("soft" in saved));
  await store.upsertClass({ ...added, archived: true });
  assert.ok(!store.listClasses().some((item) => item.id === added.id));
  assert.ok(store.listClasses({ includeArchived: true }).some((item) => item.id === added.id));
  assert.equal(store.classById("missing"), Store.NO_CLASS);
});

test("subscribers hear about loads and edits, and reset restores the demo data", async () => {
  const storage = memoryStorage();
  const store = makeStore({ storage });
  const reasons = [];
  store.subscribe(({ reason }) => reasons.push(reason));
  await store.init();
  await store.upsertItem({ title: "Extra", dueDate: "2026-10-31" });
  assert.equal(store.listItems().length, 2);
  await store.resetLocalDemo();
  assert.deepEqual(store.listItems().map((task) => task.id), ["demo-1"]);
  assert.deepEqual(reasons, ["load", "local", "load"]);
});
