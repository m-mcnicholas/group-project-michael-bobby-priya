const test = require("node:test");
const assert = require("node:assert/strict");
const Ledger = require("../landing/reminder-ledger.js");

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function lockManager() {
  const queues = new Map();
  return {
    async request(name, callback) {
      const previous = queues.get(name) || Promise.resolve();
      let release;
      const next = new Promise((resolve) => { release = resolve; });
      queues.set(name, previous.then(() => next));
      await previous;
      try { return await callback(); }
      finally { release(); }
    },
  };
}

test("two tabs claim one occurrence only once", async () => {
  const storage = memoryStorage();
  const locks = lockManager();
  const first = Ledger.createLedger({ storage, locks });
  const second = Ledger.createLedger({ storage, locks });
  const [one, two] = await Promise.all([first.claim("occurrence", 1000), second.claim("occurrence", 1000)]);
  assert.equal([one, two].filter(Boolean).length, 1);
});

test("constructor submission is recorded distinctly and survives reload", async () => {
  const storage = memoryStorage();
  const first = Ledger.createLedger({ storage });
  const token = await first.claim("one", 1000);
  assert.equal(await first.finish("one", token, "submitted", { channel: "browser" }, 1001), true);
  const reloaded = Ledger.createLedger({ storage });
  assert.equal(reloaded.record("one").state, "submitted");
  assert.equal(reloaded.record("one").channel, "browser");
  assert.equal(await reloaded.claim("one", 2000), null);
});

test("foreground reminders are acknowledged without calling them device-delivered", async () => {
  const storage = memoryStorage();
  const ledger = Ledger.createLedger({ storage });
  const token = await ledger.claim("one", 1000);
  await ledger.finish("one", token, "acknowledged", { channel: "in-app" }, 1001);
  assert.deepEqual(ledger.record("one"), { state: "acknowledged", attempts: 1, updatedAt: 1001, channel: "in-app" });
});

test("failed browser submission becomes retryable after a bounded cooldown", async () => {
  const storage = memoryStorage();
  const ledger = Ledger.createLedger({ storage, retryMs: 500 });
  const token = await ledger.claim("one", 1000);
  await ledger.finish("one", token, "failed", { reason: "unsupported" }, 1000);
  assert.equal(await ledger.claim("one", 1499), null);
  assert.ok(await ledger.claim("one", 1499, { forceRetry: true }), "foreground fallback can retry immediately");
  const retryToken = ledger.record("one").token;
  await ledger.finish("one", retryToken, "failed", {}, 1499);
  assert.ok(await ledger.claim("one", 1999));
});

test("an abandoned tab claim expires and can be retried", async () => {
  const storage = memoryStorage();
  const ledger = Ledger.createLedger({ storage, leaseMs: 500 });
  assert.ok(await ledger.claim("one", 1000));
  assert.equal(await ledger.claim("one", 1499), null);
  assert.ok(await ledger.claim("one", 1500));
});

test("modal deferral can release a claim without handling the reminder", async () => {
  const storage = memoryStorage();
  const ledger = Ledger.createLedger({ storage });
  const token = await ledger.claim("one", 1000);
  assert.equal(await ledger.release("one", token), true);
  assert.equal(ledger.record("one"), null);
  assert.ok(await ledger.claim("one", 1001));
});

test("rescheduling, completion, deletion, and undo prune stale occurrence state", async () => {
  const storage = memoryStorage();
  const ledger = Ledger.createLedger({ storage });
  for (const id of ["old-time", "old-lead", "deleted"]) {
    const token = await ledger.claim(id, 1000);
    await ledger.finish(id, token, "acknowledged", {}, 1001);
  }
  ledger.prune(["new-time", "new-lead"], 2000);
  assert.deepEqual(ledger.read().records, {});
  assert.ok(await ledger.claim("deleted", 2001), "undo can create a fresh occurrence after deletion pruned it");
});

test("ledger history remains bounded", async () => {
  const storage = memoryStorage();
  const ledger = Ledger.createLedger({ storage, maxRecords: 3 });
  for (let index = 0; index < 5; index += 1) {
    const id = `item-${index}`;
    const token = await ledger.claim(id, 1000 + index);
    await ledger.finish(id, token, "acknowledged", {}, 1000 + index);
  }
  ledger.prune(["item-0", "item-1", "item-2", "item-3", "item-4"], 2000);
  assert.equal(Object.keys(ledger.read().records).length, 3);
  assert.deepEqual(Object.keys(ledger.read().records).sort(), ["item-2", "item-3", "item-4"]);
});
