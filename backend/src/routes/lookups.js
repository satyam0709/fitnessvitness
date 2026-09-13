"use strict";

const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const prisma = require("../config/prisma");

const router = express.Router();
router.use(verifyToken);

function clean(v, max = 255) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function lookupLimit(raw) {
  const n = Number.parseInt(String(raw || "40"), 10);
  if (!Number.isFinite(n) || n < 1) return 40;
  return Math.min(500, n);
}

router.get("/companies", async (req, res) => {
  try {
    const q = clean(req.query.q, 120);
    const limit = lookupLimit(req.query.limit);
    const where = {};
    if (q) {
      where.OR = [
        { account_name: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
        { city: { contains: q } },
      ];
    }
    const rows = await prisma.companies.findMany({
      where,
      orderBy: { account_name: "asc" },
      take: limit,
      select: {
        id: true,
        account_name: true,
        account_relationship: true,
        phone: true,
        email: true,
        industry: true,
        street: true,
        city: true,
        state: true,
        country: true,
        postal_code: true,
        website: true,
      },
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/contacts", async (req, res) => {
  try {
    const q = clean(req.query.q, 120);
    const companyId = Number(req.query.company_id) || null;
    const limit = lookupLimit(req.query.limit);
    const where = {};
    if (companyId) where.company_id = companyId;
    if (q) {
      where.OR = [
        { contact_name: { contains: q } },
        { company_name: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
      ];
    }
    const rows = await prisma.contacts.findMany({
      where,
      orderBy: { contact_name: "asc" },
      take: limit,
      select: {
        id: true,
        company_id: true,
        company_name: true,
        contact_name: true,
        designation: true,
        email: true,
        phone: true,
        street: true,
        city: true,
        state: true,
        country: true,
        postal_code: true,
        department: true,
        account_relationship: true,
      },
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
