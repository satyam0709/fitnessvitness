"use strict";

const fs = require("fs");
const path = require("path");
const prisma = require("../config/prisma");

const UPLOADS_ROOT = path.join(__dirname, "..", "..", "uploads");
const TOTAL_MB = 1024;

const MODULE_LABEL = {
  lead: "Lead",
  lead_followup: "Lead Followup",
  todo: "To Do",
  brochure: "Brochure",
  company_assets: "Company Assets",
  chat: "Chat",
  storage_files: "Files",
};

function canonicalUploadUrl(raw) {
  let s = String(raw || "").trim().replace(/\\/g, "/");
  if (!s) return "";
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep */
  }
  const idx = s.indexOf("/uploads/");
  if (idx >= 0) s = s.slice(idx);
  if (!s.startsWith("/uploads/")) return "";
  if (s.includes("..")) return "";
  return s.replace(/\/{2,}/g, "/");
}

function isProtectedUploadPath(canonical) {
  const p = canonicalUploadUrl(canonical);
  return p.startsWith("/uploads/settings/");
}

function resolveDisk(canonical) {
  const c = canonicalUploadUrl(canonical);
  if (!c) return null;
  const rel = c.replace(/^\/uploads\//, "");
  const abs = path.normalize(path.join(UPLOADS_ROOT, rel));
  if (!abs.startsWith(UPLOADS_ROOT)) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return abs;
}

function fileExtOf(p) {
  return path.extname(String(p || "")).replace(/^\./, "").toLowerCase();
}

function mimeOfExt(ext) {
  const e = String(ext || "").toLowerCase();
  if (e === "pdf") return "application/pdf";
  if (e === "png") return "image/png";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "gif") return "image/gif";
  if (e === "webp") return "image/webp";
  if (e === "svg") return "image/svg+xml";
  if (e === "csv") return "text/csv";
  return "application/octet-stream";
}

function diskSize(canonical) {
  const abs = resolveDisk(canonical);
  if (!abs) return 0;
  try {
    return fs.statSync(abs).size;
  } catch {
    return 0;
  }
}

function parseJsonArr(v) {
  if (v == null || v === "") return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function extractPaths(arr) {
  const out = [];
  for (const item of arr) {
    if (typeof item === "string") {
      const file_url = canonicalUploadUrl(item);
      if (file_url) out.push({ file_url, file_name: path.basename(file_url) });
      continue;
    }
    if (item && typeof item === "object") {
      const file_url = canonicalUploadUrl(item.url || item.file_url || item.path || item.file);
      if (file_url) {
        out.push({
          file_url,
          file_name: item.file_name || item.name || path.basename(file_url),
        });
      }
    }
  }
  return out;
}

function pushFile(files, module, rec) {
  const file_url = canonicalUploadUrl(rec.file_url);
  if (!file_url) return;
  files.push({
    id: rec.id || null,
    module,
    file_url,
    file_name: rec.file_name || path.basename(file_url),
    size_bytes: rec.size_bytes != null ? Number(rec.size_bytes) || 0 : diskSize(file_url),
    mime_type: rec.mime_type || mimeOfExt(fileExtOf(file_url)),
    created_at: rec.created_at || null,
    lead_name: rec.lead_name || null,
    ext: fileExtOf(file_url),
  });
}

async function buildStorageOverview(userId) {
  const uid = Number(userId);
  const files = [];

  const attachments = await prisma.file_attachments.findMany({
    where: { user_id: uid },
    include: { leads: { select: { name: true } } },
    orderBy: { created_at: "desc" },
  });
  for (const fa of attachments) {
    pushFile(files, fa.lead_id ? "lead" : "storage_files", {
      id: fa.id,
      file_url: fa.file_url,
      file_name: fa.file_name,
      size_bytes: fa.size_bytes,
      mime_type: fa.mime_type,
      created_at: fa.created_at,
      lead_name: fa.leads?.name || null,
    });
  }

  const leads = await prisma.leads.findMany({
    where: {
      is_deleted: false,
      OR: [{ created_by: uid }, { assigned_to: uid }],
    },
    select: { name: true, attachments_json: true, created_at: true },
  });
  for (const lead of leads) {
    for (const p of extractPaths(parseJsonArr(lead.attachments_json))) {
      pushFile(files, "lead", { ...p, lead_name: lead.name, created_at: lead.created_at });
    }
  }

  const followups = await prisma.lead_followups.findMany({
    where: { created_by: uid },
    select: { attachments_json: true, created_at: true },
  });
  for (const row of followups) {
    for (const p of extractPaths(parseJsonArr(row.attachments_json))) {
      pushFile(files, "lead_followup", { ...p, created_at: row.created_at });
    }
  }

  const todos = await prisma.crm_todos.findMany({
    where: { is_deleted: false, created_by: uid },
    select: { attachment_json: true, created_at: true },
  });
  for (const todo of todos) {
    for (const p of extractPaths(parseJsonArr(todo.attachment_json))) {
      pushFile(files, "todo", { ...p, created_at: todo.created_at });
    }
  }

  const brochures = await prisma.brochures.findMany({
    where: { is_deleted: false },
    select: { file_name: true, stored_name: true, created_at: true },
  });
  for (const b of brochures) {
    if (!b.stored_name) continue;
    pushFile(files, "brochure", {
      file_url: `/uploads/brochures/${path.basename(b.stored_name)}`,
      file_name: b.file_name || b.stored_name,
      created_at: b.created_at,
    });
  }

  const settings = await prisma.company_settings.findUnique({ where: { id: 1 } });
  if (settings?.logo_path) {
    pushFile(files, "company_assets", {
      file_url: `/uploads/settings/${path.basename(settings.logo_path)}`,
      file_name: "logo",
      created_at: settings.updated_at,
    });
  }
  if (settings?.invoice_signature_path) {
    pushFile(files, "company_assets", {
      file_url: `/uploads/settings/${path.basename(settings.invoice_signature_path)}`,
      file_name: "signature",
      created_at: settings.updated_at,
    });
  }

  const messages = await prisma.chat_thread_messages.findMany({
    where: { sender_id: uid },
    select: { attachments_json: true, created_at: true },
    take: 400,
    orderBy: { created_at: "desc" },
  });
  for (const msg of messages) {
    for (const p of extractPaths(parseJsonArr(msg.attachments_json))) {
      pushFile(files, "chat", { ...p, created_at: msg.created_at });
    }
  }

  const seen = new Set();
  const unique = [];
  for (const f of files) {
    if (seen.has(f.file_url)) continue;
    seen.add(f.file_url);
    unique.push(f);
  }

  const used_bytes = unique.reduce((s, f) => s + (Number(f.size_bytes) || 0), 0);
  const used_mb = +(used_bytes / (1024 * 1024)).toFixed(2);
  const modulesMap = {};
  for (const f of unique) {
    if (!modulesMap[f.module]) {
      modulesMap[f.module] = {
        key: f.module,
        label: MODULE_LABEL[f.module] || f.module,
        file_count: 0,
        used_bytes: 0,
      };
    }
    modulesMap[f.module].file_count += 1;
    modulesMap[f.module].used_bytes += Number(f.size_bytes) || 0;
  }

  return {
    usage: {
      used_mb,
      total_mb: TOTAL_MB,
      free_mb: Math.max(0, +(TOTAL_MB - used_mb).toFixed(2)),
      percent_used: TOTAL_MB ? +((used_mb / TOTAL_MB) * 100).toFixed(2) : 0,
      used_bytes,
      active_modules: Object.keys(modulesMap).length,
      unlimited: false,
    },
    modules: Object.values(modulesMap).map((m) => ({
      ...m,
      used_mb: +(m.used_bytes / (1024 * 1024)).toFixed(2),
    })),
    files: unique,
  };
}

function unlinkCanonical(canonical) {
  const abs = resolveDisk(canonical);
  if (!abs) return false;
  try {
    fs.unlinkSync(abs);
    return true;
  } catch {
    return false;
  }
}

async function removePathFromJson(userId, canonical) {
  const uid = Number(userId);
  const c = canonicalUploadUrl(canonical);
  if (!c) return;

  function without(arr) {
    return arr.filter((item) => {
      const url = typeof item === "string" ? item : item?.url || item?.file_url || item?.path;
      return canonicalUploadUrl(url) !== c;
    });
  }

  const leads = await prisma.leads.findMany({
    where: { is_deleted: false, OR: [{ created_by: uid }, { assigned_to: uid }] },
    select: { id: true, attachments_json: true },
  });
  for (const lead of leads) {
    const arr = parseJsonArr(lead.attachments_json);
    const next = without(arr);
    if (next.length !== arr.length) {
      await prisma.leads.update({ where: { id: lead.id }, data: { attachments_json: next } });
    }
  }

  const followups = await prisma.lead_followups.findMany({
    where: { created_by: uid },
    select: { id: true, attachments_json: true },
  });
  for (const row of followups) {
    const arr = parseJsonArr(row.attachments_json);
    const next = without(arr);
    if (next.length !== arr.length) {
      await prisma.lead_followups.update({ where: { id: row.id }, data: { attachments_json: next } });
    }
  }

  const todos = await prisma.crm_todos.findMany({
    where: { is_deleted: false, created_by: uid },
    select: { id: true, attachment_json: true },
  });
  for (const todo of todos) {
    const arr = parseJsonArr(todo.attachment_json);
    const next = without(arr);
    if (next.length !== arr.length) {
      await prisma.crm_todos.update({ where: { id: todo.id }, data: { attachment_json: next } });
    }
  }

  const brochureName = path.basename(c);
  if (c.startsWith("/uploads/brochures/") && brochureName) {
    await prisma.brochures.updateMany({
      where: { stored_name: brochureName, is_deleted: false },
      data: { stored_name: null, file_name: null, updated_at: new Date() },
    });
  }
}

async function deleteOwnedPath(userId, rawPath) {
  const canonical = canonicalUploadUrl(rawPath);
  if (!canonical) {
    const err = new Error("Invalid file path");
    err.status = 400;
    throw err;
  }
  if (isProtectedUploadPath(canonical)) {
    const err = new Error("This file cannot be deleted from storage");
    err.status = 403;
    throw err;
  }

  const fa = await prisma.file_attachments.findFirst({
    where: { user_id: Number(userId), file_url: canonical },
  });
  if (fa) {
    await prisma.file_attachments.delete({ where: { id: fa.id } });
  }

  await removePathFromJson(userId, canonical);
  unlinkCanonical(canonical);
  return canonical;
}

module.exports = {
  UPLOADS_ROOT,
  canonicalUploadUrl,
  isProtectedUploadPath,
  resolveDisk,
  fileExtOf,
  mimeOfExt,
  buildStorageOverview,
  deleteOwnedPath,
};
