"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  getAllTransactions,
  createTransaction,
  deleteTransaction,
  getExternalStats,
  getExternalBuyers,
  searchExternalBuyers,
  searchClients,
} from "@/lib/fitnessApi";
import { connectGlobalSocket } from "@/lib/api";
import styles from "../business-tracker/business.module.css";

const PAY_MODES = ["GPay", "Cash", "Online Transfer", "Cheque", "UPI", "NEFT"];
const TX_TYPES = ["Membership", "Supplement", "Other"];

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function todayYmdLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ExternalSalesPage() {
  const [transactions, setTransactions] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [formError, setFormError] = useState({});

  const [buyerSearch, setBuyerSearch] = useState("");
  const [buyerResults, setBuyerResults] = useState([]);
  const [selectedBuyerId, setSelectedBuyerId] = useState(null);

  const [refSearch, setRefSearch] = useState("");
  const [refResults, setRefResults] = useState([]);

  const [form, setForm] = useState({
    buyer_name: "",
    buyer_phone: "",
    buyer_notes: "",
    transaction_date: todayYmdLocal(),
    product_plan: "",
    type: "Supplement",
    mrp_inr: "",
    rate_inr: "",
    received_inr: "",
    cost_inr: "",
    pay_mode: "GPay",
    notes: "",
    referred_by_client_id: "",
  });

  const buyerSearchTimeout = useRef(null);
  const refSearchTimeout = useRef(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tx, by, st] = await Promise.all([
        getAllTransactions({ scope: "external" }),
        getExternalBuyers({ limit: 200 }),
        getExternalStats(),
      ]);
      setTransactions(tx);
      setBuyers(by);
      setStats(st);
    } catch {
      setTransactions([]);
      setBuyers([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const cleanups = [];
    let cancelled = false;
    (async () => {
      try {
        const socket = await connectGlobalSocket();
        if (cancelled || !socket) return;
        const onFitness = () => loadAll();
        socket.on("fitness_changed", onFitness);
        cleanups.push(() => socket.off("fitness_changed", onFitness));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, [loadAll]);

  function handleBuyerLookup(value) {
    setBuyerSearch(value);
    setSelectedBuyerId(null);
    clearTimeout(buyerSearchTimeout.current);
    if (value.length < 2) {
      setBuyerResults([]);
      return;
    }
    buyerSearchTimeout.current = setTimeout(async () => {
      try {
        const rows = await searchExternalBuyers(value);
        setBuyerResults(rows);
      } catch {
        setBuyerResults([]);
      }
    }, 300);
  }

  function selectPriorBuyer(b) {
    setSelectedBuyerId(b.id);
    setForm((prev) => ({
      ...prev,
      buyer_name: b.full_name || "",
      buyer_phone: b.phone || "",
      referred_by_client_id: b.referred_by_client_id || "",
    }));
    setBuyerSearch(`${b.full_name}${b.phone ? ` · ${b.phone}` : ""}`);
    setBuyerResults([]);
  }

  function handleRefSearch(value) {
    setRefSearch(value);
    setForm((prev) => ({ ...prev, referred_by_client_id: "" }));
    clearTimeout(refSearchTimeout.current);
    if (value.length < 2) {
      setRefResults([]);
      return;
    }
    refSearchTimeout.current = setTimeout(async () => {
      try {
        const rows = await searchClients(value);
        setRefResults(rows);
      } catch {
        setRefResults([]);
      }
    }, 300);
  }

  function selectReferrer(c) {
    setForm((prev) => ({ ...prev, referred_by_client_id: c.client_id }));
    setRefSearch(`${c.full_name} (${c.client_id})`);
    setRefResults([]);
  }

  function validateForm() {
    const errors = {};
    if (!selectedBuyerId && !form.buyer_name?.trim()) errors.buyer_name = "Name required";
    if (!form.transaction_date) errors.transaction_date = "Date required";
    if (!form.product_plan?.trim()) errors.product_plan = "Product required";
    if (!form.type) errors.type = "Type required";
    if (form.rate_inr === "" || form.rate_inr == null) errors.rate_inr = "Rate required";
    if (form.received_inr === "" || form.received_inr == null) errors.received_inr = "Received required";
    return errors;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errors = validateForm();
    if (Object.keys(errors).length) {
      setFormError(errors);
      return;
    }

    const rate = parseFloat(form.rate_inr) || 0;
    const received = parseFloat(form.received_inr) || 0;
    const pending = Math.max(0, rate - received);

    const external_buyer = {
      full_name: form.buyer_name.trim(),
      phone: form.buyer_phone?.trim() || undefined,
      referred_by_client_id: form.referred_by_client_id?.trim() || undefined,
      notes: form.buyer_notes?.trim() || undefined,
    };

    if (selectedBuyerId) {
      external_buyer.phone = form.buyer_phone?.trim() || undefined;
    }

    setFormSaving(true);
    setSubmitError(null);
    try {
      const body = selectedBuyerId
        ? {
            external_buyer_id: selectedBuyerId,
            transaction_date: form.transaction_date,
            product_plan: form.product_plan.trim(),
            type: form.type,
            mrp_inr: form.mrp_inr === "" ? undefined : form.mrp_inr,
            rate_inr: form.rate_inr,
            received_inr: form.received_inr,
            pending_inr: pending,
            cost_inr: form.cost_inr === "" ? undefined : form.cost_inr,
            pay_mode: form.pay_mode,
            notes: form.notes || undefined,
          }
        : {
            external_buyer,
            transaction_date: form.transaction_date,
            product_plan: form.product_plan.trim(),
            type: form.type,
            mrp_inr: form.mrp_inr === "" ? undefined : form.mrp_inr,
            rate_inr: form.rate_inr,
            received_inr: form.received_inr,
            pending_inr: pending,
            cost_inr: form.cost_inr === "" ? undefined : form.cost_inr,
            pay_mode: form.pay_mode,
            notes: form.notes || undefined,
          };

      await createTransaction(body);
      setShowAdd(false);
      setForm({
        buyer_name: "",
        buyer_phone: "",
        buyer_notes: "",
        transaction_date: todayYmdLocal(),
        product_plan: "",
        type: "Supplement",
        mrp_inr: "",
        rate_inr: "",
        received_inr: "",
        cost_inr: "",
        pay_mode: "GPay",
        notes: "",
        referred_by_client_id: "",
      });
      setFormError({});
      setBuyerSearch("");
      setRefSearch("");
      setSelectedBuyerId(null);
      loadAll();
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setFormSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this walk-in transaction?")) return;
    try {
      await deleteTransaction(id);
      setTransactions((prev) => prev.filter((t) => t.id !== id));
      loadAll();
    } catch {
      loadAll();
    }
  }

  const profitPreview = (
    (parseFloat(form.received_inr) || 0) - (parseFloat(form.cost_inr) || 0)
  ).toFixed(2);
  const pendingPreview = Math.max(
    0,
    (parseFloat(form.rate_inr) || 0) - (parseFloat(form.received_inr) || 0)
  ).toFixed(2);

  return (
    <div className={styles.container}>
      {submitError && (
        <div className={styles.errorBanner} onClick={() => setSubmitError(null)}>
          <i className="fa-solid fa-circle-exclamation" /> {submitError}{" "}
          <span>(click to dismiss)</span>
        </div>
      )}

      <div className={styles.header}>
        <div>
          <h1>External / walk-in sales</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 15 }}>
            Supplement and other sales to non-clients. Same ledger as{" "}
            <Link href="/business-tracker">Business Tracker</Link> — revenue and charts include these
            rows automatically.
          </p>
        </div>
        <button className={styles.addBtn} type="button" onClick={() => setShowAdd(true)}>
          <i className="fa-solid fa-plus" /> Add walk-in transaction
        </button>
      </div>

      {stats && (
        <div className={styles.statsBar}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{stats.distinct_buyers ?? 0}</span>
            <span className={styles.statLabel}>Distinct buyers</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{stats.repeat_buyers ?? 0}</span>
            <span className={styles.statLabel}>Repeat buyers</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>₹{Number(stats.total_received || 0).toLocaleString()}</span>
            <span className={styles.statLabel}>Total received</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>₹{Number(stats.total_profit || 0).toLocaleString()}</span>
            <span className={styles.statLabel}>Total profit</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{stats.transaction_count ?? 0}</span>
            <span className={styles.statLabel}>Transactions</span>
          </div>
        </div>
      )}

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 20, marginBottom: 12, color: "#1e293b" }}>
          <i className="fa-solid fa-users" /> Buyers (visits &amp; lifetime)
        </h2>
        <div className={styles.tableWrap}>
          {loading ? (
            <div className={styles.empty}>
              <i className="fa-solid fa-spinner fa-spin" /> Loading…
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Visits</th>
                  <th>Received</th>
                  <th>Last visit</th>
                  <th>Referred by</th>
                </tr>
              </thead>
              <tbody>
                {buyers.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.full_name}</strong>
                    </td>
                    <td>{b.phone || "—"}</td>
                    <td>{b.visit_count ?? 0}</td>
                    <td>₹{Number(b.lifetime_received || 0).toLocaleString()}</td>
                    <td>{formatDate(b.last_visit)}</td>
                    <td>
                      {b.referred_by_client_id ? (
                        <Link href={`/clients/${b.referred_by_client_id}`} className={styles.clientLink}>
                          {b.referred_by_client_name
                            ? `${b.referred_by_client_name} (${b.referred_by_client_id})`
                            : b.referred_by_client_id}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && buyers.length === 0 && (
            <div className={styles.empty}>No external buyers yet — add a transaction below.</div>
          )}
        </div>
      </section>

      <h2 style={{ fontSize: 20, marginBottom: 12, color: "#1e293b" }}>
        <i className="fa-solid fa-receipt" /> Walk-in transactions
      </h2>
      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.empty}>
            <i className="fa-solid fa-spinner fa-spin" /> Loading…
          </div>
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Buyer</th>
                  <th>Phone</th>
                  <th>Visit</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th>Received</th>
                  <th>Profit</th>
                  <th>Mode</th>
                  <th>Referred by</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDate(t.transaction_date)}</td>
                    <td>{t.external_buyer_name || "—"}</td>
                    <td>{t.external_buyer_phone || "—"}</td>
                    <td>
                      {(() => {
                        const vi = t.visit_index != null ? Number(t.visit_index) : null;
                        if (vi == null || Number.isNaN(vi)) return "—";
                        if (vi > 1) return <span style={{ color: "#b45309", fontWeight: 700 }}>Repeat</span>;
                        return <span style={{ color: "#166534", fontWeight: 700 }}>First</span>;
                      })()}
                    </td>
                    <td>{t.product_plan}</td>
                    <td>
                      <span className={styles[`type_${t.type}`]}>{t.type}</span>
                    </td>
                    <td>₹{t.received_inr}</td>
                    <td className={Number(t.profit_inr) > 0 ? styles.profit : ""}>₹{t.profit_inr}</td>
                    <td>{t.pay_mode}</td>
                    <td>{t.referred_by_client_name || "—"}</td>
                    <td>
                      <button className={styles.delBtn} type="button" onClick={() => handleDelete(t.id)}>
                        <i className="fa-solid fa-trash" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {transactions.length === 0 && (
              <div className={styles.empty}>No walk-in transactions recorded yet.</div>
            )}
          </>
        )}
      </div>

      {showAdd && (
        <div className={styles.modal} onClick={() => setShowAdd(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2>Add walk-in transaction</h2>
            <p style={{ color: "#64748b", fontSize: 14, marginTop: 0 }}>
              Search a returning buyer by name or phone, or enter a new person. Phone is optional but
              helps match repeat visits.
            </p>
            <form onSubmit={handleSubmit}>
              <div className={styles.field}>
                <label>Returning buyer (optional)</label>
                <input
                  value={buyerSearch}
                  onChange={(e) => handleBuyerLookup(e.target.value)}
                  placeholder="Search saved buyers…"
                  autoComplete="off"
                />
                {buyerResults.length > 0 && (
                  <div className={styles.searchResults}>
                    {buyerResults.map((b) => (
                      <div
                        key={b.id}
                        className={styles.searchItem}
                        onClick={() => selectPriorBuyer(b)}
                      >
                        <strong>{b.full_name}</strong>{" "}
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>{b.phone || "no phone"}</span>
                      </div>
                    ))}
                  </div>
                )}
                {selectedBuyerId && (
                  <p style={{ fontSize: 13, color: "#059669", margin: "6px 0 0" }}>
                    Using saved buyer #{selectedBuyerId} — amounts apply to this profile.
                  </p>
                )}
              </div>

              {!selectedBuyerId && (
                <>
                  <div className={styles.field}>
                    {formError.buyer_name && (
                      <span className={styles.fieldError}>{formError.buyer_name}</span>
                    )}
                    <label>Buyer name *</label>
                    <input
                      value={form.buyer_name}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, buyer_name: e.target.value }))
                      }
                      placeholder="Walk-in name"
                    />
                  </div>
                  <div className={styles.field}>
                    <label>Phone (optional)</label>
                    <input
                      value={form.buyer_phone}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, buyer_phone: e.target.value }))
                      }
                      placeholder="Digits only recommended"
                    />
                  </div>
                  <div className={styles.field}>
                    <label>Referred by client (optional)</label>
                    <input
                      value={refSearch}
                      onChange={(e) => handleRefSearch(e.target.value)}
                      placeholder="Search your client who referred…"
                      autoComplete="off"
                    />
                    {refResults.length > 0 && (
                      <div className={styles.searchResults}>
                        {refResults.map((c) => (
                          <div
                            key={c.client_id}
                            className={styles.searchItem}
                            onClick={() => selectReferrer(c)}
                          >
                            <strong>{c.full_name}</strong> ({c.client_id})
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className={styles.field}>
                    <label>Buyer notes (optional)</label>
                    <textarea
                      value={form.buyer_notes}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, buyer_notes: e.target.value }))
                      }
                      placeholder="Stored on buyer profile"
                    />
                  </div>
                </>
              )}

              {selectedBuyerId && (
                <div className={styles.field}>
                  <label>Phone (optional override)</label>
                  <input
                    value={form.buyer_phone}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, buyer_phone: e.target.value }))
                    }
                  />
                </div>
              )}

              <div className={styles.field}>
                {formError.transaction_date && (
                  <span className={styles.fieldError}>{formError.transaction_date}</span>
                )}
                <label>Transaction date *</label>
                <input
                  type="date"
                  value={form.transaction_date}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, transaction_date: e.target.value }))
                  }
                />
              </div>
              <div className={styles.field}>
                {formError.product_plan && (
                  <span className={styles.fieldError}>{formError.product_plan}</span>
                )}
                <label>Product *</label>
                <input
                  value={form.product_plan}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, product_plan: e.target.value }))
                  }
                  placeholder="e.g. Whey protein 2kg"
                />
              </div>
              <div className={styles.field}>
                <label>Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
                >
                  {TX_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>MRP (₹)</label>
                  <input
                    type="number"
                    value={form.mrp_inr}
                    onChange={(e) => setForm((p) => ({ ...p, mrp_inr: e.target.value }))}
                  />
                </div>
                <div className={styles.field}>
                  <label>Rate (₹)</label>
                  <input
                    type="number"
                    value={form.rate_inr}
                    onChange={(e) => setForm((p) => ({ ...p, rate_inr: e.target.value }))}
                  />
                </div>
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>Received (₹)</label>
                  <input
                    type="number"
                    value={form.received_inr}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, received_inr: e.target.value }))
                    }
                  />
                </div>
                <div className={styles.field}>
                  <label>Cost (₹)</label>
                  <input
                    type="number"
                    value={form.cost_inr}
                    onChange={(e) => setForm((p) => ({ ...p, cost_inr: e.target.value }))}
                  />
                </div>
              </div>
              <div className={styles.field}>
                <label>Pay mode</label>
                <select
                  value={form.pay_mode}
                  onChange={(e) => setForm((p) => ({ ...p, pay_mode: e.target.value }))}
                >
                  {PAY_MODES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label>Transaction notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                />
              </div>
              <div className={styles.profitPreview}>
                <span>
                  Projected profit: <strong>₹{profitPreview}</strong>
                </span>
                <span style={{ marginLeft: "auto" }}>
                  Outstanding:{" "}
                  <strong
                    style={{
                      color: parseFloat(pendingPreview) > 0 ? "#b45309" : "#166534",
                    }}
                  >
                    ₹{pendingPreview}
                  </strong>
                </span>
              </div>
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => {
                    setShowAdd(false);
                    setFormError({});
                  }}
                >
                  Discard
                </button>
                <button type="submit" className={styles.submitBtn} disabled={formSaving}>
                  {formSaving ? "Saving…" : "Record"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
