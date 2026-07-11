const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const prisma = require("../config/prisma");
const { createUserNotification } = require("../services/notificationService");
const { emitCalendarChanged, emitTasksChanged } = require("../realtime/meetingsRealtime");

const router = express.Router();
router.use(verifyToken);

const VALID_STATUS = new Set([
  "new",
  "pending",
  "in_feedback",
  "processing",
  "completed",
  "rejected",
  "todo",
  "in_progress",
  "done",
  "carried_forward",
]);

async function resolveUserId(assignedTo) {
  if (assignedTo === null || assignedTo === undefined || assignedTo === "") return null;

  const n = Number(assignedTo);
  if (Number.isInteger(n) && n > 0) {
    const user = await prisma.users.findFirst({
      where: { id: n, is_active: true },
      select: { id: true }
    });
    if (user) return user.id;
  }
  return null;
}

function sanitizeStatus(s) {
  if (!s || !VALID_STATUS.has(String(s))) return null;
  return String(s);
}

function statusToDbEnum(apiStatus) {
  const k = String(apiStatus || "new").toLowerCase();
  if (k === "carried_forward") return "carried_forward";
  if (k === "in_progress" || k === "processing" || k === "in_feedback") {
    return "in_progress";
  }
  if (k === "done" || k === "completed") {
    return "done";
  }
  if (k === "new") return "new";
  if (k === "pending") return "todo";
  if (k === "rejected") return "rejected";
  return "todo";
}

function emitTaskEvents(req, reason = "tasks") {
  const tenantId = req.user?.tenantId || undefined;
  emitTasksChanged({ reason, tenantId });
  if (reason === "task_done" || reason === "tasks") {
    emitCalendarChanged({ reason: reason === "task_done" ? "task_done" : "tasks", tenantId });
  }
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
      client_id,
      task_category,
      task_type,
      scope,
      sort = "due_date",
      order = "asc",
    } = req.query;

    const conditions = [{ is_deleted: false }];

    if (client_id) {
      conditions.push({ client_id: Number(client_id) });
    }
    if (task_category && String(task_category).trim()) {
      conditions.push({ task_category: String(task_category).trim() });
    }
    if (task_type && String(task_type).trim()) {
      conditions.push({ task_type: String(task_type).trim() });
    }

    const scopeKey = scope != null ? String(scope).toLowerCase() : "";
    if (scopeKey === "today") {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      const todayDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
      conditions.push({ due_date: todayDate });
    } else if (scopeKey === "overdue") {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      const todayDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
      conditions.push({
        due_date: { lt: todayDate },
        status: { notIn: ["completed", "done"] }
      });
    }

    if (priority) {
      conditions.push({ priority });
    }
    if (due_before) {
      conditions.push({ due_date: { lte: new Date(`${due_before}T00:00:00.000Z`) } });
    }
    if (due_after) {
      conditions.push({ due_date: { gte: new Date(`${due_after}T00:00:00.000Z`) } });
    }
    if (label && String(label).trim()) {
      conditions.push({ label: String(label).trim() });
    }
    if (created_by) {
      conditions.push({ created_by: Number(created_by) });
    }

    const qTrim = q != null ? String(q).trim() : "";
    if (qTrim) {
      conditions.push({
        OR: [
          { title: { contains: qTrim } },
          { description: { contains: qTrim } }
        ]
      });
    }

    if (assigned_to === "me") {
      conditions.push({ assigned_to: req.user.id });
    } else if (assigned_to === "__none__") {
      conditions.push({ assigned_to: null });
    } else if (assigned_to) {
      const mapped = await resolveUserId(assigned_to);
      if (mapped) {
        conditions.push({ assigned_to: mapped });
      } else {
        return res
          .status(400)
          .json({ success: false, message: "assigned_to user not found" });
      }
    } else if (my === "true") {
      conditions.push({
        OR: [
          { created_by: req.user.id },
          { assigned_to: req.user.id }
        ]
      });
    }

    const baseConditions = [...conditions];

    if (status) {
      const s = String(status);
      if (s === "new") {
        conditions.push({ status: { in: ["new", "todo"] } });
      } else if (s === "processing") {
        conditions.push({ status: { in: ["processing", "in_progress"] } });
      } else if (s === "completed") {
        conditions.push({ status: { in: ["completed", "done"] } });
      } else {
        conditions.push({ status: s });
      }
    }

    const sortKey = String(sort).toLowerCase();
    const orderDir = String(order).toLowerCase() === "desc" ? "desc" : "asc";
    
    let orderBy = [];
    if (sortKey === "created_at") {
      orderBy = [
        { created_at: orderDir },
        { id: "desc" }
      ];
    } else if (sortKey === "priority") {
      // In-memory sort needed for FIELD(priority) tie-breaker, set default orderBy
      orderBy = [
        { due_date: "asc" }
      ];
    } else {
      orderBy = [
        { due_date: orderDir },
        { created_at: "desc" }
      ];
    }

    const tasks = await prisma.tasks.findMany({
      where: { AND: conditions },
      include: {
        users_tasks_assigned_toTousers: {
          select: {
            email: true,
            first_name: true,
            last_name: true
          }
        },
        users_tasks_created_byTousers: {
          select: {
            email: true,
            first_name: true,
            last_name: true
          }
        }
      },
      orderBy
    });

    const clientIds = tasks.map(t => t.client_id).filter(Boolean);
    const clients = await prisma.fitness_clients.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, full_name: true, phone: true }
    });
    const clientMap = new Map(clients.map(c => [c.id, c]));

    let data = tasks.map(t => {
      const assignee = t.users_tasks_assigned_toTousers;
      const creator = t.users_tasks_created_byTousers;
      const client = t.client_id ? clientMap.get(t.client_id) : null;
      
      const row = { ...t };
      delete row.users_tasks_assigned_toTousers;
      delete row.users_tasks_created_byTousers;
      
      row.assigned_email = assignee?.email || null;
      row.assignee_first_name = assignee?.first_name || null;
      row.assignee_last_name = assignee?.last_name || null;
      row.creator_email = creator?.email || null;
      row.creator_first_name = creator?.first_name || null;
      row.creator_last_name = creator?.last_name || null;
      row.client_name = client?.full_name || null;
      row.client_phone = client?.phone || null;
      
      return row;
    });

    if (sortKey === "priority") {
      const priorityMap = { high: 1, medium: 2, low: 3 };
      data.sort((a, b) => {
        const valA = priorityMap[a.priority] || 4;
        const valB = priorityMap[b.priority] || 4;
        if (valA !== valB) {
          return orderDir === "asc" ? valA - valB : valB - valA;
        }
        const dateA = a.due_date ? new Date(a.due_date).getTime() : 0;
        const dateB = b.due_date ? new Date(b.due_date).getTime() : 0;
        return dateA - dateB;
      });
    }

    let statusCounts = null;
    if (req.query.include_status_counts === "1") {
      const allMatchingTasks = await prisma.tasks.findMany({
        where: { AND: baseConditions },
        select: { status: true }
      });
      statusCounts = {
        new: 0,
        in_feedback: 0,
        processing: 0,
        completed: 0,
        rejected: 0
      };
      for (const task of allMatchingTasks) {
        const s = task.status;
        if (s === "new" || s === "todo") statusCounts.new += 1;
        else if (s === "in_feedback") statusCounts.in_feedback += 1;
        else if (s === "processing" || s === "in_progress") statusCounts.processing += 1;
        else if (s === "completed" || s === "done") statusCounts.completed += 1;
        else if (s === "rejected") statusCounts.rejected += 1;
      }
    }

    res.json({
      success: true,
      total: data.length,
      data,
      statusCounts,
    });
  } catch (err) {
    console.error("GET /api/tasks", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/bulk-status", async (req, res) => {
  try {
    const { ids, status } = req.body || {};
    const st = sanitizeStatus(status);
    if (!st) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    const idList = (Array.isArray(ids) ? ids : [])
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (idList.length === 0) {
      return res.status(400).json({ success: false, message: "ids array required" });
    }

    const dbSt = statusToDbEnum(st);

    const updatedCount = await prisma.$transaction(async (tx) => {
      const result = await tx.tasks.updateMany({
        where: {
          id: { in: idList },
          is_deleted: false,
          OR: [
            { created_by: req.user.id },
            { assigned_to: req.user.id }
          ]
        },
        data: {
          status: dbSt,
          updated_at: new Date()
        }
      });
      return result.count;
    });

    const reason = dbSt === "done" || dbSt === "completed" ? "task_done" : "tasks";
    emitTaskEvents(req, reason);
    res.json({ success: true, updated: updatedCount });
  } catch (err) {
    console.error("POST /api/tasks/bulk-status", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    if (!taskId) return res.status(400).json({ success: false, message: "Invalid task id" });

    const task = await prisma.tasks.findFirst({
      where: { id: taskId, is_deleted: false },
      include: {
        users_tasks_assigned_toTousers: {
          select: {
            email: true,
            first_name: true,
            last_name: true
          }
        },
        users_tasks_created_byTousers: {
          select: {
            email: true,
            first_name: true,
            last_name: true
          }
        }
      }
    });

    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    let client = null;
    if (task.client_id) {
      client = await prisma.fitness_clients.findFirst({
        where: { id: task.client_id },
        select: { full_name: true, phone: true }
      });
    }

    const assignee = task.users_tasks_assigned_toTousers;
    const creator = task.users_tasks_created_byTousers;
    
    const row = { ...task };
    delete row.users_tasks_assigned_toTousers;
    delete row.users_tasks_created_byTousers;
    
    row.assigned_email = assignee?.email || null;
    row.assignee_first_name = assignee?.first_name || null;
    row.assignee_last_name = assignee?.last_name || null;
    row.creator_email = creator?.email || null;
    row.creator_first_name = creator?.first_name || null;
    row.creator_last_name = creator?.last_name || null;
    row.client_name = client?.full_name || null;
    row.client_phone = client?.phone || null;

    res.json({ success: true, data: row });
  } catch (err) {
    console.error("GET /api/tasks/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
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
      client_id,
      task_category,
      task_type,
      frequency,
    } = req.body;

    if (!title) return res.status(400).json({ success: false, message: "title is required" });

    const assignedUserId = await resolveUserId(assigned_to);
    const clientIdNum = client_id != null && client_id !== "" ? Number(client_id) : null;
    const taskType = task_type || (clientIdNum ? "client" : "internal");
    const taskCategory = task_category || "general";

    const apiSt = sanitizeStatus(status) || "new";
    const st = statusToDbEnum(apiSt);

    const labelVal = label != null && String(label).trim()
      ? String(label).trim().slice(0, 120)
      : null;

    const createdTask = await prisma.tasks.create({
      data: {
        title,
        label: labelVal,
        description: description || null,
        lead_id: lead_id ? Number(lead_id) : null,
        client_id: clientIdNum,
        task_category: taskCategory,
        task_type: taskType,
        frequency: frequency || "once",
        assigned_to: assignedUserId,
        created_by: req.user.id,
        due_date: due_date ? new Date(`${due_date}T00:00:00.000Z`) : null,
        priority: priority || "medium",
        status: st,
      }
    });

    const taskWithJoins = await prisma.tasks.findFirst({
      where: { id: createdTask.id },
      include: {
        users_tasks_assigned_toTousers: {
          select: {
            email: true,
            first_name: true,
            last_name: true
          }
        },
        users_tasks_created_byTousers: {
          select: {
            email: true,
            first_name: true,
            last_name: true
          }
        }
      }
    });

    let client = null;
    if (createdTask.client_id) {
      client = await prisma.fitness_clients.findFirst({
        where: { id: createdTask.client_id },
        select: { full_name: true, phone: true }
      });
    }

    const assignee = taskWithJoins.users_tasks_assigned_toTousers;
    const creator = taskWithJoins.users_tasks_created_byTousers;
    
    const row = { ...taskWithJoins };
    delete row.users_tasks_assigned_toTousers;
    delete row.users_tasks_created_byTousers;
    
    row.assigned_email = assignee?.email || null;
    row.assignee_first_name = assignee?.first_name || null;
    row.assignee_last_name = assignee?.last_name || null;
    row.creator_email = creator?.email || null;
    row.creator_first_name = creator?.first_name || null;
    row.creator_last_name = creator?.last_name || null;
    row.client_name = client?.full_name || null;
    row.client_phone = client?.phone || null;

    if (assignedUserId && assignedUserId !== req.user.id) {
      await createUserNotification({
        userId: assignedUserId,
        actorUserId: req.user.id,
        entityType: "task",
        entityId: createdTask.id,
        title: "New task assigned",
        body: String(title || "").trim() || "A task was assigned to you.",
      }).catch((e) => console.warn("task notification(create):", e.message));
    }

    emitTaskEvents(req, "tasks");
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    console.error("POST /api/tasks", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    if (!taskId) return res.status(400).json({ success: false, message: "Invalid task id" });

    const existing = await prisma.tasks.findFirst({
      where: { id: taskId, is_deleted: false }
    });
    if (!existing) return res.status(404).json({ success: false, message: "Task not found" });

    const {
      title,
      description,
      lead_id,
      assigned_to,
      due_date,
      priority,
      status,
      label,
      client_id,
      task_category,
      task_type,
      frequency,
    } = req.body;

    const data = {};
    if (title !== undefined) data.title = title;
    if (label !== undefined) {
      data.label = label === null || label === undefined || label === ""
        ? null
        : String(label).trim().slice(0, 120);
    }
    if (description !== undefined) data.description = description;
    if (lead_id !== undefined) data.lead_id = lead_id ? Number(lead_id) : null;
    if (assigned_to !== undefined) {
      data.assigned_to = assigned_to !== null && assigned_to !== "" 
        ? await resolveUserId(assigned_to) 
        : null;
    }
    if (due_date !== undefined) {
      data.due_date = due_date ? new Date(`${due_date}T00:00:00.000Z`) : null;
    }
    if (priority !== undefined) data.priority = priority;
    if (status !== undefined) {
      const st = sanitizeStatus(status);
      if (!st) {
        return res.status(400).json({ success: false, message: "Invalid status" });
      }
      data.status = statusToDbEnum(st);
    }
    if (client_id !== undefined) data.client_id = client_id ? Number(client_id) : null;
    if (task_category !== undefined) data.task_category = task_category || "general";
    if (task_type !== undefined) data.task_type = task_type || "internal";
    if (frequency !== undefined) data.frequency = frequency || "once";

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    data.updated_at = new Date();

    const updatedTask = await prisma.tasks.update({
      where: { id: taskId },
      data
    });

    const taskWithJoins = await prisma.tasks.findFirst({
      where: { id: taskId },
      include: {
        users_tasks_assigned_toTousers: {
          select: {
            email: true,
            first_name: true,
            last_name: true
          }
        },
        users_tasks_created_byTousers: {
          select: {
            email: true,
            first_name: true,
            last_name: true
          }
        }
      }
    });

    let client = null;
    if (taskWithJoins.client_id) {
      client = await prisma.fitness_clients.findFirst({
        where: { id: taskWithJoins.client_id },
        select: { full_name: true, phone: true }
      });
    }

    const assignee = taskWithJoins.users_tasks_assigned_toTousers;
    const creator = taskWithJoins.users_tasks_created_byTousers;
    
    const row = { ...taskWithJoins };
    delete row.users_tasks_assigned_toTousers;
    delete row.users_tasks_created_byTousers;
    
    row.assigned_email = assignee?.email || null;
    row.assignee_first_name = assignee?.first_name || null;
    row.assignee_last_name = assignee?.last_name || null;
    row.creator_email = creator?.email || null;
    row.creator_first_name = creator?.first_name || null;
    row.creator_last_name = creator?.last_name || null;
    row.client_name = client?.full_name || null;
    row.client_phone = client?.phone || null;

    const nextAssignedTo = Number(updatedTask.assigned_to) || null;
    const prevAssignedTo = Number(existing.assigned_to) || null;
    if (nextAssignedTo && nextAssignedTo !== req.user.id && nextAssignedTo !== prevAssignedTo) {
      await createUserNotification({
        userId: nextAssignedTo,
        actorUserId: req.user.id,
        entityType: "task",
        entityId: taskId,
        title: "Task assigned to you",
        body: String(updatedTask.title || "").trim() || "A task was assigned to you.",
      }).catch((e) => console.warn("task notification(assign):", e.message));
    }

    const dbSt = updatedTask.status;
    const reason = dbSt === "done" || dbSt === "completed" ? "task_done" : "tasks";
    emitTaskEvents(req, reason);

    res.json({ success: true, data: row });
  } catch (err) {
    console.error("PUT /api/tasks/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    if (!taskId) return res.status(400).json({ success: false, message: "Invalid task id" });

    const existing = await prisma.tasks.findFirst({
      where: { id: taskId, is_deleted: false }
    });
    if (!existing) return res.status(404).json({ success: false, message: "Task not found" });

    await prisma.tasks.update({
      where: { id: taskId },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        updated_at: new Date()
      }
    });

    emitTaskEvents(req, "tasks");
    res.json({ success: true, message: "Task deleted" });
  } catch (err) {
    console.error("DELETE /api/tasks/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
