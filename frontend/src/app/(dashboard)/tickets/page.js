"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { getChatSocket, subscribeCrmLive } from "@/lib/chatRealtime";
import { useToast } from "@/components/Toast/ToastContext";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import { CrmFilterStrip } from "@/components/UI/CrmFilterStrip";
import styles from "./ticketsPage.module.css";

const STATUS = ["open", "in_progress", "resolved", "closed", "reopened"];
const PRIORITY = ["low", "medium", "high", "urgent"];
const STATUS_LABEL = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
  reopened: "Reopened",
};
const PRIORITY_LABEL = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};
const STATUS_COLOR = {
  open: "#0ea5e9",
  in_progress: "#f59e0b",
  resolved: "#16a34a",
  closed: "#64748b",
  reopened: "#9333ea",
};

async function ticketsRequest(suffix = "", options = {}) {
  const cleanSuffix = suffix.startsWith("/") || suffix.startsWith("?") ? suffix : `/${suffix}`;
  const paths = [`/tickets${cleanSuffix}`, `/crm/tickets${cleanSuffix}`];
  let lastRes = null;
  let lastErr = null;

  for (const p of paths) {
    try {
      const res = await apiFetch(p, options);
      lastRes = res;
      if (res.status !== 404) return res;
    } catch (e) {
      lastErr = e;
    }
  }

  if (lastErr && !lastRes) throw lastErr;
  return lastRes;
}

export default function TicketsPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const searchParams = useSearchParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liveConnected, setLiveConnected] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(searchParams.get("status") || "");
  const [priority, setPriority] = useState("");
  const [q, setQ] = useState("");
  const [colFilters, setColFilters] = useState({
    subject: "",
    description: "",
    status: "",
    priority: "",
    dueDate: "",
  });
  const [form, setForm] = useState({
    subject: "",
    description: "",
    status: "open",
    priority: "medium",
    due_at: "",
  });

  const fetchItems = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams();
      if (priority) p.set("priority", priority);
      if (q.trim()) p.set("q", q.trim());
      const res = await ticketsRequest(`?${p.toString()}`);
      if (!res) {
        setItems([]);
        setError("Ticket service is temporarily unavailable");
        showToast("Ticket service is temporarily unavailable", "error");
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to load tickets");
      }
      setItems(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      setItems([]);
      setError(e.message || "Failed to load tickets");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [priority, q, showToast]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setLiveConnected(false);
      return undefined;
    }
    let cancelled = false;
    let sock = null;
    const onConnect = () => {
      if (!cancelled) setLiveConnected(true);
    };
    const onDisconnect = () => {
      if (!cancelled) setLiveConnected(false);
    };
    const unsub = subscribeCrmLive(["tickets:changed"], () => {
      if (!cancelled) fetchItems({ silent: true });
    });
    getChatSocket().then((s) => {
      if (cancelled || !s) return;
      sock = s;
      setLiveConnected(Boolean(s.connected));
      s.on("connect", onConnect);
      s.on("disconnect", onDisconnect);
    });
    return () => {
      cancelled = true;
      unsub();
      if (sock) {
        sock.off("connect", onConnect);
        sock.off("disconnect", onDisconnect);
      }
      setLiveConnected(false);
    };
  }, [isLoaded, isSignedIn, fetchItems]);

  const statusCounts = useMemo(() => {
    const out = { all: items.length };
    STATUS.forEach((s) => {
      out[s] = 0;
    });
    items.forEach((it) => {
      if (out[it.status] != null) out[it.status] += 1;
    });
    return out;
  }, [items]);

  const filteredRows = useMemo(() => {
    return items.filter((it) => {
      if (status && it.status !== status) return false;
      if (colFilters.subject && !String(it.subject || "").toLowerCase().includes(colFilters.subject.toLowerCase())) return false;
      if (colFilters.description && !String(it.description || "").toLowerCase().includes(colFilters.description.toLowerCase())) return false;
      if (colFilters.status && it.status !== colFilters.status) return false;
      if (colFilters.priority && it.priority !== colFilters.priority) return false;
      if (colFilters.dueDate && String(it.due_at || "").slice(0, 10) !== colFilters.dueDate) return false;
      return true;
    });
  }, [items, colFilters, status]);

  async function createTicket(e) {
    e.preventDefault();
    if (!form.subject.trim()) {
      showToast("Ticket subject is required", "error");
      return;
    }
    try {
      const res = await ticketsRequest("", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          subject: form.subject.trim(),
          due_at: form.due_at || null,
        }),
      });
      if (!res) {
        showToast("Ticket service is temporarily unavailable", "error");
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Could not create ticket", "error");
        return;
      }
      setForm({ subject: "", description: "", status: "open", priority: "medium", due_at: "" });
      showToast("Ticket created");
      fetchItems();
    } catch {
      showToast("Could not create ticket", "error");
    }
  }

  async function updateStatus(id, nextStatus) {
    try {
      const res = await ticketsRequest(`/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res) {
        showToast("Ticket service is temporarily unavailable", "error");
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Could not update ticket status", "error");
        return;
      }
      showToast("Ticket status updated");
      fetchItems();
    } catch {
      showToast("Could not update ticket status", "error");
    }
  }

  async function remove(item) {
    const msg = buildDeleteMessage({
      singular: "ticket",
      name: item?.subject?.trim() || null,
    });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    try {
      const res = await ticketsRequest(`/${item.id}`, { method: "DELETE" });
      if (!res) {
        showToast("Ticket service is temporarily unavailable", "error");
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Could not delete ticket", "error");
        return;
      }
      showToast("Ticket deleted");
      fetchItems();
    } catch {
      showToast("Could not delete ticket", "error");
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <h1 className={styles.title}>Tickets</h1>
        <span className={styles.liveMeta}>
          <span className={`${styles.liveDot} ${liveConnected ? "" : styles.liveDotOff}`} />
          {liveConnected ? "Live" : "Offline"}
        </span>
      </div>

      <CrmFilterStrip
        ariaLabel="Filter by status"
        activeKey={status || ""}
        items={[
          { key: "", label: "All Tickets", count: statusCounts.all || 0, color: "#64748b" },
          ...STATUS.map((s) => ({
            key: s,
            label: STATUS_LABEL[s],
            count: statusCounts[s] || 0,
            color: STATUS_COLOR[s],
          })),
        ]}
        onSelect={(key) => setStatus((prev) => (prev === key ? "" : key))}
      />

      <div className={styles.toolbar}>
        <select className={styles.input} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Status</option>
          {STATUS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select className={styles.input} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">All Priority</option>
          {PRIORITY.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject/description" />
        <button type="button" className={styles.btnGhost} onClick={fetchItems}>
          Search
        </button>
        <button
          type="button"
          className={styles.btnGhost}
          onClick={() => {
            setStatus("");
            setPriority("");
            setQ("");
          }}
        >
          Clear
        </button>
      </div>

      <form className={styles.createRow} onSubmit={createTicket}>
        <input
          className={styles.input}
          required
          placeholder="Ticket subject"
          value={form.subject}
          onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
        />
        <input
          className={styles.input}
          placeholder="Description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
        <select className={styles.input} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
          {STATUS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select className={styles.input} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
          {PRIORITY.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        <input className={styles.input} type="datetime-local" value={form.due_at} onChange={(e) => setForm((f) => ({ ...f, due_at: e.target.value }))} />
        <button type="submit" className={styles.btnPrimary}>Add</button>
      </form>

      {error ? (
        <div className={styles.errorBox}>
          <div>{error}</div>
          <button type="button" className={styles.btnGhost} onClick={fetchItems}>
            Try again
          </button>
        </div>
      ) : null}

      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.empty}>Loading tickets...</div>
        ) : filteredRows.length === 0 ? (
          <div className={styles.empty}>No tickets found.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Description</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Due At</th>
                <th>Assigned</th>
                <th />
              </tr>
              <tr className={styles.filterRow}>
                <th>
                  <input
                    className={styles.filterInput}
                    value={colFilters.subject}
                    onChange={(e) => setColFilters((p) => ({ ...p, subject: e.target.value }))}
                    placeholder="Search"
                  />
                </th>
                <th>
                  <input
                    className={styles.filterInput}
                    value={colFilters.description}
                    onChange={(e) => setColFilters((p) => ({ ...p, description: e.target.value }))}
                    placeholder="Search"
                  />
                </th>
                <th>
                  <select
                    className={styles.filterInput}
                    value={colFilters.status}
                    onChange={(e) => setColFilters((p) => ({ ...p, status: e.target.value }))}
                  >
                    <option value="">All</option>
                    {STATUS.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </th>
                <th>
                  <select
                    className={styles.filterInput}
                    value={colFilters.priority}
                    onChange={(e) => setColFilters((p) => ({ ...p, priority: e.target.value }))}
                  >
                    <option value="">All</option>
                    {PRIORITY.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </th>
                <th>
                  <input
                    type="date"
                    className={styles.filterInput}
                    value={colFilters.dueDate}
                    onChange={(e) => setColFilters((p) => ({ ...p, dueDate: e.target.value }))}
                  />
                </th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((it) => (
                <tr key={it.id}>
                  <td>{it.subject}</td>
                  <td className={styles.descCell}>{it.description || "-"}</td>
                  <td>
                    <select className={styles.statusSelect} value={it.status} onChange={(e) => updateStatus(it.id, e.target.value)}>
                      {STATUS.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{PRIORITY_LABEL[it.priority] || it.priority || "-"}</td>
                  <td>{it.due_at ? new Date(it.due_at).toLocaleString("en-IN") : "-"}</td>
                  <td>{it.assigned_email || "-"}</td>
                  <td>
                    <button type="button" className={styles.iconBtn} onClick={() => remove(it)} title="Delete">
                      <i className="fas fa-trash" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
