const { pool } = require("../config/database");
const { emitMeetingsChanged, emitAdminChanged, emitCalendarChanged } = require("../realtime/meetingsRealtime");
const { createUserNotification } = require("../services/notificationService");

const MEETING_TYPES = new Set(["in_person", "virtual", "phone", "other"]);
const MEETING_STATUSES = new Set(["scheduled", "completed", "cancelled", "postponed", "no_show"]);
const MEETING_RECURRENCE = new Set([
  "once",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "half_yearly",
  "yearly",
]);

function viewerId(req) {
  if (!req.user?.id) return null;
  const n = Number(req.user.id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Avoid Date / odd shapes breaking mysqld_stmt_execute on DATETIME columns */
function toMysqlDateTime(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  const s = String(v).trim().replace("T", " ");
  if (s.length === 16) return `${s}:00`;
  return s.length >= 19 ? s.slice(0, 19) : s;
}

function sanitizeType(v) {
  const s = String(v || "virtual").toLowerCase();
  return MEETING_TYPES.has(s) ? s : "virtual";
}

function sanitizeStatus(v) {
  const s = String(v || "scheduled").toLowerCase();
  return MEETING_STATUSES.has(s) ? s : "scheduled";
}

function sanitizeRecurrence(v) {
  const s = String(v || "once").toLowerCase();
  return MEETING_RECURRENCE.has(s) ? s : "once";
}

function safeLeadId(lead_id) {
  if (lead_id == null || lead_id === "") return null;
  const n = Number(lead_id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * WHERE: meetings the viewer organizes or attends.
 * Optional filters: search, created_by, assign_to, meeting_type, recurrence, status, status_group,
 * range_start / range_end (meeting start_time window), lead_id
 */
function buildMeetingFilter(req, viewerUserId) {
  const parts = [
    "(m.organizer_id = ? OR EXISTS (SELECT 1 FROM meeting_attendees ma0 WHERE ma0.meeting_id = m.id AND ma0.user_id = ?))",
  ];
  const uidNum = Number(viewerUserId);
  const params = [uidNum, uidNum];
  const tenantId = req.user?.tenantId || null;
  parts.push("m.is_deleted = 0");
  parts.push("(? IS NULL OR m.tenant_id = ?)");
  params.push(tenantId, tenantId);

  const q = req.query || {};
  const rawSearch = q.search != null ? String(q.search).trim() : "";
  const search = rawSearch.replace(/[%_\\]/g, " ").trim();
  if (search) {
    parts.push("(m.title LIKE ? OR m.description LIKE ? OR m.location LIKE ? OR m.meet_link LIKE ?)");
    const wild = `%${search}%`;
    params.push(wild, wild, wild, wild);
  }

  if (q.created_by != null && String(q.created_by).trim() !== "") {
    const cid = Number(q.created_by);
    if (Number.isFinite(cid) && cid > 0) {
      parts.push("m.organizer_id = ?");
      params.push(cid);
    }
  }

  if (q.assign_to != null && String(q.assign_to).trim() !== "") {
    const aid = Number(q.assign_to);
    if (Number.isFinite(aid) && aid > 0) {
      parts.push(
        "(m.assigned_to_user_id = ? OR EXISTS (SELECT 1 FROM meeting_attendees ma1 WHERE ma1.meeting_id = m.id AND ma1.user_id = ?))"
      );
      params.push(aid, aid);
    }
  }

  if (q.meeting_type != null && String(q.meeting_type).trim() !== "") {
    parts.push("m.meeting_type = ?");
    params.push(String(q.meeting_type));
  }

  if (q.recurrence != null && String(q.recurrence).trim() !== "") {
    const r = String(q.recurrence).trim().toLowerCase();
    if (MEETING_RECURRENCE.has(r)) {
      parts.push("m.recurrence = ?");
      params.push(r);
    }
  }

  const rs = q.range_start != null ? String(q.range_start).trim() : "";
  if (rs) {
    const sqlDt = toMysqlDateTime(rs);
    if (sqlDt) {
      parts.push("m.start_time >= ?");
      params.push(sqlDt);
    }
  }
  const re = q.range_end != null ? String(q.range_end).trim() : "";
  if (re) {
    const sqlDt = toMysqlDateTime(re);
    if (sqlDt) {
      parts.push("m.start_time <= ?");
      params.push(sqlDt);
    }
  }

  if (q.lead_id != null && String(q.lead_id).trim() !== "") {
    const lid = Number(q.lead_id);
    if (Number.isFinite(lid) && lid > 0) {
      parts.push("m.lead_id = ?");
      params.push(lid);
    }
  }

  const sg = q.status_group != null ? String(q.status_group).trim().toLowerCase() : "";
  if (sg === "pending") {
    parts.push("(m.status IN ('scheduled','postponed'))");
  } else if (sg === "completed") {
    parts.push("m.status = 'completed'");
  } else if (sg === "missing") {
    parts.push("m.status = 'no_show'");
  } else if (q.status != null && String(q.status).trim() !== "") {
    const st = String(q.status).trim().toLowerCase();
    if (MEETING_STATUSES.has(st)) {
      parts.push("m.status = ?");
      params.push(st);
    }
  }

  return { whereSql: parts.join(" AND "), params };
}

/** Express can duplicate query keys → arrays; String(array) breaks parseInt → NaN → bad LIMIT. */
function firstQueryScalar(val, fallback) {
  const v = Array.isArray(val) ? val[0] : val;
  const n = Number.parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** MySQL/MariaDB prepared LIMIT/OFFSET can throw "Incorrect arguments"; use validated ints. */
function clampLimitOffset(limit, page) {
  const lim = Math.min(Math.max(firstQueryScalar(limit, 50), 1), 500);
  const pg = Math.max(firstQueryScalar(page, 1), 1);
  const offset = (pg - 1) * lim;
  return { lim, offset, page: pg };
}

function sanitizeParams(arr) {
  return arr.map((p) => (p === undefined ? null : p));
}

let recurrenceMigrationAttempted = false;

/** Older DBs without `recurrence` break filters/quotes; add column once at runtime if missing. */
async function ensureMeetingsRecurrenceColumn() {
  if (recurrenceMigrationAttempted) return;
  recurrenceMigrationAttempted = true;
  try {
    const [cols] = await pool.query(
      `SELECT 1 AS ok FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meetings' AND COLUMN_NAME = 'recurrence' LIMIT 1`
    );
    if (!cols.length) {
      await pool.query(
        "ALTER TABLE meetings ADD COLUMN recurrence VARCHAR(50) NOT NULL DEFAULT 'once'"
      );
      try {
        await pool.query("ALTER TABLE meetings ADD INDEX idx_meeting_recurrence (recurrence)");
      } catch (_) {
        /* index may exist */
      }
      console.log("meetings: added recurrence column (runtime migration)");
    }
  } catch (e) {
    console.warn("meetings recurrence migration:", e.message);
    recurrenceMigrationAttempted = false;
  }
}

async function resolveUserRowById(id) {
  const idNum = Number(id);
  if (!Number.isFinite(idNum) || idNum <= 0) return null;
  /* pool.query: some MySQL/MariaDB builds error on LIMIT with pool.execute() */
  const [rows] = await pool.query(
    "SELECT id FROM users WHERE id = ? AND is_active = 1 LIMIT 1",
    [idNum]
  );
  return rows[0] || null;
}

async function getMeetings(req, res) {
  try {
    const uid = viewerId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    await ensureMeetingsRecurrenceColumn();

    const { whereSql, params } = buildMeetingFilter(req, uid);
    const bind = sanitizeParams(params);
    const { lim, offset, page } = clampLimitOffset(req.query?.limit, req.query?.page);

    const [countRows] = await pool.query(
      `SELECT COUNT(DISTINCT m.id) AS total FROM meetings m
       LEFT JOIN meeting_attendees ma ON ma.meeting_id = m.id
       WHERE ${whereSql}`,
      bind
    );
    const total = Number(countRows?.[0]?.total ?? 0);

    const listSql = `
      SELECT DISTINCT m.*,
        l.name AS lead_name,
        TRIM(CONCAT_WS(' ', uo.first_name, uo.last_name)) AS organizer_name,
        TRIM(CONCAT_WS(' ', ua.first_name, ua.last_name)) AS assignee_name,
        (SELECT COUNT(*) FROM meeting_attendees c WHERE c.meeting_id = m.id) AS attendee_count,
        (SELECT GROUP_CONCAT(ma2.user_id) FROM meeting_attendees ma2 WHERE ma2.meeting_id = m.id) AS attendee_ids_csv
      FROM meetings m
      LEFT JOIN meeting_attendees ma ON ma.meeting_id = m.id
      LEFT JOIN leads l ON l.id = m.lead_id
      LEFT JOIN users uo ON uo.id = m.organizer_id
      LEFT JOIN users ua ON ua.id = m.assigned_to_user_id
      WHERE ${whereSql}
      ORDER BY m.start_time DESC, m.id DESC
      LIMIT ${lim} OFFSET ${offset}`;

    const [meetings] = await pool.query(listSql, bind);

    res.json({
      success: true,
      total: Number(total) || 0,
      page,
      limit: lim,
      meetings,
    });
  } catch (err) {
    console.error("getMeetings", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMeetingStats(req, res) {
  try {
    const uid = viewerId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    await ensureMeetingsRecurrenceColumn();

    const { whereSql, params } = buildMeetingFilter(req, uid);
    const bind = sanitizeParams(params);
    /* One row per meeting (JOIN attendees duplicates rows; SUM would be wrong) */
    const sql = `
      SELECT
        COUNT(*) AS total,
        SUM(t.status = 'scheduled') AS scheduled,
        SUM(t.status = 'completed') AS completed,
        SUM(t.status = 'cancelled') AS cancelled,
        SUM(t.status = 'postponed') AS postponed,
        SUM(t.status = 'no_show') AS no_show,
        SUM(t.meeting_type = 'virtual') AS type_virtual,
        SUM(t.meeting_type = 'in_person') AS type_in_person,
        SUM(t.meeting_type = 'phone') AS type_phone,
        SUM(t.meeting_type = 'other') AS type_other
      FROM (
        SELECT m.id, MAX(m.status) AS status, MAX(m.meeting_type) AS meeting_type
        FROM meetings m
        LEFT JOIN meeting_attendees ma ON ma.meeting_id = m.id
        WHERE ${whereSql}
        GROUP BY m.id
      ) t`;
    const [rows] = await pool.query(sql, bind);
    res.json({ success: true, stats: rows[0] || {} });
  } catch (err) {
    console.error("getMeetingStats", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

function csvEscape(s) {
  if (s == null) return "";
  const t = String(s);
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

async function exportMeetingsCsv(req, res) {
  try {
    const uid = viewerId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    await ensureMeetingsRecurrenceColumn();

    const { whereSql, params } = buildMeetingFilter(req, uid);
    const bind = sanitizeParams(params);
    const sql = `
      SELECT DISTINCT m.*,
        l.name AS lead_name,
        TRIM(CONCAT_WS(' ', uo.first_name, uo.last_name)) AS organizer_name,
        TRIM(CONCAT_WS(' ', ua.first_name, ua.last_name)) AS assignee_name,
        (SELECT COUNT(*) FROM meeting_attendees c WHERE c.meeting_id = m.id) AS attendee_count,
        (SELECT GROUP_CONCAT(ma3.user_id) FROM meeting_attendees ma3 WHERE ma3.meeting_id = m.id) AS attendee_ids_csv
      FROM meetings m
      LEFT JOIN meeting_attendees ma ON ma.meeting_id = m.id
      LEFT JOIN leads l ON l.id = m.lead_id
      LEFT JOIN users uo ON uo.id = m.organizer_id
      LEFT JOIN users ua ON ua.id = m.assigned_to_user_id
      WHERE ${whereSql}
      ORDER BY m.start_time DESC, m.id DESC
      LIMIT 5000`;

    const [rows] = await pool.query(sql, bind);
    const headers = [
      "id",
      "title",
      "meeting_type",
      "recurrence",
      "status",
      "start_time",
      "end_time",
      "location",
      "meet_link",
      "organizer_name",
      "assignee_name",
      "lead_name",
      "attendee_count",
      "description",
    ];
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.title,
          r.meeting_type,
          r.recurrence,
          r.status,
          r.start_time,
          r.end_time,
          r.location,
          r.meet_link,
          r.organizer_name,
          r.assignee_name,
          r.lead_name,
          r.attendee_count,
          r.description,
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="meetings-export.csv"');
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err) {
    console.error("exportMeetingsCsv", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createMeeting(req, res) {
  try {
    const uid = viewerId(req);
    const tenantId = req.user?.tenantId || null;
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    await ensureMeetingsRecurrenceColumn();

    const {
      title,
      description,
      start_time,
      end_time,
      location,
      meet_link,
      lead_id,
      attendees,
      meeting_type,
      status,
      recurrence,
      assigned_to_user_id,
    } = req.body;

    if (!title?.trim()) return res.status(400).json({ success: false, message: "Title required" });
    if (!start_time) return res.status(400).json({ success: false, message: "start_time required" });

    let assigneeId = uid;
    if (assigned_to_user_id != null && String(assigned_to_user_id).trim() !== "") {
      const cand = Number(assigned_to_user_id);
      const row = await resolveUserRowById(cand);
      if (!row) return res.status(400).json({ success: false, message: "Invalid assignee" });
      assigneeId = cand;
    }

    const mt = sanitizeType(meeting_type);
    const st = sanitizeStatus(status);
    const rec = sanitizeRecurrence(recurrence);

    const startSql = toMysqlDateTime(start_time);
    const endSql = toMysqlDateTime(end_time);
    if (!startSql) return res.status(400).json({ success: false, message: "Invalid start_time" });

    const [result] = await pool.query(
      `INSERT INTO meetings (tenant_id, title, description, start_time, end_time, location, meet_link,
        meeting_type, status, recurrence, organizer_id, assigned_to_user_id, lead_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        title.trim(),
        description || null,
        startSql,
        endSql,
        location || null,
        meet_link || null,
        mt,
        st,
        rec,
        uid,
        assigneeId,
        safeLeadId(lead_id),
      ]
    );

    const meetingId = result.insertId;

    await pool.query("INSERT IGNORE INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)", [
      meetingId,
      uid,
    ]);
    if (assigneeId !== uid) {
      await pool.query("INSERT IGNORE INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)", [
        meetingId,
        assigneeId,
      ]);
    }

    if (Array.isArray(attendees) && attendees.length > 0) {
      for (const raw of attendees) {
        const aid = Number(raw);
        if (!Number.isFinite(aid) || aid <= 0 || aid === uid) continue;
        await pool.query("INSERT IGNORE INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)", [
          meetingId,
          aid,
        ]);
      }
    }

    emitMeetingsChanged({ action: "create", id: meetingId });
    emitCalendarChanged({ reason: "meetings" });
    emitAdminChanged({ scope: "stats", reason: "meetings" });
    if (assigneeId && assigneeId !== uid) {
      await createUserNotification({
        userId: assigneeId,
        actorUserId: uid,
        entityType: "meeting",
        entityId: meetingId,
        title: "New meeting assigned",
        body: title.trim(),
      }).catch((e) => console.warn("meeting notification(create):", e.message));
    }
    res.status(201).json({ success: true, id: meetingId });
  } catch (err) {
    console.error("createMeeting", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateMeeting(req, res) {
  try {
    const uid = viewerId(req);
    const tenantId = req.user?.tenantId || null;
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    await ensureMeetingsRecurrenceColumn();

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ success: false, message: "Invalid id" });

    const {
      title,
      description,
      start_time,
      end_time,
      location,
      meet_link,
      lead_id,
      meeting_type,
      status,
      recurrence,
      assigned_to_user_id,
      attendees,
    } = req.body;

    const [rows] = await pool.query(
      "SELECT * FROM meetings WHERE id = ? AND organizer_id = ? AND is_deleted = 0 AND (? IS NULL OR tenant_id = ?)",
      [id, uid, tenantId, tenantId]
    );
    const cur = rows[0];
    if (!cur) {
      return res.status(403).json({ success: false, message: "Not found or not authorized" });
    }

    const nextTitle = title !== undefined ? String(title || "").trim() : cur.title;
    const prevAssignee = cur.assigned_to_user_id != null ? Number(cur.assigned_to_user_id) : null;
    if (!nextTitle) return res.status(400).json({ success: false, message: "Title required" });

    const nextDesc = description !== undefined ? description || null : cur.description;
    const nextStartRaw = start_time !== undefined ? start_time : cur.start_time;
    const nextEndRaw = end_time !== undefined ? end_time : cur.end_time;
    const nextStart = toMysqlDateTime(nextStartRaw);
    const nextEnd = nextEndRaw == null || nextEndRaw === "" ? null : toMysqlDateTime(nextEndRaw);
    if (!nextStart) return res.status(400).json({ success: false, message: "Invalid start_time" });
    const nextLoc = location !== undefined ? location || null : cur.location;
    const nextLink = meet_link !== undefined ? meet_link || null : cur.meet_link;
    const nextLead = lead_id !== undefined ? safeLeadId(lead_id) : safeLeadId(cur.lead_id);
    const nextType = meeting_type !== undefined ? sanitizeType(meeting_type) : cur.meeting_type || "virtual";
    const nextStatus = status !== undefined ? sanitizeStatus(status) : cur.status || "scheduled";
    const nextRec =
      recurrence !== undefined
        ? sanitizeRecurrence(recurrence)
        : sanitizeRecurrence(cur.recurrence != null ? cur.recurrence : "once");

    let nextAssignee = cur.assigned_to_user_id != null ? Number(cur.assigned_to_user_id) : uid;
    if (assigned_to_user_id !== undefined) {
      if (assigned_to_user_id == null || assigned_to_user_id === "") {
        nextAssignee = uid;
      } else {
        const cand = Number(assigned_to_user_id);
        const row = await resolveUserRowById(cand);
        if (!row) return res.status(400).json({ success: false, message: "Invalid assignee" });
        nextAssignee = cand;
      }
    }

    await pool.query(
      `UPDATE meetings SET title=?, description=?, start_time=?, end_time=?, location=?, meet_link=?,
        meeting_type=?, status=?, recurrence=?, assigned_to_user_id=?, lead_id=?
       WHERE id=? AND organizer_id=?`,
      [
        nextTitle,
        nextDesc,
        nextStart,
        nextEnd,
        nextLoc,
        nextLink,
        nextType,
        nextStatus,
        nextRec,
        nextAssignee,
        nextLead,
        id,
        uid,
      ]
    );

    if (Array.isArray(attendees)) {
      await pool.query("DELETE FROM meeting_attendees WHERE meeting_id = ?", [id]);
      await pool.query("INSERT IGNORE INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)", [id, uid]);
      if (nextAssignee !== uid) {
        await pool.query("INSERT IGNORE INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)", [
          id,
          nextAssignee,
        ]);
      }
      for (const raw of attendees) {
        const aid = Number(raw);
        if (!Number.isFinite(aid) || aid <= 0) continue;
        await pool.query("INSERT IGNORE INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)", [
          id,
          aid,
        ]);
      }
    }

    emitMeetingsChanged({ action: "update", id });
    emitCalendarChanged({ reason: "meetings" });
    emitAdminChanged({ scope: "stats", reason: "meetings" });
    if (nextAssignee && nextAssignee !== uid && nextAssignee !== prevAssignee) {
      await createUserNotification({
        userId: nextAssignee,
        actorUserId: uid,
        entityType: "meeting",
        entityId: id,
        title: "Meeting assigned to you",
        body: nextTitle,
      }).catch((e) => console.warn("meeting notification(assign):", e.message));
    }
    res.json({ success: true });
  } catch (err) {
    console.error("updateMeeting", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteMeeting(req, res) {
  try {
    const uid = viewerId(req);
    const tenantId = req.user?.tenantId || null;
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const mid = Number(req.params.id);
    if (!Number.isFinite(mid) || mid <= 0) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const [r] = await pool.query(
      "UPDATE meetings SET is_deleted = 1, deleted_at = NOW() WHERE id = ? AND organizer_id = ? AND is_deleted = 0 AND (? IS NULL OR tenant_id = ?)",
      [mid, uid, tenantId, tenantId]
    );
    if (r.affectedRows) {
      emitMeetingsChanged({ action: "delete", id: mid });
      emitCalendarChanged({ reason: "meetings" });
      emitAdminChanged({ scope: "stats", reason: "meetings" });
    }
    res.json({ success: true, deleted: r.affectedRows || 0 });
  } catch (err) {
    console.error("deleteMeeting", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function bulkDeleteMeetings(req, res) {
  try {
    const uid = viewerId(req);
    const tenantId = req.user?.tenantId || null;
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n) => n > 0) : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: "ids array required" });
    }
    const uniq = [...new Set(ids)].slice(0, 200);
    const placeholders = uniq.map(() => "?").join(",");
    const [r] = await pool.query(
      `UPDATE meetings
       SET is_deleted = 1, deleted_at = NOW()
       WHERE organizer_id = ? AND is_deleted = 0 AND (? IS NULL OR tenant_id = ?) AND id IN (${placeholders})`,
      [uid, tenantId, tenantId, ...uniq]
    );
    if (r.affectedRows) {
      emitMeetingsChanged({ action: "bulk_delete", ids: uniq });
      emitAdminChanged({ scope: "stats", reason: "meetings" });
    }
    res.json({ success: true, deleted: r.affectedRows || 0 });
  } catch (err) {
    console.error("bulkDeleteMeetings", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function bulkAssignMeetings(req, res) {
  try {
    const uid = viewerId(req);
    const tenantId = req.user?.tenantId || null;
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    await ensureMeetingsRecurrenceColumn();

    const assignRaw = req.body?.assigned_to_user_id;
    const cand = Number(assignRaw);
    if (!Number.isFinite(cand) || cand <= 0) {
      return res.status(400).json({ success: false, message: "assigned_to_user_id required" });
    }
    const assigneeRow = await resolveUserRowById(cand);
    if (!assigneeRow) {
      return res.status(400).json({ success: false, message: "Invalid assignee" });
    }

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n) => n > 0) : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: "ids array required" });
    }
    const uniq = [...new Set(ids)].slice(0, 200);
    const placeholders = uniq.map(() => "?").join(",");

    const [r] = await pool.query(
      `UPDATE meetings SET assigned_to_user_id = ?
       WHERE organizer_id = ? AND (? IS NULL OR tenant_id = ?) AND id IN (${placeholders})`,
      [cand, uid, tenantId, tenantId, ...uniq]
    );

    const updated = Number(r.affectedRows) || 0;
    for (const mid of uniq) {
      await pool.query("INSERT IGNORE INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)", [
        mid,
        cand,
      ]);
    }

    if (updated) {
      emitMeetingsChanged({ action: "bulk_assign", ids: uniq });
      emitCalendarChanged({ reason: "meetings" });
      emitAdminChanged({ scope: "stats", reason: "meetings" });
      for (const mid of uniq) {
        await createUserNotification({
          userId: cand,
          actorUserId: uid,
          entityType: "meeting",
          entityId: mid,
          title: "Meeting assigned to you",
          body: `Meeting #${mid} was assigned to you.`,
        }).catch((e) => console.warn("meeting notification(bulk_assign):", e.message));
      }
    }
    res.json({ success: true, updated });
  } catch (err) {
    console.error("bulkAssignMeetings", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getMeetings,
  getMeetingStats,
  exportMeetingsCsv,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  bulkDeleteMeetings,
  bulkAssignMeetings,
};
