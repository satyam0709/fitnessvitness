"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getFitnessSettings, updateFitnessSettings } from "@/lib/fitnessApi";

export default function FitnessSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [settings, setSettings] = useState(null);
  const [activeTab, setActiveTab] = useState("plans");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getFitnessSettings();
      setSettings(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function handleSave(key, value) {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const updated = { ...settings, [key]: value };
      await updateFitnessSettings(updated);
      setSettings(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function parseList(value, isJson = false) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (isJson && typeof value === "string") {
      try { return JSON.parse(value); }
      catch { return []; }
    }
    return [];
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>
        <i className="fas fa-spinner fa-spin" style={{ fontSize: 24 }}></i>
        <p>Loading settings...</p>
      </div>
    );
  }

  const tabs = [
    { id: "plans", label: "Membership Plans", key: "plan_types" },
    { id: "progress", label: "Progress Options", key: "progress_options" },
    { id: "status", label: "Status Options", key: "status_options" },
    { id: "source", label: "Source Options", key: "source_options" },
    { id: "consult", label: "Consultation Types", key: "consult_type_options" },
    { id: "task", label: "Task Status", key: "task_status_options" },
    { id: "priority", label: "Priority Options", key: "priority_options" },
    { id: "paymode", label: "Payment Modes", key: "pay_mode_options" },
    { id: "transaction", label: "Transaction Types", key: "transaction_type_options" },
  ];

  const currentTab = tabs.find(t => t.id === activeTab) || tabs[0];
  const currentValue = settings?.[currentTab.key] || [];

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <Link href="/settings" style={{ color: "#6b7280", textDecoration: "none", fontSize: 14 }}>
          <i className="fas fa-arrow-left"></i> Back to Settings
        </Link>
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 600, color: "#1f2937", marginBottom: 8 }}>
        <i className="fas fa-heart-pulse" style={{ color: "#10b981", marginRight: 8 }}></i>
        Fitness Settings
      </h1>
      <p style={{ color: "#6b7280", marginBottom: 24 }}>
        Configure options and lists used throughout the Fitness CRM.
      </p>

      {error && (
        <div style={{ background: "#fee2e2", color: "#dc2626", padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: "#dcfce7", color: "#16a34a", padding: 12, borderRadius: 8, marginBottom: 16 }}>
          Settings saved successfully!
        </div>
      )}

      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid #e5e7eb", marginBottom: 24, overflowX: "auto" }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "12px 16px",
              background: "none",
              border: "none",
              borderBottom: activeTab === tab.id ? "2px solid #10b981" : "2px solid transparent",
              color: activeTab === tab.id ? "#10b981" : "#6b7280",
              fontWeight: 500,
              fontSize: 14,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ background: "white", borderRadius: 12, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "#1f2937", marginBottom: 16 }}>
          {currentTab.label}
        </h2>

        {activeTab === "plans" ? (
          <PlanTypesEditor
            value={parseList(currentValue)}
            onSave={(v) => handleSave(currentTab.key, v)}
            saving={saving}
          />
        ) : (
          <ListEditor
            value={parseList(currentValue)}
            onSave={(v) => handleSave(currentTab.key, v)}
            saving={saving}
          />
        )}
      </div>
    </div>
  );
}

function ListEditor({ value, onSave, saving }) {
  const [items, setItems] = useState(value);
  const [newItem, setNewItem] = useState("");
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    setItems(value);
  }, [value]);

  function addItem() {
    if (!newItem.trim()) return;
    const updated = [...items, newItem.trim()];
    setItems(updated);
    setNewItem("");
    onSave(updated);
  }

  function deleteItem(idx) {
    const updated = items.filter((_, i) => i !== idx);
    setItems(updated);
    onSave(updated);
  }

  function startEdit(idx, val) {
    setEditing(idx);
    setEditValue(val);
  }

  function saveEdit(idx) {
    const updated = [...items];
    updated[idx] = editValue.trim();
    setItems(updated);
    setEditing(null);
    setEditValue("");
    onSave(updated);
  }

  function moveItem(idx, dir) {
    if (dir === -1 && idx === 0) return;
    if (dir === 1 && idx === items.length - 1) return;
    const updated = [...items];
    [updated[idx], updated[idx + dir]] = [updated[idx + dir], updated[idx]];
    setItems(updated);
    onSave(updated);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="Add new option..."
          style={{ flex: 1, padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 14 }}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
        />
        <button
          onClick={addItem}
          disabled={saving || !newItem.trim()}
          style={{ padding: "8px 16px", background: "#10b981", color: "white", border: "none", borderRadius: 6, fontWeight: 500, cursor: saving ? "not-allowed" : "pointer" }}
        >
          Add
        </button>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map((item, idx) => (
          <li key={idx} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
            <button onClick={() => moveItem(idx, -1)} disabled={idx === 0} style={{ background: "none", border: "none", cursor: idx === 0 ? "not-allowed" : "pointer", color: "#9ca3af" }}>
              <i className="fas fa-arrow-up"></i>
            </button>
            <button onClick={() => moveItem(idx, 1)} disabled={idx === items.length - 1} style={{ background: "none", border: "none", cursor: idx === items.length - 1 ? "not-allowed" : "pointer", color: "#9ca3af" }}>
              <i className="fas fa-arrow-down"></i>
            </button>

            {editing === idx ? (
              <>
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  style={{ flex: 1, padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 14 }}
                  onKeyDown={(e) => e.key === "Enter" && saveEdit(idx)}
                />
                <button onClick={() => saveEdit(idx)} style={{ background: "#10b981", color: "white", border: "none", borderRadius: 4, padding: "4px 8px", fontSize: 12 }}>Save</button>
                <button onClick={() => setEditing(null)} style={{ background: "#e5e7eb", color: "#6b7280", border: "none", borderRadius: 4, padding: "4px 8px", fontSize: 12 }}>Cancel</button>
              </>
            ) : (
              <>
                <span style={{ flex: 1, fontSize: 14, color: "#374151" }}>{item}</span>
                <button onClick={() => startEdit(idx, item)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", padding: 4 }}>
                  <i className="fas fa-edit"></i>
                </button>
                <button onClick={() => deleteItem(idx)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", padding: 4 }}>
                  <i className="fas fa-trash"></i>
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {items.length === 0 && (
        <p style={{ textAlign: "center", color: "#9ca3af", padding: 24 }}>No options defined yet.</p>
      )}
    </div>
  );
}

function PlanTypesEditor({ value, onSave, saving }) {
  const [items, setItems] = useState(value);

  useEffect(() => {
    setItems(value);
  }, [value]);

  function updateItem(idx, field, fieldValue) {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: fieldValue };
    setItems(updated);
  }

  function saveItem(idx) {
    onSave(items);
  }

  function addItem() {
    const updated = [...items, { type: "New Plan", duration_days: 30 }];
    setItems(updated);
    onSave(updated);
  }

  function deleteItem(idx) {
    const updated = items.filter((_, i) => i !== idx);
    setItems(updated);
    onSave(updated);
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <button
          onClick={addItem}
          disabled={saving}
          style={{ padding: "8px 16px", background: "#10b981", color: "white", border: "none", borderRadius: 6, fontWeight: 500, cursor: saving ? "not-allowed" : "pointer" }}
        >
          <i className="fas fa-plus"></i> Add Plan
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
            <th style={{ textAlign: "left", padding: 12, fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Plan Name</th>
            <th style={{ textAlign: "left", padding: 12, fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Duration (Days)</th>
            <th style={{ width: 100 }}></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ padding: 8 }}>
                <input
                  type="text"
                  value={item.type || ""}
                  onChange={(e) => updateItem(idx, "type", e.target.value)}
                  onBlur={() => saveItem(idx)}
                  style={{ width: "100%", padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 14 }}
                />
              </td>
              <td style={{ padding: 8 }}>
                <input
                  type="number"
                  value={item.duration_days || 0}
                  onChange={(e) => updateItem(idx, "duration_days", parseInt(e.target.value) || 0)}
                  onBlur={() => saveItem(idx)}
                  style={{ width: "100px", padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 14 }}
                />
              </td>
              <td style={{ padding: 8, textAlign: "right" }}>
                <button onClick={() => deleteItem(idx)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer" }}>
                  <i className="fas fa-trash"></i>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {items.length === 0 && (
        <p style={{ textAlign: "center", color: "#9ca3af", padding: 24 }}>No plans defined yet. Click "Add Plan" to create one.</p>
      )}
    </div>
  );
}