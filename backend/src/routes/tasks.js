const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { pool } = require("../config/database");
const { createUserNotification } = require("../services/notificationService");
const { emitCalendarChanged } = require("../realtime/meetingsRealtime");
const {
  resolveTenantContext,
  enforceSubscription,
  requireFeature,
} = require("../middleware/tenantAccess");
const { bindTenantCrmPool } = require("../middleware/tenantCrmPool");
const { requireCrmTenant } = require("../middleware/crmTenant");

const router = express.Router();
router.use(
  verifyToken,
  resolveTenantContext,
  bindTenantCrmPool,
  requireCrmTenant,
  enforceSubscription(),
  requireFeature("task_management", "view")
);

const VALID_STATUS = new Set([
  "new",
  "in_feedback",
  "processing",
  "completed",
  "rejected",
  "todo",
  "in_progress",
  "done",
]);

async function resolveUserId(assignedTo) {
  if (assignedTo === null || assignedTo === undefined || assignedTo === "") return null;

  if (Number.isInteger(Number(assignedTo))) {
    const [rows] = await pool.execute(
      "SELECT id FROM users WHERE id = ? AND is_active = 1",
      [Number(assignedTo)]
    );
    if (rows.length) return rows[0].id;
  }

  const [rows] = await pool.execute(
    "SELECT id FROM users WHERE clerk_user_id = ? AND is_active = 1",
    [assignedTo]
  );
  return rows.length ? rows[0].id : null;
}

function addTenantCondition(conditions, params, req, tableAlias = "t") {
  conditions.push(`${tableAlias}.is_deleted = 0`);
  if (req.user?.tenantId) {
    conditions.push(`${tableAlias}.tenant_id = ?`);
    params.push(req.user.tenantId);
  }
}

function sanitizeStatus(s) {
  if (!s || !VALID_STATUS.has(String(s))) return null;
  return String(s);
}

/**
 * Persist only ENUM values that exist on all deployments: todo | in_progress | done.
 * Maps API labels (new, completed, in_feedback, …) so MySQL never truncates when the
 * expanded ENUM migration has not been applied yet.
 */
function statusToDbEnum(apiStatus) {
  const k = String(apiStatus || "new").toLowerCase();
  if (k === "in_progress" || k === "processing" || k === "in_feedback") {
    return "in_progress";
  }
  if (k === "done" || k === "completed") {
    return "done";
  }
  // new, rejected, todo, and unknown → todo (open / not done)
  return "todo";
}

router.get("/", async (req, res) => {
  try {
    const {
      status,
      priority,
      assigned_to,
      created_by,
      due_before,
      due_after,
      my,
      q,
      label,
      sort = "due_date",
      order = "asc",
    } = req.query;

    const conditions = ["1=1"];
    const params = [];
    addTenantCondition(conditions, params, req, "t");

    if (priority) {
      conditions.push("t.priority = ?");
      params.push(priority);
    }
    if (due_before) {
      conditions.push("t.due_date <= ?");
      params.push(due_before);
    }
    if (due_after) {
      conditions.push("t.due_date >= ?");
      params.push(due_after);
    }
    if (label && String(label).trim()) {
      conditions.push("t.label = ?");
      params.push(String(label).trim());
    }
    if (created_by) {
      conditions.push("t.created_by = ?");
      params.push(Number(created_by));
    }

    const qTrim = q != null ? String(q).trim() : "";
    if (qTrim) {
      conditions.push("(t.title LIKE ? OR t.description LIKE ?)");
      const like = `%${qTrim.replace(/[%_]/g, (c) => `\\${c}`)}%`;
      params.push(like, like);
    }

    if (assigned_to === "me") {
      conditions.push("t.assigned_to = ?");
      params.push(req.user.id);
    } else if (assigned_to === "__none__") {
      conditions.push("t.assigned_to IS NULL");
    } else if (assigned_to) {
      const mapped = await resolveUserId(assigned_to);
      if (mapped) {
        conditions.push("t.assigned_to = ?");
        params.push(mapped);
      } else {
        return res
          .status(400)
          .json({ success: false, message: "assigned_to user not found" });
      }
    } else if (my === "true") {
      conditions.push("(t.created_by = ? OR t.assigned_to = ?)");
      params.push(req.user.id, req.user.id);
    }

    const baseConditions = [...conditions];
    const baseParams = [...params];

    if (status) {
      const s = String(status);
      if (s === "new") {
        conditions.push("(t.status IN ('new','todo'))");
      } else if (s === "processing") {
        conditions.push("(t.status IN ('processing','in_progress'))");
      } else if (s === "completed") {
        conditions.push("(t.status IN ('completed','done'))");
      } else {
        conditions.push("t.status = ?");
        params.push(s);
      }
    }

    const sortKey = String(sort).toLowerCase();
    const orderDir = String(order).toLowerCase() === "desc" ? "DESC" : "ASC";
    let orderClause = "t.due_date ASC, t.created_at DESC";
    if (sortKey === "created_at") {
      orderClause = `t.created_at ${orderDir}, t.id DESC`;
    } else if (sortKey === "priority") {
      orderClause = `FIELD(t.priority,'high','medium','low') ${orderDir === "DESC" ? "DESC" : "ASC"}, t.due_date ASC`;
    } else {
      orderClause = `t.due_date ${orderDir}, t.created_at DESC`;
    }

    const fromJoin = `FROM tasks t
       LEFT JOIN users u ON t.assigned_to = u.id
       LEFT JOIN users uc ON t.created_by = uc.id`;

    const [tasks] = await pool.execute(
      `SELECT t.*,
              u.email as assigned_email,
              u.first_name as assignee_first_name,
              u.last_name as assignee_last_name,
              u.clerk_user_id as assigned_to_clerk,
              uc.email as creator_email,
              uc.first_name as creator_first_name,
              uc.last_name as creator_last_name
       ${fromJoin}
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${orderClause}`,
      params
    );

    let statusCounts = null;
    if (req.query.include_status_counts === "1") {
      const [agg] = await pool.execute(
        `SELECT
           SUM(CASE WHEN t.status IN ('new','todo') THEN 1 ELSE 0 END) AS new_c,
           SUM(CASE WHEN t.status = 'in_feedback' THEN 1 ELSE 0 END) AS in_feedback_c,
           SUM(CASE WHEN t.status IN ('processing','in_progress') THEN 1 ELSE 0 END) AS processing_c,
           SUM(CASE WHEN t.status IN ('completed','done') THEN 1 ELSE 0 END) AS completed_c,
           SUM(CASE WHEN t.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_c
         ${fromJoin}
         WHERE ${baseConditions.join(" AND ")}`,
        baseParams
      );
      const row = agg[0] || {};
      statusCounts = {
        new: Number(row.new_c) || 0,
        in_feedback: Number(row.in_feedback_c) || 0,
        processing: Number(row.processing_c) || 0,
        completed: Number(row.completed_c) || 0,
        rejected: Number(row.rejected_c) || 0,
      };
    }

    res.json({
      success: true,
      total: tasks.length,
      data: tasks,
      statusCounts,
    });
  } catch (err) {
    console.error("GET /api/tasks", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    if (!taskId) return res.status(400).json({ success: false, message: "Invalid task id" });

    const [rows] = await pool.execute(
      `SELECT t.*, u.email as assigned_email, u.clerk_user_id as assigned_to_clerk,
              uc.email as creator_email, uc.first_name as creator_first_name, uc.last_name as creator_last_name
       FROM tasks t
       LEFT JOIN users u ON t.assigned_to = u.id
       LEFT JOIN users uc ON t.created_by = uc.id
       WHERE t.id = ? AND t.is_deleted = 0 AND (? IS NULL OR t.tenant_id = ?)`,
      [taskId, req.user.tenantId || null, req.user.tenantId || null]
    );

    if (rows.length === 0)
      return res.status(404).json({ success: false, message: "Task not found" });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("GET /api/tasks/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", requireFeature("task_management", "create"), async (req, res) => {
  try {
    const {
      title,
      description,
      lead_id,
      assigned_to,
      due_date,
      priority,
      status,
      label,
    } = req.body;

    if (!title) return res.status(400).json({ success: false, message: "title is required" });

    const assignedUserId = await resolveUserId(assigned_to);

    const apiSt = sanitizeStatus(status) || "new";
    const st = statusToDbEnum(apiSt);

    const labelVal =
      label != null && String(label).trim()
        ? String(label).trim().slice(0, 120)
        : null;

    let insertId;
    try {
      const [result] = await pool.execute(
        `INSERT INTO tasks (tenant_id, title, label, description, lead_id, assigned_to, created_by, due_date, priority, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.tenantId || null,
          title,
          labelVal,
          description || null,
          lead_id || null,
          assignedUserId,
          req.user.id,
          due_date || null,
          priority || "medium",
          st,
        ]
      );
      insertId = result.insertId;
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      const noLabel =
        e && (e.code === "ER_BAD_FIELD_ERROR" || /Unknown column ['"]label['"]/i.test(msg));
      if (!noLabel) throw e;
      const [result] = await pool.execute(
        `INSERT INTO tasks (tenant_id, title, description, lead_id, assigned_to, created_by, due_date, priority, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.tenantId || null,
          title,
          description || null,
          lead_id || null,
          assignedUserId,
          req.user.id,
          due_date || null,
          priority || "medium",
          st,
        ]
      );
      insertId = result.insertId;
    }

    const [created] = await pool.execute(
      `SELECT t.*, u.email as assigned_email,
              uc.email as creator_email, uc.first_name as creator_first_name, uc.last_name as creator_last_name
       FROM tasks t
       LEFT JOIN users u ON t.assigned_to = u.id
       LEFT JOIN users uc ON t.created_by = uc.id
       WHERE t.id = ? AND (? IS NULL OR t.tenant_id = ?)`,
      [insertId, req.user.tenantId || null, req.user.tenantId || null]
    );
    if (assignedUserId && assignedUserId !== req.user.id) {
      await createUserNotification({
        userId: assignedUserId,
        actorUserId: req.user.id,
        entityType: "task",
        entityId: insertId,
        title: "New task assigned",
        body: String(title || "").trim() || "A task was assigned to you.",
      }).catch((e) => console.warn("task notification(create):", e.message));
    }
    emitCalendarChanged({ reason: "tasks" });
    res.status(201).json({ success: true, data: created[0] });
  } catch (err) {
    console.error("POST /api/tasks", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", requireFeature("task_management", "edit"), async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    if (!taskId) return res.status(400).json({ success: false, message: "Invalid task id" });

    const {
      title,
      description,
      lead_id,
      assigned_to,
      due_date,
      priority,
      status,
      label,
    } = req.body;

    const assignedUserId =
      assigned_to !== undefined ? await resolveUserId(assigned_to) : undefined;

    const sets = [];
    const params = [];

    if (title !== undefined) {
      sets.push("title = ?");
      params.push(title);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "label")) {
      sets.push("label = ?");
      params.push(
        label === null || label === undefined || label === ""
          ? null
          : String(label).trim().slice(0, 120)
      );
    }
    if (description !== undefined) {
      sets.push("description = ?");
      params.push(description);
    }
    if (lead_id !== undefined) {
      sets.push("lead_id = ?");
      params.push(lead_id || null);
    }
    if (assigned_to !== undefined) {
      sets.push("assigned_to = ?");
      params.push(assignedUserId);
    }
    if (due_date !== undefined) {
      sets.push("due_date = ?");
      params.push(due_date || null);
    }
    if (priority !== undefined) {
      sets.push("priority = ?");
      params.push(priority);
    }
    if (status !== undefined) {
      const st = sanitizeStatus(status);
      if (!st) {
        return res.status(400).json({ success: false, message: "Invalid status" });
      }
      sets.push("status = ?");
      params.push(statusToDbEnum(st));
    }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    sets.push("updated_at = NOW()");
    params.push(taskId);

    const [[beforeRow]] = await pool.execute(
      "SELECT assigned_to FROM tasks WHERE id = ? AND is_deleted = 0 AND (? IS NULL OR tenant_id = ?)",
      [taskId, req.user.tenantId || null, req.user.tenantId || null]
    );

    const [result] = await pool.execute(
      `UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND is_deleted = 0 AND (? IS NULL OR tenant_id = ?)`,
      [...params, req.user.tenantId || null, req.user.tenantId || null]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const [updated] = await pool.execute(
      `SELECT t.*, u.email as assigned_email,
              uc.email as creator_email, uc.first_name as creator_first_name, uc.last_name as creator_last_name
       FROM tasks t
       LEFT JOIN users u ON t.assigned_to = u.id
       LEFT JOIN users uc ON t.created_by = uc.id
       WHERE t.id = ? AND t.is_deleted = 0 AND (? IS NULL OR t.tenant_id = ?)`,
      [taskId, req.user.tenantId || null, req.user.tenantId || null]
    );
    const nextAssignedTo = Number(updated?.[0]?.assigned_to) || null;
    const prevAssignedTo = Number(beforeRow?.assigned_to) || null;
    if (nextAssignedTo && nextAssignedTo !== req.user.id && nextAssignedTo !== prevAssignedTo) {
      await createUserNotification({
        userId: nextAssignedTo,
        actorUserId: req.user.id,
        entityType: "task",
        entityId: taskId,
        title: "Task assigned to you",
        body: String(updated?.[0]?.title || "").trim() || "A task was assigned to you.",
      }).catch((e) => console.warn("task notification(assign):", e.message));
    }
    emitCalendarChanged({ reason: "tasks" });
    res.json({ success: true, data: updated[0] });
  } catch (err) {
    console.error("PUT /api/tasks/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", requireFeature("task_management", "delete"), async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    if (!taskId) return res.status(400).json({ success: false, message: "Invalid task id" });

    const [result] = await pool.execute(
      `UPDATE tasks
       SET is_deleted = 1, deleted_at = NOW(), updated_at = NOW()
       WHERE id = ? AND is_deleted = 0 AND (? IS NULL OR tenant_id = ?)`,
      [taskId, req.user.tenantId || null, req.user.tenantId || null]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    emitCalendarChanged({ reason: "tasks" });
    res.json({ success: true, message: "Task deleted" });
  } catch (err) {
    console.error("DELETE /api/tasks/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
