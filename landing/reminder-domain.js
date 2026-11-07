(function reminderDomainFactory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DuckReminderDomain = api;
})(typeof window !== "undefined" ? window : globalThis, function buildReminderDomain() {
  const MINUTE_MS = 60_000;
  const DEFAULT_UNTIMED_DUE = "23:59";
  const DEFAULT_MISSED_GRACE_MINUTES = 60;
  const MAX_LEAD_MINUTES = 60 * 24 * 30;
  const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

  function browserTimeZone(IntlApi = Intl) {
    try { return IntlApi.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
    catch { return "UTC"; }
  }

  function parseWallTime(dateValue, timeValue) {
    const dateMatch = DATE_PATTERN.exec(String(dateValue || ""));
    const timeMatch = TIME_PATTERN.exec(String(timeValue || ""));
    if (!dateMatch || !timeMatch) return null;
    const parts = {
      year: Number(dateMatch[1]), month: Number(dateMatch[2]), day: Number(dateMatch[3]),
      hour: Number(timeMatch[1]), minute: Number(timeMatch[2]),
    };
    const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (probe.getUTCFullYear() !== parts.year || probe.getUTCMonth() !== parts.month - 1 || probe.getUTCDate() !== parts.day) return null;
    return parts;
  }

  function partsAt(epoch, timeZone, IntlApi = Intl) {
    const formatter = new IntlApi.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    const values = {};
    formatter.formatToParts(new Date(epoch)).forEach((part) => {
      if (part.type !== "literal") values[part.type] = Number(part.value);
    });
    return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute };
  }

  function sameParts(left, right) {
    return left.year === right.year && left.month === right.month && left.day === right.day
      && left.hour === right.hour && left.minute === right.minute;
  }

  // Resolve a wall-clock deadline in an explicit IANA zone. Sampling offsets on both sides of
  // the target makes DST overlaps deterministic (the earlier instant wins) and DST gaps invalid.
  function wallTimeToEpoch(dateValue, timeValue, timeZone, IntlApi = Intl) {
    const desired = parseWallTime(dateValue, timeValue);
    if (!desired) return { ok: false, reason: "invalid-wall-time" };
    const zone = String(timeZone || "UTC");
    const naive = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute);
    try {
      const offsets = new Set();
      [-36, -12, 0, 12, 36].forEach((hours) => {
        const sample = naive + hours * 60 * MINUTE_MS;
        const actual = partsAt(sample, zone, IntlApi);
        offsets.add(Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute) - sample);
      });
      const matches = [...offsets]
        .map((offset) => naive - offset)
        .filter((candidate) => sameParts(partsAt(candidate, zone, IntlApi), desired))
        .sort((a, b) => a - b);
      if (!matches.length) return { ok: false, reason: "nonexistent-wall-time" };
      return { ok: true, epoch: matches[0], ambiguous: matches.length > 1 };
    } catch {
      return { ok: false, reason: "invalid-time-zone" };
    }
  }

  function encodeIdentityPart(value) { return encodeURIComponent(String(value)); }
  function hashIdentity(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function inactive(status, extra = {}) {
    return { status, eligible: false, occurrenceId: null, displayTag: null, ...extra };
  }

  function calculateOccurrence({
    taskId,
    dueDate,
    dueTime,
    leadMinutes,
    enabled = true,
    completed = false,
    deleted = false,
    evaluationTime = Date.now(),
    timeZone = browserTimeZone(),
    missedGraceMinutes = DEFAULT_MISSED_GRACE_MINUTES,
  } = {}) {
    if (!enabled) return inactive("disabled");
    if (deleted) return inactive("deleted");
    if (completed) return inactive("completed");
    if (!taskId) return inactive("invalid-task");
    if (!dueDate) return inactive("missing-deadline");
    const lead = Number(leadMinutes);
    if (!Number.isInteger(lead) || lead < 0 || lead > MAX_LEAD_MINUTES) return inactive("invalid-lead");
    const grace = Number(missedGraceMinutes);
    if (!Number.isInteger(grace) || grace < 0 || grace > 24 * 60) return inactive("invalid-grace");
    const effectiveTime = dueTime || DEFAULT_UNTIMED_DUE;
    const resolved = wallTimeToEpoch(dueDate, effectiveTime, timeZone);
    if (!resolved.ok) return inactive("invalid-deadline", { reason: resolved.reason });

    const identity = ["v2", taskId, dueDate, effectiveTime, lead, timeZone].map(encodeIdentityPart).join(":");
    const deadlineAt = resolved.epoch;
    const triggerAt = deadlineAt - lead * MINUTE_MS;
    const graceEndsAt = deadlineAt + grace * MINUTE_MS;
    const now = Number(evaluationTime);
    let status = "pending";
    if (!Number.isFinite(now)) status = "invalid-evaluation-time";
    else if (now > graceEndsAt) status = "expired";
    else if (now > deadlineAt) status = "missed";
    else if (now >= triggerAt) status = "due";
    return {
      taskId: String(taskId),
      occurrenceId: identity,
      displayTag: `duckplan-reminder-${hashIdentity(identity)}`,
      status,
      eligible: status === "due" || status === "missed",
      dueDate,
      dueTime: effectiveTime,
      isUntimed: !dueTime,
      leadMinutes: lead,
      timeZone,
      deadlineAt,
      triggerAt,
      graceEndsAt,
      ambiguousWallTime: resolved.ambiguous,
    };
  }

  return {
    DEFAULT_MISSED_GRACE_MINUTES,
    DEFAULT_UNTIMED_DUE,
    MAX_LEAD_MINUTES,
    MINUTE_MS,
    browserTimeZone,
    calculateOccurrence,
    wallTimeToEpoch,
  };
});
