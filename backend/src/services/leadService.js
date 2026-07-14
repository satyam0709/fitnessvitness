const path = require("path");
const fs = require("fs");
const prisma = require("../config/prisma");
const { Prisma } = require("../generated/prisma");
const {
  emitAdminChanged,
  emitCalendarChanged,
  emitLeadsChanged,
  emitOpportunitiesChanged,
} = require("../realtime/meetingsRealtime");
const { canSeeAllTeamRecords } = require("../utils/crmTeamAccess");
const { sendEmailWithRetry } = require("./emailService");
const {
  VALID_LEGACY,
  VALID_V2,
  legacyToV2,
  v2ToLegacy,
  resolveStatusFilter,
  parseStatusInput,
  enrichLeadStatus,
} = require("../utils/leadStatusMap");
const {
  isBuiltInOption,
  dedupeOptions,
  LEAD_COLUMN_MAP,
  normKey,
} = require("../utils/leadCustomOptions");

const CUSTOM_OPTION_FIELDS = [
  "source",
  "label",
  "status",
  "account_relationship",
  "followup_type",
  "product_category",
  "team",
];

const TRACKED_FIELDS = [
  "name",
  "first_name",
  "last_name",
  "company_name",
  "phone",
  "email",
  "source",
  "status",
  "label",
  "assigned_to",
  "follow_up_date",
  "followup_at",
  "notes",
  "amount",
  "currency",
  "product_category",
  "team",
  "followup_type",
  "industry",
  "department",
  "address",
];

function tenantId(req) {
  return req.user?.tenantId ?? req.tenantId ?? null;
}

/** Standalone CRM uses null tenant_id on rows; counter table PK cannot be null. */
function counterTenantKey(tid) {
  return tid != null ? Number(tid) : 0;
}

function parseAttachments(row) {
  if (!row || row.attachments_json == null) return [];
  try {
    const v = row.attachments_json;
    if (typeof v === "string") return JSON.parse(v);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function formatRow(row) {
  return enrichLeadStatus({ ...row, attachments: parseAttachments(row) });
}

async function resolveUserId(assignedTo) {
  if (assignedTo == null || assignedTo === "") return null;
  const num = Number(assignedTo);
  if (!isNaN(num) && Number.isInteger(num) && num > 0) {
    const user = await prisma.users.findFirst({
      where: { id: num, is_active: true },
      select: { id: true }
    });
    if (user) return user.id;
  }
  const user = await prisma.users.findFirst({
    where: { clerk_user_id: assignedTo, is_active: true },
    select: { id: true }
  });
  return user ? user.id : null;
}

function normalizePhone(b) {
  const raw = b.phone != null ? String(b.phone).trim() : "";
  const dial = b.phone_dial != null ? String(b.phone_dial).trim() : "";
  if (dial && raw && !raw.startsWith("+")) {
    return `${dial}${raw.replace(/^0+/, "")}`;
  }
  return raw || dial || "";
}

function canMutateLead(req, lead) {
  if (!lead) return false;
  return (
    req.user.role === "admin" ||
    req.user.role === "manager" ||
    req.rbac?.roleSlug === "tenant_admin" ||
    req.rbac?.roleSlug === "manager" ||
    lead.created_by === req.user.id ||
    lead.assigned_to === req.user.id
  );
}

function emitLeadChanges(action) {
  emitAdminChanged({ scope: "stats", reason: "leads", action });
  emitCalendarChanged({ reason: "leads" });
  emitLeadsChanged({ reason: "leads" });
}

async function loadLeadScoped(req, leadId) {
  const lead = await prisma.leads.findFirst({
    where: {
      id: Number(leadId),
      is_deleted: false,
      tenant_id: tenantId(req),
    },
    include: {
      users_leads_assigned_toTousers: {
        select: {
          first_name: true,
          last_name: true,
          email: true,
        }
      }
    }
  });

  if (!lead) return null;

  const assigned = lead.users_leads_assigned_toTousers;
  return {
    ...lead,
    amount: lead.amount ? lead.amount.toString() : null,
    assigned_name: assigned ? [assigned.first_name, assigned.last_name].filter(Boolean).join(" ") : "",
    assigned_email: assigned ? assigned.email : null,
  };
}

async function logFieldChanges(leadId, oldRow, newValues, userId) {
  for (const field of TRACKED_FIELDS) {
    if (!(field in newValues)) continue;
    const oldVal = oldRow[field] != null ? String(oldRow[field]) : null;
    const newVal = newValues[field] != null ? String(newValues[field]) : null;
    if (oldVal === newVal) continue;
    await prisma.lead_change_log.create({
      data: {
        lead_id: Number(leadId),
        field_name: field,
        old_value: oldVal,
        new_value: newVal,
        user_id: userId,
      }
    });
  }
}

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: null, last_name: null };
  if (parts.length === 1) return { first_name: parts[0], last_name: null };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

async function listLeads(req) {
  const {
    status,
    source,
    assigned_to,
    search,
    follow_up_date,
    follow_up_from,
    follow_up_to,
    my,
  } = req.query;

  const where = {
    is_deleted: false,
    tenant_id: tenantId(req),
  };

  if (!canSeeAllTeamRecords(req) || my === "true") {
    where.OR = [
      { created_by: req.user.id },
      { assigned_to: req.user.id }
    ];
  }

  if (status) {
    const mapped = resolveStatusFilter(status);
    if (mapped) {
      const statusCondition = mapped.custom
        ? { status_v2: mapped.v2 }
        : {
            OR: [
              { status: mapped.legacy },
              { status_v2: mapped.v2 },
            ],
          };
      if (where.AND) {
        where.AND.push(statusCondition);
      } else {
        where.AND = [statusCondition];
      }
    }
  }

  if (source) {
    where.source = source;
  }

  if (follow_up_date) {
    where.follow_up_date = new Date(follow_up_date);
  } else {
    if (follow_up_from || follow_up_to) {
      where.follow_up_date = {};
      if (follow_up_from) {
        where.follow_up_date.gte = new Date(follow_up_from);
      }
      if (follow_up_to) {
        where.follow_up_date.lte = new Date(follow_up_to);
      }
    }
  }

  if (search) {
    const searchCondition = {
      OR: [
        { name: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
        { company_name: { contains: search } }
      ]
    };
    if (where.AND) {
      where.AND.push(searchCondition);
    } else {
      where.AND = [searchCondition];
    }
  }

  if (assigned_to === "me") {
    where.assigned_to = req.user.id;
  } else if (assigned_to) {
    const mapped = await resolveUserId(assigned_to);
    if (mapped) {
      where.assigned_to = mapped;
    } else {
      where.assigned_to = -1; // force empty
    }
  }

  const rows = await prisma.leads.findMany({
    where,
    orderBy: {
      created_at: 'desc',
    },
    include: {
      users_leads_assigned_toTousers: {
        select: {
          first_name: true,
          last_name: true,
          email: true,
        }
      },
      users_leads_created_byTousers: {
        select: {
          first_name: true,
          last_name: true,
        }
      }
    }
  });

  const data = rows.map(lead => {
    const assigned = lead.users_leads_assigned_toTousers;
    const creator = lead.users_leads_created_byTousers;
    return formatRow({
      ...lead,
      amount: lead.amount ? lead.amount.toString() : null,
      assigned_name: assigned ? [assigned.first_name, assigned.last_name].filter(Boolean).join(" ") : "",
      assigned_email: assigned ? assigned.email : null,
      created_by_name: creator ? [creator.first_name, creator.last_name].filter(Boolean).join(" ") : "",
    });
  });

  return { success: true, total: data.length, data };
}

async function getCalendarMarkers(req) {
  const { from, to } = req.query;
  if (!from || !to) {
    const err = new Error("from and to are required (YYYY-MM-DD)");
    err.status = 400;
    throw err;
  }

  const conditions = [
    Prisma.sql`follow_up_date IS NOT NULL`,
    Prisma.sql`follow_up_date >= ${from}`,
    Prisma.sql`follow_up_date <= ${to}`,
    Prisma.sql`is_deleted = 0`,
  ];
  if (tenantId(req) !== null) {
    conditions.push(Prisma.sql`tenant_id = ${tenantId(req)}`);
  } else {
    conditions.push(Prisma.sql`tenant_id IS NULL`);
  }

  if (!canSeeAllTeamRecords(req)) {
    conditions.push(Prisma.sql`(created_by = ${req.user.id} OR assigned_to = ${req.user.id})`);
  }

  const whereSql = Prisma.join(conditions, ' AND ');

  const rows = await prisma.$queryRaw`
    SELECT DATE(follow_up_date) AS d, COUNT(*) AS cnt
    FROM leads
    WHERE ${whereSql}
    GROUP BY DATE(follow_up_date)
  `;

  function rowToYMD(v) {
    if (v instanceof Date) {
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, "0");
      const day = String(v.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    if (v == null) return "";
    const s = String(v);
    return s.length >= 10 ? s.slice(0, 10) : s;
  }

  const byDate = {};
  for (const r of rows) {
    const key = rowToYMD(r.d);
    if (key) byDate[key] = Number(r.cnt) || 0;
  }

  return { success: true, byDate };
}

async function getLeadById(req, leadId) {
  const lead = await prisma.leads.findFirst({
    where: {
      id: Number(leadId),
      is_deleted: false,
      tenant_id: tenantId(req),
    },
    include: {
      users_leads_assigned_toTousers: {
        select: {
          first_name: true,
          last_name: true,
          email: true,
        }
      }
    }
  });

  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }

  if (!canMutateLead(req, lead)) {
    const err = new Error("Not allowed to view this lead");
    err.status = 403;
    throw err;
  }

  const timelineNotes = await prisma.notes.findMany({
    where: {
      lead_id: Number(leadId),
    },
    include: {
      users: {
        select: {
          email: true,
        }
      }
    },
    orderBy: {
      created_at: 'asc',
    }
  });

  const formattedNotes = timelineNotes.map(n => ({
    id: n.id,
    content: n.content,
    created_by: n.created_by,
    creator_email: n.users ? n.users.email : null,
    created_at: n.created_at,
  }));

  const assigned = lead.users_leads_assigned_toTousers;
  const leadData = formatRow({
    ...lead,
    amount: lead.amount ? lead.amount.toString() : null,
    assigned_name: assigned ? [assigned.first_name, assigned.last_name].filter(Boolean).join(" ") : "",
    assigned_email: assigned ? assigned.email : null,
  });

  return {
    success: true,
    data: { ...leadData, timeline_notes: formattedNotes },
  };
}

async function getFollowups(req, leadId) {
  const lead = await loadLeadScoped(req, leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, lead)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }

  const rows = await prisma.lead_followups.findMany({
    where: {
      lead_id: Number(leadId),
    },
    include: {
      users: {
        select: {
          email: true,
        }
      }
    },
    orderBy: {
      created_at: 'desc',
    }
  });

  const formattedRows = rows.map(f => ({
    ...f,
    creator_email: f.users ? f.users.email : null,
  }));

  return { success: true, data: formattedRows };
}

async function createLead(req) {
  const b = req.body || {};
  const name = b.name != null ? String(b.name).trim() : "";
  const phone = normalizePhone(b);

  if (!name) {
    const err = new Error("name is required");
    err.status = 400;
    throw err;
  }
  if (!phone) {
    const err = new Error("phone is required");
    err.status = 400;
    throw err;
  }

  const statusParsed = parseStatusInput(b, "new");
  const status = statusParsed.legacy;
  const statusV2 = statusParsed.v2;
  const assignedUserId = (await resolveUserId(b.assigned_to)) || req.user.id;
  const tid = tenantId(req);

  let attachmentsJson = null;
  if (req.files && req.files.length) {
    attachmentsJson = req.files.map((f) => `/uploads/leads/${f.filename}`);
  }

  const { first_name, last_name } = splitName(name);

  const result = await prisma.$transaction(async (tx) => {
    const key = counterTenantKey(tid);
    
    await tx.$executeRaw`
      INSERT INTO tenant_lead_counters (tenant_id, next_lead_number)
      VALUES (${key}, 1)
      ON DUPLICATE KEY UPDATE tenant_id = tenant_id
    `;
    
    const rows = await tx.$queryRaw`
      SELECT next_lead_number FROM tenant_lead_counters WHERE tenant_id = ${key} FOR UPDATE
    `;
    // $queryRaw returns BIGINT columns as BigInt — coerce before arithmetic
    const num = Number(rows[0]?.next_lead_number ?? 1);
    
    await tx.$executeRaw`
      UPDATE tenant_lead_counters SET next_lead_number = ${num + 1} WHERE tenant_id = ${key}
    `;

    const created = await tx.leads.create({
      data: {
        tenant_id: tid,
        name,
        first_name: b.first_name || first_name,
        last_name: b.last_name || last_name,
        company_name: b.company_name || null,
        phone,
        phone_dial: b.phone_dial || null,
        email: b.email || null,
        source: b.source || "other",
        status,
        status_v2: statusV2,
        label: b.label || null,
        cancel_reason: b.cancel_reason || null,
        address: b.address || null,
        reference: b.reference || null,
        attachments_json: attachmentsJson,
        assigned_to: assignedUserId,
        created_by: req.user.id,
        follow_up_date: b.follow_up_date ? new Date(b.follow_up_date) : null,
        followup_at: b.followup_at ? new Date(b.followup_at) : null,
        notes: b.notes || b.comment || null,
        lead_number: num,
        amount: b.amount ? new Prisma.Decimal(b.amount) : 0,
        currency: String(b.currency || "INR").toUpperCase(),
        product_category: b.product_category || null,
        team: b.team || null,
        account_relationship: b.account_relationship || null,
        followup_type: b.followup_type || null,
        last_touched_at: new Date(),
        updated_by: req.user.id,
      }
    });

    await tx.lead_change_log.create({
      data: {
        lead_id: created.id,
        field_name: 'status',
        old_value: null,
        new_value: status,
        user_id: req.user.id,
      }
    });

    return created;
  });

  await registerLeadCustomOptions(b, statusParsed);

  const createdRow = await prisma.leads.findFirst({
    where: { id: result.id, tenant_id: tid },
    include: {
      users_leads_assigned_toTousers: {
        select: {
          first_name: true,
          last_name: true,
          email: true,
        }
      }
    }
  });

  const assigned = createdRow.users_leads_assigned_toTousers;
  const formattedRow = formatRow({
    ...createdRow,
    amount: createdRow.amount ? createdRow.amount.toString() : null,
    assigned_name: assigned ? [assigned.first_name, assigned.last_name].filter(Boolean).join(" ") : "",
    assigned_email: assigned ? assigned.email : null,
  });

  emitLeadChanges("create");
  emitLeadsChanged({ reason: "options_changed", action: "create" });
  return { success: true, data: formattedRow };
}

async function updateLead(req, leadId) {
  const existing = await loadLeadScoped(req, leadId);
  if (!existing) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, existing)) {
    const err = new Error("Not allowed to update this lead");
    err.status = 403;
    throw err;
  }

  const b = req.body || {};
  let status = null;
  let statusV2 = null;
  let statusParsed = null;

  if (b.status != null || b.status_v2 != null) {
    statusParsed = parseStatusInput(b, existing.status);
    status = statusParsed.legacy;
    statusV2 = statusParsed.v2;
  }

  const phone =
    b.phone != null || b.phone_dial != null ? normalizePhone(b) : null;

  let assignedUserId = existing.assigned_to;
  if (b.assigned_to !== undefined) {
    assignedUserId = (await resolveUserId(b.assigned_to)) ?? null;
  }

  let attachmentsJson = existing.attachments_json;
  if (req.files && req.files.length) {
    const prev = parseAttachments(existing);
    const added = req.files.map((f) => `/uploads/leads/${f.filename}`);
    attachmentsJson = [...prev, ...added];
  }

  const newName =
    b.name != null ? String(b.name).trim() || null : existing.name;
  const nameParts = newName ? splitName(newName) : {};

  const updates = {
    name: newName,
    first_name: b.first_name != null ? b.first_name : nameParts.first_name,
    last_name: b.last_name != null ? b.last_name : nameParts.last_name,
    company_name: b.company_name != null ? b.company_name || null : undefined,
    phone: phone != null ? phone : undefined,
    email: b.email != null ? b.email || null : undefined,
    source: b.source != null ? b.source || null : undefined,
    status: status != null ? status : undefined,
    label: b.label != null ? b.label || null : undefined,
    assigned_to: b.assigned_to !== undefined ? assignedUserId : undefined,
    follow_up_date:
      b.follow_up_date != null ? b.follow_up_date || null : undefined,
    followup_at: b.followup_at != null ? b.followup_at || null : undefined,
    notes:
      b.notes != null || b.comment != null
        ? b.notes || b.comment || null
        : undefined,
    amount: b.amount != null ? Number(b.amount) : undefined,
    currency: b.currency != null ? String(b.currency).toUpperCase() : undefined,
    product_category:
      b.product_category != null ? b.product_category || null : undefined,
    team: b.team != null ? b.team || null : undefined,
    account_relationship:
      b.account_relationship != null ? b.account_relationship || null : undefined,
    followup_type: b.followup_type != null ? b.followup_type || null : undefined,
    industry: b.industry != null ? b.industry || null : undefined,
    department: b.department != null ? b.department || null : undefined,
    address: b.address != null ? b.address || null : undefined,
  };

  await logFieldChanges(leadId, existing, updates, req.user.id);

  await registerLeadCustomOptions(b, statusParsed);

  await prisma.leads.update({
    where: { id: Number(leadId) },
    data: {
      name: updates.name !== undefined ? updates.name : undefined,
      first_name: updates.first_name !== undefined ? updates.first_name : undefined,
      last_name: updates.last_name !== undefined ? updates.last_name : undefined,
      company_name: updates.company_name !== undefined ? updates.company_name : undefined,
      phone: updates.phone !== undefined ? updates.phone : undefined,
      phone_dial: b.phone_dial !== undefined ? (b.phone_dial || null) : undefined,
      email: updates.email !== undefined ? updates.email : undefined,
      source: updates.source !== undefined ? updates.source : undefined,
      status: updates.status !== undefined ? updates.status : undefined,
      status_v2: statusV2 || (status ? legacyToV2(status) : undefined),
      label: updates.label !== undefined ? updates.label : undefined,
      cancel_reason: b.cancel_reason !== undefined ? (b.cancel_reason || null) : undefined,
      address: updates.address !== undefined ? updates.address : undefined,
      reference: b.reference !== undefined ? (b.reference || null) : undefined,
      attachments_json: attachmentsJson !== undefined ? attachmentsJson : undefined,
      assigned_to: b.assigned_to !== undefined ? assignedUserId : undefined,
      follow_up_date: updates.follow_up_date !== undefined ? (updates.follow_up_date ? new Date(updates.follow_up_date) : null) : undefined,
      followup_at: updates.followup_at !== undefined ? (updates.followup_at ? new Date(updates.followup_at) : null) : undefined,
      notes: updates.notes !== undefined ? updates.notes : undefined,
      amount: updates.amount !== undefined ? new Prisma.Decimal(updates.amount) : undefined,
      currency: updates.currency !== undefined ? updates.currency : undefined,
      product_category: updates.product_category !== undefined ? updates.product_category : undefined,
      team: updates.team !== undefined ? updates.team : undefined,
      account_relationship:
        updates.account_relationship !== undefined ? updates.account_relationship : undefined,
      followup_type: updates.followup_type !== undefined ? updates.followup_type : undefined,
      industry: updates.industry !== undefined ? updates.industry : undefined,
      department: updates.department !== undefined ? updates.department : undefined,
      last_touched_at: new Date(),
      updated_by: req.user.id,
      updated_at: new Date(),
    }
  });

  const updatedRow = await prisma.leads.findFirst({
    where: { id: Number(leadId) },
    include: {
      users_leads_assigned_toTousers: {
        select: {
          first_name: true,
          last_name: true,
          email: true,
        }
      }
    }
  });

  const assigned = updatedRow.users_leads_assigned_toTousers;
  const formattedRow = formatRow({
    ...updatedRow,
    amount: updatedRow.amount ? updatedRow.amount.toString() : null,
    assigned_name: assigned ? [assigned.first_name, assigned.last_name].filter(Boolean).join(" ") : "",
    assigned_email: assigned ? assigned.email : null,
  });

  emitLeadChanges("update");
  emitLeadsChanged({ reason: "options_changed", action: "update" });
  return { success: true, data: formattedRow };
}

async function updateLeadStatus(req, leadId, status) {
  const existing = await loadLeadScoped(req, leadId);
  if (!existing) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, existing)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }

  const statusParsed = parseStatusInput({ status }, existing.status);
  const legacy = statusParsed.legacy;
  const v2 = statusParsed.v2;
  if (statusParsed.custom) {
    await registerCustomOptionIfNeeded("status", v2);
  }

  await prisma.lead_change_log.create({
    data: {
      lead_id: Number(leadId),
      field_name: 'status',
      old_value: existing.status,
      new_value: legacy,
      user_id: req.user.id,
    }
  });

  await prisma.leads.update({
    where: { id: Number(leadId) },
    data: {
      status: legacy,
      status_v2: v2,
      last_touched_at: new Date(),
      updated_by: req.user.id,
      updated_at: new Date(),
    }
  });

  emitLeadChanges("status");
  return { success: true, message: "Status updated" };
}

async function softDeleteLead(req, leadId, uploadsBase) {
  const existing = await loadLeadScoped(req, leadId);
  if (!existing) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, existing)) {
    const err = new Error("Not allowed to delete this lead");
    err.status = 403;
    throw err;
  }

  const paths = parseAttachments(existing);
  for (const rel of paths) {
    if (rel && String(rel).includes("uploads/leads/")) {
      const fp = path.join(uploadsBase, String(rel).replace(/^\//, ""));
      fs.unlink(fp, () => {});
    }
  }

  await prisma.leads.update({
    where: { id: Number(leadId) },
    data: {
      is_deleted: true,
      deleted_at: new Date(),
      updated_at: new Date(),
    }
  });

  emitLeadChanges("delete");
  return { success: true, message: "Lead deleted" };
}

async function addFollowup(req, leadId) {
  const lead = await loadLeadScoped(req, leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, lead)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }

  const b = req.body || {};
  const note = String(b.note || b.message || b.comment || "").trim();
  if (!note) {
    const err = new Error("Comment is required");
    err.status = 400;
    throw err;
  }

  const nextAtRaw = b.next_follow_up_at || b.next_follow_up_date || null;
  let nextDate = null;
  let nextAtSql = null;
  if (nextAtRaw) {
    const d = new Date(nextAtRaw);
    if (!Number.isNaN(d.getTime())) {
      nextDate = d.toISOString().slice(0, 10);
      nextAtSql = d.toISOString().slice(0, 19).replace("T", " ");
    }
  }

  let attachmentsJson = null;
  if (req.files && req.files.length) {
    attachmentsJson = req.files.map((f) => `/uploads/leads/${f.filename}`);
  }

  await prisma.lead_followups.create({
    data: {
      lead_id: Number(leadId),
      note,
      next_follow_up_date: nextDate ? new Date(nextDate) : null,
      next_follow_up_at: nextAtSql ? new Date(nextAtSql) : null,
      attachments_json: attachmentsJson,
      created_by: req.user.id,
    }
  });

  if (nextDate || nextAtSql) {
    await prisma.leads.update({
      where: { id: Number(leadId) },
      data: {
        follow_up_date: nextDate ? new Date(nextDate) : undefined,
        followup_at: nextAtSql ? new Date(nextAtSql) : undefined,
        last_touched_at: new Date(),
        updated_at: new Date(),
      }
    });
  }

  const shouldSendEmail = b.send_email !== "false" && b.send_email !== false;
  let mail = { ok: false, reason: "disabled" };
  if (shouldSendEmail) {
    if (!lead.email) {
      mail = { ok: false, reason: "missing_lead_email" };
    } else {
      const company = String(lead.company_name || "").trim();
      const leadName = String(lead.name || "").trim() || "there";
      const whenText = nextAtSql
        ? new Date(nextAtSql).toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : nextDate || "scheduled soon";
      const subject = company
        ? `Follow-up from ${company}`
        : "CRM follow-up update";
      const text = `Hi ${leadName},\n\n${note}\n\nNext follow-up: ${whenText}\n\nBest regards,\nCRM Team`;
      const html = `<p>Hi ${leadName},</p>
<p style="white-space:pre-wrap;">${note.replace(/[<>&]/g, (ch) =>
        ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&amp;"
      )}</p>
<p><strong>Next follow-up:</strong> ${whenText}</p>
<p>Best regards,<br/>CRM Team</p>`;
      mail = await sendEmailWithRetry({
        to: lead.email,
        subject,
        text,
        html,
        meta: { type: "lead_followup", lead_id: leadId, tenant_id: tenantId(req) },
      });
    }
  }

  emitLeadChanges("followup");
  return { success: true, message: "Follow-up saved", mail };
}

function leadTitle(lead) {
  const fn = String(lead.first_name || "").trim();
  const ln = String(lead.last_name || "").trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return String(lead.name || "Lead").trim();
}

async function convertLeadToOpportunity(req, leadId) {
  const lead = await loadLeadScoped(req, leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, lead)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }
  if (lead.converted_opportunity_id) {
    const err = new Error("Lead is already converted to an opportunity");
    err.status = 400;
    throw err;
  }

  const b = req.body || {};
  const amount =
    b.amount != null ? Number(b.amount) : Number(lead.amount) || 0;
  const currency = String(b.currency || lead.currency || "INR").toUpperCase();
  const productCategory =
    b.product_category || lead.product_category || null;
  const expectedClose = b.expected_close_date ? new Date(b.expected_close_date) : null;
  const notes = b.notes || lead.notes || lead.comments_history || null;
  const title = leadTitle(lead);
  const followupAt = lead.followup_at ? new Date(lead.followup_at) : (lead.follow_up_date ? new Date(lead.follow_up_date) : null);
  const followupType = lead.followup_type || null;
  const tid = tenantId(req);

  const result = await prisma.$transaction(async (tx) => {
    const createdOpp = await tx.opportunities.create({
      data: {
        tenant_id: tid,
        title,
        lead_id: Number(leadId),
        contact_id: lead.contact_id || null,
        company_name: lead.company_name || null,
        amount: new Prisma.Decimal(amount),
        currency,
        stage: 'qualification_done',
        expected_close_date: expectedClose,
        owner_user_id: lead.assigned_to || req.user.id,
        created_by: req.user.id,
        notes,
        product_category: productCategory,
        followup_at: followupAt,
        followup_type: followupType,
        lead_source: lead.source || null,
        team: lead.team || null,
        comments_history: lead.comments_history || null,
        phone: lead.phone || null,
      }
    });

    await tx.lead_change_log.create({
      data: {
        lead_id: Number(leadId),
        field_name: 'status',
        old_value: lead.status,
        new_value: 'confirm',
        user_id: req.user.id,
      }
    });

    await tx.leads.update({
      where: { id: Number(leadId) },
      data: {
        status: 'confirm',
        status_v2: 'converted',
        converted_opportunity_id: createdOpp.id,
        amount: new Prisma.Decimal(amount),
        currency,
        product_category: productCategory || undefined,
        last_touched_at: new Date(),
        updated_by: req.user.id,
        updated_at: new Date(),
      }
    });

    return createdOpp;
  });

  const opp = await prisma.opportunities.findFirst({
    where: { id: result.id }
  });

  emitLeadChanges("convert");
  emitOpportunitiesChanged({ action: "create", tenantId: tid, leadId });

  const formattedOpp = opp ? {
    ...opp,
    amount: opp.amount ? opp.amount.toString() : null,
  } : null;

  return {
    success: true,
    opportunity_id: result.id,
    opportunity: formattedOpp,
    message: "Lead converted to opportunity",
  };
}

async function linkLeadToFitnessClient(req, leadId) {
  const lead = await loadLeadScoped(req, leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, lead)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }

  const clientId = Number(req.query?.client_id || req.body?.client_id) || null;

  const dup = await prisma.customers.findFirst({
    where: { lead_id: Number(leadId) },
    select: { id: true }
  });
  if (dup) {
    const err = new Error("This lead is already linked to a customer");
    err.status = 400;
    throw err;
  }

  if (clientId) {
    const fc = await prisma.fitness_clients.findFirst({
      where: {
        id: clientId,
        tenant_id: tenantId(req),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
      }
    });
    if (!fc) {
      const err = new Error("Fitness client not found");
      err.status = 404;
      throw err;
    }
    await prisma.customers.create({
      data: {
        tenant_id: tenantId(req),
        name: fc.name || lead.name,
        email: fc.email || lead.email || null,
        phone: fc.phone || lead.phone || null,
        company: lead.company_name || null,
        city: null,
        country: "India",
        lead_id: Number(leadId),
      }
    });
  } else {
    await prisma.customers.create({
      data: {
        tenant_id: tenantId(req),
        name: lead.name,
        email: lead.email || null,
        phone: lead.phone || null,
        company: lead.company_name || null,
        city: null,
        country: "India",
        lead_id: Number(leadId),
      }
    });
  }

  emitLeadChanges("link-client");
  return { success: true, message: "Lead linked to client" };
}

async function duplicateLead(req, leadId) {
  const lead = await loadLeadScoped(req, leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, lead)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }

  const tid = tenantId(req);
  const result = await prisma.$transaction(async (tx) => {
    const key = counterTenantKey(tid);
    
    await tx.$executeRaw`
      INSERT INTO tenant_lead_counters (tenant_id, next_lead_number)
      VALUES (${key}, 1)
      ON DUPLICATE KEY UPDATE tenant_id = tenant_id
    `;
    const rows = await tx.$queryRaw`
      SELECT next_lead_number FROM tenant_lead_counters WHERE tenant_id = ${key} FOR UPDATE
    `;
    const num = rows[0]?.next_lead_number || 1;
    await tx.$executeRaw`
      UPDATE tenant_lead_counters SET next_lead_number = ${num + 1} WHERE tenant_id = ${key}
    `;

    const created = await tx.leads.create({
      data: {
        tenant_id: tid,
        name: lead.name,
        first_name: lead.first_name,
        last_name: lead.last_name,
        company_name: lead.company_name,
        phone: lead.phone,
        phone_dial: lead.phone_dial,
        email: lead.email,
        source: lead.source,
        status: 'new',
        status_v2: 'new',
        label: lead.label,
        address: lead.address,
        reference: lead.reference,
        attachments_json: lead.attachments_json,
        assigned_to: lead.assigned_to,
        created_by: req.user.id,
        follow_up_date: lead.follow_up_date ? new Date(lead.follow_up_date) : null,
        followup_at: lead.followup_at ? new Date(lead.followup_at) : null,
        notes: lead.notes ? `Duplicate of #${leadId}: ${lead.notes}` : `Duplicate of lead #${leadId}`,
        lead_number: num,
        amount: lead.amount ? new Prisma.Decimal(lead.amount) : 0,
        currency: lead.currency,
        product_category: lead.product_category,
        team: lead.team,
        industry: lead.industry,
        department: lead.department,
        last_touched_at: new Date(),
        updated_by: req.user.id,
      }
    });

    return created;
  });

  const createdRow = await prisma.leads.findFirst({
    where: { id: result.id },
    include: {
      users_leads_assigned_toTousers: {
        select: {
          first_name: true,
          last_name: true,
        }
      }
    }
  });

  const assigned = createdRow.users_leads_assigned_toTousers;
  const formattedRow = formatRow({
    ...createdRow,
    amount: createdRow.amount ? createdRow.amount.toString() : null,
    assigned_name: assigned ? [assigned.first_name, assigned.last_name].filter(Boolean).join(" ") : "",
  });

  emitLeadChanges("duplicate");
  return { success: true, data: formattedRow };
}

async function getChangeLog(req, leadId) {
  const lead = await loadLeadScoped(req, leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, lead)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;

  const total = await prisma.lead_change_log.count({
    where: { lead_id: Number(leadId) }
  });

  const rows = await prisma.lead_change_log.findMany({
    where: { lead_id: Number(leadId) },
    include: {
      users: {
        select: {
          first_name: true,
          last_name: true,
          email: true,
        }
      }
    },
    orderBy: {
      created_at: 'desc',
    },
    take: limit,
    skip: offset,
  });

  const formattedRows = rows.map(r => {
    const user = r.users;
    return {
      ...r,
      user_email: user ? user.email : null,
      user_name: user ? [user.first_name, user.last_name].filter(Boolean).join(" ") : "",
    };
  });

  return {
    success: true,
    data: formattedRows,
    pagination: { page, limit, total: Number(total) || 0 },
  };
}

async function getHistory(req, leadId) {
  const lead = await loadLeadScoped(req, leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, lead)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }

  const tab = String(req.query.tab || "counts").toLowerCase();

  if (tab === "counts") {
    const followups = await prisma.lead_followups.count({
      where: { lead_id: Number(leadId) }
    });
    const notes = await prisma.notes.count({
      where: { lead_id: Number(leadId) }
    });
    const change_log = await prisma.lead_change_log.count({
      where: { lead_id: Number(leadId) }
    });
    return {
      success: true,
      data: {
        followups,
        notes,
        change_log,
      },
    };
  }

  if (tab === "followups") {
    const rows = await prisma.lead_followups.findMany({
      where: { lead_id: Number(leadId) },
      include: {
        users: {
          select: { email: true }
        }
      },
      orderBy: { created_at: 'desc' },
      take: 50
    });
    const formattedRows = rows.map(r => ({
      ...r,
      creator_email: r.users ? r.users.email : null,
    }));
    return { success: true, data: formattedRows };
  }

  if (tab === "notes") {
    const rows = await prisma.notes.findMany({
      where: { lead_id: Number(leadId) },
      include: {
        users: {
          select: { email: true }
        }
      },
      orderBy: { created_at: 'desc' },
      take: 50
    });
    const formattedRows = rows.map(r => ({
      ...r,
      creator_email: r.users ? r.users.email : null,
    }));
    return { success: true, data: formattedRows };
  }

  if (tab === "change_log") {
    const rows = await prisma.lead_change_log.findMany({
      where: { lead_id: Number(leadId) },
      include: {
        users: {
          select: { email: true }
        }
      },
      orderBy: { created_at: 'desc' },
      take: 50
    });
    const formattedRows = rows.map(r => ({
      ...r,
      user_email: r.users ? r.users.email : null,
    }));
    return { success: true, data: formattedRows };
  }

  const err = new Error("Invalid tab");
  err.status = 400;
  throw err;
}

async function registerCustomOptionIfNeeded(fieldName, value) {
  if (!value || typeof value !== "string") return;
  const val = value.trim();
  if (!val || isBuiltInOption(fieldName, val)) return;

  try {
    // Prisma compound unique name is field_name_option_value (map name uk_dropdown_opt is DB-only)
    await prisma.dropdown_options.upsert({
      where: {
        field_name_option_value: {
          field_name: fieldName,
          option_value: val,
        },
      },
      update: { option_label: val },
      create: {
        field_name: fieldName,
        option_value: val,
        option_label: val,
      },
    });
  } catch (err) {
    // Fallback if client out of sync with schema
    try {
      await prisma.$executeRaw`
        INSERT INTO dropdown_options (field_name, option_value, option_label)
        VALUES (${fieldName}, ${val}, ${val})
        ON DUPLICATE KEY UPDATE option_label = VALUES(option_label)
      `;
    } catch (err2) {
      console.error(`Error registering custom option for ${fieldName}:`, err2.message || err.message);
    }
  }
}

async function registerLeadCustomOptions(body, statusParsed) {
  for (const field of CUSTOM_OPTION_FIELDS) {
    if (field === "status") {
      if (statusParsed?.custom && statusParsed.v2) {
        await registerCustomOptionIfNeeded("status", statusParsed.v2);
      }
      continue;
    }
    if (body[field]) await registerCustomOptionIfNeeded(field, body[field]);
  }
}

const CUSTOM_OPTION_FIELD_KEYS = [
  "source",
  "label",
  "status",
  "account_relationship",
  "followup_type",
  "product_category",
  "team",
];

function emptyCustomOptionBuckets() {
  return Object.fromEntries(CUSTOM_OPTION_FIELD_KEYS.map((k) => [k, []]));
}

function addCustomOptionEntry(buckets, field, value, label, id) {
  if (!value || isBuiltInOption(field, value)) return;
  const key = normKey(value);
  const existing = buckets[field].find((o) => normKey(o.value) === key);
  const item = {
    value,
    label: label || value,
    id: id ?? existing?.id ?? null,
  };
  if (!existing) {
    buckets[field].push(item);
  } else if (id && !existing.id) {
    existing.id = id;
  }
}

async function getCustomOptions() {
  const discovered = emptyCustomOptionBuckets();

  const [
    registryRows,
    sourceDistinct,
    labelDistinct,
    statusDistinct,
    categoryDistinct,
    followupDistinct,
    relationshipDistinct,
    teamDistinct,
  ] = await Promise.all([
    prisma.dropdown_options.findMany({
      orderBy: [{ field_name: "asc" }, { option_label: "asc" }],
    }),
    prisma.leads.findMany({
      where: { is_deleted: false, NOT: { source: "" } },
      distinct: ["source"],
      select: { source: true },
    }),
    prisma.leads.findMany({
      where: { is_deleted: false, NOT: { label: null } },
      distinct: ["label"],
      select: { label: true },
    }),
    prisma.leads.findMany({
      where: { is_deleted: false, NOT: { status_v2: null } },
      distinct: ["status_v2"],
      select: { status_v2: true },
    }),
    prisma.leads.findMany({
      where: { is_deleted: false, NOT: { product_category: null } },
      distinct: ["product_category"],
      select: { product_category: true },
    }),
    prisma.leads.findMany({
      where: { is_deleted: false, NOT: { followup_type: null } },
      distinct: ["followup_type"],
      select: { followup_type: true },
    }),
    prisma.leads.findMany({
      where: { is_deleted: false, NOT: { account_relationship: null } },
      distinct: ["account_relationship"],
      select: { account_relationship: true },
    }),
    prisma.leads.findMany({
      where: { is_deleted: false, NOT: { team: null } },
      distinct: ["team"],
      select: { team: true },
    }),
  ]);

  for (const row of sourceDistinct) {
    if (row.source) addCustomOptionEntry(discovered, "source", row.source, row.source, null);
  }
  for (const row of labelDistinct) {
    if (row.label) addCustomOptionEntry(discovered, "label", row.label, row.label, null);
  }
  for (const row of statusDistinct) {
    if (row.status_v2) {
      addCustomOptionEntry(discovered, "status", row.status_v2, row.status_v2, null);
    }
  }
  for (const row of categoryDistinct) {
    if (row.product_category) {
      addCustomOptionEntry(
        discovered,
        "product_category",
        row.product_category,
        row.product_category,
        null
      );
    }
  }
  for (const row of followupDistinct) {
    if (row.followup_type) {
      addCustomOptionEntry(
        discovered,
        "followup_type",
        row.followup_type,
        row.followup_type,
        null
      );
    }
  }
  for (const row of relationshipDistinct) {
    if (row.account_relationship) {
      addCustomOptionEntry(
        discovered,
        "account_relationship",
        row.account_relationship,
        row.account_relationship,
        null
      );
    }
  }
  for (const row of teamDistinct) {
    if (row.team) addCustomOptionEntry(discovered, "team", row.team, row.team, null);
  }

  const known = new Set(
    registryRows.map((r) => `${r.field_name}::${normKey(r.option_value)}`)
  );
  const syncJobs = [];
  for (const field of CUSTOM_OPTION_FIELD_KEYS) {
    for (const item of discovered[field] || []) {
      const key = `${field}::${normKey(item.value)}`;
      if (!known.has(key)) syncJobs.push(registerCustomOptionIfNeeded(field, item.value));
    }
  }
  if (syncJobs.length) await Promise.all(syncJobs);

  const finalRows =
    syncJobs.length > 0
      ? await prisma.dropdown_options.findMany({
          orderBy: [{ field_name: "asc" }, { option_label: "asc" }],
        })
      : registryRows;

  const data = emptyCustomOptionBuckets();
  for (const row of finalRows) {
    if (!CUSTOM_OPTION_FIELD_KEYS.includes(row.field_name)) continue;
    addCustomOptionEntry(
      data,
      row.field_name,
      row.option_value,
      row.option_label,
      row.id
    );
  }
  // Include any remaining discovered values
  for (const field of CUSTOM_OPTION_FIELD_KEYS) {
    for (const item of discovered[field] || []) {
      addCustomOptionEntry(data, field, item.value, item.label, item.id);
    }
  }

  for (const field of CUSTOM_OPTION_FIELD_KEYS) {
    const byKey = new Map();
    for (const item of data[field]) {
      const k = normKey(item.value);
      if (!k || isBuiltInOption(field, item.value)) continue;
      const prev = byKey.get(k);
      if (!prev || (item.id && !prev.id)) {
        byKey.set(k, {
          value: item.value,
          label: item.label || item.value,
          id: item.id || `dist:${field}:${item.value}`,
        });
      }
    }
    data[field] = [...byKey.values()].sort((a, b) =>
      a.label.localeCompare(b.label, "en", { sensitivity: "base" })
    );
  }

  return { success: true, data, registry: data };
}

async function renameCustomOption({ fieldName, oldValue, newValue }) {
  if (!fieldName || !oldValue || !newValue) {
    const err = new Error("fieldName, oldValue and newValue are required");
    err.status = 400;
    throw err;
  }
  const oldTrim = String(oldValue).trim();
  const newTrim = String(newValue).trim();
  if (!newTrim) {
    const err = new Error("newValue cannot be empty");
    err.status = 400;
    throw err;
  }
  if (isBuiltInOption(fieldName, newTrim)) {
    const err = new Error("Cannot rename to a built-in option value");
    err.status = 400;
    throw err;
  }

  const col = LEAD_COLUMN_MAP[fieldName];
  const existingTarget = await prisma.dropdown_options.findFirst({
    where: { field_name: fieldName, option_value: newTrim },
  });

  await prisma.$transaction(async (tx) => {
    if (fieldName === "status") {
      await tx.leads.updateMany({
        where: { is_deleted: false, status_v2: oldTrim },
        data: { status_v2: newTrim },
      });
    } else if (col) {
      await tx.leads.updateMany({
        where: { is_deleted: false, [col]: oldTrim },
        data: { [col]: newTrim },
      });
    }

    if (existingTarget) {
      await tx.dropdown_options.deleteMany({
        where: { field_name: fieldName, option_value: oldTrim },
      });
    } else {
      const updated = await tx.dropdown_options.updateMany({
        where: { field_name: fieldName, option_value: oldTrim },
        data: { option_value: newTrim, option_label: newTrim },
      });
      if (updated.count === 0) {
        await tx.dropdown_options.create({
          data: {
            field_name: fieldName,
            option_value: newTrim,
            option_label: newTrim,
          },
        });
      }
    }
  });

  emitLeadsChanged({ reason: "custom_option_rename" });
  return { success: true, message: "Option renamed" };
}

async function deleteCustomOption({ fieldName, optionValue }) {
  if (!fieldName || !optionValue) {
    const err = new Error("fieldName and optionValue are required");
    err.status = 400;
    throw err;
  }
  const val = String(optionValue).trim();
  const col = LEAD_COLUMN_MAP[fieldName];
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    if (fieldName === "status") {
      // Custom statuses live only in status_v2 (legacy `status` is leads_status enum).
      await tx.leads.updateMany({
        where: {
          is_deleted: false,
          status_v2: val,
        },
        data: { is_deleted: true, deleted_at: now },
      });
    } else if (col) {
      await tx.leads.updateMany({
        where: { is_deleted: false, [col]: val },
        data: { is_deleted: true, deleted_at: now },
      });
    }

    await tx.dropdown_options.deleteMany({
      where: { field_name: fieldName, option_value: val },
    });
  });

  emitLeadsChanged({ reason: "custom_option_delete" });
  return {
    success: true,
    message: "Option deleted and matching leads were removed",
  };
}

async function convertLeadToOpportunity(req, leadId, body = {}) {
  const lead = await prisma.leads.findFirst({
    where: { id: Number(leadId), is_deleted: false, tenant_id: tenantId(req) }
  });

  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }

  if (lead.converted_opportunity_id) {
    const err = new Error("This lead is already converted to an opportunity");
    err.status = 400;
    throw err;
  }

  const existingAmount = lead.amount != null ? Number(lead.amount) : 0;
  const hasLeadAmount = Number.isFinite(existingAmount) && existingAmount > 0;

  let leadAmount = hasLeadAmount ? existingAmount : 0;
  if (!hasLeadAmount) {
    const bodyAmount = Number(body.amount);
    if (!Number.isFinite(bodyAmount) || bodyAmount <= 0) {
      const err = new Error("Amount (INR) is required to convert this lead.");
      err.status = 400;
      throw err;
    }
    leadAmount = bodyAmount;
  } else if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
    const bodyAmount = Number(body.amount);
    if (bodyAmount > 0) leadAmount = bodyAmount;
  }

  const rawCategory = body.product_category != null && String(body.product_category).trim() 
    ? String(body.product_category).trim() 
    : lead.product_category;

  if (!rawCategory || !String(rawCategory).trim()) {
    const err = new Error("Product category is required to convert this lead to an opportunity");
    err.status = 400;
    throw err;
  }

  const title = lead.name;
  const ownerId = lead.assigned_to || req.user.id;
  const normalizedCategory = String(rawCategory).trim();

  const result = await prisma.$transaction(async (tx) => {
    if (normalizedCategory) {
      await tx.dropdown_options.upsert({
        where: {
          field_name_option_value: { field_name: "product_category", option_value: normalizedCategory }
        },
        update: { option_label: normalizedCategory },
        create: { field_name: "product_category", option_value: normalizedCategory, option_label: normalizedCategory }
      });
    }

    const opp = await tx.opportunities.create({
      data: {
        tenant_id: tenantId(req),
        title,
        lead_id: lead.id,
        contact_id: lead.contact_id || null,
        company_name: lead.company_name || null,
        amount: leadAmount,
        currency: String(body.currency || lead.currency || "INR").trim().toUpperCase() || "INR",
        stage: "qualification_done",
        owner_user_id: ownerId,
        created_by: req.user.id,
        notes: lead.comments_history || lead.notes || null,
        product_category: normalizedCategory,
        followup_at: lead.followup_at || null,
        followup_type: lead.followup_type || null,
        lead_source: lead.source || "other",
        team: lead.team || null,
        comments_history: lead.comments_history || null,
      }
    });

    await tx.leads.update({
      where: { id: lead.id },
      data: {
        status: "confirm",
        status_v2: "converted",
        converted_opportunity_id: opp.id,
        amount: leadAmount,
        currency: String(body.currency || lead.currency || "INR").trim().toUpperCase() || "INR",
        product_category: normalizedCategory,
        updated_by: req.user.id,
        last_touched_at: new Date(),
        updated_at: new Date(),
      }
    });

    await tx.lead_change_log.create({
      data: {
        lead_id: lead.id,
        user_id: req.user.id,
        field_name: "status",
        old_value: lead.status,
        new_value: "converted"
      }
    });

    return opp;
  });

  emitLeadsChanged({ reason: "convert", id: leadId, opportunityId: result.id });
  emitOpportunitiesChanged({ reason: "create", id: result.id, leadId });
  emitAdminChanged({ scope: "opportunities", action: "create", id: result.id });
  emitAdminChanged({ scope: "stats", reason: "leads", action: "convert" });
  emitCalendarChanged({ reason: "leads" });

  return { success: true, opportunityId: result.id };
}

module.exports = {
  canMutateLead,
  listLeads,
  getCalendarMarkers,
  getLeadById,
  getFollowups,
  createLead,
  updateLead,
  updateLeadStatus,
  softDeleteLead,
  addFollowup,
  convertLeadToOpportunity,
  linkLeadToFitnessClient,
  duplicateLead,
  getChangeLog,
  getHistory,
  getCustomOptions,
  renameCustomOption,
  deleteCustomOption,
  registerCustomOptionIfNeeded,
};
