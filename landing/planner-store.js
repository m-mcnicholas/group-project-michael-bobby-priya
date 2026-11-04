(function plannerStoreFactory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DuckPlannerStore = api;
})(typeof window !== "undefined" ? window : globalThis, function buildPlannerStore() {
  // The only code that reads or writes planner data. Everything lives in this browser's localStorage.
  const TASKS_KEY = "duckplan-demo-tasks-v1";
  const CLASSES_KEY = "duckplan-demo-classes-v1";
  const NO_CLASS = { id: null, name: "No class", color: "#8f8a7d", soft: "#efede7", code: "•", teacher: "", period: "", archived: false };

  function newId() { return globalThis.crypto.randomUUID(); }
  function softColor(hex) {
    const match = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!match) return NO_CLASS.soft;
    const value = parseInt(match[1], 16);
    const mix = (channel) => Math.round(channel + (255 - channel) * 0.84).toString(16).padStart(2, "0");
    return `#${mix(value >> 16)}${mix((value >> 8) & 255)}${mix(value & 255)}`;
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

  function createPlannerStore({ storage, model, defaultClasses, defaultTasks }) {
    const listeners = new Set();
    let state = { classes: [], tasks: [] };
    let unwatch = () => {};

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
    const saveTasks = (current) => write(TASKS_KEY, current.tasks);
    const saveClasses = (current) => write(CLASSES_KEY, current.classes.map(({ soft, ...rest }) => rest));
    function notify(reason) { listeners.forEach((listener) => listener({ reason })); }
    async function mutate(apply, persist) {
      state = apply(state);
      persist(state);
      notify("local");
    }

    return {
      NO_CLASS,

      async init() {
        state = load();
        unwatch();
        // Another tab edited the planner.
        if (typeof window !== "undefined") {
          const listener = (event) => { if (event.key === TASKS_KEY || event.key === CLASSES_KEY) { state = load(); notify("remote"); } };
          window.addEventListener("storage", listener);
          unwatch = () => window.removeEventListener("storage", listener);
        }
        notify("load");
      },
      subscribe(onChange) { listeners.add(onChange); return () => listeners.delete(onChange); },

      listItems(range) { return state.tasks.filter((task) => taskInRange(task, range)); },
      listClasses({ includeArchived = false } = {}) { return state.classes.filter((item) => includeArchived || !item.archived); },
      classById(id) { return state.classes.find((item) => item.id === id) || NO_CLASS; },

      upsertItem(task) {
        const next = { completed: false, ...task, id: task.id || newId(), schemaVersion: 2 };
        return mutate((current) => ({ ...current, tasks: [...current.tasks.filter((item) => item.id !== next.id), next] }), saveTasks).then(() => next);
      },
      toggleComplete(id, completed) {
        return mutate((current) => ({ ...current, tasks: current.tasks.map((task) => (task.id === id ? { ...task, completed } : task)) }), saveTasks);
      },
      deleteItem(id) {
        return mutate((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== id) }), saveTasks);
      },
      upsertClass(item) {
        const next = { archived: false, ...item, id: item.id || newId() };
        next.soft = softColor(next.color);
        return mutate((current) => {
          const exists = current.classes.some((existing) => existing.id === next.id);
          return { ...current, classes: exists ? current.classes.map((existing) => (existing.id === next.id ? next : existing)) : [...current.classes, next] };
        }, saveClasses).then(() => next);
      },
      async resetLocalDemo() {
        storage.removeItem(TASKS_KEY); storage.removeItem(CLASSES_KEY);
        state = load();
        notify("load");
      },
    };
  }

  return { NO_CLASS, attachClassIds, createPlannerStore, softColor, taskInRange };
});
