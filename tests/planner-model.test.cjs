const test = require("node:test");
const assert = require("node:assert/strict");
const Model = require("../landing/planner-model.js");

test("date keys stay in local calendar time", () => {
  const date = new Date(2026, 9, 28, 23, 45);
  assert.equal(Model.toDateKey(date), "2026-10-28");
  assert.equal(Model.addDays("2026-10-31", 1), "2026-11-01");
});

test("legacy deadlines are preserved without inventing schedules", () => {
  const [task] = Model.migrateTasks([{ id: "legacy", title: "Essay", dueDate: "2026-10-30", dueTime: "15:30" }]);
  assert.equal(task.dueDate, "2026-10-30");
  assert.equal(task.dueTime, "15:30");
  assert.equal(task.scheduledStart, null);
  assert.equal(task.durationMinutes, 45);
  assert.equal(task.schemaVersion, 2);
});

test("daily groups keep scheduled and deadline-only work separate", () => {
  const tasks = Model.migrateTasks([
    { id: "scheduled", title: "Study", dueDate: "2026-10-30", scheduledStart: "2026-10-28T14:00", completed: false },
    { id: "unscheduled", title: "Submit", dueDate: "2026-10-28", dueTime: "17:00", completed: false },
    { id: "overdue", title: "Late", dueDate: "2026-10-27", completed: false },
    { id: "done", title: "Done", dueDate: "2026-10-28", completed: true },
  ]);
  const groups = Model.groupForDate(tasks, "2026-10-28", "2026-10-28");
  assert.deepEqual(groups.scheduled.map((task) => task.id), ["scheduled"]);
  assert.deepEqual(groups.unscheduled.map((task) => task.id), ["unscheduled"]);
  assert.deepEqual(groups.overdue.map((task) => task.id), ["overdue"]);
  assert.deepEqual(groups.completed.map((task) => task.id), ["done"]);
});

test("calendar views and duration helpers are stable", () => {
  assert.equal(Model.datesForView("week", "2026-10-28")[0], "2026-10-26");
  assert.equal(Model.datesForView("month", "2026-10-28").length, 42);
  assert.equal(Model.shiftView("month", "2026-10-31", 1), "2026-11-30");
  assert.equal(Model.scheduledEnd({ scheduledStart: "2026-10-28T23:00", durationMinutes: 30 }), "23:30");
});
