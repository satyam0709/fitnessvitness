const prisma = require("../config/prisma");
const {
  emitMeetingsChanged,
  emitAdminChanged,
  emitCalendarChanged,
  emitFitnessChanged,
} = require("../realtime/meetingsRealtime");
const { createUserNotification } = require("../services/notificationService");
const { getMeetingFormMeta, sanitizeRecurrence } = require("../services/meetingFormMeta");

const MEETING_TYPES = new Set(["in_person", "virtual", "phone", "other"]);
const MEETING_STATUSES = new Set(["scheduled", "completed", "cancelled", "postponed", "no_show"]);

function viewerId(req) {
  if (!req.user?.id) return null;
  const n = Number(req.user.id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sanitizeType(v) {
  const s = String(v || "virtual").toLowerCase();
  return MEETING_TYPES.has(s) ? s : "virtual";
}

function sanitizeStatus(v) {
  const s = String(v || "scheduled").toLowerCase();
  return MEETING_STATUSES.has(s) ? s : "scheduled";
}

function safeLeadId(lead_id) {
  if (lead_id == null || lead_id === "") return null;
  const n = Number(lead_id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function assertMeetingAccess(meetingId, dbUserId) {
  const mid = Number(meetingId);
  const uid = Number(dbUserId);
  if (!Number.isFinite(mid) || !Number.isFinite(uid)) return null;
  try {
    const row = await prisma.meetings.findFirst({
      where: {
        id: mid,
        organizer_id: uid,
        is_deleted: false,
      },
    });
    return row;
  } catch {
    return null;
  }
}

function buildMeetingFilter(req, viewerUserId) {
  const uidNum = Number(viewerUserId);
  const conditions = [
    { is_deleted: false },
    {
      OR: [
        { organizer_id: uidNum },
        { meeting_attendees: { some: { user_id: uidNum } } },
      ],
    },
  ];

  const q = req.query || {};
  const rawSearch = q.search != null ? String(q.search).trim() : "";
  const search = rawSearch.replace(/[%_\\]/g, " ").trim();
  if (search) {
    conditions.push({
      OR: [
        { title: { contains: search } },
        { description: { contains: search } },
        { location: { contains: search } },
        { meet_link: { contains: search } },
      ],
    });
  }

  if (q.created_by != null && String(q.created_by).trim() !== "") {
    const cid = Number(q.created_by);
    if (Number.isFinite(cid) && cid > 0) {
      conditions.push({ organizer_id: cid });
    }
  }

  if (q.assign_to != null && String(q.assign_to).trim() !== "") {
    const aid = Number(q.assign_to);
    if (Number.isFinite(aid) && aid > 0) {
      conditions.push({
        OR: [
          { assigned_to_user_id: aid },
          { meeting_attendees: { some: { user_id: aid } } },
        ],
      });
    }
  }

  if (q.meeting_type != null && String(q.meeting_type).trim() !== "") {
    conditions.push({ meeting_type: String(q.meeting_type) });
  }

  if (q.recurrence != null && String(q.recurrence).trim() !== "") {
    const r = String(q.recurrence).trim().toLowerCase();
    if (MEETING_RECURRENCE.has(r)) {
      conditions.push({ recurrence: r });
    }
  }

  const rs = q.range_start != null ? String(q.range_start).trim() : "";
  if (rs) {
    const d = new Date(rs);
    if (!Number.isNaN(d.getTime())) {
      conditions.push({ start_time: { gte: d } });
    }
  }
  const re = q.range_end != null ? String(q.range_end).trim() : "";
  if (re) {
    const d = new Date(re);
    if (!Number.isNaN(d.getTime())) {
      conditions.push({ start_time: { lte: d } });
    }
  }

  if (q.lead_id != null && String(q.lead_id).trim() !== "") {
    const lid = Number(q.lead_id);
    if (Number.isFinite(lid) && lid > 0) {
      conditions.push({ lead_id: lid });
    }
  }

  const sg = q.status_group != null ? String(q.status_group).trim().toLowerCase() : "";
  if (sg === "pending") {
    conditions.push({ status: { in: ["scheduled", "postponed"] } });
  } else if (sg === "completed") {
    conditions.push({ status: "completed" });
  } else if (sg === "missing") {
    conditions.push({ status: "no_show" });
  } else if (q.status != null && String(q.status).trim() !== "") {
    const st = String(q.status).trim().toLowerCase();
    if (MEETING_STATUSES.has(st)) {
      conditions.push({ status: st });
    }
  }

  return { AND: conditions };
}

function firstQueryScalar(val, fallback) {
  const v = Array.isArray(val) ? val[0] : val;
  const n = Number.parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clampLimitOffset(limit, page) {
  const lim = Math.min(Math.max(firstQueryScalar(limit, 50), 1), 500);
  const pg = Math.max(firstQueryScalar(page, 1), 1);
  const offset = (pg - 1) * lim;
  return { lim, offset, page: pg };
}

async function getMeetings(req, res) {
  try {
    const uid = viewerId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const where = buildMeetingFilter(req, uid);
    const { lim, offset, page } = clampLimitOffset(req.query?.limit, req.query?.page);

    const total = await prisma.meetings.count({ where });

    const rows = await prisma.meetings.findMany({
      where,
      include: {
        leads: {
          select: { name: true },
        },
        users_meetings_organizer_idTousers: {
          select: { first_name: true, last_name: true },
        },
        users_meetings_assigned_to_user_idTousers: {
          select: { first_name: true, last_name: true },
        },
        meeting_attendees: {
          select: { user_id: true },
        },
      },
      orderBy: [
        { start_time: "desc" },
        { id: "desc" },
      ],
      skip: offset,
      take: lim,
    });

    const meetings = rows.map((m) => {
      const organizer = m.users_meetings_organizer_idTousers;
      const assignee = m.users_meetings_assigned_to_user_idTousers;
      const attendeeIds = m.meeting_attendees.map((ma) => ma.user_id);

      const formatted = {
        ...m,
        lead_name: m.leads?.name || null,
        organizer_name: organizer
          ? [organizer.first_name, organizer.last_name].filter(Boolean).join(" ").trim()
          : "",
        assignee_name: assignee
          ? [assignee.first_name, assignee.last_name].filter(Boolean).join(" ").trim()
          : "",
        attendee_count: attendeeIds.length,
        attendee_ids_csv: attendeeIds.join(","),
      };

      delete formatted.leads;
      delete formatted.users_meetings_organizer_idTousers;
      delete formatted.users_meetings_assigned_to_user_idTousers;
      delete formatted.meeting_attendees;

      return formatted;
    });

    res.json({
      success: true,
      total,
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

    const where = buildMeetingFilter(req, uid);
    const rows = await prisma.meetings.findMany({
      where,
      select: {
        status: true,
        meeting_type: true,
      },
    });

    const stats = {
      total: rows.length,
      scheduled: 0,
      completed: 0,
      cancelled: 0,
      postponed: 0,
      no_show: 0,
      type_virtual: 0,
      type_in_person: 0,
      type_phone: 0,
      type_other: 0,
    };

    for (const r of rows) {
      const st = r.status || "scheduled";
      if (st === "scheduled") stats.scheduled++;
      else if (st === "completed") stats.completed++;
      else if (st === "cancelled") stats.cancelled++;
      else if (st === "postponed") stats.postponed++;
      else if (st === "no_show") stats.no_show++;

      const mt = r.meeting_type || "virtual";
      if (mt === "virtual") stats.type_virtual++;
      else if (mt === "in_person") stats.type_in_person++;
      else if (mt === "phone") stats.type_phone++;
      else if (mt === "other") stats.type_other++;
    }

    res.json({ success: true, stats });
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

const formatDate = (d) => {
  if (!d) return "";
  const dateObj = new Date(d);
  if (Number.isNaN(dateObj.getTime())) return "";
  return dateObj.toISOString().replace("T", " ").substring(0, 19);
};

async function exportMeetingsCsv(req, res) {
  try {
    const uid = viewerId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const where = buildMeetingFilter(req, uid);
    const rows = await prisma.meetings.findMany({
      where,
      include: {
        leads: {
          select: { name: true },
        },
        users_meetings_organizer_idTousers: {
          select: { first_name: true, last_name: true },
        },
        users_meetings_assigned_to_user_idTousers: {
          select: { first_name: true, last_name: true },
        },
        meeting_attendees: {
          select: { user_id: true },
        },
      },
      orderBy: [
        { start_time: "desc" },
        { id: "desc" },
      ],
      take: 5000,
    });

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
      const organizer = r.users_meetings_organizer_idTousers;
      const assignee = r.users_meetings_assigned_to_user_idTousers;
      const organizer_name = organizer
        ? [organizer.first_name, organizer.last_name].filter(Boolean).join(" ").trim()
        : "";
      const assignee_name = assignee
        ? [assignee.first_name, assignee.last_name].filter(Boolean).join(" ").trim()
        : "";
      const lead_name = r.leads?.name || "";
      const attendee_count = r.meeting_attendees.length;

      lines.push(
        [
          r.id,
          r.title,
          r.meeting_type,
          r.recurrence,
          r.status,
          formatDate(r.start_time),
          formatDate(r.end_time),
          r.location,
          r.meet_link,
          organizer_name,
          assignee_name,
          lead_name,
          attendee_count,
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

async function getMeetingMeta(_req, res) {
  try {
    res.json({ success: true, data: getMeetingFormMeta() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createMeeting(req, res) {
  try {
    const uid = viewerId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

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
      consultation_type,
      client_id: clientIdRaw,
    } = req.body;

    if (!title?.trim()) return res.status(400).json({ success: false, message: "Title required" });
    if (!start_time) return res.status(400).json({ success: false, message: "start_time required" });

    let assigneeId = uid;
    if (assigned_to_user_id != null && String(assigned_to_user_id).trim() !== "") {
      const cand = Number(assigned_to_user_id);
      const userExists = await prisma.users.findUnique({
        where: { id: cand, is_active: true },
        select: { id: true },
      });
      if (!userExists) return res.status(400).json({ success: false, message: "Invalid assignee" });
      assigneeId = cand;
    }

    const mt = sanitizeType(meeting_type);
    const st = sanitizeStatus(status);
    const rec = sanitizeRecurrence(recurrence);

    const startDt = new Date(start_time);
    if (Number.isNaN(startDt.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid start_time" });
    }
    const endDt = end_time ? new Date(end_time) : null;
    if (endDt && Number.isNaN(endDt.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid end_time" });
    }

    const consultType =
      consultation_type != null && String(consultation_type).trim()
        ? String(consultation_type).trim().slice(0, 50)
        : "general";
    const fitnessClientId =
      clientIdRaw != null && String(clientIdRaw).trim() ? String(clientIdRaw).trim().slice(0, 20) : null;

    const createdMeeting = await prisma.$transaction(async (tx) => {
      const meeting = await tx.meetings.create({
        data: {
          title: title.trim(),
          description: description || null,
          start_time: startDt,
          end_time: endDt,
          location: location || null,
          meet_link: meet_link || null,
          meeting_type: mt,
          status: st,
          recurrence: rec,
          organizer_id: uid,
          assigned_to_user_id: assigneeId,
          lead_id: safeLeadId(lead_id),
          consultation_type: consultType,
          client_id: fitnessClientId,
        },
      });

      const attendeeIds = new Set();
      attendeeIds.add(uid);
      attendeeIds.add(assigneeId);
      if (Array.isArray(attendees)) {
        for (const raw of attendees) {
          const aid = Number(raw);
          if (Number.isFinite(aid) && aid > 0) {
            attendeeIds.add(aid);
          }
        }
      }

      const attendeeData = [...attendeeIds].map((user_id) => ({
        meeting_id: meeting.id,
        user_id,
      }));

      await tx.meeting_attendees.createMany({
        data: attendeeData,
        skipDuplicates: true,
      });

      if (consultType !== "general" && fitnessClientId) {
        await tx.fitness_clients.updateMany({
          where: { client_id: fitnessClientId },
          data: {
            next_due_date: startDt,
            updated_at: new Date(),
          },
        });
      }

      return meeting;
    });

    if (consultType !== "general" && fitnessClientId) {
      try {
        emitFitnessChanged();
      } catch (e) {
        console.warn("createMeeting emitFitnessChanged error:", e.message);
      }
    }

    emitMeetingsChanged({ action: "create", id: createdMeeting.id });
    emitCalendarChanged({ reason: "meetings" });
    emitAdminChanged({ scope: "stats", reason: "meetings" });

    if (assigneeId !== uid) {
      await createUserNotification({
        userId: assigneeId,
        actorUserId: uid,
        entityType: "meeting",
        entityId: createdMeeting.id,
        title: "New meeting assigned",
        body: title.trim(),
      }).catch((e) => console.warn("meeting notification(create):", e.message));
    }

    res.status(201).json({ success: true, id: createdMeeting.id });
  } catch (err) {
    console.error("createMeeting", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateMeeting(req, res) {
  try {
    const uid = viewerId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

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

    const cur = await assertMeetingAccess(id, uid);
    if (!cur) {
      return res.status(403).json({ success: false, message: "Not found or not authorized" });
    }

    const nextTitle = title !== undefined ? String(title || "").trim() : cur.title;
    const prevAssignee = cur.assigned_to_user_id != null ? Number(cur.assigned_to_user_id) : null;
    if (!nextTitle) return res.status(400).json({ success: false, message: "Title required" });

    const nextDesc = description !== undefined ? description || null : cur.description;
    const nextStartRaw = start_time !== undefined ? start_time : cur.start_time;
    const nextEndRaw = end_time !== undefined ? end_time : cur.end_time;

    const nextStart = new Date(nextStartRaw);
    if (Number.isNaN(nextStart.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid start_time" });
    }
    const nextEnd = nextEndRaw == null || nextEndRaw === "" ? null : new Date(nextEndRaw);
    if (nextEnd && Number.isNaN(nextEnd.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid end_time" });
    }

    const nextLoc = location !== undefined ? location || null : cur.location;
    const nextLink = meet_link !== undefined ? meet_link || null : cur.meet_link;
    const nextLead = lead_id !== undefined ? safeLeadId(lead_id) : safeLeadId(cur.lead_id);
    const nextType = meeting_type !== undefined ? sanitizeType(meeting_type) : cur.meeting_type || "virtual";
    const nextStatus = status !== undefined ? sanitizeStatus(status) : cur.status || "scheduled";
    const nextRec =
      recurrence !== undefined ? sanitizeRecurrence(recurrence) : sanitizeRecurrence(cur.recurrence || "once");

    let nextAssignee = cur.assigned_to_user_id != null ? Number(cur.assigned_to_user_id) : uid;
    if (assigned_to_user_id !== undefined) {
      if (assigned_to_user_id == null || assigned_to_user_id === "") {
        nextAssignee = uid;
      } else {
        const cand = Number(assigned_to_user_id);
        const userExists = await prisma.users.findUnique({
          where: { id: cand, is_active: true },
          select: { id: true },
        });
        if (!userExists) return res.status(400).json({ success: false, message: "Invalid assignee" });
        nextAssignee = cand;
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.meetings.update({
        where: { id },
        data: {
          title: nextTitle,
          description: nextDesc,
          start_time: nextStart,
          end_time: nextEnd,
          location: nextLoc,
          meet_link: nextLink,
          meeting_type: nextType,
          status: nextStatus,
          recurrence: nextRec,
          assigned_to_user_id: nextAssignee,
          lead_id: nextLead,
        },
      });

      if (Array.isArray(attendees)) {
        await tx.meeting_attendees.deleteMany({
          where: { meeting_id: id },
        });

        const attendeeIds = new Set();
        attendeeIds.add(uid);
        attendeeIds.add(nextAssignee);
        for (const raw of attendees) {
          const aid = Number(raw);
          if (Number.isFinite(aid) && aid > 0) {
            attendeeIds.add(aid);
          }
        }

        const attendeeData = [...attendeeIds].map((user_id) => ({
          meeting_id: id,
          user_id,
        }));

        await tx.meeting_attendees.createMany({
          data: attendeeData,
          skipDuplicates: true,
        });
      }
    });

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
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const mid = Number(req.params.id);
    if (!Number.isFinite(mid) || mid <= 0) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const { count } = await prisma.meetings.updateMany({
      where: {
        id: mid,
        organizer_id: uid,
        is_deleted: false,
      },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
      },
    });

    if (count) {
      emitMeetingsChanged({ action: "delete", id: mid });
      emitCalendarChanged({ reason: "meetings" });
      emitAdminChanged({ scope: "stats", reason: "meetings" });
    }
    res.json({ success: true, deleted: count });
  } catch (err) {
    console.error("deleteMeeting", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function bulkDeleteMeetings(req, res) {
  try {
    const uid = viewerId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n) => n > 0) : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: "ids array required" });
    }
    const uniq = [...new Set(ids)].slice(0, 200);

    const { count } = await prisma.meetings.updateMany({
      where: {
        id: { in: uniq },
        organizer_id: uid,
        is_deleted: false,
      },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
      },
    });

    if (count) {
      emitMeetingsChanged({ action: "bulk_delete", ids: uniq });
      emitAdminChanged({ scope: "stats", reason: "meetings" });
    }
    res.json({ success: true, deleted: count });
  } catch (err) {
    console.error("bulkDeleteMeetings", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function bulkAssignMeetings(req, res) {
  try {
    const uid = viewerId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const assignRaw = req.body?.assigned_to_user_id;
    const cand = Number(assignRaw);
    if (!Number.isFinite(cand) || cand <= 0) {
      return res.status(400).json({ success: false, message: "assigned_to_user_id required" });
    }

    const assignee = await prisma.users.findUnique({
      where: { id: cand, is_active: true },
      select: { id: true },
    });
    if (!assignee) {
      return res.status(400).json({ success: false, message: "Invalid assignee" });
    }

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n) => n > 0) : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: "ids array required" });
    }
    const uniq = [...new Set(ids)].slice(0, 200);

    const updated = await prisma.$transaction(async (tx) => {
      const { count } = await tx.meetings.updateMany({
        where: {
          id: { in: uniq },
          organizer_id: uid,
        },
        data: {
          assigned_to_user_id: cand,
        },
      });

      if (count > 0) {
        const updatedMeetings = await tx.meetings.findMany({
          where: {
            id: { in: uniq },
            organizer_id: uid,
            is_deleted: false,
          },
          select: { id: true },
        });

        const attendeeData = updatedMeetings.map((m) => ({
          meeting_id: m.id,
          user_id: cand,
        }));

        await tx.meeting_attendees.createMany({
          data: attendeeData,
          skipDuplicates: true,
        });
      }

      return count;
    });

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
  getMeetingMeta,
  getMeetingStats,
  exportMeetingsCsv,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  bulkDeleteMeetings,
  bulkAssignMeetings,
};
