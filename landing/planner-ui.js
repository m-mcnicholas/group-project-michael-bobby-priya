(function plannerUiFactory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DuckPlannerUI = api;
})(typeof window !== "undefined" ? window : globalThis, function buildPlannerUi() {
  function pad(value) { return String(value).padStart(2, "0"); }

  function nextSlot(current, key, dates, startHour = 7, endHour = 22) {
    if (!current || !Array.isArray(dates) || !dates.length) return current;
    const dateIndex = Math.max(0, dates.indexOf(current.date));
    const hour = Number(String(current.time || `${startHour}:00`).split(":")[0]);
    let nextDateIndex = dateIndex;
    let nextHour = hour;
    if (key === "ArrowUp") nextHour -= 1;
    else if (key === "ArrowDown") nextHour += 1;
    else if (key === "ArrowLeft") nextDateIndex -= 1;
    else if (key === "ArrowRight") nextDateIndex += 1;
    else return current;
    nextDateIndex = Math.max(0, Math.min(dates.length - 1, nextDateIndex));
    nextHour = Math.max(startHour, Math.min(endHour - 1, nextHour));
    return { date: dates[nextDateIndex], time: `${pad(nextHour)}:00` };
  }

  function timelineScrollTop({
    targetMinutes,
    startHour = 7,
    hourHeight = 62,
    headerOffset = 114,
    viewportHeight = 0,
    scrollHeight = 0,
  }) {
    const timelineMinutes = Math.max(startHour * 60, Number(targetMinutes) || startHour * 60);
    const target = headerOffset + ((timelineMinutes - startHour * 60) / 60) * hourHeight;
    const preferred = target - Math.max(56, viewportHeight * 0.3);
    return Math.max(0, Math.min(preferred, Math.max(0, scrollHeight - viewportHeight)));
  }

  function restoreDeletedTask(tasks, task, index) {
    if (!task || tasks.some((candidate) => candidate.id === task.id)) return [...tasks];
    const restored = [...tasks];
    restored.splice(Math.max(0, Math.min(Number(index) || 0, restored.length)), 0, task);
    return restored;
  }

  function snapCalendarDrop({
    date,
    pointerY,
    columnTop,
    hourHeight = 62,
    startHour = 7,
    endHour = 22,
    snapMinutes = 15,
    durationMinutes = 45,
  }) {
    const startMinutes = startHour * 60;
    const endMinutes = endHour * 60;
    const duration = Math.max(snapMinutes, Number(durationMinutes) || 45);
    const rawMinutes = startMinutes + ((Number(pointerY) - Number(columnTop)) / hourHeight) * 60;
    const snapped = Math.round(rawMinutes / snapMinutes) * snapMinutes;
    const latestStart = Math.max(startMinutes, endMinutes - duration);
    const minutes = Math.max(startMinutes, Math.min(latestStart, snapped));
    return { date, minutes, time: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}` };
  }

  return { nextSlot, restoreDeletedTask, snapCalendarDrop, timelineScrollTop };
});
