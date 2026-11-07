(function browserNotificationsFactory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DuckBrowserNotifications = api;
})(typeof window !== "undefined" ? window : globalThis, function buildBrowserNotifications() {
  function capability(NotificationApi, { isSecureContext = true, constructorFailed = false } = {}) {
    if (!isSecureContext || !NotificationApi || typeof NotificationApi.requestPermission !== "function") return "unsupported";
    const permission = ["default", "granted", "denied"].includes(NotificationApi.permission)
      ? NotificationApi.permission
      : "unsupported";
    if (permission === "granted" && (typeof NotificationApi !== "function" || constructorFailed)) return "granted-unusable";
    return permission;
  }

  function settingsCopy(state) {
    if (state === "granted") {
      return { label: "Allowed · open-page", action: "Try a test notification", disabled: false };
    }
    if (state === "granted-unusable") {
      return { label: "Allowed · unavailable here", action: "Device delivery unavailable", disabled: true };
    }
    if (state === "denied") {
      return { label: "Blocked in browser", action: "Notifications blocked", disabled: true };
    }
    if (state === "default") {
      return { label: "Not allowed yet", action: "Allow device notifications", disabled: false };
    }
    return { label: "Not supported", action: "Device notifications unavailable", disabled: true };
  }

  function formatDue(deadline, locale) {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(deadline));
  }

  function taskNotification(task, occurrence, options = {}) {
    const className = task.className ? `${task.className} · ` : "";
    return {
      title: "DuckPlan deadline reminder",
      options: {
        body: `${task.title}\n${className}Due ${formatDue(occurrence.deadlineAt, options.locale)}`,
        icon: options.icon,
        badge: options.badge || options.icon,
        tag: occurrence.displayTag,
        renotify: false,
        data: { taskId: task.id, occurrenceId: occurrence.occurrenceId, dueDate: task.dueDate || null },
      },
    };
  }

  function testNotification(options = {}) {
    return {
      title: "DuckPlan notifications are ready",
      options: {
        body: "DuckPlan submitted this test while the planner is open. Your browser and device decide whether it appears.",
        icon: options.icon,
        badge: options.badge || options.icon,
        tag: "duckplan-notification-test",
        renotify: false,
      },
    };
  }

  function createNotification(NotificationApi, payload) {
    try {
      const notification = new NotificationApi(payload.title, payload.options);
      return { status: "submitted", notification };
    } catch (error) {
      return { status: "failed", reason: String(error?.message || error || "Notification unavailable") };
    }
  }

  function resolveTaskTarget(tasks, taskId) {
    const task = Array.isArray(tasks) ? tasks.find((item) => String(item.id) === String(taskId)) : null;
    return task
      ? { status: "found", task, date: task.dueDate || null }
      : { status: "missing", task: null, date: null };
  }

  return { capability, createNotification, resolveTaskTarget, settingsCopy, taskNotification, testNotification };
});
