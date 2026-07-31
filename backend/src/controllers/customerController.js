const prisma = require("../config/prisma");

async function getCustomers(req, res) {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const take = Math.min(200, Math.max(1, Number(limit) || 50));
    const pageNum = Math.max(1, Number(page) || 1);
    const skip = (pageNum - 1) * take;

    const where = {
      is_deleted: false,
    };

    const q = String(search || "").trim();
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { email: { contains: q } },
        { company: { contains: q } },
      ];
    }

    const [total, customers] = await Promise.all([
      prisma.customers.count({ where }),
      prisma.customers.findMany({
        where,
        orderBy: { created_at: "desc" },
        take,
        skip,
      }),
    ]);

    res.json({ success: true, total, customers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createCustomer(req, res) {
  try {
    const { name, email, phone, company, city, country, lead_id } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "name is required" });
    }

    const created = await prisma.customers.create({
      data: {
        name: String(name).trim(),
        email: email || null,
        phone: phone || null,
        company: company || null,
        city: city || null,
        country: country || "India",
        lead_id: lead_id ? Number(lead_id) : null,
      },
    });
    res.json({ success: true, id: created.id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateCustomer(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid customer id" });

    const existing = await prisma.customers.findFirst({
      where: { id, is_deleted: false },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Customer not found" });

    const { name, email, phone, company, city, country } = req.body;
    await prisma.customers.update({
      where: { id },
      data: {
        name,
        email: email || null,
        phone: phone || null,
        company: company || null,
        city: city || null,
        country: country || "India",
        updated_at: new Date(),
      },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteCustomer(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid customer id" });

    const existing = await prisma.customers.findFirst({
      where: { id, is_deleted: false },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Customer not found" });

    await prisma.customers.update({
      where: { id },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        updated_at: new Date(),
      },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getCustomers, createCustomer, updateCustomer, deleteCustomer };
