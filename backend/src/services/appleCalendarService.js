const ical = require("node-ical");
const { createDAVClient } = require("tsdav");
const { pool } = require("../config/database");

const DEFAULT_CALDAV_SERVER = "https://caldav.icloud.com";
const FETCH_TIMEOUT_MS = 20000;

let tableReady = false;

async function ensureAppleCalendarTable() {
  if (tableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS user_apple_calendar (
      user_id INT UNSIGNED NOT NULL,
      ical_url TEXT DEFAULT NULL,
      caldav_username VARCHAR(255) DEFAULT NULL,
      caldav_password VARCHAR(255) DEFAULT NULL,
      caldav_server VARCHAR(255) NOT NULL DEFAULT 'https://caldav.icloud.com',
      connected_at DATETIME DEFAULT NULL,
      last_sync_at DATETIME DEFAULT NULL,
      last_error VARCHAR(500) DEFAULT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id),
      CONSTRAINT fk_user_apple_calendar_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableReady = true;
}

function parseYmd(v) {
  const s = String(v || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function toMysqlDateTime(d) {
  if (!d || Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}

function normalizeIcalUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("webcal://")) return `https://${raw.slice("webcal://".length)}`;
  if (raw.startsWith("webcals://")) return `https://${raw.slice("webcals://".length)}`;
  return raw;
}

function rangeBounds(from, to) {
  const start = new Date(`${parseYmd(from)}T00:00:00`);
  const end = new Date(`${parseYmd(to)}T23:59:59`);
  return { start, end };
}

function eventOverlapsRange(evStart, evEnd, rangeStart, rangeEnd) {
  if (!evStart || Number.isNaN(evStart.getTime())) return false;
  const end = evEnd && !Number.isNaN(evEnd.getTime()) ? evEnd : evStart;
  return end >= rangeStart && evStart <= rangeEnd;
}

function veventToFeedItem(ev, sourceIdPrefix) {
  const start = ev.start instanceof Date ? ev.start : new Date(ev.start);
  const endRaw = ev.end instanceof Date ? ev.end : ev.end ? new Date(ev.end) : null;
  const allDay =
    ev.datetype === "date" ||
    (start.getHours() === 0 &&
      start.getMinutes() === 0 &&
      endRaw &&
      endRaw.getHours() === 0 &&
      endRaw.getMinutes() === 0 &&
      (endRaw - start) % 86400000 === 0);

  let end = endRaw;
  if (!end || Number.isNaN(end.getTime())) {
    end = new Date(start);
    if (allDay) end.setHours(23, 59, 59, 0);
    else end.setMinutes(end.getMinutes() + 30);
  }

  const uid = String(ev.uid || ev.id || `${start.getTime()}-${ev.summary || "event"}`);
  const id = `${sourceIdPrefix}-${uid.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120)}`;

  return {
    id,
    source: "apple",
    type: "apple",
    title: ev.summary || "Apple Calendar event",
    description: ev.description || null,
    start: allDay ? `${toMysqlDateTime(start).slice(0, 10)}T00:00:00` : toMysqlDateTime(start),
    end: allDay ? `${toMysqlDateTime(end).slice(0, 10)}T23:59:59` : toMysqlDateTime(end),
    allDay: !!allDay,
    meta: {
      readOnly: true,
      appleUid: uid,
      location: ev.location || null,
    },
  };
}

function icalObjectToItems(icalData, from, to) {
  const { start: rangeStart, end: rangeEnd } = rangeBounds(from, to);
  const items = [];
  const seen = new Set();

  for (const entry of Object.values(icalData || {})) {
    if (!entry || entry.type !== "VEVENT") continue;
    const evStart = entry.start instanceof Date ? entry.start : new Date(entry.start);
    const evEnd = entry.end instanceof Date ? entry.end : entry.end ? new Date(entry.end) : null;
    if (!eventOverlapsRange(evStart, evEnd, rangeStart, rangeEnd)) continue;

    const item = veventToFeedItem(entry, "apple");
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }

  return items;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchEventsFromIcalUrl(icalUrl, from, to) {
  const url = normalizeIcalUrl(icalUrl);
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("Calendar URL must start with https:// or webcal://");
  }

  let icalData;
  try {
    icalData = await ical.async.fromURL(url, {
      fetch: fetchWithTimeout,
      skipTimezoneClient: true,
    });
  } catch (e) {
    const res = await fetchWithTimeout(url, { headers: { Accept: "text/calendar" } });
    if (!res.ok) throw new Error(`Could not fetch calendar feed (${res.status})`);
    const text = await res.text();
    icalData = ical.sync.parse(text);
  }

  return icalObjectToItems(icalData, from, to);
}

function caldavTimeRange(from, to) {
  const start = parseYmd(from).replace(/-/g, "");
  const endDate = new Date(`${parseYmd(to)}T00:00:00`);
  endDate.setDate(endDate.getDate() + 1);
  const end = `${endDate.getFullYear()}${String(endDate.getMonth() + 1).padStart(2, "0")}${String(
    endDate.getDate()
  ).padStart(2, "0")}`;
  return { start, end };
}

async function fetchEventsFromCalDAV(settings, from, to) {
  const username = String(settings.caldav_username || "").trim();
  const password = String(settings.caldav_password || "").trim();
  const serverUrl = String(settings.caldav_server || DEFAULT_CALDAV_SERVER).trim() || DEFAULT_CALDAV_SERVER;

  if (!username || !password) {
    throw new Error("Apple ID email and app-specific password are required for iCloud CalDAV");
  }

  const client = await createDAVClient({
    serverUrl,
    credentials: { username, password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });

  const calendars = await client.fetchCalendars();
  if (!calendars.length) return [];

  const timeRange = caldavTimeRange(from, to);
  const items = [];
  const seen = new Set();

  for (const calendar of calendars) {
    let objects = [];
    try {
      objects = await client.fetchCalendarObjects({
        calendar,
        timeRange,
        expand: true,
      });
    } catch (e) {
      console.warn("apple caldav calendar fetch:", calendar.url, e.message);
      continue;
    }

    for (const obj of objects) {
      let parsed = obj.data;
      if (typeof parsed === "string") {
        try {
          parsed = ical.sync.parse(parsed);
        } catch {
          continue;
        }
      }
      if (!parsed || typeof parsed !== "object") continue;

      for (const entry of Object.values(parsed)) {
        if (!entry || entry.type !== "VEVENT") continue;
        const item = veventToFeedItem(entry, "apple-caldav");
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        const { start: rangeStart, end: rangeEnd } = rangeBounds(from, to);
        const evStart = entry.start instanceof Date ? entry.start : new Date(entry.start);
        const evEnd = entry.end instanceof Date ? entry.end : entry.end ? new Date(entry.end) : null;
        if (!eventOverlapsRange(evStart, evEnd, rangeStart, rangeEnd)) continue;
        items.push(item);
      }
    }
  }

  return items;
}

async function getAppleCalendarSettings(userId) {
  await ensureAppleCalendarTable();
  const [rows] = await pool.execute(`SELECT * FROM user_apple_calendar WHERE user_id = ?`, [userId]);
  return rows[0] || null;
}

function isConnected(settings) {
  if (!settings) return false;
  const hasIcal = Boolean(String(settings.ical_url || "").trim());
  const hasCaldav =
    Boolean(String(settings.caldav_username || "").trim()) &&
    Boolean(String(settings.caldav_password || "").trim());
  return hasIcal || hasCaldav;
}

async function saveAppleCalendarSettings(userId, body) {
  await ensureAppleCalendarTable();

  const icalUrl = body.ical_url != null ? normalizeIcalUrl(body.ical_url) || null : undefined;
  const caldavUsername =
    body.caldav_username != null ? String(body.caldav_username).trim() || null : undefined;
  const caldavPassword =
    body.caldav_password != null ? String(body.caldav_password).trim() || null : undefined;
  const caldavServer =
    body.caldav_server != null
      ? String(body.caldav_server).trim() || DEFAULT_CALDAV_SERVER
      : undefined;

  const [existing] = await pool.execute(
    "SELECT user_id FROM user_apple_calendar WHERE user_id = ?",
    [userId]
  );

  if (!existing.length) {
    await pool.execute(
      `INSERT INTO user_apple_calendar
        (user_id, ical_url, caldav_username, caldav_password, caldav_server, connected_at, last_error)
       VALUES (?, ?, ?, ?, ?, NOW(), NULL)`,
      [
        userId,
        icalUrl ?? null,
        caldavUsername ?? null,
        caldavPassword ?? null,
        caldavServer ?? DEFAULT_CALDAV_SERVER,
      ]
    );
  } else {
    const sets = [];
    const params = [];
    if (icalUrl !== undefined) {
      sets.push("ical_url = ?");
      params.push(icalUrl);
    }
    if (caldavUsername !== undefined) {
      sets.push("caldav_username = ?");
      params.push(caldavUsername);
    }
    if (caldavPassword !== undefined) {
      sets.push("caldav_password = ?");
      params.push(caldavPassword);
    }
    if (caldavServer !== undefined) {
      sets.push("caldav_server = ?");
      params.push(caldavServer);
    }
    sets.push("connected_at = NOW()", "last_error = NULL");
    params.push(userId);
    await pool.execute(
      `UPDATE user_apple_calendar SET ${sets.join(", ")} WHERE user_id = ?`,
      params
    );
  }

  return getAppleCalendarSettings(userId);
}

async function disconnectAppleCalendar(userId) {
  await ensureAppleCalendarTable();
  await pool.execute("DELETE FROM user_apple_calendar WHERE user_id = ?", [userId]);
}

async function recordSyncResult(userId, errorMessage) {
  await ensureAppleCalendarTable();
  if (errorMessage) {
    await pool.execute(
      `UPDATE user_apple_calendar SET last_sync_at = NOW(), last_error = ? WHERE user_id = ?`,
      [String(errorMessage).slice(0, 500), userId]
    );
  } else {
    await pool.execute(
      `UPDATE user_apple_calendar SET last_sync_at = NOW(), last_error = NULL WHERE user_id = ?`,
      [userId]
    );
  }
}

async function fetchAppleEvents(userId, from, to) {
  const settings = await getAppleCalendarSettings(userId);
  if (!isConnected(settings)) return [];

  const fromY = parseYmd(from);
  const toY = parseYmd(to);
  if (!fromY || !toY) return [];

  try {
    let items = [];
    const hasCaldav =
      Boolean(String(settings.caldav_username || "").trim()) &&
      Boolean(String(settings.caldav_password || "").trim());

    if (hasCaldav) {
      items = await fetchEventsFromCalDAV(settings, fromY, toY);
    }
    if (String(settings.ical_url || "").trim()) {
      const icalItems = await fetchEventsFromIcalUrl(settings.ical_url, fromY, toY);
      const seen = new Set(items.map((i) => i.id));
      for (const it of icalItems) {
        if (!seen.has(it.id)) {
          items.push(it);
          seen.add(it.id);
        }
      }
    }

    await recordSyncResult(userId, null);
    return items;
  } catch (err) {
    await recordSyncResult(userId, err.message);
    throw err;
  }
}

async function testAppleConnection(userId, body) {
  const from = parseYmd(body?.from) || new Date().toISOString().slice(0, 10);
  const d = new Date(`${from}T00:00:00`);
  d.setDate(d.getDate() + 30);
  const to =
    parseYmd(body?.to) ||
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const tempSettings = {
    ical_url: body.ical_url != null ? normalizeIcalUrl(body.ical_url) : null,
    caldav_username: body.caldav_username,
    caldav_password: body.caldav_password,
    caldav_server: body.caldav_server || DEFAULT_CALDAV_SERVER,
  };

  let count = 0;
  const hasCaldav =
    Boolean(String(tempSettings.caldav_username || "").trim()) &&
    Boolean(String(tempSettings.caldav_password || "").trim());
  if (hasCaldav) {
    count += (await fetchEventsFromCalDAV(tempSettings, from, to)).length;
  }
  if (String(tempSettings.ical_url || "").trim()) {
    count += (await fetchEventsFromIcalUrl(tempSettings.ical_url, from, to)).length;
  }
  if (!hasCaldav && !String(tempSettings.ical_url || "").trim()) {
    throw new Error("Provide iCloud credentials or a calendar subscription URL");
  }
  return { count, from, to };
}

module.exports = {
  ensureAppleCalendarTable,
  getAppleCalendarSettings,
  saveAppleCalendarSettings,
  disconnectAppleCalendar,
  fetchAppleEvents,
  testAppleConnection,
  isConnected,
};
