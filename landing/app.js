const Model = window.DuckPlannerModel;
const DEFAULT_CLASSES = [
  { id: "calculus", name: "Calculus", color: "#538fc5", code: "M", teacher: "Ms. Nguyen", period: "Period 2" },
  { id: "english", name: "English", color: "#d96f63", code: "E", teacher: "Mr. Ramirez", period: "Period 4" },
  { id: "physics", name: "Physics", color: "#7d6fbd", code: "P", teacher: "Dr. Shah", period: "Period 5" },
  { id: "computer-science", name: "Computer Science", color: "#3e946d", code: "CS", teacher: "Ms. Chen", period: "Period 7" },
  { id: "personal", name: "Personal", color: "#c48b34", code: "★", teacher: "Personal", period: "Anytime" },
];

const nowKey = () => Model.todayKey();
const relativeDate = (amount) => Model.addDays(nowKey(), amount);
const schedule = (dayOffset, time) => `${relativeDate(dayOffset)}T${time}`;
const defaultTasks = () => [
  { id: "calculus-practice", title: "Finish calculus practice set", classId: "calculus", dueDate: relativeDate(0), dueTime: "17:00", scheduledStart: schedule(0, "15:30"), durationMinutes: 60, priority: "High", completed: false },
  { id: "english-response", title: "Submit reading response", classId: "english", dueDate: relativeDate(0), dueTime: "20:00", scheduledStart: null, durationMinutes: 45, priority: "Medium", completed: false },
  { id: "physics-notes", title: "Organize lab notes", classId: "physics", dueDate: relativeDate(1), dueTime: "09:00", scheduledStart: schedule(1, "07:45"), durationMinutes: 45, priority: "Medium", completed: false },
  { id: "cs-wireframe", title: "Review app wireframe", classId: "computer-science", dueDate: relativeDate(2), dueTime: "14:15", scheduledStart: schedule(1, "16:00"), durationMinutes: 60, priority: "Low", completed: false },
  { id: "english-vocab", title: "Study vocabulary cards", classId: "english", dueDate: relativeDate(3), dueTime: "16:00", scheduledStart: null, durationMinutes: 30, priority: "Medium", completed: false },
  { id: "physics-quiz", title: "Complete motion quiz", classId: "physics", dueDate: relativeDate(-1), dueTime: "12:30", scheduledStart: null, durationMinutes: 45, priority: "High", completed: false },
  { id: "backpack", title: "Pack materials for Monday", classId: "personal", dueDate: relativeDate(0), dueTime: "20:00", scheduledStart: null, durationMinutes: 30, priority: "Low", completed: true },
];

const store = window.DuckPlannerStore.createPlannerStore({
  storage: localStorage, model: Model, defaultClasses: () => DEFAULT_CLASSES, defaultTasks,
  config: window.DUCKPLAN_SUPABASE || {}, redirectTo: `${location.origin}${location.pathname}`,
});
let tasks = [];
let selectedDate = nowKey();
let calendarView = window.matchMedia("(max-width: 760px)").matches ? "day" : "week";
let currentFilter = "all";
let searchTerm = "";
let selectedTaskId = null;
let editingTaskId = null;
let editingClassId = null;
let axisStatus = { connected: false, lastSyncedAt: null, lastError: null };
let localImportCount = 0;
let collapsed = { overdue: false, completed: false };
let toastTimer;
let observedToday = nowKey();

const els = {
  navItems: [...document.querySelectorAll("[data-view]")],
  views: [...document.querySelectorAll(".view")],
  pageTitle: document.querySelector("#page-title"), pageEyebrow: document.querySelector("#page-eyebrow"),
  taskCount: document.querySelector("#task-count"), search: document.querySelector("#global-search"),
  allList: document.querySelector("#all-task-list"), taskEmpty: document.querySelector("#task-empty"),
  classGrid: document.querySelector("#class-grid"), calendar: document.querySelector("#planner-calendar"),
  calendarRange: document.querySelector("#calendar-range"), modal: document.querySelector("#task-modal"),
  form: document.querySelector("#task-form"), modalTitle: document.querySelector("#modal-title"),
  modalKicker: document.querySelector("#modal-kicker"), deleteTask: document.querySelector("#delete-task"),
  saveTask: document.querySelector("#save-task"), toast: document.querySelector("#toast"),
  classModal: document.querySelector("#class-modal"), classForm: document.querySelector("#class-form"),
  classModalTitle: document.querySelector("#class-modal-title"), archiveClass: document.querySelector("#archive-class"),
  accountSettings: document.querySelector("#account-settings"), axisSettings: document.querySelector("#axis-settings"),
  syncCopy: document.querySelector(".sync-copy"), syncInfo: document.querySelector("#sync-info"), resetDemo: document.querySelector("#reset-demo"),
  selectedDayLabel: document.querySelector("#selected-day-label"), selectedDateHeading: document.querySelector("#selected-date-heading"),
  dailyProgressCopy: document.querySelector("#daily-progress-copy"), completionPercent: document.querySelector("#completion-percent"),
  completionRing: document.querySelector("#completion-ring"), dailyEmpty: document.querySelector("#daily-empty"),
  dailyPanelDate: document.querySelector("#daily-panel-date"), dailyPanelProgress: document.querySelector("#daily-panel-progress"),
  lists: {
    overdue: document.querySelector("#overdue-task-list"), scheduled: document.querySelector("#scheduled-task-list"),
    unscheduled: document.querySelector("#unscheduled-task-list"), completed: document.querySelector("#completed-task-list"),
  },
  counts: {
    overdue: document.querySelector("#overdue-count"), scheduled: document.querySelector("#scheduled-count"),
    unscheduled: document.querySelector("#unscheduled-count"), completed: document.querySelector("#completed-count"),
  },
};

const sidebarToggles = [...document.querySelectorAll("[data-open-navigation]")];
const sidebarScrim = document.querySelector(".sidebar-scrim");
const sidebar = document.querySelector(".sidebar");
const workspace = document.querySelector(".workspace");

function setSidebar(open) {
  const wasOpen = document.body.classList.contains("sidebar-open");
  document.body.classList.toggle("sidebar-open", open);
  sidebar.inert = !open;
  sidebar.setAttribute("aria-hidden", String(!open));
  workspace.inert = open;
  sidebarScrim.hidden = !open;
  sidebarToggles.forEach((toggle) => toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation"));
  sidebarScrim.tabIndex = open ? 0 : -1;
  if (open) document.querySelector(".sidebar .nav-item.active")?.focus();
  else if (wasOpen) sidebarToggles.find((toggle) => toggle.getClientRects().length)?.focus();
  requestAnimationFrame(() => setupFurMaterial());
}

function classInfo(task) { return store.classById(task.classId); }
function reportError(error) { console.error(error); showToast(error.message || "Something went wrong. Try again."); }
function safeText(value) { const span = document.createElement("span"); span.textContent = value ?? ""; return span.innerHTML; }
function dateObject(value) { return Model.fromDateKey(value); }
function formatLongDate(value) { return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(dateObject(value)); }
function formatShortDate(value) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(dateObject(value)); }
function formatTime(value) {
  if (!value) return "Anytime";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2020, 0, 1, hour, minute));
}
function dayRelationship(value) {
  if (value === nowKey()) return "Today";
  if (value === Model.addDays(nowKey(), 1)) return "Tomorrow";
  if (value === Model.addDays(nowKey(), -1)) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(dateObject(value));
}
function taskScheduleText(task) {
  const parts = Model.scheduledParts(task);
  return parts ? `${formatTime(parts.time)}–${formatTime(Model.scheduledEnd(task))}` : "Not scheduled";
}

function taskCardMarkup(task, mode = "daily") {
  const info = classInfo(task);
  const scheduled = Model.scheduledParts(task);
  const due = task.dueDate ? `${formatShortDate(task.dueDate)}${task.dueTime ? ` · ${formatTime(task.dueTime)}` : ""}` : "No deadline";
  const leading = mode === "scheduled" ? `<span class="task-time">${formatTime(scheduled.time)}</span>` : "";
  return `<article class="daily-task-card ${task.completed ? "completed" : ""} ${task.id === selectedTaskId ? "selected" : ""}" style="--course-color:${info.color};--course-soft:${info.soft}" data-task-card="${task.id}">
    ${leading}<input class="task-check" type="checkbox" data-task-id="${task.id}" ${task.completed ? "checked" : ""} aria-label="Mark ${safeText(task.title)} complete" />
    <button class="task-select" type="button" data-select-task="${task.id}"><span class="task-title">${safeText(task.title)}</span><span class="task-meta"><span class="course-dot"></span>${safeText(info.name)} · ${mode === "scheduled" ? taskScheduleText(task) : `Due ${due}`}${task.priority === "High" ? '<span class="priority-tag">High</span>' : ""}</span></button>
    <button class="task-edit" type="button" data-edit-task="${task.id}" aria-label="Edit ${safeText(task.title)}">•••</button>
  </article>`;
}

function renderDailyPlan() {
  const groups = Model.groupForDate(tasks, selectedDate, nowKey());
  const todayItems = [...groups.scheduled, ...groups.unscheduled, ...groups.completed];
  const completed = todayItems.filter((task) => task.completed).length;
  const percent = todayItems.length ? Math.round((completed / todayItems.length) * 100) : 0;
  els.selectedDayLabel.textContent = dayRelationship(selectedDate);
  els.selectedDateHeading.textContent = formatLongDate(selectedDate);
  els.dailyProgressCopy.textContent = todayItems.length ? `${completed} of ${todayItems.length} tasks completed` : "No tasks planned yet";
  els.dailyPanelDate.textContent = formatLongDate(selectedDate);
  els.dailyPanelProgress.textContent = todayItems.length ? `${completed} of ${todayItems.length} completed` : "No tasks planned yet";
  els.completionPercent.textContent = `${percent}%`;
  els.completionRing.style.setProperty("--completion", `${percent * 3.6}deg`);
  for (const name of Object.keys(els.lists)) {
    els.counts[name].textContent = groups[name].length;
    els.lists[name].innerHTML = groups[name].map((task) => taskCardMarkup(task, name === "scheduled" ? "scheduled" : "daily")).join("");
    els.lists[name].hidden = collapsed[name] || groups[name].length === 0;
    els.lists[name].closest(".task-section").classList.toggle("is-empty", groups[name].length === 0);
  }
  els.dailyEmpty.hidden = groups.overdue.length + todayItems.length > 0;
  document.querySelectorAll("[data-collapse]").forEach((button) => {
    button.setAttribute("aria-expanded", String(!collapsed[button.dataset.collapse]));
    button.closest(".task-section").classList.toggle("collapsed", collapsed[button.dataset.collapse]);
  });
}

function allTaskMarkup(task) {
  const info = classInfo(task);
  const scheduled = Model.scheduledParts(task);
  return `<article class="all-task-row ${task.completed ? "completed" : ""}" style="--course-color:${info.color};--course-soft:${info.soft}">
    <input class="task-check" type="checkbox" data-task-id="${task.id}" ${task.completed ? "checked" : ""} aria-label="Mark ${safeText(task.title)} complete" />
    <button class="task-select" type="button" data-select-task="${task.id}"><span class="task-title">${safeText(task.title)}</span><span class="task-meta"><span class="course-dot"></span>${safeText(info.name)}${scheduled ? ` · Work ${formatShortDate(scheduled.date)} at ${formatTime(scheduled.time)}` : " · Unscheduled"}${task.axisMissing ? " · No longer in Axis" : ""}</span></button>
    <span class="task-due"><strong>${task.dueDate ? formatShortDate(task.dueDate) : "No due date"}</strong><small>${formatTime(task.dueTime)}</small></span>
    <button class="task-edit" type="button" data-edit-task="${task.id}" aria-label="Edit ${safeText(task.title)}">•••</button>
  </article>`;
}
function renderAllTasks() {
  const sorted = [...tasks].sort((a, b) => `${a.dueDate || "9999"}${a.dueTime || "99"}`.localeCompare(`${b.dueDate || "9999"}${b.dueTime || "99"}`));
  const filtered = sorted.filter((task) => {
    if (searchTerm && !`${task.title} ${classInfo(task).name}`.toLowerCase().includes(searchTerm)) return false;
    if (currentFilter === "today") return task.dueDate === nowKey() && !task.completed;
    if (currentFilter === "upcoming") return task.dueDate > nowKey() && !task.completed;
    if (currentFilter === "done") return task.completed;
    return true;
  });
  els.allList.innerHTML = filtered.map(allTaskMarkup).join("");
  els.taskEmpty.hidden = filtered.length > 0;
  els.taskCount.textContent = tasks.filter((task) => !task.completed).length;
}

function renderClasses() {
  if (window.DuckFur) els.classGrid.querySelectorAll("button").forEach((button) => window.DuckFur.unmount(button));
  els.classGrid.innerHTML = store.listClasses().map((info) => {
    const classTasks = tasks.filter((task) => task.classId === info.id);
    const open = classTasks.filter((task) => !task.completed).length;
    const details = [info.teacher, info.period].filter(Boolean).join(" · ") || (info.axisKey ? "From Axis · add teacher and period" : "Add teacher and period");
    return `<article class="class-card" style="--course-color:${info.color};--course-soft:${info.soft}"><div class="class-card-head"><span class="class-card-icon">${safeText(info.code)}</span><button class="class-menu" type="button" data-edit-class="${info.id}" aria-label="Edit ${safeText(info.name)}">•••</button></div><h2>${safeText(info.name)}</h2><p>${safeText(details)}</p><div class="class-stats"><div><strong>${open}</strong><span>Open tasks</span></div><div><strong>${classTasks.length}</strong><span>Total items</span></div></div></article>`;
  }).join("");
}
function renderClassOptions() {
  const select = els.form.elements.classId;
  const current = select.value;
  select.innerHTML = `${store.listClasses().map((info) => `<option value="${info.id}">${safeText(info.name)}</option>`).join("")}<option value="">No class</option>`;
  select.value = current;
}

function relativeSyncTime(value) {
  if (!value) return "Not synced yet";
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes} min ago`;
  return `Synced ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value))}`;
}
function replaceSettings(container, markup) {
  if (window.DuckFur) container.querySelectorAll("button").forEach((button) => window.DuckFur.unmount(button));
  container.innerHTML = markup;
}
function renderAccount() {
  const user = store.user;
  let body;
  if (!store.configured) body = `<div><h2>Account</h2><p>Cloud sync isn't set up on this copy of DuckPlan yet, so your tasks are saved in this browser only.</p></div>`;
  else if (!user) body = `<div><h2>Account</h2><p>Sign in to keep your planner in sync across devices. We'll email you a sign-in link.</p></div><form class="settings-form" id="sign-in-form"><label><span class="sr-only">Email address</span><input name="email" type="email" required autocomplete="email" placeholder="you@school.org" /></label><button type="submit" class="secondary-button">Email me a link</button><button type="button" class="secondary-button" id="google-sign-in">Use Google</button></form>`;
  else body = `<div><h2>Account</h2><p>Signed in as ${safeText(user.email || "your account")}. Your planner syncs to every device you sign in on.</p></div><div class="settings-actions"><button type="button" class="secondary-button" id="sign-out">Sign out</button></div>`;
  const offer = localImportCount ? `<div class="settings-row" id="local-import-row"><div><h2>Bring your local tasks</h2><p>This browser has ${localImportCount} task${localImportCount === 1 ? "" : "s"} from before you signed in. Copy them into your account?</p></div><div class="settings-actions"><button type="button" class="secondary-button" id="import-local">Import tasks</button><button type="button" class="secondary-button" id="dismiss-import">Not now</button></div></div>` : "";
  replaceSettings(els.accountSettings, `<div class="settings-row">${body}</div>${offer}`);
  els.resetDemo.closest(".settings-row").hidden = store.mode === "cloud";
}
function renderAxis() {
  let body;
  if (store.mode !== "cloud") body = `<div><h2>Axis connection</h2><p>Sign in, then paste your Axis calendar feed link to import classes and assignments.</p></div><button type="button" class="secondary-button" id="connect-axis">Sign in first</button>`;
  else if (!axisStatus.connected) body = `<div><h2>Axis connection</h2><p>In Axis, open your calendar's subscribe option and copy the feed link (it ends in <code>iCal.aspx</code>). Treat it like a password.</p></div><form class="settings-form" id="axis-form"><label><span class="sr-only">Axis feed link</span><input name="icalUrl" type="url" required autocomplete="off" spellcheck="false" placeholder="webcal://…myschoolapp.com/podium/feed/iCal.aspx?z=…" /></label><button type="submit" class="secondary-button">Connect Axis</button></form>`;
  else body = `<div><h2>Axis connection</h2><p>${safeText(relativeSyncTime(axisStatus.lastSyncedAt))}. DuckPlan re-syncs every few hours.${axisStatus.lastError ? ` Last problem: ${safeText(axisStatus.lastError)}` : ""}</p></div><div class="settings-actions"><button type="button" class="secondary-button" id="axis-sync-now">Sync now</button><button type="button" class="secondary-button" id="axis-disconnect">Disconnect</button></div>`;
  replaceSettings(els.axisSettings, `<div class="settings-row">${body}</div>`);
  els.syncCopy.textContent = store.mode !== "cloud" ? "Not signed in" : axisStatus.connected ? (axisStatus.lastError ? "Needs attention" : relativeSyncTime(axisStatus.lastSyncedAt)) : "Not connected";
  els.syncInfo.setAttribute("aria-label", axisStatus.connected ? "Sync Axis now" : "Set up Axis sync");
}
async function refreshAccountState() {
  try {
    [axisStatus, localImportCount] = await Promise.all([store.axisStatus(), store.localImportOffer()]);
  } catch (error) { console.error(error); }
  renderAccount(); renderAxis(); requestAnimationFrame(() => setupFurMaterial());
}

function rangeLabel(dates) {
  if (calendarView === "month") return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(dateObject(selectedDate));
  if (dates.length === 1) return formatLongDate(dates[0]);
  const first = formatShortDate(dates[0]);
  const lastDate = dateObject(dates.at(-1));
  const last = new Intl.DateTimeFormat(undefined, { month: dateObject(dates[0]).getMonth() === lastDate.getMonth() ? undefined : "short", day: "numeric", year: dates[0].slice(0, 4) === dates.at(-1).slice(0, 4) ? undefined : "numeric" }).format(lastDate);
  return `${first}–${last}`;
}
function deadlineChips(date) {
  return tasks.filter((task) => task.dueDate === date && !task.completed).slice(0, 3).map((task) => {
    const info = classInfo(task);
    return `<button type="button" class="deadline-chip ${task.id === selectedTaskId ? "selected" : ""}" style="--course-color:${info.color}" data-select-task="${task.id}" data-edit-task="${task.id}"><span></span>${safeText(task.title)}</button>`;
  }).join("");
}
function layoutEvents(dayTasks) {
  const sorted = dayTasks.map((task) => {
    const start = Model.scheduledParts(task).minutes;
    return { task, start, end: start + Number(task.durationMinutes || 45), lane: 0, lanes: 1 };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  const active = [];
  for (const event of sorted) {
    for (let index = active.length - 1; index >= 0; index -= 1) if (active[index].end <= event.start) active.splice(index, 1);
    const used = new Set(active.map((item) => item.lane));
    while (used.has(event.lane)) event.lane += 1;
    active.push(event);
    const count = Math.max(...active.map((item) => item.lane)) + 1;
    active.forEach((item) => { item.lanes = Math.max(item.lanes, count); });
  }
  return sorted;
}
function renderTimeline(dates) {
  const startHour = 7;
  const endHour = 22;
  const hourHeight = 62;
  const headers = dates.map((date) => `<button type="button" class="calendar-date-button ${date === selectedDate ? "selected" : ""} ${date === nowKey() ? "today" : ""}" data-date="${date}"><span>${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(dateObject(date))}</span><strong>${dateObject(date).getDate()}</strong></button>`).join("");
  const deadlineRows = dates.map((date) => `<div class="deadline-cell">${deadlineChips(date)}</div>`).join("");
  const timeLabels = Array.from({ length: endHour - startHour }, (_, index) => `<span>${formatTime(`${String(startHour + index).padStart(2, "0")}:00`)}</span>`).join("");
  const columns = dates.map((date) => {
    const scheduled = tasks.filter((task) => Model.scheduledParts(task)?.date === date && !task.completed);
    const events = layoutEvents(scheduled).map(({ task, start, end, lane, lanes }) => {
      const info = classInfo(task);
      const top = ((start - startHour * 60) / 60) * hourHeight;
      const height = Math.max(30, ((end - start) / 60) * hourHeight);
      return `<button type="button" class="calendar-event-block ${task.id === selectedTaskId ? "selected" : ""}" data-select-task="${task.id}" data-edit-task="${task.id}" style="--course-color:${info.color};--course-soft:${info.soft};top:${top}px;height:${height}px;left:calc(${(lane / lanes) * 100}% + 3px);width:calc(${100 / lanes}% - 6px)"><strong>${safeText(task.title)}</strong><small>${formatTime(Model.scheduledParts(task).time)}</small></button>`;
    }).join("");
    const slots = Array.from({ length: endHour - startHour }, (_, index) => `<button type="button" class="calendar-slot" data-slot-date="${date}" data-slot-time="${String(startHour + index).padStart(2, "0")}:00" aria-label="Plan work on ${formatLongDate(date)} at ${formatTime(`${String(startHour + index).padStart(2, "0")}:00`)}"></button>`).join("");
    return `<div class="timeline-column ${date === selectedDate ? "selected-day" : ""}" style="--timeline-height:${(endHour - startHour) * hourHeight}px">${slots}${events}</div>`;
  }).join("");
  return `<div class="timeline-calendar" style="--day-count:${dates.length};--hour-height:${hourHeight}px"><div class="timeline-corner">Due</div><div class="timeline-days">${headers}</div><div class="timeline-deadline-label">Deadlines</div><div class="timeline-deadlines">${deadlineRows}</div><div class="time-axis">${timeLabels}</div><div class="timeline-columns">${columns}</div></div>`;
}
function renderMonth(dates) {
  const currentMonth = dateObject(selectedDate).getMonth();
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<span>${day}</span>`).join("");
  const cells = dates.map((date) => {
    const dayTasks = tasks.filter((task) => task.dueDate === date || Model.scheduledParts(task)?.date === date);
    const dots = dayTasks.slice(0, 4).map((task) => `<i style="--course-color:${(classInfo(task)).color}"></i>`).join("");
    return `<button type="button" class="month-day ${date === selectedDate ? "selected" : ""} ${date === nowKey() ? "today" : ""} ${dateObject(date).getMonth() !== currentMonth ? "outside" : ""}" data-date="${date}"><strong>${dateObject(date).getDate()}</strong><span class="month-dots">${dots}</span><small>${dayTasks.length ? `${dayTasks.length} item${dayTasks.length === 1 ? "" : "s"}` : ""}</small></button>`;
  }).join("");
  return `<div class="month-calendar"><div class="month-weekdays">${weekdays}</div><div class="month-grid">${cells}</div></div>`;
}
function renderCalendar() {
  const dates = Model.datesForView(calendarView, selectedDate);
  els.calendarRange.textContent = rangeLabel(dates);
  els.calendar.className = `planner-calendar ${calendarView}-view`;
  els.calendar.innerHTML = calendarView === "month" ? renderMonth(dates) : renderTimeline(dates);
  document.querySelectorAll("[data-calendar-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.calendarView === calendarView)));
}

function furLabelForButton(button) {
  if (button.matches(".profile-card")) return button.querySelector("strong")?.textContent.trim() || "Profile";
  const clone = button.cloneNode(true);
  clone.querySelectorAll(".notification-dot, .nav-count, small").forEach((element) => element.remove());
  return clone.textContent.replace(/\s+/g, " ").trim() || button.getAttribute("aria-label") || "Button";
}
function shouldUseFurButton(button) {
  if (button.matches("[data-fur-button]")) return true;
  if (button.matches(".sidebar-scrim,.calendar-slot,.calendar-date-button,.calendar-event-block,.deadline-chip,.month-day,.task-select,.task-section-heading")) return false;
  const text = button.textContent.replace(/\s+/g, " ").trim();
  return Boolean(text || button.getAttribute("aria-label"));
}
function setupFurMaterial(root = document) {
  if (!window.DuckFur) return;
  const openDialog = document.querySelector("dialog[open]");
  const drawerOpen = document.body.classList.contains("sidebar-open");
  root.querySelectorAll("button, a.secondary-button, a.nav-open-button").forEach((button) => {
    const mount = shouldUseFurButton(button) && button.getClientRects().length && (!openDialog || openDialog.contains(button));
    const activeSurface = (!drawerOpen || sidebar.contains(button)) && (!openDialog || openDialog.contains(button));
    if (!mount || !activeSurface || button.closest('[aria-hidden="true"]')) { window.DuckFur.unmount(button); return; }
    window.DuckFur.mount(button, { quality: "medium", density: 1, length: 5.2, stiffness: 62, damping: 22, radius: 12.8, pressRadius: 38.4, recoveryDelay: 280, pressDepth: 0.78, compression: 0.92, splay: 0.76, transitionWidth: 0.36, labelScale: 2, labelSharpness: 1.15, labelLengthScale: 0.8, labelWidthScale: 0.9, labelOrientationVariance: 0.06, labelDensity: 2.4, glyphTransition: 0.55, glyphGuardWidth: 1.4, glyphGuardStrength: 0.9, motionGuardStart: 0.12, motionGuardEnd: 0.58, boundaryLabelWidthScale: 0.72, boundaryLabelLeanScale: 0.62, fragmentGlyphMask: true, silhouette: true, label: furLabelForButton(button) });
  });
}
function renderAll() { tasks = store.listItems(); renderDailyPlan(); renderAllTasks(); renderClasses(); renderClassOptions(); renderCalendar(); requestAnimationFrame(() => setupFurMaterial()); }

function setView(name) {
  const normalized = ["today", "calendar"].includes(name) ? "home" : name;
  const next = document.querySelector(`#view-${normalized}`) || document.querySelector("#view-home");
  document.body.dataset.view = normalized;
  els.views.forEach((view) => view.classList.toggle("active", view === next));
  els.navItems.forEach((item) => { const active = item.dataset.view === normalized; item.classList.toggle("active", active); active ? item.setAttribute("aria-current", "page") : item.removeAttribute("aria-current"); });
  els.pageTitle.textContent = next.dataset.pageTitle;
  els.pageEyebrow.textContent = next.dataset.eyebrow;
  history.replaceState(null, "", `#${normalized}`);
  setSidebar(false);
  window.scrollTo({ top: 0, behavior: "smooth" });
  requestAnimationFrame(() => setupFurMaterial());
}
function showToast(message) { clearTimeout(toastTimer); els.toast.textContent = message; els.toast.classList.add("show"); toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600); }
function selectDate(date) { selectedDate = date; selectedTaskId = null; renderDailyPlan(); renderCalendar(); requestAnimationFrame(() => setupFurMaterial()); }
function selectTask(id) { selectedTaskId = selectedTaskId === id ? null : id; renderDailyPlan(); renderCalendar(); }

function openModal(prefill = {}) {
  editingTaskId = prefill.id || null;
  els.form.reset();
  const task = editingTaskId ? tasks.find((item) => item.id === editingTaskId) : null;
  const scheduled = task ? Model.scheduledParts(task) : null;
  els.modalTitle.textContent = task ? "Edit task" : "New task";
  els.modalKicker.textContent = task ? "Task details" : "Plan your work";
  els.saveTask.textContent = task ? "Save changes" : "Add to DuckPlan";
  els.deleteTask.hidden = !task;
  els.form.elements.title.value = task?.title || "";
  els.form.elements.classId.value = task ? task.classId || "" : store.listClasses()[0]?.id || "";
  els.form.elements.priority.value = task?.priority || "Medium";
  els.form.elements.dueDate.value = task?.dueDate || prefill.dueDate || selectedDate;
  els.form.elements.dueTime.value = task?.dueTime || prefill.dueTime || "";
  els.form.elements.scheduledDate.value = scheduled?.date || prefill.scheduledDate || "";
  els.form.elements.scheduledTime.value = scheduled?.time || prefill.scheduledTime || "";
  els.form.elements.durationMinutes.value = String(task?.durationMinutes || prefill.durationMinutes || 45);
  els.modal.showModal(); setupFurMaterial(); els.form.elements.title.focus();
}
function closeModal() { els.modal.close(); editingTaskId = null; setupFurMaterial(); }

function openClassModal(id = null) {
  editingClassId = id;
  els.classForm.reset();
  const info = id ? store.listClasses({ includeArchived: true }).find((item) => item.id === id) : null;
  els.classModalTitle.textContent = info ? "Edit class" : "New class";
  els.archiveClass.hidden = !info;
  els.classForm.elements.name.value = info?.name || "";
  els.classForm.elements.teacher.value = info?.teacher || "";
  els.classForm.elements.period.value = info?.period || "";
  els.classForm.elements.code.value = info?.code || "";
  els.classForm.elements.color.value = info?.color || window.DuckAxisIcal.pickClassColor(store.listClasses({ includeArchived: true }).length);
  els.classModal.showModal(); setupFurMaterial(); els.classForm.elements.name.focus();
}
function closeClassModal() { els.classModal.close(); editingClassId = null; setupFurMaterial(); }
async function runAction(button, action) {
  if (button) button.disabled = true;
  try { await action(); } catch (error) { reportError(error); } finally { if (button?.isConnected) button.disabled = false; }
}

document.addEventListener("click", (event) => {
  const drawerDismiss = event.target.closest(".drawer-close,.sidebar-scrim"); if (drawerDismiss) setSidebar(false);
  const viewButton = event.target.closest("[data-view]"); if (viewButton) setView(viewButton.dataset.view);
  const goButton = event.target.closest("[data-go]"); if (goButton) { event.preventDefault(); setView(goButton.dataset.go); }
  const dateButton = event.target.closest("[data-date]"); if (dateButton) selectDate(dateButton.dataset.date);
  const slot = event.target.closest("[data-slot-date]"); if (slot) openModal({ scheduledDate: slot.dataset.slotDate, scheduledTime: slot.dataset.slotTime, dueDate: slot.dataset.slotDate });
  const select = event.target.closest("[data-select-task]"); if (select) selectTask(select.dataset.selectTask);
  const edit = event.target.closest("[data-edit-task]"); if (edit) openModal({ id: edit.dataset.editTask });
  const editClass = event.target.closest("[data-edit-class]"); if (editClass) openClassModal(editClass.dataset.editClass);
  const collapse = event.target.closest("[data-collapse]"); if (collapse) { collapsed[collapse.dataset.collapse] = !collapsed[collapse.dataset.collapse]; renderDailyPlan(); }
});
document.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-task-id]");
  if (!checkbox) return;
  const completed = checkbox.checked;
  store.toggleComplete(checkbox.dataset.taskId, completed).then(() => showToast(completed ? "Task completed. Nice work!" : "Task returned to your plan."), reportError);
});
document.querySelectorAll(".filter-chip").forEach((chip) => chip.addEventListener("click", () => {
  document.querySelectorAll(".filter-chip").forEach((item) => { item.classList.toggle("active", item === chip); item.setAttribute("aria-pressed", String(item === chip)); });
  currentFilter = chip.dataset.filter; renderAllTasks(); setupFurMaterial();
}));
document.querySelectorAll("[data-calendar-view]").forEach((button) => button.addEventListener("click", () => { calendarView = button.dataset.calendarView; renderCalendar(); }));
sidebarToggles.forEach((toggle) => toggle.addEventListener("click", () => setSidebar(true)));
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && document.body.classList.contains("sidebar-open")) setSidebar(false); });
window.addEventListener("hashchange", () => { if (location.hash === "#planner-sidebar") setSidebar(true); });
document.querySelector("#calendar-previous").addEventListener("click", () => selectDate(Model.shiftView(calendarView, selectedDate, -1)));
document.querySelector("#calendar-next").addEventListener("click", () => selectDate(Model.shiftView(calendarView, selectedDate, 1)));
document.querySelector("#calendar-today").addEventListener("click", () => selectDate(nowKey()));
document.querySelector("#plan-selected-date").addEventListener("click", () => openModal({ dueDate: selectedDate }));
document.querySelector("#open-task-modal").addEventListener("click", () => openModal({ dueDate: selectedDate }));
document.querySelector("#close-task-modal").addEventListener("click", closeModal);
document.querySelector("#cancel-task").addEventListener("click", closeModal);
els.modal.addEventListener("click", (event) => { if (event.target === els.modal) closeModal(); });
els.search.addEventListener("input", () => { searchTerm = els.search.value.trim().toLowerCase(); if (searchTerm) setView("tasks"); renderAllTasks(); });
els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(els.form); const title = form.get("title").trim(); if (!title) return;
  const wasEditing = Boolean(editingTaskId);
  const scheduledDate = form.get("scheduledDate"); const scheduledTime = form.get("scheduledTime");
  const next = { title, classId: form.get("classId") || null, priority: form.get("priority"), dueDate: form.get("dueDate"), dueTime: form.get("dueTime"), scheduledStart: scheduledDate && scheduledTime ? `${scheduledDate}T${scheduledTime}` : null, scheduledEnd: null, durationMinutes: Number(form.get("durationMinutes") || 45), schemaVersion: 2 };
  const existing = editingTaskId ? tasks.find((task) => task.id === editingTaskId) : null;
  closeModal();
  store.upsertItem({ ...existing, ...next }).then(() => showToast(wasEditing ? "Task updated." : "Task added to your plan."), reportError);
});
els.deleteTask.addEventListener("click", () => {
  if (!editingTaskId) return;
  const id = editingTaskId; closeModal();
  store.deleteItem(id).then(() => showToast("Task deleted."), reportError);
});
document.querySelector("#notification-button").addEventListener("click", () => showToast("You are all caught up."));
document.querySelector("#add-class").addEventListener("click", () => openClassModal());
document.querySelector("#close-class-modal").addEventListener("click", closeClassModal);
document.querySelector("#cancel-class").addEventListener("click", closeClassModal);
els.classModal.addEventListener("click", (event) => { if (event.target === els.classModal) closeClassModal(); });
els.classModal.addEventListener("close", () => { editingClassId = null; setupFurMaterial(); });
els.classForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(els.classForm); const name = form.get("name").trim(); if (!name) return;
  const existing = editingClassId ? store.listClasses({ includeArchived: true }).find((item) => item.id === editingClassId) : null;
  const code = form.get("code").trim() || window.DuckAxisIcal.classCode(name);
  closeClassModal();
  store.upsertClass({ ...existing, name, teacher: form.get("teacher").trim(), period: form.get("period").trim(), code, color: form.get("color") })
    .then(() => showToast(existing ? "Class updated." : "Class added."), reportError);
});
els.archiveClass.addEventListener("click", () => {
  const existing = store.listClasses({ includeArchived: true }).find((item) => item.id === editingClassId); if (!existing) return;
  closeClassModal();
  store.upsertClass({ ...existing, archived: true }).then(() => showToast(`${existing.name} archived. Its tasks are kept.`), reportError);
});
els.syncInfo.addEventListener("click", () => {
  if (store.mode === "cloud" && axisStatus.connected) runAction(els.syncInfo, syncAxisNow);
  else { setView("settings"); showToast(store.mode === "cloud" ? "Paste your Axis feed link to connect." : "Sign in to connect Axis."); }
});
els.resetDemo.addEventListener("click", () => { store.resetLocalDemo().then(() => { selectedDate = nowKey(); showToast("Demo tasks reset."); }, reportError); });

async function syncAxisNow() {
  const result = await store.syncAxisNow();
  showToast(`Axis synced: ${result.added} new, ${result.updated} updated.`);
  await refreshAccountState();
}
els.accountSettings.addEventListener("submit", (event) => {
  if (event.target.id !== "sign-in-form") return;
  event.preventDefault();
  const email = new FormData(event.target).get("email").trim();
  runAction(event.submitter, async () => { await store.signInWithEmail(email); showToast(`Check ${email} for your sign-in link.`); });
});
els.accountSettings.addEventListener("click", (event) => {
  const button = event.target.closest("button"); if (!button) return;
  if (button.id === "google-sign-in") runAction(button, () => store.signInWithGoogle());
  if (button.id === "sign-out") runAction(button, async () => { await store.signOut(); showToast("Signed out. Showing this browser's local tasks."); });
  if (button.id === "dismiss-import") { store.dismissLocalImport(); refreshAccountState(); }
  if (button.id === "import-local") runAction(button, async () => { const count = await store.importLocalTasks(); showToast(`Imported ${count} task${count === 1 ? "" : "s"}.`); await refreshAccountState(); });
});
els.axisSettings.addEventListener("submit", (event) => {
  if (event.target.id !== "axis-form") return;
  event.preventDefault();
  const input = event.target.elements.icalUrl;
  let link;
  try { link = window.DuckAxisIcal.normalizeFeedUrl(input.value); } catch (error) { showToast(error.message); input.focus(); return; }
  runAction(event.submitter, async () => {
    showToast("Connecting to Axis…");
    const result = await store.connectAxis(link);
    const count = (value, one, many) => `${value} ${value === 1 ? one : many}`;
    showToast(`Axis connected: ${count(result.added, "assignment", "assignments")} and ${count(result.classesAdded, "class", "classes")} imported.`);
    await refreshAccountState();
  });
});
els.axisSettings.addEventListener("click", (event) => {
  const button = event.target.closest("button"); if (!button) return;
  if (button.id === "connect-axis") { els.accountSettings.querySelector("input[name=email]")?.focus(); showToast(store.configured ? "Sign in first, then connect Axis." : "Cloud sync isn't set up on this copy of DuckPlan yet."); }
  if (button.id === "axis-sync-now") runAction(button, syncAxisNow);
  if (button.id === "axis-disconnect") runAction(button, async () => { await store.disconnectAxis(); showToast("Axis disconnected. Imported assignments stay in your planner."); await refreshAccountState(); });
});
store.subscribe(({ reason }) => {
  renderAll();
  if (reason === "load" || reason === "auth") refreshAccountState();
});

function refreshDateBoundary() {
  const nextToday = nowKey();
  if (nextToday === observedToday) return;
  if (selectedDate === observedToday) selectedDate = nextToday;
  observedToday = nextToday; renderAll();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshDateBoundary(); });
window.addEventListener("focus", refreshDateBoundary);
setInterval(refreshDateBoundary, 60000);

const requestedView = location.hash.replace("#", "");
renderAll();
renderAccount(); renderAxis();
setView(document.querySelector(`#view-${requestedView}`) || ["today", "calendar"].includes(requestedView) ? requestedView : "home");
store.init().catch(reportError);
