(function axisIcalFactory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DuckAxisIcal = api;
})(typeof window !== "undefined" ? window : globalThis, function buildAxisIcal() {
  // Keep supabase/functions/axis-sync/ical-parser.js byte-identical to this file (a test checks it).
  const CLASS_COLORS = ["#538fc5", "#d96f63", "#7d6fbd", "#3e946d", "#c48b34", "#c4568f", "#2f8f9d", "#8a7a3a", "#5b6fd6", "#b8613a"];
  const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

  function unfoldLines(text) {
    return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  }
  function parseProperty(line) {
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === "\"") quoted = !quoted;
      else if (char === ":" && !quoted) {
        const [name, ...rawParams] = line.slice(0, index).split(";");
        const params = {};
        rawParams.forEach((param) => {
          const [key, ...rest] = param.split("=");
          params[key.toUpperCase()] = rest.join("=").replace(/^"|"$/g, "");
        });
        return { name: name.toUpperCase(), params, value: line.slice(index + 1) };
      }
    }
    return null;
  }
  function unescapeText(value) {
    return String(value || "").replace(/\\([\\;,nN])/g, (_, char) => (char === "n" || char === "N" ? "\n" : char));
  }
  function decodeEntities(value) {
    return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
      if (body[0] === "#") {
        const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code > 0x10ffff) return match;
        return code === 160 ? " " : String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    });
  }
  function toPlainText(value) {
    const withBreaks = unescapeText(value).replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n").replace(/<[^>]*>/g, "");
    return decodeEntities(withBreaks).replace(/[ \t ]+/g, " ").split("\n").map((line) => line.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function parseDateValue(value) {
    const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z)?)?$/.exec(String(value || "").trim());
    if (!match) return null;
    // UTC times can't be turned into a local wall-clock time without the student's zone, so keep only the date.
    const time = match[4] && !match[6] ? `${match[4]}:${match[5]}` : null;
    return { date: `${match[1]}-${match[2]}-${match[3]}`, time };
  }

  function splitTitle(summary) {
    const text = toPlainText(summary);
    const index = text.indexOf(": ");
    if (index <= 0) return { classKey: null, courseName: null, section: null, title: text || "Untitled item" };
    const classKey = text.slice(0, index).trim();
    const sectionMatch = /^(.+) - (\S+)$/.exec(classKey);
    return {
      classKey,
      courseName: sectionMatch ? sectionMatch[1].trim() : classKey,
      section: sectionMatch ? sectionMatch[2] : null,
      title: text.slice(index + 2).trim() || "Untitled item",
    };
  }
  function itemTypeForTitle(title) {
    return /\b(quiz(zes)?|tests?|exams?)\b/i.test(title) ? "test" : "assignment";
  }
  function classCode(courseName) {
    const words = String(courseName || "").replace(/\([^)]*\)/g, " ").replace(/[^\p{L}\p{N}\s-]/gu, "").split(/[\s-]+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word[0].toUpperCase()).join("") || "★";
  }
  function pickClassColor(index) {
    return CLASS_COLORS[((index % CLASS_COLORS.length) + CLASS_COLORS.length) % CLASS_COLORS.length];
  }

  function parseEvents(text) {
    const events = [];
    let current = null;
    for (const line of unfoldLines(text)) {
      if (!line.trim()) continue;
      const property = parseProperty(line);
      if (!property) continue;
      if (property.name === "BEGIN" && property.value.toUpperCase() === "VEVENT") current = {};
      else if (property.name === "END" && property.value.toUpperCase() === "VEVENT") { if (current) events.push(current); current = null; }
      else if (current && !(property.name in current)) current[property.name] = property;
    }
    return events;
  }
  function parseAxisFeed(text) {
    const byUid = new Map();
    const classes = new Map();
    for (const event of parseEvents(text)) {
      const uid = event.UID?.value.trim();
      const start = parseDateValue(event.DTSTART?.value);
      if (!uid || !start) continue;
      const parts = splitTitle(event.SUMMARY?.value);
      if (parts.classKey && !classes.has(parts.classKey)) {
        classes.set(parts.classKey, { axisKey: parts.classKey, name: parts.courseName, section: parts.section, code: classCode(parts.courseName) });
      }
      byUid.set(uid, {
        axisUid: uid,
        classKey: parts.classKey,
        title: parts.title,
        type: itemTypeForTitle(parts.title),
        notes: event.DESCRIPTION ? toPlainText(event.DESCRIPTION.value) : "",
        dueDate: start.date,
        dueTime: start.time,
      });
    }
    return { classes: [...classes.values()], items: [...byUid.values()] };
  }

  function normalizeFeedUrl(input) {
    const trimmed = String(input || "").trim().replace(/^webcal:\/\//i, "https://");
    let url;
    try { url = new URL(trimmed); } catch { throw new Error("That doesn't look like a link. Paste the Axis calendar feed link."); }
    const validHost = url.protocol === "https:" && url.hostname.toLowerCase().endsWith(".myschoolapp.com") && !url.port && !url.username && !url.password;
    if (!validHost || url.pathname.toLowerCase() !== "/podium/feed/ical.aspx") {
      throw new Error("Use the Axis feed link that ends in /podium/feed/iCal.aspx on a myschoolapp.com address.");
    }
    url.hash = "";
    return url.href;
  }

  // Works out the database writes for one sync. Rows use the database's snake_case column names.
  function planAxisSync({ feed, existingClasses = [], existingItems = [], newId }) {
    const classIdByKey = new Map(existingClasses.filter((row) => row.axis_key).map((row) => [row.axis_key, row.id]));
    const classInserts = [];
    feed.classes.forEach((feedClass) => {
      if (classIdByKey.has(feedClass.axisKey)) return;
      const row = { id: newId(), name: feedClass.name, code: feedClass.code, color: pickClassColor(existingClasses.length + classInserts.length), axis_key: feedClass.axisKey };
      classInserts.push(row);
      classIdByKey.set(feedClass.axisKey, row.id);
    });

    const existingByUid = new Map(existingItems.filter((row) => row.axis_uid).map((row) => [row.axis_uid, row]));
    const seen = new Set();
    const itemInserts = [];
    const itemUpdates = [];
    feed.items.forEach((item) => {
      seen.add(item.axisUid);
      const owned = { title: item.title, due_date: item.dueDate, class_id: item.classKey ? classIdByKey.get(item.classKey) : null, notes: item.notes };
      const existing = existingByUid.get(item.axisUid);
      if (!existing) {
        itemInserts.push({ id: newId(), ...owned, type: item.type, due_time: item.dueTime, source: "axis", axis_uid: item.axisUid, axis_missing: false });
        return;
      }
      if (existing.deleted_at || existing.completed) return;
      const changed = Object.keys(owned).some((key) => (existing[key] ?? null) !== (owned[key] ?? null)) || existing.axis_missing;
      if (changed) itemUpdates.push({ id: existing.id, ...owned, axis_missing: false });
    });
    const itemsMissing = existingItems
      .filter((row) => row.axis_uid && !seen.has(row.axis_uid) && !row.completed && !row.deleted_at && !row.axis_missing)
      .map((row) => row.id);

    return { classInserts, itemInserts, itemUpdates, itemsMissing, counts: { added: itemInserts.length, updated: itemUpdates.length, removed: itemsMissing.length } };
  }

  return {
    CLASS_COLORS,
    classCode,
    decodeEntities,
    itemTypeForTitle,
    normalizeFeedUrl,
    parseAxisFeed,
    parseDateValue,
    pickClassColor,
    planAxisSync,
    splitTitle,
    toPlainText,
    unfoldLines,
  };
});
