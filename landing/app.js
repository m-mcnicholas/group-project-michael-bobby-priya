const Model = window.DuckPlannerModel;
const PlannerUI = window.DuckPlannerUI;
const ReminderDomain = window.DuckReminderDomain;
const ReminderLedger = window.DuckReminderLedger;
const BrowserNotifications = window.DuckBrowserNotifications;
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
  storage: localStorage,
  model: Model,
  defaultClasses: () => DEFAULT_CLASSES,
  defaultTasks,
  config: window.DUCKPLAN_CLOUD || {},
  redirectPath: location.pathname,
});
let tasks = [];
const REMINDER_KEY = "duckplan-deadline-reminders-v1";
const reminderSettings = loadReminderSettings();
const reminderLedger = ReminderLedger.createLedger({ storage: localStorage });
const reminderToggle = document.querySelector("#reminders-enabled");
const reminderLead = document.querySelector("#reminder-lead");
const reminderList = document.querySelector("#reminder-list");
const reminderEmpty = document.querySelector("#reminders-empty");
const notificationPermissionStatus = document.querySelector("#notification-permission-status");
const notificationPermissionButton = document.querySelector("#enable-device-notifications");
const notificationPermissionHelp = document.querySelector("#notification-permission-help");
reminderToggle.checked = reminderSettings.enabled;
reminderLead.value = String(reminderSettings.lead);
let selectedDate = nowKey();
let calendarView = window.matchMedia("(max-width: 760px)").matches ? "day" : "week";
let currentFilter = "all";
let searchTerm = "";
let selectedTaskId = null;
let editingTaskId = null;
let axisStatus = { connected: false, lastSyncedAt: null, lastError: null };
let localImportCount = 0;
let collapsed = { overdue: false, completed: false };
let toastTimer;
let notificationConstructorFailed = false;
let observedToday = nowKey();
let calendarFocusSlot = { date: selectedDate, time: "09:00" };
let calendarUserScrolled = false;
let calendarProgrammaticScroll = false;
let calendarDrag = null;
let suppressCalendarEventClickUntil = 0;

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
  toastMessage: document.querySelector("#toast-message"), toastAction: document.querySelector("#toast-action"),
  calendarStatus: document.querySelector("#calendar-status"), taskPanel: document.querySelector("#daily-task-panel"),
  taskPanelToggle: document.querySelector("#toggle-task-panel"), taskPanelScrim: document.querySelector(".task-panel-scrim"),
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
const compactPlannerQuery = window.matchMedia("(max-width: 1000px)");

function setSidebar(open) {
  const wasOpen = document.body.classList.contains("sidebar-open");
  document.body.classList.toggle("sidebar-open", open);
  // The collapsed drawer remains an interactive navigation rail.
  sidebar.inert = false;
  sidebar.setAttribute("aria-hidden", "false");
  // Docked navigation shares the workspace plane; the main page stays usable.
  workspace.inert = false;
  sidebarScrim.hidden = true;
  sidebarToggles.forEach(toggle => {
    toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    toggle.setAttribute("aria-expanded", String(open));
    const glyph = toggle.querySelector("[data-sidebar-glyph]");
    if (glyph) glyph.textContent = open ? "‹" : "›";
  });
  sidebarScrim.tabIndex = -1;
  if (open) document.querySelector(".sidebar .nav-item.active")?.focus({preventScroll:true});
  else if (wasOpen) sidebarToggles.find(toggle => toggle.getClientRects().length)?.focus({preventScroll:true});
  requestAnimationFrame(() => setupButtonMaterial());
}

function setTaskPanel(open, moveFocus = true) {
  const compact = compactPlannerQuery.matches;
  const nextOpen = compact && open;
  document.body.classList.toggle("task-panel-open", nextOpen);
  els.taskPanelToggle.setAttribute("aria-expanded", String(nextOpen));
  els.taskPanelScrim.hidden = !nextOpen;
  if (compact) {
    els.taskPanel.inert = !nextOpen;
    els.taskPanel.setAttribute("aria-hidden", String(!nextOpen));
  } else {
    els.taskPanel.inert = false;
    els.taskPanel.removeAttribute("aria-hidden");
  }
  if (moveFocus && nextOpen) document.querySelector("[data-close-task-panel]")?.focus({ preventScroll: true });
  else if (moveFocus && !nextOpen) els.taskPanelToggle.focus({ preventScroll: true });
}

function loadReminderSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(REMINDER_KEY));
    return {
      enabled: saved?.enabled === true,
      lead: [15, 60, 1440].includes(saved?.lead) ? saved.lead : 60,
    };
  } catch {
    return { enabled: false, lead: 60 };
  }
}

function saveReminderSettings() {
  localStorage.setItem(REMINDER_KEY, JSON.stringify(reminderSettings));
}

function notificationCapability() {
  return BrowserNotifications.capability(window.Notification, {
    isSecureContext: window.isSecureContext,
    constructorFailed: notificationConstructorFailed,
  });
}

function updateNotificationPermission() {
  const state = notificationCapability();
  const copy = BrowserNotifications.settingsCopy(state);
  notificationPermissionStatus.textContent = copy.label;
  notificationPermissionStatus.dataset.state = state;
  notificationPermissionButton.textContent = copy.action;
  notificationPermissionButton.disabled = copy.disabled;
  notificationPermissionHelp.textContent = state === "granted"
    ? "DuckPlan can submit alerts while this page remains open. Browser acceptance does not confirm that your device displayed one."
    : state === "granted-unusable"
      ? "Permission is allowed, but this browser cannot use DuckPlan's open-page delivery method. In-app reminders still work."
    : state === "denied"
      ? "Allow notifications for this site in your browser settings, then return to DuckPlan. In-app reminders still work."
      : state === "unsupported"
        ? "This browser cannot create DuckPlan device notifications; in-app reminders still work."
        : "Your browser will ask before DuckPlan can notify you.";
  return state;
}

function focusReminderTask(task) {
  requestAnimationFrame(() => {
    const card = [...document.querySelectorAll("[data-task-card]")]
      .find((item) => item.dataset.taskCard === String(task.id));
    if (!card) {
      els.calendarStatus.textContent = `${task.title} is selected, but its task card is not available in this view.`;
      return;
    }
    card.tabIndex = -1;
    card.scrollIntoView({ block: "center", inline: "nearest" });
    card.focus({ preventScroll: true });
    els.calendarStatus.textContent = `${task.title} selected from a deadline reminder.`;
  });
}

function displayBrowserNotification(payload, taskId = null) {
  if (notificationCapability() !== "granted") return { status: "unavailable" };
  const result = BrowserNotifications.createNotification(window.Notification, payload);
  if (result.status !== "submitted") {
    notificationConstructorFailed = true;
    updateNotificationPermission();
    return result;
  }
  result.notification.onclick = () => {
    window.focus();
    if (taskId) {
      const target = BrowserNotifications.resolveTaskTarget(tasks, taskId);
      if (target.status === "found") {
        selectedTaskId = target.task.id;
        if (target.date) selectedDate = target.date;
        setView("home");
        renderAll({ autoScrollCalendar: true });
        focusReminderTask(target.task);
      } else {
        setView("settings");
        document.querySelector("#reminders-heading").focus();
        showToast("That reminder's task is no longer available.");
      }
    } else {
      setView("settings");
      document.querySelector("#reminders-heading").focus();
    }
    result.notification.close();
  };
  return result;
}

function notifyForTask(task, occurrence) {
  const icon = new URL("./assets/duckplan-mascot-v8.png", location.href).href;
  return displayBrowserNotification(
    BrowserNotifications.taskNotification(task, occurrence, { icon }),
    task.id,
  );
}

const taskReminderChoices = ["default", "off", "15", "60", "1440"];

function taskReminderLead(choice) {
  if (choice === "off") return null;
  if (choice && taskReminderChoices.includes(choice) && choice !== "default") return Number(choice);
  return reminderSettings.enabled ? reminderSettings.lead : null;
}

function reminderOccurrences(now = Date.now()) {
  const timeZone = ReminderDomain.browserTimeZone();
  return tasks.map((task) => {
    const lead = taskReminderLead(task.reminderChoice);
    const occurrence = ReminderDomain.calculateOccurrence({
      taskId: task.id,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      leadMinutes: lead,
      enabled: lead !== null,
      completed: task.completed,
      deleted: task.deleted === true,
      evaluationTime: now,
      timeZone,
    });
    return { task, occurrence };
  }).sort((left, right) => (left.occurrence.deadlineAt || Infinity) - (right.occurrence.deadlineAt || Infinity));
}

async function announceReminders(dueSoon, now) {
  if (!dueSoon.length || els.modal.open) return;
  const claimed = (await Promise.all(dueSoon.map(async (entry) => ({
    ...entry,
    token: await reminderLedger.claim(entry.occurrence.occurrenceId, now, { forceRetry: !document.hidden }),
  })))).filter((entry) => entry.token);
  if (!claimed.length) return;

  if (!document.hidden) {
    showToast(claimed.length === 1
      ? `${claimed[0].occurrence.status === "missed" ? "Missed reminder" : "Due soon"}: ${claimed[0].task.title}`
      : `${claimed.length} deadline reminders are ready. Check Settings for details.`);
    await Promise.all(claimed.map((entry) => reminderLedger.finish(
      entry.occurrence.occurrenceId,
      entry.token,
      "acknowledged",
      { channel: "in-app" },
      now,
    )));
    return;
  }

  await Promise.all(claimed.map(async (entry) => {
    const result = notifyForTask(entry.task, entry.occurrence);
    if (result.status === "submitted") {
      await reminderLedger.finish(entry.occurrence.occurrenceId, entry.token, "submitted", { channel: "browser" }, now);
    } else {
      await reminderLedger.finish(entry.occurrence.occurrenceId, entry.token, "failed", { channel: "browser", reason: result.reason || result.status }, now);
    }
  }));
}

function refreshReminders({ announce = false, now = Date.now() } = {}) {
  const occurrences = reminderOccurrences(now);
  const activeIds = occurrences
    .filter(({ occurrence }) => ["pending", "due", "missed"].includes(occurrence.status))
    .map(({ occurrence }) => occurrence.occurrenceId);
  reminderLedger.prune(activeIds, now);
  const dueSoon = occurrences.filter(({ occurrence }) => occurrence.eligible);
  reminderLead.disabled = !reminderSettings.enabled;
  reminderEmpty.textContent = dueSoon.length
    ? "Active open-page reminders"
    : "No tasks are currently inside their reminder window.";
  reminderList.replaceChildren(...dueSoon.map(({ task, occurrence }) => {
    const item = document.createElement("li");
    const due = new Date(occurrence.deadlineAt).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
    item.textContent = `${occurrence.status === "missed" ? "Missed reminder · " : ""}${task.title} · Due ${due}`;
    return item;
  }));
  if (announce) void announceReminders(dueSoon, now);
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
  const due = task.dueDate ? `${formatShortDate(task.dueDate)}${task.dueTime ? ` · ${formatTime(task.dueTime)}` : ""}` : "No deadline";
  return `<article class="daily-task-card ${task.completed ? "completed" : ""} ${task.id === selectedTaskId ? "selected" : ""}" style="--course-color:${info.color};--course-soft:${info.soft}" data-task-card="${task.id}">
    <input class="task-check" type="checkbox" data-task-id="${task.id}" ${task.completed ? "checked" : ""} aria-label="Mark ${safeText(task.title)} complete" />
    <button class="task-select" type="button" data-select-task="${task.id}"><span class="task-title">${safeText(task.title)}</span><span class="task-meta"><span class="course-dot"></span>${safeText(info.name)} · ${mode === "scheduled" ? taskScheduleText(task) : `Due ${due}`}${Number.isInteger(task.actualMinutes) ? ` · ${task.actualMinutes} min spent` : ""}${task.priority === "High" ? '<span class="priority-tag">High</span>' : ""}</span></button>
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
  els.classGrid.innerHTML = store.listClasses().map((info) => {
    const classTasks = tasks.filter((task) => task.classId === info.id);
    const open = classTasks.filter((task) => !task.completed).length;
    const details = [info.teacher, info.period].filter(Boolean).join(" · ") || (info.axisKey ? "Imported from Axis" : "Class details");
    return `<article class="class-card" style="--course-color:${info.color};--course-soft:${info.soft}"><div class="class-card-head"><span class="class-card-icon">${safeText(info.code)}</span></div><h2>${safeText(info.name)}</h2><p>${safeText(details)}</p><div class="class-stats"><div><strong>${open}</strong><span>Open tasks</span></div><div><strong>${classTasks.length}</strong><span>Total items</span></div></div></article>`;
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
  container.innerHTML = markup;
  setupButtonMaterial(container);
}
let accountMode = "sign-in";
let shownRecoveryCode = null;
const passwordInput = (name, placeholder, autocomplete) => `<label><span class="sr-only">${placeholder}</span><input name="${name}" type="password" required minlength="8" maxlength="200" autocomplete="${autocomplete}" placeholder="${placeholder}" /></label>`;
const emailInput = `<label><span class="sr-only">Email address</span><input name="email" type="email" required autocomplete="username" placeholder="you@school.org" /></label>`;
function signedOutAccount() {
  if (accountMode === "recover") return `<div><h2>Reset your password</h2><p>Use the recovery code you saved when you created your account.</p></div><form class="settings-form" id="recover-form">${emailInput}<label><span class="sr-only">Recovery code</span><input name="recoveryCode" type="text" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" /></label>${passwordInput("newPassword", "New password", "new-password")}<button type="submit" class="secondary-button">Reset password</button><button type="button" class="secondary-button" id="show-sign-in">Back to sign in</button></form>`;
  return `<div><h2>Account</h2><p>Sign in to sync your planner across devices, or create an account with an 8-character password.</p></div><form class="settings-form" id="sign-in-form">${emailInput}${passwordInput("password", "Password", "current-password")}<button type="submit" class="secondary-button" data-action="sign-in">Sign in</button><button type="submit" class="secondary-button" data-action="sign-up">Create account</button>${store.providers.google ? `<button type="button" class="secondary-button" id="google-sign-in">Use Google</button>` : ""}<button type="button" class="secondary-button" id="show-recover">Forgot password?</button></form>`;
}
function signedInAccount(user) {
  const intro = `<div><h2>Account</h2><p>Signed in as ${safeText(user.email || "your account")}. Your planner is syncing across devices.</p></div>`;
  if (accountMode === "change-password") return `${intro}<form class="settings-form" id="password-form">${user.hasPassword ? passwordInput("currentPassword", "Current password", "current-password") : ""}${passwordInput("newPassword", "New password", "new-password")}<button type="submit" class="secondary-button">Save password</button><button type="button" class="secondary-button" id="cancel-account-form">Cancel</button></form>`;
  if (accountMode === "recovery-code") return `${intro}<form class="settings-form" id="recovery-code-form">${passwordInput("password", "Current password", "current-password")}<button type="submit" class="secondary-button">Make a new code</button><button type="button" class="secondary-button" id="cancel-account-form">Cancel</button></form>`;
  return `${intro}<div class="settings-actions"><button type="button" class="secondary-button" id="show-change-password">${user.hasPassword ? "Change password" : "Add a password"}</button>${user.hasPassword ? `<button type="button" class="secondary-button" id="show-recovery-code">New recovery code</button>` : ""}<button type="button" class="secondary-button" id="sign-out">Sign out</button></div>`;
}
function renderAccount() {
  const user = store.user;
  const body = !store.configured
    ? `<div><h2>Account</h2><p>Cloud sync is unavailable on this copy, so tasks stay in this browser.</p></div>`
    : user ? signedInAccount(user) : signedOutAccount();
  const recovery = user && shownRecoveryCode ? `<div class="settings-row recovery-row" id="recovery-row"><div><h2>Save your recovery code</h2><p>This code is the only way to reset a forgotten password. Store it in a password manager.</p><p class="recovery-code"><code>${safeText(shownRecoveryCode)}</code></p></div><div class="settings-actions"><button type="button" class="secondary-button" id="copy-recovery">Copy code</button><button type="button" class="secondary-button" id="dismiss-recovery">I saved it</button></div></div>` : "";
  const offer = localImportCount ? `<div class="settings-row"><div><h2>Bring your local tasks</h2><p>This browser has ${localImportCount} local task${localImportCount === 1 ? "" : "s"}. Copy them into your account?</p></div><div class="settings-actions"><button type="button" class="secondary-button" id="import-local">Import tasks</button><button type="button" class="secondary-button" id="dismiss-import">Not now</button></div></div>` : "";
  replaceSettings(els.accountSettings, `<div class="settings-row">${body}</div>${recovery}${offer}`);
  els.resetDemo.closest(".settings-row").hidden = store.mode === "cloud";
}
function setAccountMode(mode, { focus = true } = {}) {
  accountMode = mode;
  renderAccount();
  if (focus) requestAnimationFrame(() => els.accountSettings.querySelector("form input")?.focus());
}
function renderAxis() {
  let body;
  if (store.mode !== "cloud") body = `<div><h2>Axis connection</h2><p>Sign in, then paste your Axis calendar feed link to import classes and assignments.</p></div><button type="button" class="secondary-button" id="connect-axis">Sign in first</button>`;
  else if (!axisStatus.connected) body = `<div><h2>Axis connection</h2><p>Copy the private calendar feed link from Axis. It ends in <code>iCal.aspx</code>.</p></div><form class="settings-form" id="axis-form"><label><span class="sr-only">Axis feed link</span><input name="icalUrl" type="url" required autocomplete="off" spellcheck="false" placeholder="webcal://…iCal.aspx?z=…" /></label><button type="submit" class="secondary-button">Connect Axis</button></form>`;
  else body = `<div><h2>Axis connection</h2><p>${safeText(relativeSyncTime(axisStatus.lastSyncedAt))}.${axisStatus.lastError ? ` Last problem: ${safeText(axisStatus.lastError)}` : ""}</p></div><div class="settings-actions"><button type="button" class="secondary-button" id="axis-sync-now">Sync now</button><button type="button" class="secondary-button" id="axis-disconnect">Disconnect</button></div>`;
  replaceSettings(els.axisSettings, `<div class="settings-row">${body}</div>`);
  els.syncCopy.textContent = store.mode !== "cloud" ? "Not signed in" : axisStatus.connected ? (axisStatus.lastError ? "Needs attention" : relativeSyncTime(axisStatus.lastSyncedAt)) : "Not connected";
  els.syncInfo.setAttribute("aria-label", axisStatus.connected ? "Sync Axis now" : "Set up Axis sync");
}
async function refreshAccountState() {
  try { [axisStatus, localImportCount] = await Promise.all([store.axisStatus(), store.localImportOffer()]); }
  catch (error) { console.error(error); }
  renderAccount(); renderAxis();
}
async function runAction(button, action) {
  button.disabled = true;
  try { await action(); }
  catch (error) { reportError(error); }
  finally { if (button.isConnected) button.disabled = false; }
}
async function syncAxisNow() {
  const result = await store.syncAxisNow();
  showToast(`Axis synced: ${result.added} new, ${result.updated} updated.`);
  await refreshAccountState();
}
function showRecoveryCode(code) {
  if (!code) return;
  shownRecoveryCode = code;
  setAccountMode(null, { focus: false });
  els.accountSettings.querySelector("#recovery-row")?.scrollIntoView({ block: "nearest" });
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
  if (!dates.includes(calendarFocusSlot.date)) calendarFocusSlot = { date: selectedDate, time: calendarFocusSlot.time || "09:00" };
  const headers = dates.map((date) => `<button type="button" class="calendar-date-button ${date === selectedDate ? "selected" : ""} ${date === nowKey() ? "today" : ""}" data-date="${date}"><span>${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(dateObject(date))}</span><strong>${dateObject(date).getDate()}</strong></button>`).join("");
  const deadlineRows = dates.map((date) => `<div class="deadline-cell">${deadlineChips(date)}</div>`).join("");
  const timeLabels = Array.from({ length: endHour - startHour }, (_, index) => `<span>${formatTime(`${String(startHour + index).padStart(2, "0")}:00`)}</span>`).join("");
  const columns = dates.map((date) => {
    const current = new Date();
    const currentMinutes = current.getHours() * 60 + current.getMinutes();
    const currentTimeLine = date === nowKey() && currentMinutes >= startHour * 60 && currentMinutes < endHour * 60
      ? `<div class="current-time-line" style="top:${((currentMinutes - startHour * 60) / 60) * hourHeight}px" aria-hidden="true"><span></span></div>`
      : "";
    const scheduled = tasks.filter((task) => Model.scheduledParts(task)?.date === date && !task.completed);
    const events = layoutEvents(scheduled).map(({ task, start, end, lane, lanes }) => {
      const info = classInfo(task);
      const top = ((start - startHour * 60) / 60) * hourHeight;
      const height = Math.max(30, ((end - start) / 60) * hourHeight);
      return `<button type="button" class="calendar-event-block ${task.id === selectedTaskId ? "selected" : ""}" data-select-task="${task.id}" data-edit-task="${task.id}" data-calendar-drag-task="${task.id}" aria-describedby="calendar-drag-instructions" style="--course-color:${info.color};--course-soft:${info.soft};top:${top}px;height:${height}px;left:calc(${(lane / lanes) * 100}% + 3px);width:calc(${100 / lanes}% - 6px)"><strong>${safeText(task.title)}</strong><small>${formatTime(Model.scheduledParts(task).time)}</small></button>`;
    }).join("");
    const slots = Array.from({ length: endHour - startHour }, (_, index) => {
      const time = `${String(startHour + index).padStart(2, "0")}:00`;
      const isFocusSlot = calendarFocusSlot.date === date && calendarFocusSlot.time === time;
      return `<button type="button" class="calendar-slot" tabindex="${isFocusSlot ? "0" : "-1"}" data-slot-date="${date}" data-slot-time="${time}" aria-label="Plan work on ${formatLongDate(date)} at ${formatTime(time)}"></button>`;
    }).join("");
    return `<div class="timeline-column ${date === selectedDate ? "selected-day" : ""}" data-column-date="${date}" style="--timeline-height:${(endHour - startHour) * hourHeight}px">${slots}${currentTimeLine}${events}</div>`;
  }).join("");
  return `<div class="timeline-calendar" style="--day-count:${dates.length};--hour-height:${hourHeight}px"><div class="timeline-corner" aria-hidden="true"></div><div class="timeline-days">${headers}</div><div class="timeline-deadline-label">Due</div><div class="timeline-deadlines">${deadlineRows}</div><div class="time-axis">${timeLabels}</div><div class="timeline-columns">${columns}</div></div>`;
}
function renderMonth(dates) {
  const currentMonth = dateObject(selectedDate).getMonth();
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<span>${day}</span>`).join("");
  const cells = dates.map((date) => {
    const dayTasks = tasks.filter((task) => task.dueDate === date || Model.scheduledParts(task)?.date === date);
    const dots = dayTasks.slice(0, 4).map((task) => `<i style="--course-color:${classInfo(task).color}"></i>`).join("");
    return `<button type="button" class="month-day ${date === selectedDate ? "selected" : ""} ${date === nowKey() ? "today" : ""} ${dateObject(date).getMonth() !== currentMonth ? "outside" : ""}" data-date="${date}"><strong>${dateObject(date).getDate()}</strong><span class="month-dots">${dots}</span><small>${dayTasks.length ? `${dayTasks.length} item${dayTasks.length === 1 ? "" : "s"}` : ""}</small></button>`;
  }).join("");
  return `<div class="month-calendar"><div class="month-weekdays">${weekdays}</div><div class="month-grid">${cells}</div></div>`;
}
function relevantCalendarMinutes(dates) {
  const scheduled = tasks
    .filter((task) => dates.includes(Model.scheduledParts(task)?.date) && !task.completed)
    .map((task) => Model.scheduledParts(task))
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date) || a.minutes - b.minutes);
  const selected = scheduled.filter((parts) => parts.date === selectedDate);
  const candidates = selected.length ? selected : scheduled;
  if (candidates.length) {
    if (selectedDate === nowKey()) {
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      return (candidates.find((parts) => parts.minutes >= nowMinutes - 30) || candidates[0]).minutes;
    }
    return candidates[0].minutes;
  }
  if (selectedDate === nowKey()) {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }
  return 9 * 60;
}

function scrollCalendarToRelevant(dates) {
  if (calendarView === "month" || calendarUserScrolled) return;
  requestAnimationFrame(() => {
    calendarProgrammaticScroll = true;
    els.calendar.scrollTop = PlannerUI.timelineScrollTop({
      targetMinutes: relevantCalendarMinutes(dates),
      viewportHeight: els.calendar.clientHeight,
      scrollHeight: els.calendar.scrollHeight,
    });
    requestAnimationFrame(() => { calendarProgrammaticScroll = false; });
  });
}

function renderCalendar({ autoScroll = false } = {}) {
  const dates = Model.datesForView(calendarView, selectedDate);
  els.calendarRange.textContent = rangeLabel(dates);
  els.calendar.className = `planner-calendar ${calendarView}-view`;
  els.calendar.innerHTML = calendarView === "month" ? renderMonth(dates) : renderTimeline(dates);
  document.querySelectorAll("[data-calendar-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.calendarView === calendarView)));
  els.calendarStatus.textContent = `${calendarView[0].toUpperCase()}${calendarView.slice(1)} view, ${els.calendarRange.textContent}`;
  if (autoScroll) {
    calendarUserScrolled = false;
    scrollCalendarToRelevant(dates);
  }
}

// Native labels remain sharp; lightweight CSS glass replaces live fur canvases.
function setupButtonMaterial(root = document) {
  const contentControls = ".sidebar-scrim,.calendar-slot,.calendar-date-button,.calendar-event-block,.deadline-chip,.month-day,.task-select,.task-section-heading";
  root.querySelectorAll("button, a.secondary-button, a.nav-open-button").forEach(button => {
    button.classList.toggle("glass-button", !button.matches(contentControls));
  });
}
function renderAll({ autoScrollCalendar = false } = {}) { tasks = store.listItems(); renderDailyPlan(); renderAllTasks(); renderClasses(); renderClassOptions(); renderCalendar({ autoScroll: autoScrollCalendar }); refreshReminders(); requestAnimationFrame(() => setupButtonMaterial()); }

function setView(name, preserveDrawer = false) {
  const normalized = ["today", "calendar"].includes(name) ? "home" : name;
  const next = document.querySelector(`#view-${normalized}`) || document.querySelector("#view-home");
  document.body.dataset.view = normalized;
  els.views.forEach((view) => view.classList.toggle("active", view === next));
  els.navItems.forEach((item) => { const active = item.dataset.view === normalized; item.classList.toggle("active", active); active ? item.setAttribute("aria-current", "page") : item.removeAttribute("aria-current"); });
  els.pageTitle.textContent = next.dataset.pageTitle;
  els.pageEyebrow.textContent = next.dataset.eyebrow;
  history.replaceState(null, "", `#${normalized}`);
  if (normalized !== "home") setTaskPanel(false, false);
  if(!preserveDrawer) setSidebar(false);
  window.scrollTo({ top: 0, behavior: "instant" });
  requestAnimationFrame(() => setupButtonMaterial());
}
function hideToast() {
  clearTimeout(toastTimer);
  els.toast.classList.remove("show");
  els.toastAction.hidden = true;
  els.toastAction.onclick = null;
}
function showToast(message, { actionLabel = "", onAction = null, duration = 2600 } = {}) {
  clearTimeout(toastTimer);
  els.toastMessage.textContent = message;
  els.toastAction.hidden = !actionLabel;
  els.toastAction.textContent = actionLabel;
  els.toastAction.onclick = actionLabel && onAction ? () => { hideToast(); onAction(); } : null;
  els.toast.classList.add("show");
  toastTimer = setTimeout(hideToast, duration);
}
function selectDate(date) { selectedDate = date; selectedTaskId = null; calendarFocusSlot = { date, time: calendarFocusSlot.time }; renderDailyPlan(); renderCalendar({ autoScroll: true }); requestAnimationFrame(() => setupButtonMaterial()); }
function selectTask(id) { selectedTaskId = selectedTaskId === id ? null : id; renderDailyPlan(); renderCalendar(); setupButtonMaterial(); }

function focusMovedCalendarTask(taskId) {
  requestAnimationFrame(() => {
    const target = [...els.calendar.querySelectorAll("[data-calendar-drag-task]")]
      .find((item) => item.dataset.calendarDragTask === taskId);
    target?.focus({ preventScroll: true });
  });
}

function moveCalendarTask(task, drop, { focus = false } = {}) {
  const previousStart = task.scheduledStart;
  const previousSelectedDate = selectedDate;
  const nextStart = `${drop.date}T${drop.time}`;
  if (nextStart === previousStart) {
    if (focus) focusMovedCalendarTask(task.id);
    return false;
  }
  selectedDate = drop.date;
  selectedTaskId = task.id;
  store.upsertItem({ ...task, scheduledStart: nextStart, scheduledEnd: null }).catch(reportError);
  const destination = `${formatLongDate(drop.date)} at ${formatTime(drop.time)}`;
  els.calendarStatus.textContent = `${task.title} moved to ${destination}.`;
  showToast(`Moved to ${destination}.`, {
    actionLabel: "Undo",
    duration: 5000,
    onAction: () => {
      selectedDate = previousStart?.slice(0, 10) || previousSelectedDate;
      selectedTaskId = task.id;
      store.upsertItem({ ...task, scheduledStart: previousStart, scheduledEnd: null }).catch(reportError);
      els.calendarStatus.textContent = `${task.title} returned to its previous time.`;
      showToast("Calendar move undone.");
      if (focus) focusMovedCalendarTask(task.id);
    },
  });
  if (focus) focusMovedCalendarTask(task.id);
  return true;
}

function calendarColumnAt(clientX) {
  return [...els.calendar.querySelectorAll(".timeline-column")].find((column) => {
    const rect = column.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right;
  }) || null;
}

function updateCalendarDragPosition(clientX, clientY) {
  if (!calendarDrag?.started) return;
  calendarDrag.lastPointer = { x: clientX, y: clientY };
  const column = calendarColumnAt(clientX);
  calendarDrag.targetColumn?.classList.remove("calendar-drop-target");
  calendarDrag.targetColumn = column;
  if (!column) {
    calendarDrag.drop = null;
    calendarDrag.ghost.hidden = true;
    return;
  }
  const rect = column.getBoundingClientRect();
  const durationMinutes = Number(calendarDrag.task.durationMinutes || 45);
  const hourHeight = rect.height / 15;
  const drop = PlannerUI.snapCalendarDrop({
    date: column.dataset.columnDate,
    pointerY: clientY - calendarDrag.offsetY,
    columnTop: rect.top,
    hourHeight,
    durationMinutes,
  });
  const top = rect.top + ((drop.minutes - 7 * 60) / 60) * hourHeight;
  calendarDrag.drop = drop;
  column.classList.add("calendar-drop-target");
  calendarDrag.ghost.hidden = false;
  calendarDrag.ghost.style.left = `${rect.left + 3}px`;
  calendarDrag.ghost.style.top = `${top}px`;
  calendarDrag.ghost.style.width = `${Math.max(32, rect.width - 6)}px`;
  calendarDrag.ghost.querySelector("small").textContent = formatTime(drop.time);
  const viewport = els.calendar.getBoundingClientRect();
  const edge = 52;
  calendarDrag.scrollVelocity = clientY < viewport.top + edge ? -12 : clientY > viewport.bottom - edge ? 12 : 0;
}

function runCalendarDragAutoscroll() {
  if (!calendarDrag?.started) return;
  if (calendarDrag.scrollVelocity) {
    const before = els.calendar.scrollTop;
    els.calendar.scrollTop += calendarDrag.scrollVelocity;
    if (els.calendar.scrollTop !== before) {
      updateCalendarDragPosition(calendarDrag.lastPointer.x, calendarDrag.lastPointer.y);
    }
  }
  calendarDrag.raf = requestAnimationFrame(runCalendarDragAutoscroll);
}

function startCalendarDragPreview() {
  const ghost = calendarDrag.source.cloneNode(true);
  ghost.classList.add("calendar-drag-ghost");
  ghost.classList.remove("selected", "interaction-pressed", "interaction-released");
  ghost.removeAttribute("data-select-task");
  ghost.removeAttribute("data-edit-task");
  ghost.removeAttribute("data-calendar-drag-task");
  ghost.removeAttribute("aria-describedby");
  ghost.setAttribute("aria-hidden", "true");
  ghost.tabIndex = -1;
  ghost.style.height = `${calendarDrag.sourceRect.height}px`;
  document.body.append(ghost);
  calendarDrag.ghost = ghost;
  calendarDrag.started = true;
  calendarDrag.source.classList.add("is-drag-source");
  document.body.classList.add("is-calendar-dragging");
  calendarDrag.raf = requestAnimationFrame(runCalendarDragAutoscroll);
}

function clearCalendarDrag() {
  if (!calendarDrag) return;
  cancelAnimationFrame(calendarDrag.raf);
  calendarDrag.targetColumn?.classList.remove("calendar-drop-target");
  calendarDrag.source?.classList.remove("is-drag-source");
  calendarDrag.ghost?.remove();
  document.body.classList.remove("is-calendar-dragging");
  calendarDrag = null;
}

function cancelCalendarDrag({ announce = false } = {}) {
  if (!calendarDrag?.started) { calendarDrag = null; return; }
  clearCalendarDrag();
  if (announce) showToast("Calendar move cancelled.");
}

let modalAnchor = null;
let modalClosing = false;
function openModal(prefill = {}) {
  modalAnchor = DuckPopupMotion.capture(prefill.source || document.activeElement);
  modalClosing = false;
  els.modal.inert = false;
  editingTaskId = prefill.id || null;
  els.form.reset();
  const task = editingTaskId ? tasks.find((item) => item.id === editingTaskId) : null;
  const scheduled = task ? Model.scheduledParts(task) : null;
  els.modalTitle.textContent = task ? "Edit task" : "Add task";
  els.modal.style.setProperty("--popup-tint",modalAnchor?.material.tint || "rgba(248,201,67,.72)");
  els.modal.style.setProperty("--popup-sheen",modalAnchor?.material.sheen || "none");
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
  const choice = task?.reminderChoice;
  els.form.elements.reminderChoice.value = taskReminderChoices.includes(choice) ? choice : "default";
  els.form.elements.actualMinutes.value = task?.actualMinutes ?? "";
  DuckPopupMotion.mark(modalAnchor,"fields");
  DuckPopupMotion.open(els.modal, modalAnchor, () => {
    if (!modalClosing && els.modal.open && (!els.modal.contains(document.activeElement) || document.activeElement === els.modal)) {
      els.form.elements.title.focus({preventScroll:true});
    }
  });
}
function closeModal() {
  if (!els.modal.open || modalClosing) return;
  modalClosing = true;
  els.modal.inert = true;
  DuckPopupMotion.close(els.modal, modalAnchor, () => {
    els.modal.close();
    els.modal.inert = false;
    modalClosing = false;
    const returnTarget = modalAnchor?.element?.isConnected ? modalAnchor.element : document.querySelector(".view.active button");
    returnTarget?.focus({preventScroll:true});
    refreshReminders({ announce: true });
  });
}
els.modal.addEventListener("cancel", event => { event.preventDefault(); closeModal(); });
// Every dismissal path releases modal state only after its return animation.
els.modal.addEventListener("close", () => {
  if (els.modal.open) return;
  DuckPopupMotion.reset(els.modal);
  editingTaskId = null;
});

// Button-origin motion belongs to popout dialogs, not page or calendar changes.
function commitMaterialAction(source, update, event) {
  update();
  setupButtonMaterial();
}

document.addEventListener("click", (event) => {
  if (performance.now() < suppressCalendarEventClickUntil && event.target.closest(".calendar-event-block")) {
    suppressCalendarEventClickUntil = 0;
    event.preventDefault();
    return;
  }
  const drawerDismiss = event.target.closest(".drawer-close,.sidebar-scrim"); if (drawerDismiss) setSidebar(false);
  const viewButton = event.target.closest("[data-view]"); if (viewButton?.matches("button")) commitMaterialAction(viewButton,()=>setView(viewButton.dataset.view,sidebar.contains(viewButton)),event);
  const goButton = event.target.closest("[data-go]"); if (goButton) { event.preventDefault(); commitMaterialAction(goButton,()=>setView(goButton.dataset.go,sidebar.contains(goButton)),event); }
  const dateButton = event.target.closest("[data-date]"); if (dateButton) selectDate(dateButton.dataset.date);
  const slot = event.target.closest("[data-slot-date]"); if (slot) { calendarFocusSlot = { date: slot.dataset.slotDate, time: slot.dataset.slotTime }; openModal({ source: slot, scheduledDate: slot.dataset.slotDate, scheduledTime: slot.dataset.slotTime, dueDate: slot.dataset.slotDate }); }
  const select = event.target.closest("[data-select-task]"); if (select) selectTask(select.dataset.selectTask);
  const edit = event.target.closest("[data-edit-task]"); if (edit) openModal({ source: edit, id: edit.dataset.editTask });
  const collapse = event.target.closest("[data-collapse]"); if (collapse) { collapsed[collapse.dataset.collapse] = !collapsed[collapse.dataset.collapse]; renderDailyPlan(); setupButtonMaterial(); }
});
document.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-task-id]");
  if (!checkbox) return;
  const task = tasks.find((item) => item.id === checkbox.dataset.taskId); if (!task) return;
  store.toggleComplete(task.id, checkbox.checked)
    .then(() => showToast(checkbox.checked ? "Task completed. Nice work!" : "Task returned to your plan."), reportError);
});
document.querySelectorAll(".filter-chip").forEach((chip) => chip.addEventListener("click", () => {
  document.querySelectorAll(".filter-chip").forEach((item) => { item.classList.toggle("active", item === chip); item.setAttribute("aria-pressed", String(item === chip)); });
  currentFilter = chip.dataset.filter; renderAllTasks(); setupButtonMaterial();
}));
document.querySelectorAll("[data-calendar-view]").forEach((button) => button.addEventListener("click", (event) => commitMaterialAction(button,() => { calendarView = button.dataset.calendarView; renderCalendar({ autoScroll: true }); },event)));
sidebarToggles.forEach((toggle) => toggle.addEventListener("click", event => { event.preventDefault(); const nextOpen = !document.body.classList.contains("sidebar-open"); setTaskPanel(false, false); setSidebar(nextOpen); }));
els.taskPanelToggle.addEventListener("click", () => setTaskPanel(!document.body.classList.contains("task-panel-open")));
document.querySelectorAll("[data-close-task-panel]").forEach((button) => button.addEventListener("click", () => setTaskPanel(false)));
compactPlannerQuery.addEventListener("change", () => setTaskPanel(false, false));
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || els.modal.open) return;
  if (calendarDrag?.started) cancelCalendarDrag({ announce: true });
  else if (document.body.classList.contains("task-panel-open")) setTaskPanel(false);
  else if (document.body.classList.contains("sidebar-open")) setSidebar(false);
});
window.addEventListener("hashchange", () => { if (location.hash === "#planner-sidebar") setSidebar(true); });
document.querySelector("#calendar-previous").addEventListener("click", () => selectDate(Model.shiftView(calendarView, selectedDate, -1)));
document.querySelector("#calendar-next").addEventListener("click", () => selectDate(Model.shiftView(calendarView, selectedDate, 1)));
document.querySelector("#calendar-today").addEventListener("click", () => selectDate(nowKey()));
els.calendar.addEventListener("scroll", () => { if (!calendarProgrammaticScroll) calendarUserScrolled = true; }, { passive: true });
els.calendar.addEventListener("pointerdown", (event) => {
  const source = event.target.closest("[data-calendar-drag-task]");
  if (!source || event.button !== 0 || event.isPrimary === false || calendarView === "month") return;
  const task = tasks.find((item) => item.id === source.dataset.calendarDragTask);
  if (!task) return;
  const sourceRect = source.getBoundingClientRect();
  calendarDrag = {
    pointerId: event.pointerId,
    source,
    sourceRect,
    task,
    startX: event.clientX,
    startY: event.clientY,
    offsetY: event.clientY - sourceRect.top,
    lastPointer: { x: event.clientX, y: event.clientY },
    scrollVelocity: 0,
    started: false,
    drop: null,
    ghost: null,
    targetColumn: null,
    raf: 0,
  };
  source.setPointerCapture?.(event.pointerId);
});
els.calendar.addEventListener("pointermove", (event) => {
  if (!calendarDrag || event.pointerId !== calendarDrag.pointerId) return;
  const distance = Math.hypot(event.clientX - calendarDrag.startX, event.clientY - calendarDrag.startY);
  if (!calendarDrag.started && distance < 5) return;
  event.preventDefault();
  if (!calendarDrag.started) startCalendarDragPreview();
  updateCalendarDragPosition(event.clientX, event.clientY);
});
els.calendar.addEventListener("pointerup", (event) => {
  if (!calendarDrag || event.pointerId !== calendarDrag.pointerId) return;
  if (!calendarDrag.started) { calendarDrag = null; return; }
  event.preventDefault();
  const { task, drop } = calendarDrag;
  suppressCalendarEventClickUntil = performance.now() + 650;
  clearCalendarDrag();
  if (drop) moveCalendarTask(task, drop);
});
els.calendar.addEventListener("pointercancel", (event) => {
  if (calendarDrag && event.pointerId === calendarDrag.pointerId) cancelCalendarDrag();
});
els.calendar.addEventListener("keydown", (event) => {
  const scheduledEvent = event.target.closest("[data-calendar-drag-task]");
  if (scheduledEvent && event.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    const task = tasks.find((item) => item.id === scheduledEvent.dataset.calendarDragTask);
    const parts = task && Model.scheduledParts(task);
    if (!task || !parts) return;
    event.preventDefault();
    const duration = Number(task.durationMinutes || 45);
    const minimum = 7 * 60;
    const maximum = 22 * 60 - duration;
    let date = parts.date;
    let minutes = parts.minutes;
    if (event.key === "ArrowUp") minutes -= 15;
    if (event.key === "ArrowDown") minutes += 15;
    if (event.key === "ArrowLeft") date = Model.addDays(date, -1);
    if (event.key === "ArrowRight") date = Model.addDays(date, 1);
    minutes = Math.max(minimum, Math.min(maximum, minutes));
    moveCalendarTask(task, { date, minutes, time: Model.timeFromMinutes(minutes) }, { focus: true });
    return;
  }
  const slot = event.target.closest(".calendar-slot");
  if (!slot || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const dates = Model.datesForView(calendarView, selectedDate);
  const next = PlannerUI.nextSlot({ date: slot.dataset.slotDate, time: slot.dataset.slotTime }, event.key, dates);
  const target = els.calendar.querySelector(`[data-slot-date="${next.date}"][data-slot-time="${next.time}"]`);
  if (!target) return;
  slot.tabIndex = -1;
  target.tabIndex = 0;
  calendarFocusSlot = next;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest", inline: "nearest" });
});
document.querySelector("#plan-selected-date").addEventListener("click", event => openModal({ source: event.currentTarget, dueDate: selectedDate }));
document.querySelector("#open-task-modal").addEventListener("click", event => openModal({ source: event.currentTarget, dueDate: selectedDate }));
document.querySelector("#close-task-modal").addEventListener("click", closeModal);
document.querySelector("#cancel-task").addEventListener("click", closeModal);
els.modal.addEventListener("click", event => {
  if (event.target !== els.modal) return;
  const box=els.modal.getBoundingClientRect();
  if(event.clientX<box.left || event.clientX>box.right || event.clientY<box.top || event.clientY>box.bottom)closeModal();
});
els.search.addEventListener("input", () => { searchTerm = els.search.value.trim().toLowerCase(); if (searchTerm) setView("tasks"); renderAllTasks(); });
els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(els.form); const title = form.get("title").trim(); if (!title) return;
  const wasEditing = Boolean(editingTaskId);
  const scheduledDate = form.get("scheduledDate"); const scheduledTime = form.get("scheduledTime");
  const existing = editingTaskId ? tasks.find((task) => task.id === editingTaskId) : null;
  const next = { ...existing, title, classId: form.get("classId") || null, priority: form.get("priority"), dueDate: form.get("dueDate"), dueTime: form.get("dueTime"), scheduledStart: scheduledDate && scheduledTime ? `${scheduledDate}T${scheduledTime}` : null, scheduledEnd: null, durationMinutes: Number(form.get("durationMinutes") || 45), schemaVersion: 2 };
  const reminderChoice = form.get("reminderChoice");
  next.reminderChoice = taskReminderChoices.includes(reminderChoice) ? reminderChoice : "default";
  const loggedMinutes = form.get("actualMinutes");
  next.actualMinutes = loggedMinutes === "" ? null : Number(loggedMinutes);
  closeModal();
  store.upsertItem(next).then(() => showToast(wasEditing ? "Task updated." : "Task added to your plan."), reportError);
});
els.deleteTask.addEventListener("click", () => {
  if (!editingTaskId) return;
  const deletedTask = tasks.find((task) => task.id === editingTaskId);
  if (!deletedTask) return;
  closeModal();
  store.deleteItem(deletedTask.id).then(() => showToast("Task deleted."), reportError);
});
document.querySelector("#notification-button").addEventListener("click", () => {
  setView("settings");
  refreshReminders();
  document.querySelector("#reminders-heading").focus();
});
notificationPermissionButton.addEventListener("click", async () => {
  const state = notificationCapability();
  if (state === "granted") {
    const icon = new URL("./assets/duckplan-mascot-v8.png", location.href).href;
    const result = displayBrowserNotification(BrowserNotifications.testNotification({ icon }));
    showToast(result.status === "submitted"
      ? "Test submitted to your browser; device display is not confirmed."
      : "The browser could not submit the test. In-app reminders still work.");
    return;
  }
  if (state !== "default") return;
  notificationPermissionButton.disabled = true;
  try {
    await window.Notification.requestPermission();
  } catch {
    showToast("The browser could not open notification permission settings.");
  } finally {
    const nextState = updateNotificationPermission();
    if (nextState !== "default") {
      showToast(nextState === "granted"
        ? "Device notifications enabled."
        : "Device notifications were not enabled. In-app reminders will still work.");
    }
  }
});
reminderToggle.addEventListener("change", () => {
  reminderSettings.enabled = reminderToggle.checked;
  saveReminderSettings();
  refreshReminders({ announce: true });
});
reminderLead.addEventListener("change", () => {
  reminderSettings.lead = Number(reminderLead.value);
  saveReminderSettings();
  refreshReminders({ announce: true });
});
els.accountSettings.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const value = (name) => String(data.get(name) || "");
  if (form.id === "sign-in-form") {
    const email = value("email").trim();
    if (event.submitter?.dataset.action === "sign-up") runAction(event.submitter, async () => { accountMode = null; showRecoveryCode(await store.signUp(email, value("password"))); showToast("Account created. Save your recovery code."); });
    else runAction(event.submitter, async () => { accountMode = null; await store.signIn(email, value("password")); showToast(`Signed in as ${email}.`); });
  }
  if (form.id === "recover-form") runAction(event.submitter, async () => { accountMode = null; showRecoveryCode(await store.recoverAccount(value("email").trim(), value("recoveryCode"), value("newPassword"))); showToast("Password reset. Save your new recovery code."); });
  if (form.id === "password-form") runAction(event.submitter, async () => { const code = await store.changePassword(value("currentPassword"), value("newPassword")); setAccountMode(null, { focus: false }); showRecoveryCode(code); showToast("Password saved."); });
  if (form.id === "recovery-code-form") runAction(event.submitter, async () => { showRecoveryCode(await store.newRecoveryCode(value("password"))); showToast("New recovery code created."); });
});
els.accountSettings.addEventListener("click", (event) => {
  const button = event.target.closest("button"); if (!button) return;
  if (button.id === "google-sign-in") runAction(button, () => store.signInWithGoogle());
  if (button.id === "show-recover") setAccountMode("recover");
  if (button.id === "show-sign-in") setAccountMode("sign-in");
  if (button.id === "show-change-password") setAccountMode("change-password");
  if (button.id === "show-recovery-code") setAccountMode("recovery-code");
  if (button.id === "cancel-account-form") setAccountMode(null, { focus: false });
  if (button.id === "copy-recovery") runAction(button, async () => { await navigator.clipboard.writeText(shownRecoveryCode); showToast("Recovery code copied."); });
  if (button.id === "dismiss-recovery") { shownRecoveryCode = null; setAccountMode(accountMode, { focus: false }); }
  if (button.id === "sign-out") runAction(button, async () => { shownRecoveryCode = null; accountMode = "sign-in"; await store.signOut(); showToast("Signed out. Showing local tasks."); });
  if (button.id === "dismiss-import") { store.dismissLocalImport(); refreshAccountState(); }
  if (button.id === "import-local") runAction(button, async () => { const count = await store.importLocalTasks(); showToast(`Imported ${count} task${count === 1 ? "" : "s"}.`); await refreshAccountState(); });
});
els.axisSettings.addEventListener("submit", (event) => {
  if (event.target.id !== "axis-form") return;
  event.preventDefault();
  const input = event.target.elements.icalUrl;
  let link;
  try { link = window.DuckAxisIcal.normalizeFeedUrl(input.value); }
  catch (error) { showToast(error.message); input.focus(); return; }
  runAction(event.submitter, async () => {
    showToast("Connecting to Axis…");
    const result = await store.connectAxis(link);
    showToast(`Axis connected: ${result.added} assignments and ${result.classesAdded} classes imported.`);
    await refreshAccountState();
  });
});
els.axisSettings.addEventListener("click", (event) => {
  const button = event.target.closest("button"); if (!button) return;
  if (button.id === "connect-axis") { els.accountSettings.querySelector("input[name=email]")?.focus(); showToast(store.configured ? "Sign in first, then connect Axis." : "Cloud sync is unavailable on this copy."); }
  if (button.id === "axis-sync-now") runAction(button, syncAxisNow);
  if (button.id === "axis-disconnect") runAction(button, async () => { await store.disconnectAxis(); showToast("Axis disconnected. Imported assignments remain."); await refreshAccountState(); });
});
els.syncInfo.addEventListener("click", () => {
  if (store.mode === "cloud" && axisStatus.connected) runAction(els.syncInfo, syncAxisNow);
  else { setView("settings"); showToast(store.mode === "cloud" ? "Paste your Axis feed link to connect." : "Sign in to connect Axis."); }
});
els.resetDemo.addEventListener("click", () => { store.resetLocalDemo().then(() => { selectedDate = nowKey(); showToast("Demo tasks reset."); }, reportError); });

function refreshDateBoundary() {
  const nextToday = nowKey();
  if (nextToday === observedToday) return;
  if (selectedDate === observedToday) selectedDate = nextToday;
  observedToday = nextToday; renderAll({ autoScrollCalendar: true });
}
function refreshPlannerClock() {
  refreshDateBoundary();
  refreshReminders({ announce: true });
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshPlannerClock(); });
window.addEventListener("focus", () => { updateNotificationPermission(); refreshPlannerClock(); });
setInterval(refreshPlannerClock, 60000);

const requestedView = location.hash.replace("#", "");
renderAll({ autoScrollCalendar: true });
renderAccount();
renderAxis();
setView(document.querySelector(`#view-${requestedView}`) || ["today", "calendar"].includes(requestedView) ? requestedView : "home");
setTaskPanel(false, false);

refreshReminders({ announce: true });
updateNotificationPermission();

// Warm the existing form while closed; no modal, focus or user data is changed.
setupButtonMaterial(els.modal);
DuckPopupMotion.schedulePrepare(els.modal);
document.fonts?.ready.then(() => DuckPopupMotion.schedulePrepare(els.modal));

store.subscribe(({ reason }) => {
  renderAll();
  if (reason === "load" || reason === "auth") refreshAccountState();
});
store.init().then(() => {
  const problem = store.takeAuthError();
  if (problem) showToast(problem);
}, reportError);
