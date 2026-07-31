const crypto = require("crypto");
const prisma = require("../config/prisma");
const {
  INTEGRATIONS,
  getIntegrationByKeyOrSlug,
} = require("../config/integrationsCatalog");

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function buildFullName(payload) {
  const combined = [payload.first_name || payload.firstName, payload.last_name || payload.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return combined || null;
}

function normalizeLeadPayload(rawPayload = {}) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const nestedData = payload.data && typeof payload.data === "object" ? payload.data : {};
  const merged = { ...payload, ...nestedData };

  const name = firstNonEmpty(
    merged.name,
    merged.full_name,
    merged.fullName,
    merged.lead_name,
    merged.customer_name,
    merged.customerName,
    buildFullName(merged)
  );

  const phone = firstNonEmpty(
    merged.phone,
    merged.mobile,
    merged.mobile_no,
    merged.phone_number,
    merged.phoneNumber,
    merged.contact,
    merged.whatsapp,
    merged.whatsapp_number
  );

  const email = firstNonEmpty(merged.email, merged.email_address, merged.emailAddress);

  const companyName = firstNonEmpty(
    merged.company_name,
    merged.company,
    merged.business_name,
    merged.businessName,
    merged.organization,
    merged.organisation
  );

  const primaryMessage = firstNonEmpty(
    merged.message,
    merged.notes,
    merged.note,
    merged.description,
    merged.requirement,
    merged.comment,
    merged.comments
  );

  const extraContext = [
    firstNonEmpty(merged.project, merged.project_name),
    firstNonEmpty(merged.property_name, merged.property_title),
    firstNonEmpty(merged.campaign, merged.campaign_name),
  ]
    .filter(Boolean)
    .map((value) => `Context: ${value}`);

  return {
    name,
    phone,
    email,
    company_name: companyName,
    notes: [primaryMessage, ...extraContext].filter(Boolean).join("\n"),
    assigned_to: merged.assigned_to || merged.assignedTo || merged.owner || null,
    follow_up_date: merged.follow_up_date || merged.followUpDate || null,
    status: firstNonEmpty(merged.status) || "new",
    label: firstNonEmpty(merged.label, merged.tag),
  };
}

function readWebhookSecret(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  return (
    req.headers["x-integration-secret"] ||
    req.query.secret ||
    req.body?.secret ||
    null
  );
}

function safeCompare(value, expected) {
  if (!value || !expected) return false;
  const left = Buffer.from(String(value));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sanitizeHeaders(headers = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(headers)) {
    if (["authorization", "x-integration-secret"].includes(key.toLowerCase())) continue;
    clean[key] = value;
  }
  return clean;
}

function getRequestBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

async function resolveUserId(value) {
  if (!value) return null;
  if (Number.isInteger(Number(value))) {
    const row = await prisma.users.findFirst({
      where: { id: Number(value), is_active: true },
      select: { id: true },
    });
    if (row) return row.id;
  }
  const byClerk = await prisma.users.findFirst({
    where: { clerk_user_id: String(value), is_active: true },
    select: { id: true },
  });
  return byClerk?.id || null;
}

async function resolveFallbackOwnerId() {
  const envOwner =
    process.env.DEFAULT_LEAD_OWNER_ID || process.env.DEFAULT_LEAD_OWNER_CLERK_USER_ID;
  const explicitOwnerId = await resolveUserId(envOwner);
  if (explicitOwnerId) return explicitOwnerId;

  const admin = await prisma.users.findFirst({
    where: { is_active: true, role: "admin" },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (admin) return admin.id;

  const any = await prisma.users.findFirst({
    where: { is_active: true },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  return any?.id || null;
}

async function createLeadFromIntegration({
  integration,
  rawPayload,
  createdById,
  fallbackOwnerId,
}) {
  const lead = normalizeLeadPayload(rawPayload);

  if (!lead.name || !lead.phone) {
    const err = new Error("name and phone are required in the incoming payload");
    err.status = 400;
    throw err;
  }

  const assignedUserId =
    (await resolveUserId(lead.assigned_to)) || fallbackOwnerId || (await resolveFallbackOwnerId());

  if (!assignedUserId) {
    const err = new Error("No active CRM user is available to own this incoming lead");
    err.status = 400;
    throw err;
  }

  const created = await prisma.leads.create({
    data: {
      name: lead.name,
      company_name: lead.company_name || null,
      phone: lead.phone,
      email: lead.email || null,
      source: integration.key,
      status: lead.status || "new",
      label: lead.label || integration.name,
      assigned_to: assignedUserId,
      created_by: createdById || assignedUserId,
      follow_up_date: lead.follow_up_date
        ? new Date(String(lead.follow_up_date).slice(0, 10))
        : null,
      notes: lead.notes || null,
    },
  });

  return prisma.leads.findUnique({ where: { id: created.id } });
}

async function logWebhookReceipt(integrationKey, req) {
  const created = await prisma.integration_webhooks.create({
    data: {
      source_key: integrationKey,
      status: "received",
      payload_json: req.body || {},
      headers_json: sanitizeHeaders(req.headers),
    },
  });
  return created.id;
}

async function markWebhookProcessed(logId, leadId) {
  await prisma.integration_webhooks.update({
    where: { id: logId },
    data: { status: "processed", lead_id: leadId || null, error_message: null },
  });
}

async function markWebhookFailed(logId, message) {
  await prisma.integration_webhooks.update({
    where: { id: logId },
    data: { status: "failed", error_message: message },
  });
}

async function getIntegrationCatalog(_req, res) {
  res.json({
    success: true,
    integrations: INTEGRATIONS.map((integration) => ({
      key: integration.key,
      slug: integration.slug,
      name: integration.name,
      description: integration.description,
      required_fields: integration.requiredFields,
    })),
  });
}

async function getIntegrationCatalogWithStatus(req, res) {
  try {
    const rows = await prisma.integrations.findMany({
      select: { key: true, is_active: true },
      orderBy: { key: "asc" },
    });
    const statuses = Object.fromEntries(rows.map((row) => [row.key, !!row.is_active]));

    res.json({
      success: true,
      integrations: INTEGRATIONS.map((integration) => ({
        key: integration.key,
        slug: integration.slug,
        name: integration.name,
        description: integration.description,
        required_fields: integration.requiredFields,
        is_active: Boolean(statuses[integration.key]),
        webhook_url: `${getRequestBaseUrl(req)}/api/integrations/webhook/${integration.key}`,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function ingestIntegrationWebhook(req, res) {
  const integration = getIntegrationByKeyOrSlug(req.params.source);
  if (!integration) {
    return res.status(404).json({ success: false, message: "Unknown integration source" });
  }

  const expectedSecret = process.env.INTEGRATION_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return res.status(503).json({
      success: false,
      message: "INTEGRATION_WEBHOOK_SECRET is not configured",
    });
  }

  const providedSecret = readWebhookSecret(req);
  if (!safeCompare(providedSecret, expectedSecret)) {
    return res.status(401).json({ success: false, message: "Invalid integration secret" });
  }

  const logId = await logWebhookReceipt(integration.key, req);
  const fallbackOwnerId = await resolveFallbackOwnerId();

  try {
    const created = await createLeadFromIntegration({
      integration,
      rawPayload: req.body,
      createdById: fallbackOwnerId,
      fallbackOwnerId,
    });

    await markWebhookProcessed(logId, created?.id);

    res.status(201).json({
      success: true,
      message: `${integration.name} lead ingested successfully`,
      data: created,
    });
  } catch (err) {
    await markWebhookFailed(logId, err.message);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function ingestIntegrationLeadAsUser(req, res) {
  try {
    const integration = getIntegrationByKeyOrSlug(req.params.source);
    if (!integration) {
      return res.status(404).json({ success: false, message: "Unknown integration source" });
    }

    const created = await createLeadFromIntegration({
      integration,
      rawPayload: req.body,
      createdById: req.user.id,
      fallbackOwnerId: req.user.id,
    });

    res.status(201).json({
      success: true,
      message: `${integration.name} lead created successfully`,
      data: created,
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getIntegrationCatalog,
  getIntegrationCatalogWithStatus,
  ingestIntegrationWebhook,
  ingestIntegrationLeadAsUser,
};
