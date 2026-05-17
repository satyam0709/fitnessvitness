const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { verifyToken } = require("../middleware/verifyToken");
const { pool } = require("../config/database");
const { emitTodosChanged, emitCalendarChanged } = require("../realtime/meetingsRealtime");
const { createUserNotification } = require("../services/notificationService");
const { formatYmd, parseYmdLocal, nextOccurrence } = require("../utils/todoRecurrence");

const router = express.Router();
router.use(verifyToken);

const VALID_FREQ = new Set([
  "once",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "half_yearly",
  "yearly",
]);

const uploadDir = path.join(__dirname, "..", "..", "uploads", "todos");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "") || "";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
const allowedMimes = ["image/jpeg", "image/png", "image/webp", "text/csv", "application/pdf"];

function visibilitySql(uid) {
  return `(t.created_by = ? OR EXISTS (SELECT 1 FROM crm_todo_assignees a WHERE a.todo_id = t.id AND a.user_id = ?))`;
}

function readAssigneeIds(req) {
  const b = req.body || {};
  if (Array.isArray(b.assignee_ids)) {
    return b.assignee_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  }
  const raw = b.assignee_ids;
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(/[,\s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  const multi = b["assignee_ids[]"];
  if (multi != null) {
    const arr = Array.isArray(multi) ? multi : [multi];
    return arr.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  }
  return [];
}

function parseAttachmentJson(row) {
  if (!row?.attachment_json) return [];
  try {
    const v =
      typeof row.attachment_json === "string"
        ? JSON.parse(row.attachment_json)
        : row.attachment_json;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function attachAssignees(todos) {
  if (!todos.length) {
    return todos.map((t) => ({
      ...t,
      attachments: parseAttachmentJson(t),
      assignees: [],
    }));
  }
  const ids = todos.map((t) => t.id);
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await pool.query(
    `SELECT a.todo_id, u.id, u.email, u.first_name, u.last_name, u.clerk_user_id
     FROM crm_todo_assignees a
     JOIN users u ON u.id = a.user_id
     WHERE a.todo_id IN (${placeholders})`,
    ids
  );
  const byTodo = {};
  for (const r of rows) {
    if (!byTodo[r.todo_id]) byTodo[r.todo_id] = [];
    byTodo[r.todo_id].push({
      id: r.id,
      email: r.email,
      first_name: r.first_name,
      last_name: r.last_name,
      clerk_user_id: r.clerk_user_id,
    });
  }
  return todos.map((t) => ({
    ...t,
    attachments: parseAttachmentJson(t),
    assignees: byTodo[t.id] || [],
  }));
}

async function assertTodoAccess(todoId, userId, tenantId) {
  const [fixed] = await pool.execute(
    `SELECT t.* FROM crm_todos t
     WHERE t.id = ?
       AND t.is_deleted = 0
       AND (? IS NULL OR t.tenant_id = ?)
       AND (t.created_by = ? OR EXISTS (
         SELECT 1 FROM crm_todo_assignees a WHERE a.todo_id = t.id AND a.user_id = ?
       ))`,
    [todoId, tenantId || null, tenantId || null, userId, userId]
  );
  return fixed[0] || null;
}

async function replaceAssignees(conn, todoId, userIds, creatorId) {
  await conn.execute(`DELETE FROM crm_todo_assignees WHERE todo_id = ?`, [todoId]);
  const uniq = [...new Set(userIds)].filter((id) => id !== creatorId || true);
  for (const uid of uniq) {
    const [urows] = await conn.execute(
      "SELECT id FROM users WHERE id = ? AND is_active = 1 LIMIT 1",
      [uid]
    );
    if (urows.length) {
      await conn.execute(
        `INSERT INTO crm_todo_assignees (todo_id, user_id) VALUES (?, ?)`,
        [todoId, uid]
      );
    }
  }
}

function maybeUpload(req, res, next) {
  const ct = String(req.headers["content-type"] || "");
  if (ct.includes("multipart/form-data")) {
    return upload.single("attachment")(req, res, (err) => {
      if (err) return next(err);
      if (req.file && !allowedMimes.includes(req.file.mimetype)) {
        return res.status(400).json({ error: "File type not allowed" });
      }
      return next();
    });
  }
  next();
}

router.get("/", async (req, res) => {
  try {
    const uid = req.user.id;
    const tenantId = req.user?.tenantId || null;
    const {
      scope = "all",
      status,
      priority,
      frequency,
      created_by,
      assigned_to,
      q,
      sort = "todo_date",
      order = "asc",
    } = req.query;

    const conditions = ["t.is_deleted = 0", visibilitySql(uid), "(? IS NULL OR t.tenant_id = ?)"];
    const params = [uid, uid, tenantId, tenantId];

    const st = status ? String(status).toLowerCase() : "";
    if (st === "pending" || st === "completed") {
      conditions.push("t.status = ?");
      params.push(st);
    }

    if (priority && ["low", "medium", "high"].includes(String(priority))) {
      conditions.push("t.priority = ?");
      params.push(priority);
    }

    if (frequency && VALID_FREQ.has(String(frequency).toLowerCase())) {
      conditions.push("t.frequency = ?");
      params.push(String(frequency).toLowerCase());
    }

    if (created_by) {
      conditions.push("t.created_by = ?");
      params.push(Number(created_by));
    }

    if (assigned_to) {
      conditions.push(
        `EXISTS (SELECT 1 FROM crm_todo_assignees a2 WHERE a2.todo_id = t.id AND a2.user_id = ?)`
      );
      params.push(Number(assigned_to));
    }

    const qTrim = q != null ? String(q).trim() : "";
    if (qTrim) {
      conditions.push("t.body LIKE ?");
      params.push(`%${qTrim.replace(/[%_]/g, (c) => `\\${c}`)}%`);
    }

    const today = formatYmd(new Date());
    const sc = String(scope || "all").toLowerCase();
    if (sc === "today") {
      conditions.push(`(
        (t.status = 'pending' AND DATE(t.todo_date) = ?)
        OR (t.status = 'pending' AND t.carry_forward = 1 AND DATE(t.todo_date) < ?)
        OR (t.status = 'completed' AND t.completed_at IS NOT NULL AND DATE(t.completed_at) = ?)
      )`);
      params.push(today, today, today);
    } else if (sc === "pending") {
      conditions.push("t.status = 'pending'");
    } else if (sc === "recursive") {
      conditions.push("t.frequency <> 'once'");
      conditions.push("t.status = 'pending'");
    }

    const sortKey = String(sort).toLowerCase();
    const orderDir = String(order).toLowerCase() === "desc" ? "DESC" : "ASC";
    let orderClause = `t.todo_date ${orderDir}, t.priority DESC, t.id DESC`;
    if (sortKey === "created_at") {
      orderClause = `t.created_at ${orderDir}, t.id DESC`;
    } else if (sortKey === "priority") {
      orderClause = `FIELD(t.priority,'high','medium','low') ${orderDir === "DESC" ? "DESC" : "ASC"}, t.todo_date ASC`;
    }

    const [todos] = await pool.execute(
      `SELECT t.*,
              uc.email as creator_email,
              uc.first_name as creator_first_name,
              uc.last_name as creator_last_name
       FROM crm_todos t
       LEFT JOIN users uc ON t.created_by = uc.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${orderClause}`,
      params
    );

    const shaped = await attachAssignees(todos);
    res.json({ success: true, total: shaped.length, data: shaped });
  } catch (err) {
    console.error("GET /todos:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/",  maybeUpload, async (req, res) => {
  const b = req.body || {};
  const body = String(b.body || "").trim();
  if (!body) {
    return res.status(400).json({ success: false, message: "Todo text is required" });
  }

  const freq = VALID_FREQ.has(String(b.frequency || "").toLowerCase())
    ? String(b.frequency).toLowerCase()
    : "once";

  const todoDateRaw = b.todo_date ? String(b.todo_date).slice(0, 10) : formatYmd(new Date());
  if (!parseYmdLocal(todoDateRaw)) {
    return res.status(400).json({ success: false, message: "Invalid todo_date" });
  }

  const pri = ["low", "medium", "high"].includes(String(b.priority || "").toLowerCase())
    ? String(b.priority).toLowerCase()
    : "medium";

  const carry =
    b.carry_forward === true ||
    b.carry_forward === 1 ||
    b.carry_forward === "1" ||
    String(b.carry_forward).toLowerCase() === "true";

  let attachmentJson = null;
  if (req.file) {
    attachmentJson = JSON.stringify([`/uploads/todos/${req.file.filename}`]);
  } else if (b.attachments && typeof b.attachments === "string") {
    try {
      const parsed = JSON.parse(b.attachments);
      if (Array.isArray(parsed)) attachmentJson = JSON.stringify(parsed);
    } catch {
      /* ignore */
    }
  }

  let assigneeIds = readAssigneeIds(req);
  if (!assigneeIds.length) assigneeIds = [req.user.id];
  const tenantId = req.user?.tenantId || null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.execute(
      `INSERT INTO crm_todos
        (tenant_id, body, frequency, todo_date, priority, carry_forward, status, attachment_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [tenantId, body, freq, todoDateRaw, pri, carry ? 1 : 0, attachmentJson, req.user.id]
    );
    const todoId = result.insertId;

    await replaceAssignees(conn, todoId, assigneeIds, req.user.id);

    await conn.commit();

    emitTodosChanged({ action: "create", id: todoId });
    emitCalendarChanged({ reason: "todos" });
    for (const asg of [...new Set(assigneeIds)]) {
      if (asg === req.user.id) continue;
      await createUserNotification({
        userId: asg,
        actorUserId: req.user.id,
        entityType: "todo",
        entityId: todoId,
        title: "New to-do assigned",
        body,
      }).catch((e) => console.warn("todo notification(create):", e.message));
    }
    const [full] = await pool.execute(
      `SELECT t.*,
              uc.email as creator_email,
              uc.first_name as creator_first_name,
              uc.last_name as creator_last_name
       FROM crm_todos t
       LEFT JOIN users uc ON t.created_by = uc.id
       WHERE t.id = ? AND t.is_deleted = 0 AND (? IS NULL OR t.tenant_id = ?)`,
      [todoId, tenantId, tenantId]
    );
    const [withAsg] = await attachAssignees(full);
    res.status(201).json({ success: true, data: withAsg });
  } catch (err) {
    await conn.rollback();
    console.error("POST /todos:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const tenantId = req.user?.tenantId || null;
    const existing = await assertTodoAccess(id, req.user.id, tenantId);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Todo not found" });
    }

    const b = req.body || {};
    let newlyAssignedUserIds = [];
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const updates = [];
      const params = [];

      if (typeof b.body === "string" && b.body.trim()) {
        updates.push("body = ?");
        params.push(b.body.trim());
      }
      if (b.priority && ["low", "medium", "high"].includes(String(b.priority))) {
        updates.push("priority = ?");
        params.push(String(b.priority).toLowerCase());
      }
      if (b.todo_date && parseYmdLocal(String(b.todo_date).slice(0, 10))) {
        updates.push("todo_date = ?");
        params.push(String(b.todo_date).slice(0, 10));
      }
      if (b.frequency && VALID_FREQ.has(String(b.frequency).toLowerCase())) {
        updates.push("frequency = ?");
        params.push(String(b.frequency).toLowerCase());
      }
      if (b.carry_forward !== undefined) {
        const carry =
          b.carry_forward === true ||
          b.carry_forward === 1 ||
          b.carry_forward === "1";
        updates.push("carry_forward = ?");
        params.push(carry ? 1 : 0);
      }

      if (updates.length) {
        params.push(id);
        await conn.execute(`UPDATE crm_todos SET ${updates.join(", ")} WHERE id = ?`, params);
      }

      if (b.status === "completed" || b.status === "pending") {
        const [freshRows] = await conn.execute(
          "SELECT frequency, todo_date FROM crm_todos WHERE id = ? AND is_deleted = 0 AND (? IS NULL OR tenant_id = ?)",
          [id, tenantId, tenantId]
        );
        const row = freshRows[0] || existing;
        if (b.status === "completed") {
          const freq = String(row.frequency || "once").toLowerCase();
          if (freq === "once") {
            await conn.execute(
              `UPDATE crm_todos SET status = 'completed', completed_at = NOW() WHERE id = ?`,
              [id]
            );
          } else {
            const nextD = nextOccurrence(String(row.todo_date).slice(0, 10), freq);
            await conn.execute(
              `UPDATE crm_todos SET todo_date = ?, status = 'pending', completed_at = NULL WHERE id = ?`,
              [nextD, id]
            );
          }
        } else {
          await conn.execute(
            `UPDATE crm_todos SET status = 'pending', completed_at = NULL WHERE id = ?`,
            [id]
          );
        }
      }

      if (Array.isArray(b.assignee_ids)) {
        const [prevRows] = await conn.execute(
          "SELECT user_id FROM crm_todo_assignees WHERE todo_id = ?",
          [id]
        );
        const beforeAssignees = prevRows.map((r) => Number(r.user_id)).filter(Boolean);
        const ids = b.assignee_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
        if (!ids.length) {
          await conn.rollback();
          return res.status(400).json({ success: false, message: "assignee_ids cannot be empty" });
        }
        await replaceAssignees(conn, id, ids, req.user.id);
        const beforeSet = new Set(beforeAssignees);
        newlyAssignedUserIds = [...new Set(ids)].filter((uid) => !beforeSet.has(uid));
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    emitTodosChanged({ action: "update", id });
    emitCalendarChanged({ reason: "todos" });
    if (Array.isArray(b.assignee_ids)) {
      const [titleRows] = await pool.execute(
        "SELECT body FROM crm_todos WHERE id = ? AND is_deleted = 0 AND (? IS NULL OR tenant_id = ?) LIMIT 1",
        [id, tenantId, tenantId]
      );
      const todoBody = String(titleRows?.[0]?.body || "A to-do was assigned to you.");
      for (const uid of newlyAssignedUserIds) {
        if (uid === req.user.id) continue;
        await createUserNotification({
          userId: uid,
          actorUserId: req.user.id,
          entityType: "todo",
          entityId: id,
          title: "To-do assigned to you",
          body: todoBody,
        }).catch((e) => console.warn("todo notification(assign):", e.message));
      }
    }
    const [full] = await pool.execute(
      `SELECT t.*,
              uc.email as creator_email,
              uc.first_name as creator_first_name,
              uc.last_name as creator_last_name
       FROM crm_todos t
       LEFT JOIN users uc ON t.created_by = uc.id
       WHERE t.id = ? AND t.is_deleted = 0 AND (? IS NULL OR t.tenant_id = ?)`,
      [id, tenantId, tenantId]
    );
    const [withAsg] = await attachAssignees(full);
    res.json({ success: true, data: withAsg });
  } catch (err) {
    console.error("PUT /todos/:id:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const tenantId = req.user?.tenantId || null;
    const [rows] = await pool.execute(
      "SELECT id, attachment_json, created_by FROM crm_todos WHERE id = ? AND is_deleted = 0 AND (? IS NULL OR tenant_id = ?)",
      [id, tenantId, tenantId]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ success: false, message: "Todo not found" });
    if (row.created_by !== req.user.id) {
      return res.status(403).json({ success: false, message: "Only the creator can delete this todo" });
    }

    const paths = parseAttachmentJson(row);
    await pool.execute(
      "UPDATE crm_todos SET is_deleted = 1, deleted_at = NOW(), updated_at = NOW() WHERE id = ? AND is_deleted = 0 AND (? IS NULL OR tenant_id = ?)",
      [id, tenantId, tenantId]
    );

    for (const rel of paths) {
      if (rel && String(rel).includes("uploads/todos/")) {
        const fname = path.basename(rel);
        const fp = path.join(uploadDir, fname);
        try {
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
        } catch {
          /* ignore */
        }
      }
    }

    emitTodosChanged({ action: "delete", id });
    emitCalendarChanged({ reason: "todos" });
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /todos/:id:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
