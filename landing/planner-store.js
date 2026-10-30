(function plannerStoreFactory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DuckPlannerStore = api;
})(typeof window !== "undefined" ? window : globalThis, function buildPlannerStore() {
  // The only code that reads or writes planner data. Signed in with Supabase configured, data lives in
  // the cloud; otherwise it stays in localStorage so the demo keeps working.
  const TASKS_KEY = "duckplan-demo-tasks-v1";
  const CLASSES_KEY = "duckplan-demo-classes-v1";
  const IMPORTED_KEY = "duckplan-local-import-v1";
  const SUPABASE_SCRIPT = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
  const PAGE_SIZE = 1000;
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

  function createCloudBackend({ client, user }) {
    async function fetchAll(table, filter) {
      const rows = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await filter(client.from(table).select("*")).order("created_at").range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < PAGE_SIZE) return rows;
      }
    }
    async function check(promise) { const { error } = await promise; if (error) throw error; }
    return {
      mode: "cloud",
      user,
      async load() {
        const [classRows, itemRows] = await Promise.all([fetchAll("classes", (query) => query), fetchAll("items", (query) => query.is("deleted_at", null))]);
        return { classes: classRows.map(rowToClass), tasks: itemRows.map(rowToTask) };
      },
      saveTask: (task) => check(client.from("items").upsert(taskToRow(task))),
      setCompleted: (id, completed) => check(client.from("items").update({ completed }).eq("id", id)),
      // Soft delete, so the deletion reaches every device.
      deleteTask: (id) => check(client.from("items").update({ deleted_at: new Date().toISOString() }).eq("id", id)),
      saveClass: (item) => check(client.from("classes").upsert(classToRow(item))),
      watch(onRowChange) {
        const channel = client.channel(`planner-${user.id}`);
        ["items", "classes"].forEach((table) => channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `user_id=eq.${user.id}` }, (payload) => onRowChange(table, payload)));
        channel.subscribe();
        return () => client.removeChannel(channel);
      },
      importRows: async ({ classRows, itemRows }) => {
        if (classRows.length) await check(client.from("classes").insert(classRows));
        for (let index = 0; index < itemRows.length; index += 200) await check(client.from("items").insert(itemRows.slice(index, index + 200)));
      },
    };
  }

  function loadSupabaseScript(documentRef) {
    if (globalThis.supabase?.createClient) return Promise.resolve(globalThis.supabase);
    return new Promise((resolve, reject) => {
      const script = documentRef.createElement("script");
      script.src = SUPABASE_SCRIPT;
      script.onload = () => resolve(globalThis.supabase);
      script.onerror = () => reject(new Error("Couldn't load the Supabase library."));
      documentRef.head.append(script);
    });
  }

  async function functionErrorMessage(error) {
    try { const body = await error.context.json(); if (body?.error) return body.error; } catch { /* not a JSON response */ }
    return error.message || "Something went wrong.";
  }

  function createPlannerStore({ storage, model, defaultClasses, defaultTasks, config = {}, createClient, documentRef = globalThis.document, redirectTo }) {
    const local = createLocalBackend({ storage, model, defaultClasses, defaultTasks });
    const listeners = new Set();
    let backend = local;
    let client = null;
    let state = { classes: [], tasks: [] };
    let unwatch = () => {};

    const configured = Boolean(config.url && config.anonKey);
    function notify(reason) { listeners.forEach((listener) => listener({ reason, mode: backend.mode })); }
    function replaceState(next) { state = next; }

    async function activate(nextBackend) {
      unwatch();
      backend = nextBackend;
      replaceState(await backend.load());
      unwatch = backend.mode === "local"
        ? backend.watch((next) => { replaceState(next); notify("remote"); })
        : backend.watch(applyRowChange);
      notify("load");
    }
    function applyRowChange(table, payload) {
      const row = payload.eventType === "DELETE" ? null : payload.new;
      const id = row?.id || payload.old?.id;
      if (table === "items") {
        const others = state.tasks.filter((task) => task.id !== id);
        state = { ...state, tasks: row && !row.deleted_at ? [...others, rowToTask(row)] : others };
      } else {
        const others = state.classes.filter((item) => item.id !== id);
        state = { ...state, classes: row ? [...others, rowToClass(row)] : others };
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
    async function userFromSession() {
      const { data } = await client.auth.getSession();
      return data.session?.user || null;
    }

    return {
      NO_CLASS,
      get mode() { return backend.mode; },
      get configured() { return configured; },
      get user() { return backend.user || null; },

      async init() {
        if (configured) {
          try {
            const make = createClient || (await loadSupabaseScript(documentRef)).createClient;
            // PKCE returns sign-in codes in the query string, which survives the app rewriting the #view hash.
            client = make(config.url, config.anonKey, { auth: { flowType: "pkce" } });
            const user = await userFromSession();
            await activate(user ? createCloudBackend({ client, user }) : local);
            client.auth.onAuthStateChange((event, session) => {
              const nextUser = session?.user || null;
              if ((nextUser?.id || null) === (backend.user?.id || null)) return;
              // Supabase warns against awaiting other calls inside this callback.
              setTimeout(() => activate(nextUser ? createCloudBackend({ client, user: nextUser }) : local).then(() => notify("auth")), 0);
            });
            return;
          } catch (error) {
            console.warn("DuckPlan is using local data:", error.message);
          }
        }
        await activate(local);
      },
      subscribe(onChange) { listeners.add(onChange); return () => listeners.delete(onChange); },

      listItems(range) { return state.tasks.filter((task) => taskInRange(task, range)); },
      listClasses({ includeArchived = false } = {}) { return state.classes.filter((item) => includeArchived || !item.archived); },
      classById(id) { return state.classes.find((item) => item.id === id) || NO_CLASS; },

      upsertItem(task) {
        const next = { completed: false, ...task, id: task.id || newId(), schemaVersion: 2 };
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
      async signInWithEmail(email) {
        if (!client) throw new Error("Cloud sync isn't set up on this site yet.");
        const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
      },
      async signInWithGoogle() {
        if (!client) throw new Error("Cloud sync isn't set up on this site yet.");
        const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
        if (error) throw error;
      },
      async signOut() { if (client) await client.auth.signOut(); },

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
        const { data, error } = await client.rpc("axis_connection_status");
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        return { connected: Boolean(row?.connected), lastSyncedAt: row?.last_synced_at || null, lastError: row?.last_error || null };
      },
      async connectAxis(icalUrl) { return this.invokeAxis({ mode: "connect", icalUrl }); },
      async syncAxisNow() { return this.invokeAxis({ mode: "sync" }); },
      async invokeAxis(body) {
        if (backend.mode !== "cloud") throw new Error("Sign in to connect Axis.");
        const { data, error } = await client.functions.invoke("axis-sync", { body });
        if (error) throw new Error(await functionErrorMessage(error));
        replaceState(await backend.load());
        notify("load");
        return data;
      },
      async disconnectAxis() {
        if (backend.mode !== "cloud") return;
        const { error } = await client.rpc("disconnect_axis");
        if (error) throw error;
      },
    };
  }

  return { NO_CLASS, attachClassIds, classToRow, createPlannerStore, planLocalImport, rowToClass, rowToTask, softColor, taskInRange, taskToRow };
});
