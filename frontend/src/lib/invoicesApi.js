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
