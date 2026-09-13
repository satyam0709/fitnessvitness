"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { openHtmlFromApi, openJsonUrlFromApi } from "@/lib/openPrintableHtml";
import { subscribeCrmLive } from "@/lib/chatRealtime";
import { useToast } from "@/components/Toast/ToastContext";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import styles from "../invoicePages.module.css";

const STATIC_STAGES = [
  { value: "Draft", label: "Draft" },
  { value: "Submitted", label: "Submitted" },
  { value: "On Hold", label: "On Hold" },
  { value: "Approved", label: "Approved" },
  { value: "Cancelled", label: "Cancelled" },
];

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return String(d);
  }
}

export default function QuotationListPage() {
  const { confirm } = useConfirmDialog();
  const { isLoaded } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [stage, setStage] = useState("all");
  const [staffId, setStaffId] = useState("all");
  const [q, setQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [users, setUsers] = useState([]);
  const [emailQuot, setEmailQuot] = useState(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  const fetchList = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ limit: "100", page: "1" });
      if (stage && stage !== "all") params.set("stage", stage);
      if (q.trim()) params.set("q", q.trim());
      const res = await apiFetch(`/v2/quotations?${params.toString()}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Failed to load quotations");
      let list = d.quotations || [];
      if (staffId && staffId !== "all") {
        list = list.filter((row) => String(row.created_by) === String(staffId));
      }
      setRows(list);
    } catch (e) {
      setErr(e.message || "Error");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, stage, q, staffId]);

  const loadUsers = useCallback(async () => {
    if (!isLoaded) return;
    try {
      const res = await apiFetch("/users");
      if (!res.ok) return;
      const d = await res.json();
      setUsers(Array.isArray(d.data) ? d.data : []);
    } catch {
      setUsers([]);
    }
  }, [isLoaded]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!isLoaded) return undefined;
    return subscribeCrmLive(["quotations:changed"], () => fetchList());
  }, [isLoaded, fetchList]);

  async function viewPdf(quot) {
    try {
      await openHtmlFromApi(`/v2/quotations/${quot.id}/pdf`);
    } catch (e) {
      setErr(e.message || "PDF failed");
    }
  }

  async function openWhatsapp(quot) {
    try {
      await openJsonUrlFromApi(`/v2/quotations/${quot.id}/whatsapp`);
    } catch (e) {
      setErr(e.message || "WhatsApp failed");
    }
  }

  async function copyQuotation(quot) {
    try {
      const res = await apiFetch(`/v2/quotations/${quot.id}/duplicate`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Duplicate failed");
      showToast(`Duplicated as ${d.quotation_no || d.id}`);
      if (d.id) router.push(`/invoice/quotation/${d.id}`);
      else fetchList();
    } catch (e) {
      setErr(e.message || "Duplicate failed");
    }
  }

  async function removeQuotation(quot) {
    const msg = buildDeleteMessage({ singular: "quotation", name: quot.quotation_no || quot.name });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    try {
      const res = await apiFetch(`/v2/quotations/${quot.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Delete failed");
      setRows((prev) => prev.filter((r) => r.id !== quot.id));
    } catch (e) {
      setErr(e.message || "Delete failed");
    }
  }

  async function submitEmail(e) {
    e.preventDefault();
    if (!emailQuot) return;
    setEmailBusy(true);
    try {
      const res = await apiFetch(`/v2/quotations/${emailQuot.id}/email`, {
        method: "POST",
        body: JSON.stringify({ to: emailTo }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Email failed");
      setEmailQuot(null);
      showToast("Quotation emailed");
    } catch (ex) {
      setErr(ex.message || "Email failed");
    } finally {
      setEmailBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Quotations</h1>
          <p className={styles.sub}>Create, email, duplicate, and print quotations. Updates live.</p>
        </div>
      </div>
      <form
        className={styles.filters}
        onSubmit={(e) => {
          e.preventDefault();
          setQ(searchInput);
        }}
      >
        <select className={styles.select} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          <option value="all">All Staff</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name || [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
            </option>
          ))}
        </select>
        <select className={styles.select} value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="all">All Stages</option>
          {STATIC_STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          className={`${styles.input} ${styles.inputSearch}`}
          placeholder="Search quotation #, name…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button type="submit" className={styles.iconBtn} aria-label="Search">
          <i className="fas fa-search" />
        </button>
      </form>
      <div className={styles.midBar}>
        <Link href="/invoice/quotation/new" className={styles.btnPrimary}>
          Create Quotation
        </Link>
      </div>
      {err ? <p className={styles.err}>{err}</p> : null}
      {loading ? (
        <p className={styles.sub}>Loading…</p>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>There are no records to display.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>No.</th>
                <th>Actions</th>
                <th>Quotation No.</th>
                <th>Company</th>
                <th>Customer</th>
                <th>Mobile</th>
                <th>Date</th>
                <th>GST</th>
                <th>Created By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((quot, idx) => (
                <tr key={quot.id}>
                  <td>{idx + 1}</td>
                  <td>
                    <div className={styles.actionIcons}>
                      <button type="button" className={styles.actBtn} title="View" onClick={() => viewPdf(quot)}>
                        <i className="fas fa-eye" />
                      </button>
                      <Link href={`/invoice/sales/new?quotation_id=${quot.id}`} className={styles.actBtn} title="Convert to invoice">
                        <i className="fas fa-sync-alt" />
                      </Link>
                      <Link href={`/invoice/quotation/${quot.id}`} className={styles.actBtn} title="Edit">
                        <i className="fas fa-pencil-alt" />
                      </Link>
                      <button type="button" className={styles.actBtn} title="PDF" onClick={() => viewPdf(quot)}>
                        <i className="fas fa-file-pdf" />
                      </button>
                      <button type="button" className={styles.actBtn} title="Email" onClick={() => { setEmailQuot(quot); setEmailTo(quot.customer_email || ""); }}>
                        <i className="fas fa-envelope" />
                      </button>
                      <button type="button" className={`${styles.actBtn} ${styles.actWa}`} title="WhatsApp" onClick={() => openWhatsapp(quot)}>
                        <i className="fab fa-whatsapp" />
                      </button>
                      <button type="button" className={styles.actBtn} title="Copy" onClick={() => copyQuotation(quot)}>
                        <i className="fas fa-copy" />
                      </button>
                      <button type="button" className={`${styles.actBtn} ${styles.actDanger}`} title="Delete" onClick={() => removeQuotation(quot)}>
                        <i className="fas fa-trash" />
                      </button>
                    </div>
                  </td>
                  <td>
                    <Link href={`/invoice/quotation/${quot.id}`} className={styles.invoiceNumLink}>
                      {quot.quotation_no || `#${quot.id}`}
                    </Link>
                  </td>
                  <td>{quot.company_name || "—"}</td>
                  <td>{quot.name || "—"}</td>
                  <td>{quot.customer_phone || "—"}</td>
                  <td>{fmtDate(quot.quotation_date)}</td>
                  <td>{quot.gst_type || "—"}</td>
                  <td>{quot.creator_name?.trim() || quot.creator_email || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {emailQuot ? (
        <div className={styles.modalOverlay} role="dialog">
          <div className={styles.payModal}>
            <div className={styles.payModalHead}>
              <h2>Email quotation</h2>
              <button type="button" className={styles.payClose} onClick={() => setEmailQuot(null)}>
                ×
              </button>
            </div>
            <form onSubmit={submitEmail} className={styles.payModalBody}>
              <label className={styles.label}>To</label>
              <input
                type="email"
                className={styles.input}
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                required
              />
              <div className={styles.payActions}>
                <button type="submit" className={styles.btnPrimary} disabled={emailBusy}>
                  {emailBusy ? "Sending…" : "Send"}
                </button>
                <button type="button" className={styles.btnGhost} onClick={() => setEmailQuot(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
