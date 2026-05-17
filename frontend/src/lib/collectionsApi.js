import { apiFetch } from "@/lib/api";

async function parseJson(res) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.message || "Request failed");
  }
  return json;
}

export async function getCollections(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") q.set(k, String(v));
  });
  const qs = q.toString();
  const res = await apiFetch(`/collections${qs ? `?${qs}` : ""}`);
  const json = await parseJson(res);
  return { data: json.data || [], total: json.total ?? 0 };
}

export async function getCollectionSummary() {
  const res = await apiFetch("/collections/summary");
  const json = await parseJson(res);
  return json.data || {};
}

export async function getCollection(id) {
  const res = await apiFetch(`/collections/${id}`);
  const json = await parseJson(res);
  return json.data;
}

export async function createCollection(payload) {
  const res = await apiFetch("/collections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson(res);
  return json.data;
}

export async function updateCollection(id, payload) {
  const res = await apiFetch(`/collections/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson(res);
  return json.data;
}

export async function addCollectionPayment(id, payload) {
  const res = await apiFetch(`/collections/${id}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson(res);
  return json.data;
}

export async function markCollectionPaid(id, payload = {}) {
  const res = await apiFetch(`/collections/${id}/mark-paid`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson(res);
  return json.data;
}
