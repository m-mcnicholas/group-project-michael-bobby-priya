const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const UI = require("../landing/planner-ui.js");

test("calendar slot navigation moves by hour and day with bounded edges", () => {
  const dates = ["2026-11-02", "2026-11-03", "2026-11-04"];
  assert.deepEqual(UI.nextSlot({ date: dates[1], time: "09:00" }, "ArrowUp", dates), { date: dates[1], time: "08:00" });
  assert.deepEqual(UI.nextSlot({ date: dates[1], time: "09:00" }, "ArrowRight", dates), { date: dates[2], time: "09:00" });
  assert.deepEqual(UI.nextSlot({ date: dates[0], time: "07:00" }, "ArrowUp", dates), { date: dates[0], time: "07:00" });
  assert.deepEqual(UI.nextSlot({ date: dates[2], time: "21:00" }, "ArrowRight", dates), { date: dates[2], time: "21:00" });
});

test("calendar auto-scroll keeps the target inside scroll bounds", () => {
  const afternoon = UI.timelineScrollTop({ targetMinutes: 15 * 60 + 30, viewportHeight: 500, scrollHeight: 1100 });
  assert.ok(afternoon > 400 && afternoon <= 600);
  assert.equal(UI.timelineScrollTop({ targetMinutes: 7 * 60, viewportHeight: 500, scrollHeight: 1100 }), 0);
  assert.equal(UI.timelineScrollTop({ targetMinutes: 22 * 60, viewportHeight: 500, scrollHeight: 700 }), 200);
});

test("undo restoration preserves the deleted task position without duplicates", () => {
  const deleted = { id: "b", title: "B" };
  const restored = UI.restoreDeletedTask([{ id: "a" }, { id: "c" }], deleted, 1);
  assert.deepEqual(restored.map((task) => task.id), ["a", "b", "c"]);
  assert.deepEqual(UI.restoreDeletedTask(restored, deleted, 1).map((task) => task.id), ["a", "b", "c"]);
});

test("calendar dragging snaps to quarter hours and stays inside the visible day", () => {
  assert.deepEqual(UI.snapCalendarDrop({
    date: "2026-11-04", pointerY: 165, columnTop: 10, hourHeight: 62, durationMinutes: 45,
  }), { date: "2026-11-04", minutes: 570, time: "09:30" });
  assert.deepEqual(UI.snapCalendarDrop({
    date: "2026-11-04", pointerY: -200, columnTop: 10, hourHeight: 62, durationMinutes: 45,
  }), { date: "2026-11-04", minutes: 420, time: "07:00" });
  assert.deepEqual(UI.snapCalendarDrop({
    date: "2026-11-04", pointerY: 2000, columnTop: 10, hourHeight: 62, durationMinutes: 90,
  }), { date: "2026-11-04", minutes: 1230, time: "20:30" });
});

test("planner markup and styles retain the responsive accessibility contract", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "landing/index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "landing/app.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "landing/styles.css"), "utf8");
  const buttonRule = fs.readFileSync(path.join(root, ".cursor/rules/button-interactions.mdc"), "utf8");
  assert.match(html, /id="toggle-task-panel"[^>]+aria-controls="daily-task-panel"/);
  assert.match(html, /id="calendar-status" role="status" aria-live="polite"/);
  assert.doesNotMatch(html, /id="planner-calendar"[^>]+aria-live=/);
  assert.match(app, /tabindex="\$\{isFocusSlot \? "0" : "-1"\}"/);
  assert.match(app, /class="current-time-line"/);
  assert.match(app, /data-calendar-drag-task="\$\{task\.id\}"/);
  assert.match(app, /snapCalendarDrop/);
  assert.match(app, /setPointerCapture/);
  assert.match(app, /actionLabel: "Undo"/);
  assert.match(css, /\.calendar-event-block \{[^}]+cursor: grab;[^}]+touch-action: none;/);
  assert.match(css, /\.calendar-drag-ghost/);
  assert.match(html, /id="calendar-drag-instructions"/);
  assert.match(app, /actionLabel: "Undo"/);
  assert.match(app, /sidebar\.inert = false/);
  assert.match(html, /class="calendar-toolbar-primary"/);
  assert.match(html, /class="sidebar-section-label">Planner/);
  assert.doesNotMatch(html, /class="calendar-legend"/);
  assert.match(css, /@media \(max-width: 1000px\)[\s\S]+\.task-sidebar-panel[\s\S]+position: fixed/);
  assert.match(css, /\.planner-glass\.sidebar-open \.unified-shell \{ grid-template-columns: var\(--sidebar-width\) minmax\(0,1fr\); \}/);
  assert.match(css, /\.planner-glass \.unified-shell \{ grid-template-columns: var\(--sidebar-rail-width\) minmax\(0,1fr\); \}/);
  assert.match(css, /clip-path: inset\(0 calc\(100% - var\(--sidebar-rail-width\)\) 0 0\)/);
  assert.match(css, /transition: grid-template-columns 280ms cubic-bezier/);
  assert.match(css, /\.planner-glass:not\(\.sidebar-open\) \.unified-shell \.nav-item\.glass-button::after \{ display: none; \}/);
  assert.match(css, /\.planner-glass:not\(\.sidebar-open\) \.unified-shell \.nav-item\.active \.nav-icon/);
  assert.match(css, /\.planner-glass:not\(\.sidebar-open\) \.unified-shell \.nav-item:not\(:disabled\):hover \.nav-icon/);
  assert.match(css, /\.planner-glass:not\(\.sidebar-open\) \.unified-shell \.nav-item:not\(:disabled\):is\(:active,\.interaction-pressed\) \.nav-icon/);
  assert.match(css, /transform: scale\(1\.12\);/);
  assert.match(css, /transform: scale\(\.88\);/);
  assert.match(css, /:is\(button,\[role="button"\],a\.secondary-button,a\.nav-open-button\):not\(:disabled\):not\(\[aria-disabled="true"\]\):hover/);
  assert.match(css, /transform: translateY\(-2px\);/);
  assert.match(css, /:is\(:active,\.interaction-pressed\)/);
  assert.match(css, /transform: scale\(\.945\);/);
  assert.match(css, /\.calendar-slot,[\s\S]+\.task-section-heading\):not\(:disabled\):is\(:active,\.interaction-pressed\)/);
  assert.match(buttonRule, /Every enabled button and button-like control must always include both/);
  assert.match(buttonRule, /Hover effect:[\s\S]+Click effect:/);
  assert.match(css, /\.planner-glass \.unified-shell \.sidebar \{[\s\S]+position: relative;[\s\S]+grid-column: 1;/);
});
