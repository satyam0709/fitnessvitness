export function pickCustomerField(row, keys) {
  for (const key of keys) {
    const v = String(row?.[key] ?? "").trim();
    if (v) return v;
  }
  return "";
}

export function joinAddressParts(row, keys) {
  if (!row) return "";
  return keys
    .map((key) => String(row[key] ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

function leadDisplayName(lead) {
  const name = String(lead?.name || "").trim();
  if (name) return name;
  return [lead?.first_name, lead?.last_name].map((x) => String(x || "").trim()).filter(Boolean).join(" ").trim();
}

function leadPhone(lead) {
  const direct = pickCustomerField(lead, ["phone", "mobile"]);
  if (direct) return direct;
  const phones = Array.isArray(lead?.phones) ? lead.phones : [];
  for (const p of phones) {
    const v = String(typeof p === "object" ? p?.number || p?.phone || p?.value : p).trim();
    if (v) return v;
  }
  return "";
}

function leadEmail(lead) {
  const direct = pickCustomerField(lead, ["email"]);
  if (direct) return direct;
  const emails = Array.isArray(lead?.emails) ? lead.emails : [];
  for (const e of emails) {
    const v = String(typeof e === "object" ? e?.email || e?.value : e).trim();
    if (v) return v;
  }
  return "";
}

export function fieldsFromLead(lead) {
  if (!lead) {
    return { name: "", email: "", phone: "", company: "", address: "" };
  }
  const structured = [
    lead.address_line1,
    lead.address_line2,
    [lead.city, lead.state].filter(Boolean).join(", "),
    lead.country,
    lead.postal_code,
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(", ");
  return {
    name: leadDisplayName(lead),
    email: leadEmail(lead),
    phone: leadPhone(lead),
    company: pickCustomerField(lead, ["company_name", "company"]),
    address: structured || pickCustomerField(lead, ["address"]),
  };
}

export function findCustomerForLead(customers, leadId, lead) {
  const list = Array.isArray(customers) ? customers : [];
  if (leadId) {
    const byLead = list.find((c) => String(c?.lead_id) === String(leadId));
    if (byLead) return byLead;
  }
  const email = String(leadEmail(lead) || "").trim().toLowerCase();
  if (email) {
    const byEmail = list.find((c) => String(c?.email || "").trim().toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  const phone = String(leadPhone(lead) || "").replace(/\D/g, "");
  if (phone.length >= 8) {
    const byPhone = list.find((c) => {
      const p = String(c?.phone || c?.mobile || "").replace(/\D/g, "");
      return p && (p === phone || p.endsWith(phone) || phone.endsWith(p));
    });
    if (byPhone) return byPhone;
  }
  return null;
}

function leadCommentNote(lead) {
  const bits = [];
  const cat = String(lead?.product_category || "").trim();
  if (cat) bits.push(`Product: ${cat}`);
  const amount = Number(lead?.amount);
  if (Number.isFinite(amount) && amount > 0) {
    const cur = String(lead?.currency || "INR").trim() || "INR";
    bits.push(`Lead amount: ${cur} ${amount}`);
  }
  return bits.join(" · ");
}

export function applyLeadToDocument({ lead, customers } = {}) {
  const leadFields = fieldsFromLead(lead);
  const matched = findCustomerForLead(customers, lead?.id, lead);
  const customerFields = matched ? fieldsFromCustomer(matched) : null;
  const opp = lead?.converted_opportunity_id;
  const assigned = lead?.assigned_to;
  const currency = String(lead?.currency || "").trim();
  return {
    customerId: matched?.id ? String(matched.id) : "",
    fields: {
      name: leadFields.name || customerFields?.name || "",
      email: leadFields.email || customerFields?.email || "",
      phone: leadFields.phone || customerFields?.phone || "",
      company: leadFields.company || customerFields?.company || "",
      address: leadFields.address || customerFields?.address || "",
    },
    opportunityId: opp ? String(opp) : "",
    assignedTo: assigned ? String(assigned) : "",
    currency: currency || "",
    comment: leadCommentNote(lead),
  };
}

export function partySnapshot(fields) {
  return JSON.stringify({
    name: String(fields?.name || "").trim(),
    email: String(fields?.email || "").trim(),
    phone: String(fields?.phone || "").trim(),
    company: String(fields?.company || "").trim(),
    address: String(fields?.address || "").trim(),
  });
}

export async function fetchLeadById(apiFetch, leadId) {
  if (!leadId) return null;
  const res = await apiFetch(`/leads/${encodeURIComponent(leadId)}?compact=1`);
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.success || !d.data) {
    const err = new Error(d.message || "Lead not found");
    err.status = res.status;
    throw err;
  }
  return d.data;
}

export function leadChangedEventApplies(payload, leadId) {
  if (!leadId) return false;
  const eventId = payload?.leadId ?? payload?.id ?? payload?.lead_id;
  if (eventId == null || String(eventId).trim() === "") return true;
  return String(eventId) === String(leadId);
}

export function createDebounced(fn, ms = 300) {
  let timer = null;
  const run = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  run.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return run;
}

export function fieldsFromCustomer(row) {
  if (!row) {
    return { name: "", email: "", phone: "", company: "", address: "" };
  }
  return {
    name: pickCustomerField(row, ["name"]),
    email: pickCustomerField(row, ["email"]),
    phone: pickCustomerField(row, ["phone", "mobile"]),
    company: pickCustomerField(row, ["company", "company_name"]),
    address: pickCustomerField(row, ["address", "address_line1"]) || joinAddressParts(row, ["city", "country"]),
  };
}

export function customerOptionLabel(row) {
  const name = pickCustomerField(row, ["name"]) || "Customer";
  const company = pickCustomerField(row, ["company", "company_name"]);
  if (company && company.toLowerCase() !== name.toLowerCase()) return `${company} — ${name}`;
  return name;
}

export async function fetchAllCustomers(apiFetch) {
  const pageSize = 200;
  const all = [];
  let page = 1;
  let total = Infinity;
  while (all.length < total && page <= 50) {
    const res = await apiFetch(`/v2/customers?limit=${pageSize}&page=${page}`);
    if (!res.ok) break;
    const d = await res.json().catch(() => ({}));
    total = Number(d.total);
    if (!Number.isFinite(total)) total = 0;
    const batch = Array.isArray(d.customers) ? d.customers : [];
    all.push(...batch);
    if (!batch.length) break;
    page += 1;
  }
  return all;
}

export async function fetchCustomerById(apiFetch, id) {
  const res = await apiFetch(`/v2/customers/${encodeURIComponent(id)}`);
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.customer) return null;
  return d.customer;
}

async function fetchJsonList(apiFetch, path) {
  const res = await apiFetch(path);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  if (Array.isArray(d.data)) return d.data;
  if (Array.isArray(d.contacts)) return d.contacts;
  if (Array.isArray(d)) return d;
  return [];
}

export async function fetchLookupContacts(apiFetch) {
  const primary = await fetchJsonList(apiFetch, "/lookups/contacts?limit=500");
  if (primary) return primary;
  const fallback = await fetchJsonList(apiFetch, "/contacts?limit=500");
  return fallback || [];
}

export function invoicePartyFromCustomer(row) {
  const f = fieldsFromCustomer(row);
  return {
    key: `customer-${row.id}`,
    customerId: row.id,
    source: "customer",
    name: f.name,
    email: f.email,
    phone: f.phone,
    company: f.company,
    address: f.address,
  };
}

export function invoicePartyFromContact(row) {
  return {
    key: `contact-${row.id}`,
    customerId: null,
    source: "contact",
    name: pickCustomerField(row, ["contact_name", "name"]),
    email: pickCustomerField(row, ["email"]),
    phone: pickCustomerField(row, ["phone", "mobile"]),
    company: pickCustomerField(row, ["company_name", "company"]),
    address: joinAddressParts(row, ["street", "city", "state", "country"]),
  };
}

export function invoicePartyFromFitnessClient(row) {
  return {
    key: `fitness-${row.client_id || row.id}`,
    customerId: null,
    fitnessClientId: row.client_id || row.id,
    source: "fitness",
    name: pickCustomerField(row, ["full_name", "name", "client_id"]),
    email: pickCustomerField(row, ["email"]),
    phone: pickCustomerField(row, ["phone", "mobile"]),
    company: pickCustomerField(row, ["company", "company_name"]),
    address: pickCustomerField(row, ["address"]) || joinAddressParts(row, ["city"]),
  };
}

export function mergeInvoiceParties(customers, contacts, fitnessClients) {
  const out = [];
  const seen = new Set();
  function add(item) {
    if (!item?.name && !item?.email && !item?.phone) return;
    if (item.key && seen.has(`key:${item.key}`)) return;
    if (item.key) seen.add(`key:${item.key}`);
    const email = String(item.email || "").toLowerCase();
    const stamp = email || `${String(item.name || "").toLowerCase()}|${String(item.phone || "")}`;
    if (stamp && seen.has(stamp)) return;
    if (stamp) seen.add(stamp);
    out.push(item);
  }
  (fitnessClients || []).forEach((c) => add(invoicePartyFromFitnessClient(c)));
  (customers || []).forEach((c) => add(invoicePartyFromCustomer(c)));
  (contacts || []).forEach((c) => add(invoicePartyFromContact(c)));
  out.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }));
  return out;
}

export function partySourceLabel(item) {
  if (item?.source === "fitness" || item?.fitnessClientId) return "Gym client";
  if (item?.customerId) return "Customer";
  return "Contact";
}

export function partyOptionLabel(item) {
  const name = String(item?.name || "").trim() || "Customer";
  const company = String(item?.company || "").trim();
  if (company && company.toLowerCase() !== name.toLowerCase()) return `${company} — ${name}`;
  return name;
}

export function partyMatchesQuery(item, q) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return true;
  return [item.name, item.company, item.email, item.phone, item.fitnessClientId]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}
