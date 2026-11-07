(function plannerStoreFactory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DuckPlannerStore = api;
})(typeof window !== "undefined" ? window : globalThis, function buildPlannerStore() {
  // The only code that reads or writes planner data. Signed in to the DuckPlan Worker (cloudflare/),
  // data lives in Cloudflare D1; otherwise it stays in localStorage so the demo keeps working.
  const TASKS_KEY = "duckplan-demo-tasks-v1";
  const CLASSES_KEY = "duckplan-demo-classes-v1";
  const IMPORTED_KEY = "duckplan-local-import-v1";
  const DEVICE_EXTRAS_KEY = "duckplan-device-task-extras-v1";
  const NO_CLASS = { id: null, name: "No class", color: "#8f8a7d", soft: "#efede7", code: "•", teacher: "", period: "", archived: false };

  function newId() { return globalThis.crypto.randomUUID(); }
  function softColor(hex) {
    const match = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!match) return NO_CLASS.soft;
    const value = parseInt(match[1], 16);
    const mix = (channel) => Math.round(channel + (255 - channel) * 0.84).toString(16).padStart(2, "0");
    return `#${mix(value >> 16)}${mix((value >> 8) & 255)}${mix(value & 255)}`;
  }
  function capitalize(value) { return value ? value[0].toUpperCase() + value.slice(1) : value; }

  function rowToClass(row) {
    return { id: row.id, name: row.name, teacher: row.teacher || "", period: row.period || "", color: row.color, soft: softColor(row.color), code: row.code || row.name.slice(0, 1).toUpperCase(), axisKey: row.axis_key || null, archived: Boolean(row.archived) };
  }
  function classToRow(item) {
    return { id: item.id, name: item.name, teacher: item.teacher || null, period: item.period || null, color: item.color, code: item.code || null, archived: Boolean(item.archived) };
  }
  function rowToTask(row) {
    return {
      id: row.id, title: row.title, classId: row.class_id || null, type: row.type, notes: row.notes || "",
      priority: capitalize(row.priority) || "Medium", dueDate: row.due_date || "", dueTime: row.due_time ? row.due_time.slice(0, 5) : "",
      scheduledStart: row.scheduled_start ? row.scheduled_start.slice(0, 16) : null, scheduledEnd: null,
      durationMinutes: Number(row.duration_minutes || 45), completed: Boolean(row.completed), source: row.source || "manual",
      axisMissing: Boolean(row.axis_missing), schemaVersion: 2,
    };
  }
  function taskToRow(task) {
    return {
      id: task.id, class_id: task.classId || null, type: task.type || "task", title: task.title, notes: task.notes || "",
      priority: String(task.priority || "Medium").toLowerCase(), due_date: task.dueDate || null, due_time: task.dueTime || null,
      scheduled_start: task.scheduledStart || null, duration_minutes: Number(task.durationMinutes || 45), completed: Boolean(task.completed),
    };
  }
  function taskInRange(task, range = {}) {
    if (!range.from && !range.to) return true;
    const dates = [task.dueDate, task.scheduledStart?.slice(0, 10)].filter(Boolean);
    return dates.some((date) => (!range.from || date >= range.from) && (!range.to || date <= range.to));
  }

  // Legacy tasks name their class; newer ones point at a class id.
  function attachClassIds(tasks, classes) {
    const byName = new Map(classes.map((item) => [item.name.toLowerCase(), item.id]));
    return tasks.map((task) => {
      const classId = classes.some((item) => item.id === task.classId) ? task.classId : byName.get(String(task.className || "").toLowerCase()) || null;
      const { className, ...rest } = task;
      return { ...rest, classId };
    });
  }

  // Maps local classes onto the account's classes (matching by name) and gives every local task a fresh
  // UUID. Tasks keep their own scheduledStart; nothing is scheduled from a due time.
  function planLocalImport({ localTasks, localClasses, cloudClasses, makeId = newId }) {
    const cloudByName = new Map(cloudClasses.map((item) => [item.name.toLowerCase(), item.id]));
    const classIdMap = new Map();
    const classRows = [];
    localClasses.forEach((item) => {
      const existing = cloudByName.get(item.name.toLowerCase());
      if (existing) { classIdMap.set(item.id, existing); return; }
      const id = makeId();
      classIdMap.set(item.id, id);
      cloudByName.set(item.name.toLowerCase(), id);
      classRows.push(classToRow({ ...item, id }));
    });
    const itemRows = localTasks.map((task) => taskToRow({ ...task, id: makeId(), classId: classIdMap.get(task.classId) || null }));
    return { classRows, itemRows };
  }

  function createLocalBackend({ storage, model, defaultClasses, defaultTasks }) {
    function read(key) { try { return JSON.parse(storage.getItem(key)); } catch { return null; } }
    function write(key, value) { try { storage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ } }
    function load() {
      const storedClasses = read(CLASSES_KEY);
      const classes = Array.isArray(storedClasses) && storedClasses.length ? storedClasses : structuredClone(defaultClasses());
      const storedTasks = read(TASKS_KEY);
      const source = Array.isArray(storedTasks) && storedTasks.length ? storedTasks : structuredClone(defaultTasks());
      const tasks = attachClassIds(model.migrateTasks(source), classes);
      write(CLASSES_KEY, classes); write(TASKS_KEY, tasks);
      return { classes: classes.map((item) => ({ ...item, soft: softColor(item.color) })), tasks };
    }
    return {
      mode: "local",
      load: async () => load(),
      saveTask: async (task, state) => write(TASKS_KEY, state.tasks),
      setCompleted: async (id, completed, state) => write(TASKS_KEY, state.tasks),
      deleteTask: async (id, state) => write(TASKS_KEY, state.tasks),
      saveClass: async (item, state) => write(CLASSES_KEY, state.classes.map(({ soft, ...rest }) => rest)),
      reset() { storage.removeItem(TASKS_KEY); storage.removeItem(CLASSES_KEY); return load(); },
      watch(onRemoteChange) {
        if (typeof window === "undefined") return () => {};
        const listener = (event) => { if (event.key === TASKS_KEY || event.key === CLASSES_KEY) onRemoteChange(load()); };
        window.addEventListener("storage", listener);
        return () => window.removeEventListener("storage", listener);
      },
    };
  }

  // Talks to the DuckPlan Worker (cloudflare/). Auth is an HttpOnly session cookie on the same
  // origin, so requests only need credentials: "same-origin".
  function createApi({ apiUrl, fetchImpl }) {
    return async function api(method, path, body) {
      let response;
      try {
        response = await fetchImpl(`${apiUrl}${path}`, {
          method, credentials: "same-origin",
          headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch { throw new Error("Couldn't reach DuckPlan. Check your connection and try again."); }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || `DuckPlan answered with status ${response.status}.`);
        error.status = response.status;
        throw error;
      }
      return data;
    };
  }

  // Live updates over a WebSocket to the user's PlannerLive Durable Object. Reconnects with backoff
  // and reloads after a reconnect, so anything missed while offline still arrives.
  function openLiveSocket({ url, WebSocketImpl, onMessage, onReconnect, timers = globalThis }) {
    if (!WebSocketImpl || !url) return () => {};
    let socket = null;
    let closed = false;
    let attempts = 0;
    let retryTimer = null;
    let pingTimer = null;
    function connect() {
      socket = new WebSocketImpl(url);
      socket.onopen = () => {
        if (attempts > 0) onReconnect();
        attempts = 0;
        pingTimer = timers.setInterval(() => { try { socket.send("ping"); } catch { /* reconnecting */ } }, 30_000);
      };
      socket.onmessage = (event) => {
        if (event.data === "pong") return;
        try { onMessage(JSON.parse(event.data)); } catch { /* ignore malformed messages */ }
      };
      socket.onclose = () => {
        timers.clearInterval(pingTimer);
        if (closed) return;
        attempts += 1;
        retryTimer = timers.setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5)));
      };
    }
    connect();
    return () => { closed = true; timers.clearTimeout(retryTimer); timers.clearInterval(pingTimer); try { socket.close(1000); } catch { /* already closed */ } };
  }

  function createCloudBackend({ api, user, liveUrl, WebSocketImpl }) {
    return {
      mode: "cloud",
      user,
      async load() {
        const { classes, items } = await api("GET", "/planner");
        return { classes: classes.map(rowToClass), tasks: items.map(rowToTask) };
      },
      saveTask: (task) => api("PUT", `/items/${encodeURIComponent(task.id)}`, taskToRow(task)),
      setCompleted: (id, completed) => api("PATCH", `/items/${encodeURIComponent(id)}`, { completed }),
      // Soft delete on the server, so the deletion reaches every device.
      deleteTask: (id) => api("DELETE", `/items/${encodeURIComponent(id)}`),
      saveClass: (item) => api("PUT", `/classes/${encodeURIComponent(item.id)}`, classToRow(item)),
      watch({ onRow, onReload }) {
        return openLiveSocket({
          url: liveUrl, WebSocketImpl,
          onMessage: (message) => (message.reload ? onReload() : message.table && message.row && onRow(message.table, message.row)),
          onReconnect: onReload,
        });
      },
      importRows: (plan) => api("POST", "/import", plan),
    };
  }

  function liveSocketUrl(apiUrl, locationRef) {
    if (!locationRef?.href) return null;
    const url = new URL(`${apiUrl}/live`, locationRef.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.href;
  }

  function createPlannerStore({
    storage, model, defaultClasses, defaultTasks, config = {}, redirectPath = "/",
    fetchImpl = globalThis.fetch?.bind(globalThis), WebSocketImpl = globalThis.WebSocket,
    locationRef = globalThis.location, historyRef = globalThis.history, documentRef = globalThis.document,
  }) {
    const local = createLocalBackend({ storage, model, defaultClasses, defaultTasks });
    const listeners = new Set();
    const apiUrl = String(config.apiUrl || "").replace(/\/+$/, "");
    const configured = Boolean(apiUrl);
    const api = configured ? createApi({ apiUrl, fetchImpl }) : null;
    let backend = local;
    let state = { classes: [], tasks: [] };
    let unwatch = () => {};
    let authError = null;
    let providers = { password: true, google: false };

    function readDeviceExtras() {
      try { return JSON.parse(storage.getItem(DEVICE_EXTRAS_KEY)) || {}; }
      catch { return {}; }
    }
    function writeDeviceExtras(task) {
      const extras = readDeviceExtras();
      extras[task.id] = {
        reminderChoice: task.reminderChoice || "default",
        actualMinutes: Number.isInteger(task.actualMinutes) ? task.actualMinutes : null,
      };
      try { storage.setItem(DEVICE_EXTRAS_KEY, JSON.stringify(extras)); } catch { /* storage unavailable */ }
    }
    function hydrateDeviceExtras(next) {
      const extras = readDeviceExtras();
      return { ...next, tasks: next.tasks.map((task) => ({ ...task, ...(extras[task.id] || {}) })) };
    }

    function notify(reason) { listeners.forEach((listener) => listener({ reason, mode: backend.mode })); }
    function replaceState(next) { state = next; }
    function cloudFor(user) { return createCloudBackend({ api, user, liveUrl: liveSocketUrl(apiUrl, locationRef), WebSocketImpl }); }

    async function activate(nextBackend) {
      unwatch();
      backend = nextBackend;
      replaceState(hydrateDeviceExtras(await backend.load()));
      unwatch = backend.mode === "local"
        ? backend.watch((next) => { replaceState(next); notify("remote"); })
        : backend.watch({ onRow: applyRowChange, onReload: reloadCloud });
      notify("load");
    }
    async function reloadCloud() {
      if (backend.mode !== "cloud") return;
      try { replaceState(hydrateDeviceExtras(await backend.load())); notify("remote"); } catch (error) {
        if (error.status === 401) { await activate(local); notify("auth"); }
      }
    }
    function applyRowChange(table, row) {
      if (table === "items") {
        const others = state.tasks.filter((task) => task.id !== row.id);
        state = { ...state, tasks: row.deleted_at ? others : [...others, hydrateDeviceExtras({ tasks: [rowToTask(row)] }).tasks[0]] };
      } else if (table === "classes") {
        const others = state.classes.filter((item) => item.id !== row.id);
        state = { ...state, classes: [...others, rowToClass(row)] };
      }
      notify("remote");
    }
    async function mutate(apply, persist) {
      const previous = state;
      state = apply(state);
      notify("local");
      try { await persist(state); } catch (error) {
        state = previous;
        if (backend.mode === "cloud") replaceState(await backend.load().catch(() => previous));
        notify("error");
        throw error;
      }
    }

    // A failed Google sign-in comes back with ?sign_in_error=…, read once and removed from the address bar.
    function consumeSignInParams() {
      if (!locationRef?.href) return;
      const url = new URL(locationRef.href);
      const error = url.searchParams.get("sign_in_error");
      if (!error) return;
      url.searchParams.delete("sign_in_error");
      historyRef?.replaceState?.(historyRef.state, "", `${url.pathname}${url.search}${url.hash}`);
      authError = error.slice(0, 200);
    }
    async function sessionUser() {
      const session = await api("GET", "/session");
      providers = { password: true, google: Boolean(session.providers?.google) };
      return session.user || null;
    }

    async function accountCall(path, body) {
      if (!configured) throw new Error("Cloud sync isn't set up on this site yet.");
      return api("POST", path, body);
    }
    async function signedIn(user) {
      await activate(cloudFor(user));
      notify("auth");
    }

    // Another tab may have signed in or out, and a sleeping laptop may have missed live updates.
    async function refreshOnFocus() {
      if (!configured || documentRef?.hidden) return;
      try {
        const user = await sessionUser();
        if ((user?.id || null) !== (backend.user?.id || null)) { await activate(user ? cloudFor(user) : local); notify("auth"); }
        else if (backend.mode === "cloud") await reloadCloud();
      } catch { /* offline: keep what we have */ }
    }

    return {
      NO_CLASS,
      get mode() { return backend.mode; },
      get configured() { return configured; },
      get user() { return backend.user || null; },
      // Which sign-in methods the Worker has set up (Google needs its client id and secret).
      get providers() { return providers; },
      // A sign-in problem from the last redirect (a cancelled Google sign-in), shown once.
      takeAuthError() { const message = authError; authError = null; return message; },

      async init() {
        if (configured) {
          try {
            consumeSignInParams();
            const user = await sessionUser();
            await activate(user ? cloudFor(user) : local);
            documentRef?.addEventListener?.("visibilitychange", refreshOnFocus);
            return;
          } catch (error) {
            console.warn("DuckPlan is using local data:", error.message);
          }
        }
        await activate(local);
      },
      subscribe(onChange) { listeners.add(onChange); return () => listeners.delete(onChange); },
      refresh: refreshOnFocus,

      listItems(range) { return state.tasks.filter((task) => taskInRange(task, range)); },
      listClasses({ includeArchived = false } = {}) { return state.classes.filter((item) => includeArchived || !item.archived); },
      classById(id) { return state.classes.find((item) => item.id === id) || NO_CLASS; },

      upsertItem(task) {
        const next = { completed: false, ...task, id: task.id || newId(), schemaVersion: 2 };
        writeDeviceExtras(next);
        return mutate((current) => ({ ...current, tasks: [...current.tasks.filter((item) => item.id !== next.id), next] }), (current) => backend.saveTask(next, current)).then(() => next);
      },
      toggleComplete(id, completed) {
        return mutate((current) => ({ ...current, tasks: current.tasks.map((task) => (task.id === id ? { ...task, completed } : task)) }), (current) => backend.setCompleted(id, completed, current));
      },
      deleteItem(id) {
        return mutate((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== id) }), (current) => backend.deleteTask(id, current));
      },
      upsertClass(item) {
        const next = { archived: false, ...item, id: item.id || newId() };
        next.soft = softColor(next.color);
        return mutate((current) => {
          const exists = current.classes.some((existing) => existing.id === next.id);
          return { ...current, classes: exists ? current.classes.map((existing) => (existing.id === next.id ? next : existing)) : [...current.classes, next] };
        }, (current) => backend.saveClass(next, current)).then(() => next);
      },
      async resetLocalDemo() {
        if (backend.mode !== "local") return;
        replaceState(local.reset());
        notify("load");
      },

      // Accounts --------------------------------------------------------------
      // Email + password. Nothing is ever emailed: the email is just the login name. Sign-up and
      // recovery return a one-time recovery code that the person must save to reset a forgotten password.
      async signUp(email, password) {
        const { user, recoveryCode } = await accountCall("/auth/sign-up", { email, password });
        await signedIn(user);
        return recoveryCode;
      },
      async signIn(email, password) {
        await signedIn((await accountCall("/auth/sign-in", { email, password })).user);
      },
      async recoverAccount(email, recoveryCode, newPassword) {
        const { user, recoveryCode: nextCode } = await accountCall("/auth/recover", { email, recoveryCode, newPassword });
        await signedIn(user);
        return nextCode;
      },
      // Returns a recovery code only when the account didn't have one yet (a Google account's first password).
      async changePassword(currentPassword, newPassword) {
        const { recoveryCode } = await accountCall("/auth/password", { currentPassword, newPassword });
        if (backend.user) backend.user.hasPassword = true;
        return recoveryCode || null;
      },
      async newRecoveryCode(password) {
        return (await accountCall("/auth/recovery-code", { password })).recoveryCode;
      },
      async signInWithGoogle() {
        if (!configured) throw new Error("Cloud sync isn't set up on this site yet.");
        locationRef.assign(`${apiUrl}/auth/google?next=${encodeURIComponent(redirectPath)}`);
      },
      async signOut() {
        if (!configured) return;
        await api("POST", "/auth/sign-out");
        await activate(local);
        notify("auth");
      },

      // First sign-in: offer to copy this browser's local tasks into the account.
      async localImportOffer() {
        if (backend.mode !== "cloud" || storage.getItem(`${IMPORTED_KEY}:${backend.user.id}`)) return 0;
        return (await local.load()).tasks.length;
      },
      dismissLocalImport() { if (backend.user) storage.setItem(`${IMPORTED_KEY}:${backend.user.id}`, "dismissed"); },
      async importLocalTasks() {
        if (backend.mode !== "cloud") throw new Error("Sign in first.");
        const localState = await local.load();
        const plan = planLocalImport({ localTasks: localState.tasks, localClasses: localState.classes, cloudClasses: state.classes });
        await backend.importRows(plan);
        storage.setItem(`${IMPORTED_KEY}:${backend.user.id}`, new Date().toISOString());
        replaceState(await backend.load());
        notify("load");
        return plan.itemRows.length;
      },

      // Axis ------------------------------------------------------------------
      async axisStatus() {
        if (backend.mode !== "cloud") return { connected: false, lastSyncedAt: null, lastError: null };
        const status = await api("GET", "/axis");
        return { connected: Boolean(status.connected), lastSyncedAt: status.lastSyncedAt || null, lastError: status.lastError || null };
      },
      async connectAxis(icalUrl) { return this.invokeAxis({ mode: "connect", icalUrl }); },
      async syncAxisNow() { return this.invokeAxis({ mode: "sync" }); },
      async invokeAxis(body) {
        if (backend.mode !== "cloud") throw new Error("Sign in to connect Axis.");
        const result = await api("POST", "/axis", body);
        replaceState(await backend.load());
        notify("load");
        return result;
      },
      async disconnectAxis() {
        if (backend.mode !== "cloud") return;
        await api("DELETE", "/axis");
      },
    };
  }

  return { NO_CLASS, attachClassIds, classToRow, createPlannerStore, planLocalImport, rowToClass, rowToTask, softColor, taskInRange, taskToRow };
});
