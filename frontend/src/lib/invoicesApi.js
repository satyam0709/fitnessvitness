import { apiFetch } from "@/lib/api";

async function parseJson(res) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.message || "Request failed");
  }
  return json;
}

export async function fetchCompanySettings() {
  const res = await apiFetch("/v2/settings/company");
  const json = await parseJson(res);
  return {
    company: json.data || null,
    invoiceSettingsComplete: !!json.invoiceSettingsComplete,
  };
}

export async function fetchCustomers(limit = 200) {
  const res = await apiFetch(`/v2/customers?limit=${limit}`);
  const json = await parseJson(res);
  return json.customers || [];
}

export async function fetchInvoices(params = {}) {
  const q = new URLSearchParams({ type: "sales", limit: "100", page: "1", ...params });
  const res = await apiFetch(`/v2/invoices?${q.toString()}`);
  const json = await parseJson(res);
  return { invoices: json.invoices || [], total: json.total ?? 0 };
}

export async function createInvoice(payload) {
  const res = await apiFetch("/v2/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson(res);
  return json;
}

export async function updateInvoice(id, payload) {
  const res = await apiFetch(`/v2/invoices/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson(res);
  return json;
}

export async function fetchInvoiceReceipt(id) {
  const res = await apiFetch(`/v2/invoices/${encodeURIComponent(id)}/receipt`);
  const json = await parseJson(res);
  return {
    invoice: json.invoice,
    company: json.company,
  };
}

export async function fetchInvoice(id) {
  const res = await apiFetch(`/v2/invoices/${encodeURIComponent(id)}`);
  const json = await parseJson(res);
  return json.invoice;
}

export async function deleteInvoice(id) {
  const res = await apiFetch(`/v2/invoices/${id}`, { method: "DELETE" });
  return parseJson(res);
}

export async function fetchInvoicePayments(id) {
  const res = await apiFetch(`/v2/invoices/${encodeURIComponent(id)}/payments`);
  return parseJson(res);
}

export async function createInvoicePayment(id, payload) {
  const res = await apiFetch(`/v2/invoices/${encodeURIComponent(id)}/payments`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

export async function patchInvoicePayment(id, paymentId, payload) {
  const res = await apiFetch(
    `/v2/invoices/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
  return parseJson(res);
}

export async function markInvoicePaid(id, payload = {}) {
  const res = await apiFetch(`/v2/invoices/${encodeURIComponent(id)}/mark-paid`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

export async function duplicateInvoice(id) {
  const res = await apiFetch(`/v2/invoices/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
  return parseJson(res);
}

export async function emailInvoice(id, to) {
  const res = await apiFetch(`/v2/invoices/${encodeURIComponent(id)}/email`, {
    method: "POST",
    body: JSON.stringify({ to }),
  });
  return parseJson(res);
}

export async function fetchInvoiceWhatsapp(id) {
  const res = await apiFetch(`/v2/invoices/${encodeURIComponent(id)}/whatsapp`);
  return parseJson(res);
}

export async function createPaymentReminder(id, payload = {}) {
  const res = await apiFetch(`/v2/invoices/${encodeURIComponent(id)}/payment-reminder`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}
