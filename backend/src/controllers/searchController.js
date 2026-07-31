const prisma = require("../config/prisma");

async function search(req, res) {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.json({ success: true, results: [] });
    }

    const term = q.trim();

    const [leads, tasks, customers, notes] = await Promise.all([
      prisma.leads.findMany({
        where: {
          is_deleted: false,
          OR: [
            { name: { contains: term } },
            { email: { contains: term } },
            { company_name: { contains: term } },
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          created_at: true,
        },
        take: 5,
        orderBy: { created_at: "desc" },
      }),
      prisma.tasks.findMany({
        where: {
          is_deleted: false,
          OR: [
            { title: { contains: term } },
            { description: { contains: term } },
          ],
        },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          created_at: true,
        },
        take: 5,
        orderBy: { created_at: "desc" },
      }),
      prisma.customers.findMany({
        where: {
          is_deleted: false,
          OR: [
            { name: { contains: term } },
            { email: { contains: term } },
            { company: { contains: term } },
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          company: true,
          created_at: true,
        },
        take: 5,
        orderBy: { created_at: "desc" },
      }),
      prisma.notes.findMany({
        where: {
          is_deleted: false,
          OR: [
            { title: { contains: term } },
            { content: { contains: term } },
          ],
        },
        select: {
          id: true,
          title: true,
          content: true,
          created_at: true,
        },
        take: 5,
        orderBy: { created_at: "desc" },
      }),
    ]);

    const results = [
      ...leads.map((r) => ({
        type: "lead",
        id: r.id,
        title: r.name,
        subtitle: r.email,
        meta: r.status,
        created_at: r.created_at,
      })),
      ...tasks.map((r) => ({
        type: "task",
        id: r.id,
        title: r.title,
        subtitle: r.description,
        meta: r.status,
        created_at: r.created_at,
      })),
      ...customers.map((r) => ({
        type: "customer",
        id: r.id,
        title: r.name,
        subtitle: r.email,
        meta: r.company,
        created_at: r.created_at,
      })),
      ...notes.map((r) => ({
        type: "note",
        id: r.id,
        title: r.title,
        subtitle: r.content ? String(r.content).slice(0, 80) : null,
        meta: null,
        created_at: r.created_at,
      })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ success: true, results, query: term });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { search };
