const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Ical = require("../landing/ical-parser.js");

const fixture = fs.readFileSync(path.join(__dirname, "fixtures/axis-feed.ics"), "utf8");

test("parses every made-up feed event with unfolded, decoded fields", () => {
  const feed = Ical.parseAxisFeed(fixture);
  assert.equal(feed.items.length, 5);
  const quiz = feed.items.find((item) => item.axisUid === "6f1c2a9e-0d4b-4c7e-9a51-1b2c3d4e5f60");
  assert.deepEqual(quiz, {
    axisUid: "6f1c2a9e-0d4b-4c7e-9a51-1b2c3d4e5f60",
    classKey: "Physics I (AP) - 4",
    title: "Unit 1 Quiz",
    type: "test",
    notes: "Bring a calculator and a pencil. Covers kinematics & vectors.",
    dueDate: "2026-11-03",
    dueTime: null,
  });
});

test("splits titles at the first colon and treats the trailing number as the section", () => {
  assert.deepEqual(Ical.splitTitle("AP Calculus BC - 2: AP Classroom: 1.1 Daily Videos"), { classKey: "AP Calculus BC - 2", courseName: "AP Calculus BC", section: "2", title: "AP Classroom: 1.1 Daily Videos" });
  assert.deepEqual(Ical.splitTitle("Software Engineering - Artificial Intelligence - 1: Project Proposal"), { classKey: "Software Engineering - Artificial Intelligence - 1", courseName: "Software Engineering - Artificial Intelligence", section: "1", title: "Project Proposal" });
  assert.equal(Ical.splitTitle("No class prefix here").classKey, null);
});

test("creates one class per unique title prefix", () => {
  const feed = Ical.parseAxisFeed(fixture);
  assert.deepEqual(feed.classes.map((item) => item.axisKey), ["Physics I (AP) - 4", "AP Calculus BC - 2", "Software Engineering - Artificial Intelligence - 1", "English 11 (Honors) - 3"]);
  assert.equal(feed.classes[0].name, "Physics I (AP)");
  assert.equal(feed.classes[0].code, "PI");
});

test("turns HTML descriptions and iCal escapes into plain notes", () => {
  const feed = Ical.parseAxisFeed(fixture);
  assert.equal(feed.items.find((item) => item.classKey === "AP Calculus BC - 2").notes, "Watch videos 1.1–1.3\nTake notes in your journal");
  const lab = feed.items.find((item) => item.title.startsWith("Lab Report"));
  assert.equal(lab.title, "Lab Report, Projectile Motion");
  assert.equal(lab.notes, "Submit on the class page.\nInclude your data table.");
  assert.equal(lab.type, "assignment");
});

test("works with LF-only line endings too", () => {
  assert.equal(Ical.parseAxisFeed(fixture.replace(/\r\n/g, "\n")).items.length, 5);
});

test("detects tests from quiz, test, and exam wording", () => {
  assert.equal(Ical.itemTypeForTitle("Unit Test: The Great Gatsby"), "test");
  assert.equal(Ical.itemTypeForTitle("Midterm Exam review"), "test");
  assert.equal(Ical.itemTypeForTitle("Vocab quizzes"), "test");
  assert.equal(Ical.itemTypeForTitle("Contest entry"), "assignment");
});

test("keeps floating times but never guesses a local time from UTC", () => {
  assert.deepEqual(Ical.parseDateValue("20261103"), { date: "2026-11-03", time: null });
  assert.deepEqual(Ical.parseDateValue("20261103T153000"), { date: "2026-11-03", time: "15:30" });
  assert.deepEqual(Ical.parseDateValue("20261103T153000Z"), { date: "2026-11-03", time: null });
});

test("only accepts Axis Podium feed links and switches webcal to https", () => {
  assert.equal(Ical.normalizeFeedUrl("webcal://example.myschoolapp.com/podium/feed/iCal.aspx?z=abc"), "https://example.myschoolapp.com/podium/feed/iCal.aspx?z=abc");
  assert.equal(Ical.normalizeFeedUrl("  https://example.myschoolapp.com/podium/feed/iCal.aspx?z=abc  "), "https://example.myschoolapp.com/podium/feed/iCal.aspx?z=abc");
  for (const bad of ["http://example.myschoolapp.com/podium/feed/iCal.aspx", "https://myschoolapp.com.evil.test/podium/feed/iCal.aspx", "https://example.myschoolapp.com/other", "https://user:pw@example.myschoolapp.com/podium/feed/iCal.aspx", "https://example.myschoolapp.com:8443/podium/feed/iCal.aspx", "not a url"]) {
    assert.throws(() => Ical.normalizeFeedUrl(bad), Error, bad);
  }
});

function counterIds() { let next = 0; return () => `new-${++next}`; }

test("first sync inserts classes and items without duplicates", () => {
  const feed = Ical.parseAxisFeed(fixture);
  const plan = Ical.planAxisSync({ feed, newId: counterIds() });
  assert.equal(plan.classInserts.length, 4);
  assert.equal(plan.itemInserts.length, 5);
  assert.deepEqual(plan.counts, { added: 5, updated: 0, removed: 0 });
  const quiz = plan.itemInserts.find((row) => row.axis_uid === "6f1c2a9e-0d4b-4c7e-9a51-1b2c3d4e5f60");
  assert.equal(quiz.class_id, plan.classInserts.find((row) => row.axis_key === "Physics I (AP) - 4").id);
  assert.equal(quiz.source, "axis");
  assert.equal(quiz.due_time, null);
  assert.ok(!("completed" in quiz) && !("scheduled_start" in quiz) && !("priority" in quiz));
});

test("re-sync updates only Axis-owned fields, skips completed and deleted items, and flags missing ones", () => {
  const feed = Ical.parseAxisFeed(fixture);
  const first = Ical.planAxisSync({ feed, newId: counterIds() });
  const existingClasses = first.classInserts;
  const existingItems = first.itemInserts.map((row) => ({ ...row, completed: false, deleted_at: null }));
  existingItems[0].title = "Old title";
  existingItems[1].completed = true;
  existingItems[1].title = "Completed and stale";
  existingItems[2].deleted_at = "2026-10-29T00:00:00Z";
  existingItems.push({ id: "gone", axis_uid: "dropped-out", completed: false, deleted_at: null, axis_missing: false });
  existingItems.push({ id: "gone-done", axis_uid: "dropped-done", completed: true, deleted_at: null, axis_missing: false });
  existingItems.push({ id: "manual", axis_uid: null, completed: false, deleted_at: null });

  const plan = Ical.planAxisSync({ feed, existingClasses, existingItems, newId: counterIds() });
  assert.equal(plan.classInserts.length, 0);
  assert.equal(plan.itemInserts.length, 0);
  assert.deepEqual(plan.itemUpdates.map((row) => row.id), [existingItems[0].id]);
  assert.deepEqual(Object.keys(plan.itemUpdates[0]).sort(), ["axis_missing", "class_id", "due_date", "id", "notes", "title"]);
  assert.deepEqual(plan.itemsMissing, ["gone"]);
});

test("an item that returns to the feed clears its missing flag", () => {
  const feed = Ical.parseAxisFeed(fixture);
  const first = Ical.planAxisSync({ feed, newId: counterIds() });
  const existingItems = first.itemInserts.map((row) => ({ ...row, completed: false, deleted_at: null }));
  existingItems[3].axis_missing = true;
  const plan = Ical.planAxisSync({ feed, existingClasses: first.classInserts, existingItems, newId: counterIds() });
  assert.deepEqual(plan.itemUpdates.map((row) => [row.id, row.axis_missing]), [[existingItems[3].id, false]]);
});

test("the Edge Function's copy of the parser matches landing/ical-parser.js", () => {
  const source = fs.readFileSync(path.join(__dirname, "../landing/ical-parser.js"), "utf8");
  const copy = fs.readFileSync(path.join(__dirname, "../supabase/functions/axis-sync/ical-parser.js"), "utf8");
  assert.equal(copy, source);
});
