"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSearchParams } from "next/navigation";
import { apiFetch, getApiOrigin } from "@/lib/api";
import { useToast } from "@/components/Toast/ToastContext";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
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

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams();
      if (status) p.set("status", status);
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
      setLoading(false);
    }
  }, [priority, q, showToast, status]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setInterval(fetchItems, 20000);
    return () => clearInterval(timer);
  }, [isLoaded, fetchItems]);

  useEffect(() => {
    if (!isLoaded) {
      setLiveConnected(false);
      return;
    }
    let cancelled = false;
    const sockRef = { current: null };

    async function connectSocket() {
      if (!isSignedIn || cancelled) return;
      try {
        const { io } = await import("socket.io-client");
        const s = io(getApiOrigin(), {
          path: "/socket.io",
          auth: {},
          transports: ["websocket", "polling"],
          withCredentials: true,
          reconnection: true,
        });
        sockRef.current = s;
        s.on("connect", () => !cancelled && setLiveConnected(true));
        s.on("disconnect", () => !cancelled && setLiveConnected(false));
        s.on("connect_error", () => !cancelled && setLiveConnected(false));
        s.on("tickets:changed", () => !cancelled && fetchItems());
      } catch {
        if (!cancelled) setLiveConnected(false);
      }
    }

    connectSocket();
    return () => {
      cancelled = true;
      setLiveConnected(false);
      if (sockRef.current) {
        try {
          sockRef.current.removeAllListeners();
          sockRef.current.disconnect();
        } catch {
          /* ignore */
        }
      }
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
      if (colFilters.subject && !String(it.subject || "").toLowerCase().includes(colFilters.subject.toLowerCase())) return false;
      if (colFilters.description && !String(it.description || "").toLowerCase().includes(colFilters.description.toLowerCase())) return false;
      if (colFilters.status && it.status !== colFilters.status) return false;
      if (colFilters.priority && it.priority !== colFilters.priority) return false;
      if (colFilters.dueDate && String(it.due_at || "").slice(0, 10) !== colFilters.dueDate) return false;
      return true;
    });
  }, [items, colFilters]);

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

      <div className={styles.statusStrip}>
        <button
          type="button"
          className={`${styles.statusCard} ${!status ? styles.statusCardActive : ""}`}
          onClick={() => setStatus("")}
        >
          <span>All status</span>
          <strong>{statusCounts.all || 0}</strong>
        </button>
        {STATUS.map((s) => (
          <button
            key={s}
            type="button"
            className={`${styles.statusCard} ${status === s ? styles.statusCardActive : ""}`}
            onClick={() => setStatus((prev) => (prev === s ? "" : s))}
          >
            <span>{STATUS_LABEL[s]}</span>
            <strong>{statusCounts[s] || 0}</strong>
          </button>
        ))}
      </div>

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
