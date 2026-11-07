const test = require("node:test");
const assert = require("node:assert/strict");
const Notifications = require("../landing/browser-notifications.js");

function notificationApi(permission = "default", constructor = () => {}) {
  function NotificationMock() { return constructor(...arguments); }
  NotificationMock.permission = permission;
  NotificationMock.requestPermission = async () => permission;
  return NotificationMock;
}

test("notification capability distinguishes permission, context, and constructor usability", () => {
  assert.equal(Notifications.capability(undefined), "unsupported");
  assert.equal(Notifications.capability(notificationApi("default")), "default");
  assert.equal(Notifications.capability(notificationApi("granted")), "granted");
  assert.equal(Notifications.capability(notificationApi("denied")), "denied");
  assert.equal(Notifications.capability(notificationApi("granted"), { isSecureContext: false }), "unsupported");
  assert.equal(Notifications.capability({ permission: "granted", requestPermission() {} }), "granted-unusable");
  assert.equal(Notifications.capability(notificationApi("granted"), { constructorFailed: true }), "granted-unusable");
});

test("notification settings copy keeps permission prompts explicit and honest", () => {
  assert.deepEqual(Notifications.settingsCopy("default"), {
    label: "Not allowed yet", action: "Allow device notifications", disabled: false,
  });
  assert.equal(Notifications.settingsCopy("granted").action, "Try a test notification");
  assert.match(Notifications.settingsCopy("granted").label, /open-page/);
  assert.equal(Notifications.settingsCopy("granted-unusable").disabled, true);
  assert.equal(Notifications.settingsCopy("denied").disabled, true);
  assert.equal(Notifications.settingsCopy("unsupported").disabled, true);
});

test("task notifications separate occurrence identity from display tag", () => {
  const occurrence = {
    deadlineAt: new Date(2026, 10, 6, 15, 30).getTime(),
    occurrenceId: "v2:essay:2026-11-06:15%3A30:60:America%2FLos_Angeles",
    displayTag: "duckplan-reminder-a1b2c3d4",
  };
  const payload = Notifications.taskNotification({
    id: "essay", title: "Submit essay", className: "English", dueDate: "2026-11-06", dueTime: "15:30",
  }, occurrence, { locale: "en-US", icon: "duck.png" });
  assert.equal(payload.title, "DuckPlan deadline reminder");
  assert.match(payload.options.body, /Submit essay\nEnglish · Due Nov 6, 3:30 PM/);
  assert.equal(payload.options.tag, occurrence.displayTag);
  assert.equal(payload.options.icon, "duck.png");
  assert.deepEqual(payload.options.data, {
    taskId: "essay", occurrenceId: occurrence.occurrenceId, dueDate: "2026-11-06",
  });
});

test("notification construction reports submission rather than delivery", () => {
  let created;
  const api = notificationApi("granted", function create(title, options) {
    created = { title, options };
    return { title, options };
  });
  const result = Notifications.createNotification(api, { title: "Test", options: { tag: "one" } });
  assert.equal(result.status, "submitted");
  assert.deepEqual(created, { title: "Test", options: { tag: "one" } });

  const failed = Notifications.createNotification(notificationApi("granted", () => { throw new Error("mobile unsupported"); }), { title: "Test", options: {} });
  assert.equal(failed.status, "failed");
  assert.match(failed.reason, /mobile unsupported/);
});

test("notification click targets resolve current tasks and handle stale ids", () => {
  const task = { id: "essay", title: "Submit essay", dueDate: "2026-11-06" };
  assert.deepEqual(Notifications.resolveTaskTarget([task], "essay"), { status: "found", task, date: "2026-11-06" });
  assert.deepEqual(Notifications.resolveTaskTarget([task], "deleted"), { status: "missing", task: null, date: null });
});

test("test notification states the open-page and unconfirmed-display limitation", () => {
  const payload = Notifications.testNotification({ icon: "duck.png" });
  assert.match(payload.options.body, /planner is open/);
  assert.match(payload.options.body, /device decide/);
  assert.equal(payload.options.tag, "duckplan-notification-test");
});
