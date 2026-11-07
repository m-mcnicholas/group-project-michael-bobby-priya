const test = require("node:test");
const assert = require("node:assert/strict");
const Domain = require("../landing/reminder-domain.js");

const ZONE = "America/Los_Angeles";
const base = {
  taskId: "essay",
  dueDate: "2026-11-06",
  dueTime: "15:30",
  leadMinutes: 60,
  timeZone: ZONE,
};

test("wall times resolve with the requested IANA zone in standard and daylight time", () => {
  assert.equal(Domain.wallTimeToEpoch("2026-01-15", "12:00", ZONE).epoch, Date.UTC(2026, 0, 15, 20, 0));
  assert.equal(Domain.wallTimeToEpoch("2026-07-15", "12:00", ZONE).epoch, Date.UTC(2026, 6, 15, 19, 0));
});

test("DST gaps are invalid and overlaps deterministically choose the earlier instant", () => {
  assert.deepEqual(Domain.wallTimeToEpoch("2026-03-08", "02:30", ZONE), { ok: false, reason: "nonexistent-wall-time" });
  const overlap = Domain.wallTimeToEpoch("2026-11-01", "01:30", ZONE);
  assert.equal(overlap.epoch, Date.UTC(2026, 10, 1, 8, 30));
  assert.equal(overlap.ambiguous, true);
});

test("occurrences move from pending to due, missed, then expired with a bounded grace", () => {
  const initial = Domain.calculateOccurrence({ ...base, evaluationTime: 0 });
  assert.equal(initial.status, "pending");
  const due = Domain.calculateOccurrence({ ...base, evaluationTime: initial.triggerAt });
  assert.equal(due.status, "due");
  assert.equal(due.eligible, true);
  const missed = Domain.calculateOccurrence({ ...base, evaluationTime: initial.deadlineAt + 30 * Domain.MINUTE_MS });
  assert.equal(missed.status, "missed");
  assert.equal(missed.eligible, true);
  const expired = Domain.calculateOccurrence({ ...base, evaluationTime: initial.deadlineAt + 61 * Domain.MINUTE_MS });
  assert.equal(expired.status, "expired");
  assert.equal(expired.eligible, false);
});

test("sleeping past the trigger but not the deadline still produces an eligible reminder", () => {
  const occurrence = Domain.calculateOccurrence({ ...base, evaluationTime: 0 });
  const wake = Domain.calculateOccurrence({ ...base, evaluationTime: occurrence.deadlineAt - 10 * Domain.MINUTE_MS });
  assert.equal(wake.status, "due");
  assert.equal(wake.eligible, true);
});

test("untimed deadlines use 11:59 PM in the applicable zone", () => {
  const occurrence = Domain.calculateOccurrence({ ...base, dueTime: "", evaluationTime: 0 });
  assert.equal(occurrence.dueTime, "23:59");
  assert.equal(occurrence.isUntimed, true);
  assert.equal(occurrence.deadlineAt, Date.UTC(2026, 10, 7, 7, 59));
});

test("identity changes for edits to time, lead, or zone and the display tag stays separate", () => {
  const first = Domain.calculateOccurrence({ ...base, evaluationTime: 0 });
  const leadEdit = Domain.calculateOccurrence({ ...base, leadMinutes: 15, evaluationTime: 0 });
  const timeEdit = Domain.calculateOccurrence({ ...base, dueTime: "16:00", evaluationTime: 0 });
  const zoneEdit = Domain.calculateOccurrence({ ...base, timeZone: "UTC", evaluationTime: 0 });
  assert.equal(new Set([first.occurrenceId, leadEdit.occurrenceId, timeEdit.occurrenceId, zoneEdit.occurrenceId]).size, 4);
  assert.match(first.displayTag, /^duckplan-reminder-[0-9a-f]{8}$/);
  assert.notEqual(first.displayTag, first.occurrenceId);
});

test("completion, deletion, disabled settings, and bad inputs are ineligible", () => {
  assert.equal(Domain.calculateOccurrence({ ...base, completed: true }).status, "completed");
  assert.equal(Domain.calculateOccurrence({ ...base, deleted: true }).status, "deleted");
  assert.equal(Domain.calculateOccurrence({ ...base, enabled: false }).status, "disabled");
  assert.equal(Domain.calculateOccurrence({ ...base, dueDate: "2026-02-30" }).status, "invalid-deadline");
  assert.equal(Domain.calculateOccurrence({ ...base, leadMinutes: -1 }).status, "invalid-lead");
  assert.equal(Domain.calculateOccurrence({ ...base, timeZone: "Mars/Olympus" }).reason, "invalid-time-zone");
});
