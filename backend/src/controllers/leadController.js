const prisma = require("../config/prisma");

function assignedName(user) {
  if (!user) return null;
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || null;
}

function mapLeadRow(row) {
  if (!row) return row;
  const assigned = row.users_leads_assigned_toTousers;
  const { users_leads_assigned_toTousers, users_leads_created_byTousers, meetings, reminders, tasks, ...rest } = row;
  return {
    ...rest,
    company: rest.company_name ?? null,
    assigned_name: assignedName(assigned),
    assigned_email: assigned?.email ?? null,
  };
}

async function getLeads(req, res) {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where = {};
    if (status) where.status = status;
    if (search) {
      const q = String(search);
      where.OR = [
        { name: { contains: q } },
        { email: { contains: q } },
        { company_name: { contains: q } },
        { phone: { contains: q } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.leads.count({ where }),
      prisma.leads.findMany({
        where,
        include: {
          users_leads_assigned_toTousers: {
            select: { first_name: true, last_name: true, email: true },
          },
        },
        orderBy: { created_at: "desc" },
        take,
        skip: offset,
      }),
    ]);

    res.json({ success: true, total, leads: rows.map(mapLeadRow) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getLead(req, res) {
  try {
    const id = Number(req.params.id);

    const lead = await prisma.leads.findUnique({
      where: { id },
      include: {
        users_leads_assigned_toTousers: {
          select: { first_name: true, last_name: true, email: true },
        },
      },
    });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    const [tasks, notes, reminders, meetings] = await Promise.all([
      prisma.tasks.findMany({ where: { lead_id: id }, orderBy: { created_at: "desc" } }),
      prisma.notes.findMany({ where: { lead_id: id }, orderBy: { created_at: "desc" } }),
      prisma.reminders.findMany({ where: { lead_id: id }, orderBy: { remind_at: "asc" } }),
      prisma.meetings.findMany({ where: { lead_id: id }, orderBy: { start_time: "asc" } }),
    ]);

    res.json({
      success: true,
      lead: mapLeadRow(lead),
      tasks,
      notes,
      reminders,
      meetings,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createLead(req, res) {
  try {
    const { name, email, phone, company, company_name, source, status, assigned_to, notes } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }

    const created = await prisma.leads.create({
      data: {
        name: name.trim(),
        email: email || null,
        phone: phone || "",
        company_name: company_name || company || null,
        source: source || "Website",
        status: status || "new",
        assigned_to: assigned_to ? Number(assigned_to) : null,
        notes: notes || null,
        created_by: req.user?.id || 0,
      },
    });
    res.status(201).json({ success: true, id: created.id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateLead(req, res) {
  try {
    const { id } = req.params;
    const { name, email, phone, company, company_name, source, status, assigned_to, notes } = req.body;

    await prisma.leads.update({
      where: { id: Number(id) },
      data: {
        name: name || null,
        email: email || null,
        phone: phone || "",
        company_name: company_name || company || null,
        source: source || "Website",
        status: status || "new",
        assigned_to: assigned_to ? Number(assigned_to) : null,
        notes: notes || null,
        updated_at: new Date(),
      },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateLeadStatus(req, res) {
  try {
    const { status } = req.body;
    await prisma.leads.update({
      where: { id: Number(req.params.id) },
      data: { status, updated_at: new Date() },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteLead(req, res) {
  try {
    await prisma.leads.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getLeads, getLead, createLead, updateLead, updateLeadStatus, deleteLead };
