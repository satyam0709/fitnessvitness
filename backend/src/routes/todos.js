const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { verifyToken } = require("../middleware/verifyToken");
const prisma = require("../config/prisma");
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

async function assertTodoAccess(todoId, userId, tenantId) {
  const todo = await prisma.crm_todos.findFirst({
    where: {
      id: todoId,
      is_deleted: false,
      tenant_id: tenantId,
      OR: [
        { created_by: userId },
        {
          crm_todo_assignees: {
            some: {
              user_id: userId,
            },
          },
        },
      ],
    },
  });
  return todo;
}

const mapTodoRow = (t) => {
  const creator = t.users;
  const shaped = {
    ...t,
    todo_date: formatYmd(t.todo_date),
    completed_at: t.completed_at ? t.completed_at.toISOString() : null,
    created_at: t.created_at.toISOString(),
    updated_at: t.updated_at.toISOString(),
    deleted_at: t.deleted_at ? t.deleted_at.toISOString() : null,
    creator_email: creator?.email || null,
    creator_first_name: creator?.first_name || null,
    creator_last_name: creator?.last_name || null,
    attachments: parseAttachmentJson(t),
    assignees: (t.crm_todo_assignees || []).map((asg) => ({
      id: asg.users.id,
      email: asg.users.email,
      first_name: asg.users.first_name,
      last_name: asg.users.last_name,
      clerk_user_id: null,
    })),
  };
  delete shaped.users;
  delete shaped.crm_todo_assignees;
  return shaped;
};

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

    const andConditions = [
      { is_deleted: false },
      { tenant_id: tenantId },
      {
        OR: [
          { created_by: uid },
          {
            crm_todo_assignees: {
              some: {
                user_id: uid,
              },
            },
          },
        ],
      },
    ];

    const st = status ? String(status).toLowerCase() : "";
    if (st === "pending" || st === "completed") {
      andConditions.push({ status: st });
    }

    if (priority && ["low", "medium", "high"].includes(String(priority))) {
      andConditions.push({ priority: priority.toLowerCase() });
    }

    if (frequency && VALID_FREQ.has(String(frequency).toLowerCase())) {
      andConditions.push({ frequency: String(frequency).toLowerCase() });
    }

    if (created_by) {
      andConditions.push({ created_by: Number(created_by) });
    }

    if (assigned_to) {
      andConditions.push({
        crm_todo_assignees: {
          some: {
            user_id: Number(assigned_to),
          },
        },
      });
    }

    const qTrim = q != null ? String(q).trim() : "";
    if (qTrim) {
      andConditions.push({
        body: {
          contains: qTrim,
        },
      });
    }

    const todayStr = formatYmd(new Date());
    const todayDate = new Date(todayStr);
    const sc = String(scope || "all").toLowerCase();

    if (sc === "today") {
      andConditions.push({
        OR: [
          {
            status: "pending",
            todo_date: todayDate,
          },
          {
            status: "pending",
            carry_forward: true,
            todo_date: { lt: todayDate },
          },
          {
            status: "completed",
            completed_at: {
              gte: new Date(todayStr + "T00:00:00.000Z"),
              lte: new Date(todayStr + "T23:59:59.999Z"),
            },
          },
        ],
      });
    } else if (sc === "pending") {
      andConditions.push({ status: "pending" });
    } else if (sc === "recursive") {
      andConditions.push({
        frequency: { not: "once" },
        status: "pending",
      });
    }

    const todos = await prisma.crm_todos.findMany({
      where: {
        AND: andConditions,
      },
      include: {
        users: {
          select: {
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        crm_todo_assignees: {
          include: {
            users: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
          },
        },
      },
    });

    const shaped = todos.map(mapTodoRow);

    // Apply Sorting in Javascript
    const sortKey = String(sort).toLowerCase();
    const orderDir = String(order).toLowerCase() === "desc" ? "desc" : "asc";

    if (sortKey === "created_at") {
      shaped.sort((a, b) => {
        const dA = new Date(a.created_at);
        const dB = new Date(b.created_at);
        if (dA.getTime() !== dB.getTime()) {
          return orderDir === "desc" ? dB - dA : dA - dB;
        }
        return b.id - a.id;
      });
    } else if (sortKey === "priority") {
      const priorityWeight = { high: 3, medium: 2, low: 1 };
      shaped.sort((a, b) => {
        const wA = priorityWeight[a.priority] || 0;
        const wB = priorityWeight[b.priority] || 0;
        if (wA !== wB) {
          return orderDir === "desc" ? wB - wA : wA - wB;
        }
        return new Date(a.todo_date) - new Date(b.todo_date);
      });
    } else {
      // default: sort by todo_date
      shaped.sort((a, b) => {
        const dA = new Date(a.todo_date);
        const dB = new Date(b.todo_date);
        if (dA.getTime() !== dB.getTime()) {
          return orderDir === "desc" ? dB - dA : dA - dB;
        }
        // secondary priority desc
        const priorityWeight = { high: 3, medium: 2, low: 1 };
        const wA = priorityWeight[a.priority] || 0;
        const wB = priorityWeight[b.priority] || 0;
        if (wA !== wB) {
          return wB - wA;
        }
        return b.id - a.id;
      });
    }

    res.json({ success: true, total: shaped.length, data: shaped });
  } catch (err) {
    console.error("GET /todos:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", maybeUpload, async (req, res) => {
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

  try {
    const todo = await prisma.$transaction(async (tx) => {
      const created = await tx.crm_todos.create({
        data: {
          tenant_id: tenantId,
          body,
          frequency: freq,
          todo_date: new Date(todoDateRaw),
          priority: pri,
          carry_forward: carry,
          status: "pending",
          attachment_json: attachmentJson,
          created_by: req.user.id,
        },
      });

      const uniq = [...new Set(assigneeIds)];
      for (const uid of uniq) {
        const u = await tx.users.findFirst({
          where: { id: uid, is_active: true },
        });
        if (u) {
          await tx.crm_todo_assignees.create({
            data: {
              todo_id: created.id,
              user_id: uid,
            },
          });
        }
      }
      return created;
    });

    emitTodosChanged({ action: "create", id: todo.id });
    emitCalendarChanged({ reason: "todos" });

    for (const asg of [...new Set(assigneeIds)]) {
      if (asg === req.user.id) continue;
      await createUserNotification({
        userId: asg,
        actorUserId: req.user.id,
        entityType: "todo",
        entityId: todo.id,
        title: "New to-do assigned",
        body,
      }).catch((e) => console.warn("todo notification(create):", e.message));
    }

    const full = await prisma.crm_todos.findFirst({
      where: {
        id: todo.id,
        is_deleted: false,
        tenant_id: tenantId,
      },
      include: {
        users: {
          select: {
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        crm_todo_assignees: {
          include: {
            users: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
          },
        },
      },
    });

    res.status(201).json({ success: true, data: mapTodoRow(full) });
  } catch (err) {
    console.error("POST /todos:", err);
    res.status(500).json({ success: false, message: err.message });
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

    await prisma.$transaction(async (tx) => {
      const updates = {};
      if (typeof b.body === "string" && b.body.trim()) {
        updates.body = b.body.trim();
      }
      if (b.priority && ["low", "medium", "high"].includes(String(b.priority))) {
        updates.priority = String(b.priority).toLowerCase();
      }
      if (b.todo_date && parseYmdLocal(String(b.todo_date).slice(0, 10))) {
        updates.todo_date = new Date(String(b.todo_date).slice(0, 10));
      }
      if (b.frequency && VALID_FREQ.has(String(b.frequency).toLowerCase())) {
        updates.frequency = String(b.frequency).toLowerCase();
      }
      if (b.carry_forward !== undefined) {
        updates.carry_forward =
          b.carry_forward === true ||
          b.carry_forward === 1 ||
          b.carry_forward === "1";
      }

      if (Object.keys(updates).length > 0) {
        await tx.crm_todos.update({
          where: { id },
          data: updates,
        });
      }

      if (b.status === "completed" || b.status === "pending") {
        const row = await tx.crm_todos.findUnique({
          where: { id },
        });
        if (b.status === "completed") {
          const freq = String(row.frequency || "once").toLowerCase();
          if (freq === "once") {
            await tx.crm_todos.update({
              where: { id },
              data: {
                status: "completed",
                completed_at: new Date(),
              },
            });
          } else {
            const nextD = nextOccurrence(formatYmd(row.todo_date), freq);
            await tx.crm_todos.update({
              where: { id },
              data: {
                todo_date: new Date(nextD),
                status: "pending",
                completed_at: null,
              },
            });
          }
        } else {
          await tx.crm_todos.update({
            where: { id },
            data: {
              status: "pending",
              completed_at: null,
            },
          });
        }
      }

      if (Array.isArray(b.assignee_ids)) {
        const prevRows = await tx.crm_todo_assignees.findMany({
          where: { todo_id: id },
          select: { user_id: true },
        });
        const beforeAssignees = prevRows.map((r) => Number(r.user_id)).filter(Boolean);
        const ids = b.assignee_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
        if (!ids.length) {
          throw new Error("assignee_ids cannot be empty");
        }

        // recreate assignees
        await tx.crm_todo_assignees.deleteMany({
          where: { todo_id: id },
        });

        const uniq = [...new Set(ids)];
        for (const uid of uniq) {
          const u = await tx.users.findFirst({
            where: { id: uid, is_active: true },
          });
          if (u) {
            await tx.crm_todo_assignees.create({
              data: {
                todo_id: id,
                user_id: uid,
              },
            });
          }
        }

        const beforeSet = new Set(beforeAssignees);
        newlyAssignedUserIds = uniq.filter((uid) => !beforeSet.has(uid));
      }
    });

    emitTodosChanged({ action: "update", id });
    emitCalendarChanged({ reason: "todos" });

    if (Array.isArray(b.assignee_ids)) {
      const titleRows = await prisma.crm_todos.findFirst({
        where: { id, is_deleted: false, tenant_id: tenantId },
        select: { body: true },
      });
      const todoBody = String(titleRows?.body || "A to-do was assigned to you.");
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

    const full = await prisma.crm_todos.findFirst({
      where: {
        id,
        is_deleted: false,
        tenant_id: tenantId,
      },
      include: {
        users: {
          select: {
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        crm_todo_assignees: {
          include: {
            users: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
          },
        },
      },
    });

    res.json({ success: true, data: mapTodoRow(full) });
  } catch (err) {
    console.error("PUT /todos/:id:", err);
    res.status(err.message === "assignee_ids cannot be empty" ? 400 : 500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const tenantId = req.user?.tenantId || null;
    const row = await prisma.crm_todos.findFirst({
      where: {
        id,
        is_deleted: false,
        tenant_id: tenantId,
      },
    });

    if (!row) return res.status(404).json({ success: false, message: "Todo not found" });
    if (row.created_by !== req.user.id) {
      return res.status(403).json({ success: false, message: "Only the creator can delete this todo" });
    }

    const paths = parseAttachmentJson(row);
    await prisma.crm_todos.update({
      where: { id },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        updated_at: new Date(),
      },
    });

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
