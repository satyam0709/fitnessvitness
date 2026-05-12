const { mainPool } = require("../config/database");
const { emitAdminChanged } = require("../realtime/meetingsRealtime");
const {
  buildPublicCatalog,
  fetchPackagesForAdmin,
  fetchAddonsForAdmin,
  normalizeFeatures,
} = require("../services/packageCatalogService");

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function badSlug(slug) {
  const s = String(slug || "").trim().toLowerCase();
  if (s.length < 2 || s.length > 80) return "Slug must be 2–80 characters.";
  if (!SLUG_RE.test(s)) return "Slug: lowercase letters, numbers, and single hyphens only.";
  return null;
}

async function getPublicCatalog(req, res) {
  try {
    const currency = String(req.query.currency || "INR").toUpperCase() === "USD" ? "USD" : "INR";
    const catalog = await buildPublicCatalog(currency);
    res.json({ success: true, ...catalog });
  } catch (err) {
    console.error("getPublicCatalog:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminListPackages(_req, res) {
  try {
    const data = await fetchPackagesForAdmin();
    res.json({ success: true, packages: data });
  } catch (err) {
    console.error("adminListPackages:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminListAddons(_req, res) {
  try {
    const data = await fetchAddonsForAdmin();
    res.json({ success: true, addons: data });
  } catch (err) {
    console.error("adminListAddons:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminCreatePackage(req, res) {
  try {
    const {
      slug,
      name,
      description = null,
      price_inr = 0,
      price_usd = 0,
      staff_seats = 3,
      billing_period = "Year",
      features = [],
      sort_order = 0,
      is_active = 1,
    } = req.body || {};

    const slugErr = badSlug(slug);
    if (slugErr) return res.status(400).json({ success: false, message: slugErr });
    if (!name || String(name).trim().length < 1) {
      return res.status(400).json({ success: false, message: "Name is required." });
    }

    const slugNorm = String(slug).trim().toLowerCase();
    const feats = normalizeFeatures(features);
    const fj = JSON.stringify(feats);

    const [r] = await mainPool.execute(
      `INSERT INTO subscription_packages
        (slug, name, description, price_inr, price_usd, staff_seats, billing_period, features_json, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?)`,
      [
        slugNorm,
        String(name).trim(),
        description,
        Number(price_inr) || 0,
        Number(price_usd) || 0,
        Math.max(0, Math.min(9999, Number(staff_seats) || 0)),
        String(billing_period || "Year").slice(0, 40),
        fj,
        Number(sort_order) || 0,
        is_active ? 1 : 0,
      ]
    );

    emitAdminChanged({ scope: "packages", action: "create", id: r.insertId });
    res.status(201).json({ success: true, id: r.insertId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "Slug already exists." });
    }
    console.error("adminCreatePackage:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminUpdatePackage(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id." });

    const body = req.body || {};
    const fields = [];
    const params = [];

    if (body.slug !== undefined) {
      const slugErr = badSlug(body.slug);
      if (slugErr) return res.status(400).json({ success: false, message: slugErr });
      fields.push("slug = ?");
      params.push(String(body.slug).trim().toLowerCase());
    }
    if (body.name !== undefined) {
      fields.push("name = ?");
      params.push(String(body.name).trim());
    }
    if (body.description !== undefined) {
      fields.push("description = ?");
      params.push(body.description);
    }
    if (body.price_inr !== undefined) {
      fields.push("price_inr = ?");
      params.push(Number(body.price_inr) || 0);
    }
    if (body.price_usd !== undefined) {
      fields.push("price_usd = ?");
      params.push(Number(body.price_usd) || 0);
    }
    if (body.staff_seats !== undefined) {
      fields.push("staff_seats = ?");
      params.push(Math.max(0, Math.min(9999, Number(body.staff_seats) || 0)));
    }
    if (body.billing_period !== undefined) {
      fields.push("billing_period = ?");
      params.push(String(body.billing_period).slice(0, 40));
    }
    if (body.features !== undefined) {
      fields.push("features_json = CAST(? AS JSON)");
      params.push(JSON.stringify(normalizeFeatures(body.features)));
    }
    if (body.sort_order !== undefined) {
      fields.push("sort_order = ?");
      params.push(Number(body.sort_order) || 0);
    }
    if (body.is_active !== undefined) {
      fields.push("is_active = ?");
      params.push(body.is_active ? 1 : 0);
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update." });
    }

    params.push(id);
    const [result] = await mainPool.execute(
      `UPDATE subscription_packages SET ${fields.join(", ")} WHERE id = ?`,
      params
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Package not found." });
    }
    emitAdminChanged({ scope: "packages", action: "update", id });
    res.json({ success: true });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "Slug already exists." });
    }
    console.error("adminUpdatePackage:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminDeletePackage(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id." });
    const [r] = await mainPool.execute("DELETE FROM subscription_packages WHERE id = ?", [id]);
    if (r.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Package not found." });
    }
    emitAdminChanged({ scope: "packages", action: "delete", id });
    res.json({ success: true });
  } catch (err) {
    console.error("adminDeletePackage:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminCreateAddon(req, res) {
  try {
    const {
      slug,
      name,
      period_label = null,
      price_inr = 0,
      price_usd = 0,
      icon = "fas fa-circle",
      sort_order = 0,
      is_active = 1,
    } = req.body || {};

    const slugErr = badSlug(slug);
    if (slugErr) return res.status(400).json({ success: false, message: slugErr });
    if (!name || String(name).trim().length < 1) {
      return res.status(400).json({ success: false, message: "Name is required." });
    }

    const slugNorm = String(slug).trim().toLowerCase();
    if (slugNorm === "staff" || slugNorm === "users" || slugNorm === "extra-staff-seat") {
      return res.status(400).json({
        success: false,
        message: "User seat add-on is removed and cannot be created.",
      });
    }
    const [r] = await mainPool.execute(
      `INSERT INTO subscription_addons
        (slug, name, period_label, price_inr, price_usd, icon, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        slugNorm,
        String(name).trim(),
        period_label,
        Number(price_inr) || 0,
        Number(price_usd) || 0,
        String(icon || "fas fa-circle").slice(0, 120),
        Number(sort_order) || 0,
        is_active ? 1 : 0,
      ]
    );
    emitAdminChanged({ scope: "packages", action: "addon_create", id: r.insertId });
    res.status(201).json({ success: true, id: r.insertId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "Slug already exists." });
    }
    console.error("adminCreateAddon:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminUpdateAddon(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id." });
    const body = req.body || {};
    const fields = [];
    const params = [];

    if (body.slug !== undefined) {
      const slugErr = badSlug(body.slug);
      if (slugErr) return res.status(400).json({ success: false, message: slugErr });
      const slugNorm = String(body.slug).trim().toLowerCase();
      if (slugNorm === "staff" || slugNorm === "users" || slugNorm === "extra-staff-seat") {
        return res.status(400).json({
          success: false,
          message: "User seat add-on is removed and cannot be used.",
        });
      }
      fields.push("slug = ?");
      params.push(slugNorm);
    }
    if (body.name !== undefined) {
      fields.push("name = ?");
      params.push(String(body.name).trim());
    }
    if (body.period_label !== undefined) {
      fields.push("period_label = ?");
      params.push(body.period_label);
    }
    if (body.price_inr !== undefined) {
      fields.push("price_inr = ?");
      params.push(Number(body.price_inr) || 0);
    }
    if (body.price_usd !== undefined) {
      fields.push("price_usd = ?");
      params.push(Number(body.price_usd) || 0);
    }
    if (body.icon !== undefined) {
      fields.push("icon = ?");
      params.push(String(body.icon).slice(0, 120));
    }
    if (body.sort_order !== undefined) {
      fields.push("sort_order = ?");
      params.push(Number(body.sort_order) || 0);
    }
    if (body.is_active !== undefined) {
      fields.push("is_active = ?");
      params.push(body.is_active ? 1 : 0);
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update." });
    }
    params.push(id);
    const [result] = await mainPool.execute(
      `UPDATE subscription_addons SET ${fields.join(", ")} WHERE id = ?`,
      params
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Add-on not found." });
    }
    emitAdminChanged({ scope: "packages", action: "addon_update", id });
    res.json({ success: true });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "Slug already exists." });
    }
    console.error("adminUpdateAddon:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminDeleteAddon(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id." });
    const [r] = await mainPool.execute("DELETE FROM subscription_addons WHERE id = ?", [id]);
    if (r.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Add-on not found." });
    }
    emitAdminChanged({ scope: "packages", action: "addon_delete", id });
    res.json({ success: true });
  } catch (err) {
    console.error("adminDeleteAddon:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getPublicCatalog,
  adminListPackages,
  adminListAddons,
  adminCreatePackage,
  adminUpdatePackage,
  adminDeletePackage,
  adminCreateAddon,
  adminUpdateAddon,
  adminDeleteAddon,
};
