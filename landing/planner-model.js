(function plannerModelFactory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DuckPlannerModel = api;
})(typeof window !== "undefined" ? window : globalThis, function buildPlannerModel() {
  const DAY_MS = 86400000;

  function pad(value) { return String(value).padStart(2, "0"); }
  function toDateKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
  function fromDateKey(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  }
  function todayKey(now = new Date()) { return toDateKey(now); }
  function addDays(value, amount) {
    const date = typeof value === "string" ? fromDateKey(value) : new Date(value);
    date.setDate(date.getDate() + amount);
    return toDateKey(date);
  }
  function startOfWeek(value) {
    const date = fromDateKey(value);
    const weekday = date.getDay() || 7;
    date.setDate(date.getDate() - weekday + 1);
    return toDateKey(date);
  }
  function addMonths(value, amount) {
    const date = fromDateKey(value);
    const originalDay = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + amount);
    date.setDate(Math.min(originalDay, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
    return toDateKey(date);
  }
  function localDateTime(dateKey, time = "00:00") {
    const date = fromDateKey(dateKey);
    if (!date) return null;
    const [hours, minutes] = (time || "00:00").split(":").map(Number);
    date.setHours(hours || 0, minutes || 0, 0, 0);
    return date;
  }
  function minutesFromTime(value) {
    if (!value) return null;
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  }
  function timeFromMinutes(value) {
    const bounded = Math.max(0, Math.min(1439, Math.round(value)));
    return `${pad(Math.floor(bounded / 60))}:${pad(bounded % 60)}`;
  }
  function scheduledParts(task) {
    if (!task.scheduledStart) return null;
    const [date, time = "09:00"] = task.scheduledStart.split("T");
    return { date, time, minutes: minutesFromTime(time) };
  }
  function scheduledEnd(task) {
    const start = scheduledParts(task);
    if (!start) return null;
    const explicit = task.scheduledEnd?.split("T")[1];
    return explicit || timeFromMinutes(start.minutes + Number(task.durationMinutes || 45));
  }
  function migrateTasks(input) {
    if (!Array.isArray(input)) return [];
    return input.filter(Boolean).map((task, index) => ({
      ...task,
      id: String(task.id || `migrated-${Date.now()}-${index}`),
      title: String(task.title || "Untitled task"),
      className: task.className || "Personal",
      priority: task.priority || "Medium",
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate || "") ? task.dueDate : "",
      dueTime: /^\d{2}:\d{2}$/.test(task.dueTime || "") ? task.dueTime : "",
      scheduledStart: task.scheduledStart || null,
      scheduledEnd: task.scheduledEnd || null,
      durationMinutes: Number(task.durationMinutes || 45),
      completed: Boolean(task.completed),
      schemaVersion: 2,
    }));
  }
  function groupForDate(tasks, selectedDate, referenceDate = todayKey()) {
    const unfinished = tasks.filter((task) => !task.completed);
    return {
      overdue: unfinished.filter((task) => task.dueDate && task.dueDate < referenceDate),
      scheduled: unfinished.filter((task) => scheduledParts(task)?.date === selectedDate)
        .sort((a, b) => scheduledParts(a).minutes - scheduledParts(b).minutes),
      unscheduled: unfinished.filter((task) => task.dueDate === selectedDate && !task.scheduledStart)
        .sort((a, b) => (a.dueTime || "99:99").localeCompare(b.dueTime || "99:99")),
      completed: tasks.filter((task) => task.completed && (task.dueDate === selectedDate || scheduledParts(task)?.date === selectedDate)),
    };
  }
  function datesForView(view, selectedDate) {
    if (view === "day") return [selectedDate];
    if (view === "week") return Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(selectedDate), index));
    const selected = fromDateKey(selectedDate);
    const first = toDateKey(new Date(selected.getFullYear(), selected.getMonth(), 1));
    const gridStart = addDays(first, -(fromDateKey(first).getDay()));
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }
  function shiftView(view, selectedDate, direction) {
    if (view === "day") return addDays(selectedDate, direction);
    if (view === "week") return addDays(selectedDate, direction * 7);
    return addMonths(selectedDate, direction);
  }

  return {
    DAY_MS,
    addDays,
    datesForView,
    fromDateKey,
    groupForDate,
    localDateTime,
    migrateTasks,
    minutesFromTime,
    scheduledEnd,
    scheduledParts,
    shiftView,
    startOfWeek,
    timeFromMinutes,
    toDateKey,
    todayKey,
  };
});
