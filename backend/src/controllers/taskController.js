const prisma = require("../config/prisma");
const { emitAdminChanged } = require("../realtime/meetingsRealtime");

const STATUS_RANK = { todo: 0, in_progress: 1, done: 2 };
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

function sortTasks(a, b) {
  const sa = STATUS_RANK[a.status] ?? 99;
  const sb = STATUS_RANK[b.status] ?? 99;
  if (sa !== sb) return sa - sb;
  const pa = PRIORITY_RANK[a.priority] ?? 99;
  const pb = PRIORITY_RANK[b.priority] ?? 99;
  if (pa !== pb) return pa - pb;
  const da = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
  const db = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
  return da - db;
}

function mapTaskRow(t) {
  const assigned = t.users_tasks_assigned_toTousers;
  const lead = t.leads;
  const { users_tasks_assigned_toTousers, users_tasks_created_byTousers, leads, ...rest } = t;
  return {
    ...rest,
    assigned_name: assigned
      ? [assigned.first_name, assigned.last_name].filter(Boolean).join(" ").trim()
      : null,
    assigned_email: assigned?.email ?? null,
    lead_name: lead?.name ?? null,
  };
}

async function getTasks(req, res) {
  try {
    const { status, assigned_to, page = 1, limit = 100 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where = {};
    if (status) where.status = status;
    if (assigned_to) where.assigned_to = Number(assigned_to);

    const [total, rows] = await Promise.all([
      prisma.tasks.count({ where }),
      prisma.tasks.findMany({
        where,
        include: {
          users_tasks_assigned_toTousers: {
            select: { first_name: true, last_name: true, email: true },
          },
          leads: { select: { name: true } },
        },
      }),
    ]);

    const tasks = rows.map(mapTaskRow).sort(sortTasks).slice(offset, offset + take);

    res.json({ success: true, total, tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getTask(req, res) {
  try {
    const row = await prisma.tasks.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        users_tasks_assigned_toTousers: {
          select: { first_name: true, last_name: true, email: true },
        },
        leads: { select: { name: true } },
      },
    });
    if (!row) return res.status(404).json({ success: false, message: "Task not found" });
    res.json({ success: true, task: mapTaskRow(row) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createTask(req, res) {
  try {
    const { title, description, status, priority, assigned_to, lead_id, due_date } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, message: "Title is required" });

    const created = await prisma.tasks.create({
      data: {
        title: title.trim(),
        description: description || null,
        status: status || "todo",
        priority: priority || "medium",
        assigned_to: assigned_to ? Number(assigned_to) : null,
        lead_id: lead_id ? Number(lead_id) : null,
        due_date: due_date ? new Date(due_date) : null,
        created_by: req.user?.id || 0,
      },
    });
    emitAdminChanged({ scope: "stats", reason: "tasks", action: "create" });
    res.status(201).json({ success: true, id: created.id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateTask(req, res) {
  try {
    const { title, description, status, priority, assigned_to, lead_id, due_date } = req.body;
    await prisma.tasks.update({
      where: { id: Number(req.params.id) },
      data: {
        title: title || null,
        description: description || null,
        status: status || "todo",
        priority: priority || "medium",
        assigned_to: assigned_to ? Number(assigned_to) : null,
        lead_id: lead_id ? Number(lead_id) : null,
        due_date: due_date ? new Date(due_date) : null,
        updated_at: new Date(),
      },
    });
    emitAdminChanged({ scope: "stats", reason: "tasks", action: "update" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateTaskStatus(req, res) {
  try {
    const { status } = req.body;
    const valid = ["todo", "in_progress", "done"];
    if (!valid.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    await prisma.tasks.update({
      where: { id: Number(req.params.id) },
      data: { status, updated_at: new Date() },
    });
    emitAdminChanged({ scope: "stats", reason: "tasks", action: "status" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteTask(req, res) {
  try {
    await prisma.tasks.delete({ where: { id: Number(req.params.id) } });
    emitAdminChanged({ scope: "stats", reason: "tasks", action: "delete" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getTasks, getTask, createTask, updateTask, updateTaskStatus, deleteTask };
