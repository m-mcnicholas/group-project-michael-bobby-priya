const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const landing = path.join(root, "landing");

test("web app manifest defines an installable standalone DuckPlan app", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(landing, "app.webmanifest"), "utf8"));
  assert.equal(manifest.name, "DuckPlan");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/#home");
  assert.equal(manifest.scope, "/");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose.includes("maskable")));
  manifest.icons.forEach((icon) => assert.ok(fs.existsSync(path.join(landing, icon.src.replace(/^\//, "")))));
});

test("planner markup exposes install metadata and an accessible install control", () => {
  const html = fs.readFileSync(path.join(landing, "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(landing, "styles.css"), "utf8");
  assert.match(html, /rel="manifest" href="\.\/app\.webmanifest"/);
  assert.match(html, /id="install-app-settings" aria-labelledby="install-app-heading"/);
  assert.match(html, /id="install-app-button" hidden/);
  assert.match(html, /src="\.\/app-install\.js\?v=app-1"/);
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

test("service worker caches the shell, leaves APIs online-only, and handles notification clicks", () => {
  const worker = fs.readFileSync(path.join(landing, "service-worker.js"), "utf8");
  assert.match(worker, /const CACHE_VERSION = "duckplan-app-v11"/);
  for (const asset of ["planner-clarity.css", "planner-clarity.js", "planner-presentation.js", "duck-mascot.js"]) assert.ok(worker.includes(asset), `Offline shell includes ${asset}`);
  assert.match(worker, /event\.request\.mode === "navigate"/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /notificationclick/);
  assert.match(worker, /duckplan-notification-open/);
  assert.match(worker, /clients\.openWindow/);
});

test("install controller registers the worker and supports native install prompts", () => {
  const controller = fs.readFileSync(path.join(landing, "app-install.js"), "utf8");
  assert.match(controller, /navigator\.serviceWorker\.register\("\.\/service-worker\.js"/);
  assert.match(controller, /beforeinstallprompt/);
  assert.match(controller, /appinstalled/);
  assert.match(controller, /Add to Home Screen/);
});
