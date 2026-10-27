const CLASS_INFO = {
  Calculus: { color: "#538fc5", soft: "#e3f0fa", code: "M", teacher: "Ms. Nguyen", period: "Period 2" },
  English: { color: "#d96f63", soft: "#fce7e1", code: "E", teacher: "Mr. Ramirez", period: "Period 4" },
  Physics: { color: "#7d6fbd", soft: "#ece9f8", code: "P", teacher: "Dr. Shah", period: "Period 5" },
  "Computer Science": { color: "#3e946d", soft: "#deeee6", code: "CS", teacher: "Ms. Chen", period: "Period 7" },
  Personal: { color: "#c48b34", soft: "#fff2c2", code: "★", teacher: "Personal", period: "Anytime" },
};

const STORAGE_KEY = "duckplan-demo-tasks-v1";
const DAY = 86400000;
const today = startOfDay(new Date());

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function isoOffset(offset) {
  const date = new Date(today.getTime() + offset * DAY);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const DEFAULT_TASKS = [
  { id: "calculus-practice", title: "Finish calculus practice set", className: "Calculus", dueDate: isoOffset(0), dueTime: "15:30", priority: "High", completed: false },
  { id: "english-response", title: "Submit reading response", className: "English", dueDate: isoOffset(0), dueTime: "18:00", priority: "Medium", completed: false },
  { id: "physics-notes", title: "Organize lab notes", className: "Physics", dueDate: isoOffset(1), dueTime: "09:00", priority: "Medium", completed: false },
  { id: "cs-wireframe", title: "Review app wireframe", className: "Computer Science", dueDate: isoOffset(2), dueTime: "14:15", priority: "Low", completed: false },
  { id: "english-vocab", title: "Study vocabulary cards", className: "English", dueDate: isoOffset(3), dueTime: "16:00", priority: "Medium", completed: false },
  { id: "physics-quiz", title: "Complete motion quiz", className: "Physics", dueDate: isoOffset(-1), dueTime: "12:30", priority: "High", completed: true },
  { id: "backpack", title: "Pack materials for Monday", className: "Personal", dueDate: isoOffset(0), dueTime: "20:00", priority: "Low", completed: true },
];

let tasks = loadTasks();
let currentFilter = "all";
let searchTerm = "";
let weekOffset = 0;
let toastTimer;

const els = {
  navItems: [...document.querySelectorAll("[data-view]")],
  views: [...document.querySelectorAll(".view")],
  pageTitle: document.querySelector("#page-title"),
  pageEyebrow: document.querySelector("#page-eyebrow"),
  todayList: document.querySelector("#today-task-list"),
  allList: document.querySelector("#all-task-list"),
  taskEmpty: document.querySelector("#task-empty"),
  taskCount: document.querySelector("#task-count"),
  doneCount: document.querySelector("#done-count"),
  totalCount: document.querySelector("#total-count"),
  progressFill: document.querySelector("#progress-fill"),
  miniClassList: document.querySelector("#mini-class-list"),
  classGrid: document.querySelector("#class-grid"),
  calendar: document.querySelector("#week-calendar"),
  calendarRange: document.querySelector("#calendar-range"),
  search: document.querySelector("#global-search"),
  modal: document.querySelector("#task-modal"),
  form: document.querySelector("#task-form"),
  toast: document.querySelector("#toast"),
};

function loadTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) && saved.length ? saved : structuredClone(DEFAULT_TASKS);
  } catch {
    return structuredClone(DEFAULT_TASKS);
  }
}

function saveTasks() { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); }

function formatTime(value) {
  if (!value) return "Anytime";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2020, 0, 1, hour, minute));
}

function formatDay(dateValue) {
  const date = startOfDay(new Date(`${dateValue}T00:00:00`));
  const difference = Math.round((date - today) / DAY);
  if (difference === 0) return "Today";
  if (difference === 1) return "Tomorrow";
  if (difference === -1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function safeText(value) {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}

function taskMarkup(task, expanded = false) {
  const info = CLASS_INFO[task.className] || CLASS_INFO.Personal;
  return `<label class="task-row ${task.completed ? "completed" : ""}" style="--course-color:${info.color};--course-soft:${info.soft}">
    <input class="task-check" type="checkbox" data-task-id="${task.id}" ${task.completed ? "checked" : ""} aria-label="Mark ${safeText(task.title)} complete" />
    <span class="task-main"><span class="task-title">${safeText(task.title)}</span><span class="task-meta"><span class="course-dot"></span>${safeText(task.className)}${expanded ? ` · ${safeText(info.period)}` : ""}${task.priority === "High" ? '<span class="priority-tag">High</span>' : ""}</span></span>
    <span class="task-due"><strong>${formatDay(task.dueDate)}</strong><small>${formatTime(task.dueTime)}</small></span>
  </label>`;
}

function renderTasks() {
  const sorted = [...tasks].sort((a, b) => `${a.dueDate}${a.dueTime}`.localeCompare(`${b.dueDate}${b.dueTime}`));
  const todayTasks = sorted.filter((task) => task.dueDate === isoOffset(0)).slice(0, 5);
  els.todayList.innerHTML = todayTasks.map((task) => taskMarkup(task)).join("");
  const filtered = sorted.filter((task) => {
    const matchesSearch = !searchTerm || `${task.title} ${task.className}`.toLowerCase().includes(searchTerm);
    if (!matchesSearch) return false;
    if (currentFilter === "today") return task.dueDate === isoOffset(0) && !task.completed;
    if (currentFilter === "upcoming") return task.dueDate > isoOffset(0) && !task.completed;
    if (currentFilter === "done") return task.completed;
    return true;
  });
  els.allList.innerHTML = filtered.map((task) => taskMarkup(task, true)).join("");
  els.taskEmpty.hidden = filtered.length > 0;
  const done = tasks.filter((task) => task.completed).length;
  els.doneCount.textContent = done;
  els.totalCount.textContent = tasks.length;
  els.taskCount.textContent = tasks.length - done;
  els.progressFill.style.width = `${tasks.length ? (done / tasks.length) * 100 : 0}%`;
}

function renderClasses() {
  if (window.DuckFur) els.classGrid.querySelectorAll("button").forEach((button) => window.DuckFur.unmount(button));
  const entries = Object.entries(CLASS_INFO);
  els.miniClassList.innerHTML = entries.slice(0, 4).map(([name, info]) => {
    const open = tasks.filter((task) => task.className === name && !task.completed).length;
    return `<div class="mini-class-row" style="--course-color:${info.color};--course-soft:${info.soft}"><span class="mini-class-icon">${info.code}</span><span><strong>${name}</strong><small>${info.period}</small></span><span>${open} open</span></div>`;
  }).join("");
  els.classGrid.innerHTML = entries.map(([name, info]) => {
    const classTasks = tasks.filter((task) => task.className === name);
    const open = classTasks.filter((task) => !task.completed).length;
    return `<article class="class-card" style="--course-color:${info.color};--course-soft:${info.soft}"><div class="class-card-head"><span class="class-card-icon">${info.code}</span><button class="class-menu" type="button" aria-label="More options for ${name}">•••</button></div><h2>${name}</h2><p>${info.teacher} · ${info.period}</p><div class="class-stats"><div><strong>${open}</strong><span>Open tasks</span></div><div><strong>${classTasks.length}</strong><span>Total items</span></div></div></article>`;
  }).join("");
}

function mondayFor(date) {
  const result = startOfDay(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

function renderCalendar() {
  const monday = mondayFor(new Date(today.getTime() + weekOffset * 7 * DAY));
  const sunday = new Date(monday.getTime() + 6 * DAY);
  const first = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(monday);
  const last = new Intl.DateTimeFormat(undefined, { month: monday.getMonth() === sunday.getMonth() ? undefined : "long", day: "numeric" }).format(sunday);
  els.calendarRange.textContent = `${first}–${last}`;
  els.calendar.innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday.getTime() + index * DAY);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const events = tasks.filter((task) => task.dueDate === iso);
    const eventMarkup = events.map((task) => {
      const info = CLASS_INFO[task.className] || CLASS_INFO.Personal;
      return `<div class="calendar-event" style="--course-color:${info.color};--course-soft:${info.soft}"><strong>${safeText(task.title)}</strong><small>${formatTime(task.dueTime)} · ${safeText(task.className)}</small></div>`;
    }).join("");
    return `<section class="day-column ${iso === isoOffset(0) ? "today" : ""}"><div class="day-head"><span>${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)}</span><strong>${date.getDate()}</strong></div>${eventMarkup}</section>`;
  }).join("");
}

function furLabelForButton(button) {
  const navLabel = button.matches(".nav-item") ? button.querySelector("span:not(.nav-icon):not(.nav-count)")?.textContent : "";
  if (navLabel?.trim()) return navLabel.trim();
  const profileLabel = button.matches(".profile-card") ? button.querySelector("strong")?.textContent : "";
  if (profileLabel?.trim()) return profileLabel.trim();
  const iconLabel = button.matches(".icon-button") ? button.querySelector("[aria-hidden='true']")?.textContent : "";
  if (iconLabel?.trim()) return iconLabel.trim();

  const clone = button.cloneNode(true);
  clone.querySelectorAll(".notification-dot, .nav-count, small, [aria-hidden='true']").forEach((element) => element.remove());
  const visibleText = clone.textContent.replace(/\s+/g, " ").trim().replace(/[→←›]+$/, "").trim();
  return visibleText || button.getAttribute("aria-label") || "Button";
}

function shouldUseFurButton(button) {
  if (button.matches("[data-fur-button]")) return true;
  if (button.matches(".nav-item, .icon-button, .profile-card, .class-menu, .close-button, #sync-info")) return false;
  if (button.querySelector("[aria-hidden='true'], .notification-dot, .nav-icon, .nav-count, .avatar, small")) return false;
  const text = button.textContent.replace(/\s+/g, " ").trim();
  if (!text || !/[a-z0-9]/i.test(text)) return false;
  return !/[→←›×♢⌂□✓◫⚙＋•]/u.test(text);
}

function setupFurMaterial(root = document) {
  if (!window.DuckFur) return;
  const modalIsOpen = els.modal.open;
  root.querySelectorAll("button").forEach((button) => {
    const shouldMount = shouldUseFurButton(button)
      && button.getClientRects().length
      && (!modalIsOpen || els.modal.contains(button));
    if (!shouldMount) {
      window.DuckFur.unmount(button);
      return;
    }
    window.DuckFur.mount(button, {
      quality: "medium",
      density: 1,
      length: 5.2,
      stiffness: 62,
      damping: 22,
      radius: 12.8,
      pressRadius: 38.4,
      recoveryDelay: 280,
      pressDepth: 0.78,
      compression: 0.92,
      splay: 0.76,
      transitionWidth: 0.36,
      labelScale: 2,
      labelSharpness: 1.15,
      labelLengthScale: 0.8,
      labelWidthScale: 0.9,
      labelOrientationVariance: 0.06,
      labelDensity: 2.4,
      glyphTransition: 0.55,
      glyphGuardWidth: 1.4,
      glyphGuardStrength: 0.9,
      motionGuardStart: 0.12,
      motionGuardEnd: 0.58,
      boundaryLabelWidthScale: 0.72,
      boundaryLabelLeanScale: 0.62,
      fragmentGlyphMask: true,
      silhouette: true,
      label: furLabelForButton(button),
    });
  });
}

function renderAll() { renderTasks(); renderClasses(); renderCalendar(); setupFurMaterial(); }

function setView(name) {
  const next = document.querySelector(`#view-${name}`) || document.querySelector("#view-today");
  els.views.forEach((view) => view.classList.toggle("active", view === next));
  els.navItems.forEach((item) => {
    const isActive = item.dataset.view === name;
    item.classList.toggle("active", isActive);
    if (isActive) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  els.pageTitle.textContent = next.dataset.pageTitle;
  els.pageEyebrow.textContent = next.dataset.eyebrow;
  history.replaceState(null, "", `#${name}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
  setupFurMaterial();
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function toggleTask(event) {
  const checkbox = event.target.closest("[data-task-id]");
  if (!checkbox) return;
  const task = tasks.find((item) => item.id === checkbox.dataset.taskId);
  if (!task) return;
  task.completed = checkbox.checked;
  saveTasks();
  renderAll();
  showToast(task.completed ? "Task completed. Nice work!" : "Task moved back to your list.");
}

document.addEventListener("change", toggleTask);
els.navItems.forEach((item) => item.addEventListener("click", () => setView(item.dataset.view)));
document.querySelectorAll("[data-go]").forEach((item) => item.addEventListener("click", (event) => { event.preventDefault(); setView(item.dataset.go); }));
document.querySelectorAll(".filter-chip").forEach((chip) => chip.addEventListener("click", () => {
  document.querySelectorAll(".filter-chip").forEach((item) => {
    item.classList.remove("active");
    item.setAttribute("aria-pressed", "false");
  });
  chip.classList.add("active");
  chip.setAttribute("aria-pressed", "true");
  currentFilter = chip.dataset.filter;
  renderTasks();
}));

els.search.addEventListener("input", () => { searchTerm = els.search.value.trim().toLowerCase(); if (searchTerm) setView("tasks"); renderTasks(); });
document.querySelector("#previous-week").addEventListener("click", () => { weekOffset -= 1; renderCalendar(); });
document.querySelector("#next-week").addEventListener("click", () => { weekOffset += 1; renderCalendar(); });
document.querySelector("#current-week").addEventListener("click", () => { weekOffset = 0; renderCalendar(); });

const openModal = () => {
  els.form.reset();
  els.form.elements.dueDate.value = isoOffset(0);
  els.form.elements.dueTime.value = "15:30";
  els.modal.showModal();
  setupFurMaterial();
  els.form.elements.title.focus();
};
const closeModal = () => {
  els.modal.close();
  setupFurMaterial();
};
document.querySelector("#open-task-modal").addEventListener("click", openModal);
document.querySelector("#close-task-modal").addEventListener("click", closeModal);
document.querySelector("#cancel-task").addEventListener("click", closeModal);
els.modal.addEventListener("click", (event) => { if (event.target === els.modal) closeModal(); });

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(els.form);
  const title = form.get("title").trim();
  if (!title) return;
  tasks.push({ id: `task-${Date.now()}`, title, className: form.get("className"), priority: form.get("priority"), dueDate: form.get("dueDate"), dueTime: form.get("dueTime"), completed: false });
  saveTasks();
  renderAll();
  closeModal();
  showToast("Task added to your plan.");
});

document.querySelector("[data-focus-task]").addEventListener("click", () => showToast("Focus timer is planned for the next prototype."));
document.querySelector("#notification-button").addEventListener("click", () => showToast("You are all caught up."));
document.querySelector("#sync-info").addEventListener("click", () => showToast("Axis sync will use an API or iCal feed once access is confirmed."));
document.querySelector("#connect-axis").addEventListener("click", () => showToast("Axis connection is intentionally disabled in this front-end draft."));
document.querySelector("#reset-demo").addEventListener("click", () => { tasks = structuredClone(DEFAULT_TASKS); saveTasks(); renderAll(); showToast("Demo tasks reset."); });

const requestedView = location.hash.replace("#", "");
renderAll();
setView(document.querySelector(`#view-${requestedView}`) ? requestedView : "today");
