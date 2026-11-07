(function reminderLedgerFactory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DuckReminderLedger = api;
})(typeof window !== "undefined" ? window : globalThis, function buildReminderLedger() {
  const DEFAULT_KEY = "duckplan-reminder-deliveries-v2";
  const DEFAULT_RETRY_MS = 60_000;
  const DEFAULT_LEASE_MS = 30_000;
  const DEFAULT_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;
  const DEFAULT_MAX_RECORDS = 200;
  const FINAL_STATES = new Set(["acknowledged", "submitted"]);

  function randomToken(cryptoApi = globalThis.crypto) {
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function createLedger({
    storage,
    locks = globalThis.navigator?.locks,
    cryptoApi = globalThis.crypto,
    key = DEFAULT_KEY,
    now = () => Date.now(),
    retryMs = DEFAULT_RETRY_MS,
    leaseMs = DEFAULT_LEASE_MS,
    retentionMs = DEFAULT_RETENTION_MS,
    maxRecords = DEFAULT_MAX_RECORDS,
  } = {}) {
    if (!storage) throw new TypeError("Reminder ledger requires storage.");

    function read() {
      try {
        const parsed = JSON.parse(storage.getItem(key));
        return parsed?.version === 2 && parsed.records && typeof parsed.records === "object"
          ? parsed
          : { version: 2, records: {} };
      } catch { return { version: 2, records: {} }; }
    }
    function write(data) {
      try { storage.setItem(key, JSON.stringify(data)); return true; }
      catch { return false; }
    }
    function record(id) { return read().records[id] || null; }
    function processable(entry, at, forceRetry = false) {
      if (!entry) return true;
      if (FINAL_STATES.has(entry.state)) return false;
      if (entry.state === "claimed") return Number(entry.leaseUntil || 0) <= at;
      if (entry.state === "failed") return forceRetry || Number(entry.retryAt || 0) <= at;
      return true;
    }
    async function exclusive(id, callback) {
      if (locks?.request) return locks.request(`duckplan-reminder:${id}`, callback);
      return callback();
    }

    async function claim(id, at = now(), { forceRetry = false } = {}) {
      if (!id) return null;
      return exclusive(id, async () => {
        const data = read();
        const current = data.records[id];
        if (!processable(current, at, forceRetry)) return null;
        const token = randomToken(cryptoApi);
        data.records[id] = {
          state: "claimed",
          token,
          attempts: Number(current?.attempts || 0) + 1,
          updatedAt: at,
          leaseUntil: at + leaseMs,
        };
        if (!write(data)) return null;
        return read().records[id]?.token === token ? token : null;
      });
    }

    async function finish(id, token, state, details = {}, at = now()) {
      if (!FINAL_STATES.has(state) && state !== "failed") throw new TypeError("Invalid reminder delivery state.");
      return exclusive(id, async () => {
        const data = read();
        const current = data.records[id];
        if (!current || current.token !== token) return false;
        data.records[id] = {
          state,
          attempts: Number(current.attempts || 1),
          updatedAt: at,
          ...(state === "failed" ? { retryAt: at + retryMs } : {}),
          ...details,
        };
        return write(data);
      });
    }

    async function release(id, token) {
      return exclusive(id, async () => {
        const data = read();
        if (data.records[id]?.token !== token) return false;
        delete data.records[id];
        return write(data);
      });
    }

    function prune(activeIds = [], at = now()) {
      const active = new Set(activeIds);
      const data = read();
      const kept = Object.entries(data.records)
        .filter(([id, entry]) => active.has(id) && at - Number(entry.updatedAt || 0) <= retentionMs)
        .sort((left, right) => Number(right[1].updatedAt || 0) - Number(left[1].updatedAt || 0))
        .slice(0, maxRecords);
      const next = { version: 2, records: Object.fromEntries(kept) };
      if (JSON.stringify(next.records) !== JSON.stringify(data.records)) write(next);
      return next.records;
    }

    return {
      claim,
      finish,
      prune,
      read,
      record,
      release,
      isFinal: (id) => FINAL_STATES.has(record(id)?.state),
    };
  }

  return {
    DEFAULT_KEY,
    DEFAULT_LEASE_MS,
    DEFAULT_MAX_RECORDS,
    DEFAULT_RETRY_MS,
    DEFAULT_RETENTION_MS,
    createLedger,
  };
});
