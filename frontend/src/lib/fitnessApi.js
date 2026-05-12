/**
 * Fitness CRM API Helper
 * All fitness endpoints go through here. Handles fetch errors, JSON parsing,
 * and consistent error objects. Never use raw fetch in page components.
 */

import { apiFetch } from "./api";

// ─────────────────────────────────────────────────────────────────
// ERROR CLASS
// ─────────────────────────────────────────────────────────────────
export class FitnessApiError extends Error {
  constructor(message, status = 500, data = null) {
    super(message);
    this.name = "FitnessApiError";
    this.status = status;
    this.data = data;
  }
}

async function handleResponse(res) {
  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const json = await res.json();
      message = json.message || message;
    } catch {
      // ignore parse failure
    }
    throw new FitnessApiError(message, res.status);
  }

  const json = await res.json();
  if (!json.success) {
    throw new FitnessApiError(json.message || "Request failed", res.status, json);
  }
  return json.data;
}

function getParams(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      params.append(key, value);
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// ─────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────
export async function getFitnessSettings() {
  const res = await apiFetch("/fitness/settings");
  return handleResponse(res);
}

export async function updateFitnessSetting(key, value) {
  const res = await apiFetch("/fitness/settings", {
    method: "PUT",
    body: JSON.stringify({ key, value }),
  });
  return handleResponse(res);
}

export async function updateFitnessSettings(settings) {
  // Accept full settings object to update multiple at once
  const res = await apiFetch("/fitness/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
  return handleResponse(res);
}

// ─────────────────────────────────────────────────────────────────
// CLIENTS
// ─────────────────────────────────────────────────────────────────
export async function getAllClients(filters = {}) {
  const res = await apiFetch(`/fitness/clients${getParams(filters)}`);
  return handleResponse(res);
}

export async function searchClients(query) {
  if (!query || query.length < 1) return [];
  const res = await apiFetch(`/fitness/clients/search?q=${encodeURIComponent(query)}`);
  return handleResponse(res);
}

export async function getClient(clientId) {
  const res = await apiFetch(`/fitness/clients/${encodeURIComponent(clientId)}`);
  return handleResponse(res);
}

export async function getClientSummary(clientId) {
  const res = await apiFetch(`/fitness/clients/${encodeURIComponent(clientId)}/summary`);
  return handleResponse(res);
}

export async function createClient(data) {
  const res = await apiFetch("/fitness/clients", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateClient(clientId, data) {
  const res = await apiFetch(`/fitness/clients/${encodeURIComponent(clientId)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function deleteClient(clientId) {
  const res = await apiFetch(`/fitness/clients/${encodeURIComponent(clientId)}`, {
    method: "DELETE",
  });
  return handleResponse(res);
}

// ─────────────────────────────────────────────────────────────────
// CONSULTATIONS
// ─────────────────────────────────────────────────────────────────
export async function getConsultations(clientId) {
  const res = await apiFetch(`/fitness/clients/${encodeURIComponent(clientId)}/consultations`);
  return handleResponse(res);
}

export async function createConsultation(clientId, data) {
  const res = await apiFetch(`/fitness/clients/${encodeURIComponent(clientId)}/consultations`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateConsultation(id, data) {
  const res = await apiFetch(`/fitness/consultations/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function deleteConsultation(id) {
  const res = await apiFetch(`/fitness/consultations/${id}`, {
    method: "DELETE",
  });
  return handleResponse(res);
}

// ─────────────────────────────────────────────────────────────────
// BODY STATS
// ─────────────────────────────────────────────────────────────────
export async function getBodyStats(clientId) {
  const res = await apiFetch(`/fitness/clients/${encodeURIComponent(clientId)}/body-stats`);
  return handleResponse(res);
}

export async function createBodyStat(clientId, data) {
  const res = await apiFetch(`/fitness/clients/${encodeURIComponent(clientId)}/body-stats`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function deleteBodyStat(id) {
  const res = await apiFetch(`/fitness/body-stats/${id}`, {
    method: "DELETE",
  });
  return handleResponse(res);
}

// ─────────────────────────────────────────────────────────────────
// SUPPLEMENTS
// ─────────────────────────────────────────────────────────────────
export async function getSupplements(clientId) {
  const res = await apiFetch(`/fitness/clients/${encodeURIComponent(clientId)}/supplements`);
  return handleResponse(res);
}

export async function createSupplement(clientId, data) {
  const res = await apiFetch(`/fitness/clients/${encodeURIComponent(clientId)}/supplements`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateSupplement(id, data) {
  const res = await apiFetch(`/fitness/supplements/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function deleteSupplement(id) {
  const res = await apiFetch(`/fitness/supplements/${id}`, {
    method: "DELETE",
  });
  return handleResponse(res);
}

// ─────────────────────────────────────────────────────────────────
// TRANSACTIONS
// ─────────────────────────────────────────────────────────────────
export async function getAllTransactions(filters = {}) {
  const res = await apiFetch(`/fitness/transactions${getParams(filters)}`);
  return handleResponse(res);
}

export async function getClientTransactions(clientId) {
  const res = await apiFetch(`/fitness/clients/${encodeURIComponent(clientId)}/transactions`);
  return handleResponse(res);
}

export async function createTransaction(data) {
  const res = await apiFetch("/fitness/transactions", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateTransaction(id, data) {
  const res = await apiFetch(`/fitness/transactions/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function deleteTransaction(id) {
  const res = await apiFetch(`/fitness/transactions/${id}`, {
    method: "DELETE",
  });
  return handleResponse(res);
}

export async function getTransactionSummaryMonthly() {
  const res = await apiFetch("/fitness/transactions/summary/monthly");
  return handleResponse(res);
}

export async function getTransactionSummaryYearly() {
  const res = await apiFetch("/fitness/transactions/summary/yearly");
  return handleResponse(res);
}

// ─────────────────────────────────────────────────────────────────
// REFERRALS
// ─────────────────────────────────────────────────────────────────
export async function getAllReferrals() {
  const res = await apiFetch("/fitness/referrals");
  return handleResponse(res);
}

export async function getClientReferrals(clientId) {
  const res = await apiFetch(`/fitness/clients/${encodeURIComponent(clientId)}/referrals`);
  return handleResponse(res);
}

export async function createReferral(data) {
  const res = await apiFetch("/fitness/referrals", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function deleteReferral(id) {
  const res = await apiFetch(`/fitness/referrals/${id}`, {
    method: "DELETE",
  });
  return handleResponse(res);
}

// ─────────────────────────────────────────────────────────────────
// CLIENT TASKS
// ─────────────────────────────────────────────────────────────────
export async function getClientTasks(clientId) {
  const res = await apiFetch(`/fitness/clients/${encodeURIComponent(clientId)}/tasks`);
  return handleResponse(res);
}

export async function createClientTask(clientId, data) {
  const res = await apiFetch(`/fitness/clients/${encodeURIComponent(clientId)}/tasks`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateClientTask(id, data) {
  const res = await apiFetch(`/fitness/client-tasks/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function patchClientTaskStatus(id, data) {
  const res = await apiFetch(`/fitness/client-tasks/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function deleteClientTask(id) {
  const res = await apiFetch(`/fitness/client-tasks/${id}`, {
    method: "DELETE",
  });
  return handleResponse(res);
}

// ─────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────
export async function getDashboardStats() {
  const res = await apiFetch("/fitness/dashboard/stats");
  return handleResponse(res);
}

// ─────────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────────
export async function getAnalyticsSources() {
  const res = await apiFetch("/fitness/analytics/sources");
  return handleResponse(res);
}

export async function getAnalyticsTiers() {
  const res = await apiFetch("/fitness/analytics/tiers");
  return handleResponse(res);
}

export async function getAnalyticsReferrers() {
  const res = await apiFetch("/fitness/analytics/referrers");
  return handleResponse(res);
}

export async function getAnalyticsFinancial() {
  const res = await apiFetch("/fitness/analytics/financial");
  return handleResponse(res);
}

export async function getAllAnalytics() {
  const [sources, tiers, referrers, financial] = await Promise.all([
    getAnalyticsSources(),
    getAnalyticsTiers(),
    getAnalyticsReferrers(),
    getAnalyticsFinancial(),
  ]);
  return { sources, tiers, referrers, financial };
}