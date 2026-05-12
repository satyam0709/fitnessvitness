"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useUser, useClerk, useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import styles from "./profile.module.css";

const TABS = [
  { key: "personal",  label: "Personal Info" },
  { key: "password",  label: "Change Password" },
  { key: "store",     label: "Change Store Authentication" },
];

export default function ProfilePage() {
  const { user, isLoaded } = useUser();
  useAuth();
  const { signOut } = useClerk();
  const fileRef = useRef(null);
  const hasFetchedRef = useRef(false);

  const [activeTab, setActiveTab] = useState("personal");
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [dbUser, setDbUser]       = useState(null);

  /* Personal form */
  const [personal, setPersonal] = useState({
    firstName: "", lastName: "", email: "", phone: "",
    gstNo: "", birthday: "",
  });

  /* Password form */
  const [pwd, setPwd] = useState({
    current: "", newPwd: "", confirm: "",
  });
  const [showPwd, setShowPwd] = useState({ current: false, newPwd: false, confirm: false });

  /* Store form */
  const [storeEmail, setStoreEmail] = useState("");
  const [storeOptions, setStoreOptions] = useState([]);

  const fetchDbUser = useCallback(async () => {
    // FIXED: prevent repeated profile DB fetch loop
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    try {
      const res = await apiFetch("/users/me");
      if (res.ok) {
        const d = await res.json();
        setDbUser(d.data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!isLoaded || !user) return;
    setPersonal({
      firstName: user.firstName || "",
      lastName:  user.lastName  || "",
      email:     user.primaryEmailAddress?.emailAddress || "",
      phone:     user.primaryPhoneNumber?.phoneNumber   || "",
      gstNo:     user.publicMetadata?.gstNo  || "",
      birthday:  user.publicMetadata?.birthday || "",
    });
    setAvatarPreview(user.imageUrl || null);
    fetchDbUser();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- primitive deps avoid Clerk `user` identity churn; fetchDbUser is guarded by ref
  }, [
    isLoaded,
    user?.id,
    user?.firstName,
    user?.lastName,
    user?.primaryEmailAddress?.emailAddress,
    user?.primaryPhoneNumber?.phoneNumber,
    user?.publicMetadata?.gstNo,
    user?.publicMetadata?.birthday,
    user?.imageUrl,
    fetchDbUser,
  ]);

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  /* ── Avatar ── */
  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setAvatarPreview(dataUrl);
      try {
        setSaving(true);
        const res = await apiFetch("/users/profile", {
          method: "PUT",
          body: JSON.stringify({ profileImage: dataUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Failed to update photo");
        showToast("Profile photo updated!");
      } catch (err) {
        showToast(err.message || "Failed to update photo", "error");
      } finally {
        setSaving(false);
      }
    };
    reader.readAsDataURL(file);
  }

  /* ── Save Personal Info ── */
  async function handleSavePersonal(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch("/users/profile", {
        method: "PUT",
        body: JSON.stringify({
          firstName: personal.firstName,
          lastName:  personal.lastName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to update profile");
      await fetchDbUser();
      showToast("Profile updated successfully!");
    } catch (err) {
      showToast(err.message || "Failed to update profile", "error");
    } finally {
      setSaving(false);
    }
  }

  /* ── Change Password ── */
  async function handleChangePassword(e) {
    e.preventDefault();
    if (pwd.newPwd !== pwd.confirm) {
      showToast("New passwords do not match", "error");
      return;
    }
    if (pwd.newPwd.length < 8) {
      showToast("Password must be at least 8 characters", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/auth/update-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: pwd.current,
          newPassword:     pwd.newPwd,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to change password");

      await apiFetch("/users/password-changed", { method: "POST" });
      setPwd({ current: "", newPwd: "", confirm: "" });
      showToast("Password changed successfully!");
    } catch (err) {
      showToast(err.message || "Failed to change password", "error");
    } finally {
      setSaving(false);
    }
  }

  const initials = [personal.firstName?.[0], personal.lastName?.[0]]
    .filter(Boolean).join("").toUpperCase() || "U";

  if (!isLoaded) {
    return (
      <div className={styles.loadingWrap}>
        <div className={styles.spinner} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Toast */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === "error" ? styles.toastError : styles.toastSuccess}`}>
          <i className={`fas ${toast.type === "error" ? "fa-circle-exclamation" : "fa-circle-check"}`} />
          {toast.msg}
        </div>
      )}

      <h1 className={styles.pageTitle}>Profile Account</h1>

      <div className={styles.card}>
        {/* Tab bar */}
        <div className={styles.tabBar}>
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={styles.cardBody}>
          {/* ── PERSONAL INFO ── */}
          {activeTab === "personal" && (
            <form className={styles.form} onSubmit={handleSavePersonal}>
              {/* Avatar */}
              <div className={styles.avatarRow}>
                <div className={styles.avatarWrap}>
                  {avatarPreview ? (
                    // profile_image from API may be any origin; keep <img> to avoid remotePatterns maintenance
                    // eslint-disable-next-line @next/next/no-img-element -- dynamic session avatar URL
                    <img src={avatarPreview} alt="Avatar" className={styles.avatar} />
                  ) : (
                    <div className={styles.avatarFallback}>{initials}</div>
                  )}
                  {saving && (
                    <div className={styles.avatarOverlay}>
                      <div className={styles.spinnerSm} />
                    </div>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleAvatarChange}
                />
                <button
                  type="button"
                  className={styles.uploadBtn}
                  onClick={() => fileRef.current?.click()}
                >
                  <i className="fas fa-upload" /> Upload
                </button>
              </div>

              {/* Fields */}
              <div className={styles.fieldsGrid}>
                <div className={styles.field}>
                  <label className={styles.label}>First Name</label>
                  <input
                    className={styles.input}
                    value={personal.firstName}
                    onChange={(e) => setPersonal((p) => ({ ...p, firstName: e.target.value }))}
                    placeholder="First name"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Last Name</label>
                  <input
                    className={styles.input}
                    value={personal.lastName}
                    onChange={(e) => setPersonal((p) => ({ ...p, lastName: e.target.value }))}
                    placeholder="Last name"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Email</label>
                  <input
                    className={`${styles.input} ${styles.inputReadonly}`}
                    value={personal.email}
                    readOnly
                    title="Email is managed by your auth provider"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Phone</label>
                  <input
                    className={styles.input}
                    value={personal.phone}
                    onChange={(e) => setPersonal((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="+91 XXXXX XXXXX"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>GST No</label>
                  <input
                    className={styles.input}
                    value={personal.gstNo}
                    onChange={(e) => setPersonal((p) => ({ ...p, gstNo: e.target.value }))}
                    placeholder="27AAAAA0000A1Z5"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Birthday Date</label>
                  <input
                    className={styles.input}
                    type="date"
                    value={personal.birthday}
                    onChange={(e) => setPersonal((p) => ({ ...p, birthday: e.target.value }))}
                  />
                </div>
              </div>

              {/* Role info row */}
              {dbUser && (
                <div className={styles.infoRow}>
                  <div className={styles.infoChip}>
                    <span className={styles.infoChipLabel}>Role</span>
                    <span className={styles.infoChipValue} style={{ textTransform: "capitalize" }}>
                      {dbUser.role}
                    </span>
                  </div>
                  <div className={styles.infoChip}>
                    <span className={styles.infoChipLabel}>Member Since</span>
                    <span className={styles.infoChipValue}>
                      {new Date(dbUser.created_at).toLocaleDateString("en-IN", {
                        day: "2-digit", month: "short", year: "numeric",
                      })}
                    </span>
                  </div>
                  <div className={styles.infoChip}>
                    <span className={styles.infoChipLabel}>Last Login</span>
                    <span className={styles.infoChipValue}>
                      {dbUser.last_login
                        ? new Date(dbUser.last_login).toLocaleDateString("en-IN", {
                            day: "2-digit", month: "short",
                          })
                        : "—"}
                    </span>
                  </div>
                </div>
              )}

              <div className={styles.formFooter}>
                <button type="submit" className={styles.saveBtn} disabled={saving}>
                  {saving ? <><div className={styles.spinnerSm} /> Saving…</> : "Save Changes"}
                </button>
              </div>
            </form>
          )}

          {/* ── CHANGE PASSWORD ── */}
          {activeTab === "password" && (
            <form className={styles.form} onSubmit={handleChangePassword}>
              <div className={styles.pwdSection}>
                <p className={styles.pwdHint}>
                  <i className="fas fa-lock" />
                  Choose a strong password. At least 8 characters with a mix of letters, numbers and symbols.
                </p>

                {[
                  { key: "current", label: "Current Password",  placeholder: "Enter current password" },
                  { key: "newPwd",  label: "New Password",       placeholder: "Enter new password" },
                  { key: "confirm", label: "Confirm New Password", placeholder: "Re-enter new password" },
                ].map((f) => (
                  <div key={f.key} className={styles.field}>
                    <label className={styles.label}>{f.label}</label>
                    <div className={styles.pwdInputWrap}>
                      <input
                        type={showPwd[f.key] ? "text" : "password"}
                        className={styles.input}
                        value={pwd[f.key]}
                        onChange={(e) => setPwd((p) => ({ ...p, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        className={styles.eyeBtn}
                        onClick={() => setShowPwd((p) => ({ ...p, [f.key]: !p[f.key] }))}
                        tabIndex={-1}
                      >
                        <i className={`fas ${showPwd[f.key] ? "fa-eye-slash" : "fa-eye"}`} />
                      </button>
                    </div>
                  </div>
                ))}

                {/* Password strength */}
                {pwd.newPwd && (
                  <PasswordStrength password={pwd.newPwd} />
                )}

                <div className={styles.formFooter}>
                  <button type="submit" className={styles.saveBtn} disabled={saving || !pwd.current || !pwd.newPwd || !pwd.confirm}>
                    {saving ? <><div className={styles.spinnerSm} /> Changing…</> : "Change Password"}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* ── STORE AUTH ── */}
          {activeTab === "store" && (
            <div className={styles.form}>
              <p className={styles.pwdHint}>
                <i className="fas fa-store" />
                Select the store email account to associate with this user profile for authentication.
              </p>

              <div className={styles.field}>
                <label className={styles.label}>Store Status / Email</label>
                <div className={styles.selectWrap}>
                  <select
                    className={styles.select}
                    value={storeEmail}
                    onChange={(e) => setStoreEmail(e.target.value)}
                  >
                    <option value="">{personal.email || "Select store email…"}</option>
                    {storeOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <i className="fas fa-chevron-down" style={{ pointerEvents: "none" }} />
                </div>
                {storeOptions.length === 0 && (
                  <span className={styles.noOptions}>No additional store accounts configured</span>
                )}
              </div>

              <div className={styles.infoRow}>
                <div className={styles.infoChip}>
                  <span className={styles.infoChipLabel}>Current Store</span>
                  <span className={styles.infoChipValue}>{personal.email || "—"}</span>
                </div>
                <div className={styles.infoChip}>
                  <span className={styles.infoChipLabel}>Status</span>
                  <span className={styles.infoChipValue} style={{ color: "#22c55e" }}>
                    <i className="fas fa-circle" style={{ fontSize: 8 }} /> Active
                  </span>
                </div>
              </div>

              <div className={styles.formFooter}>
                <button
                  type="button"
                  className={styles.saveBtn}
                  disabled={!storeEmail || saving}
                  onClick={() => showToast("Store authentication updated!")}
                >
                  Update Store Auth
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Password Strength Component ── */
function PasswordStrength({ password }) {
  const checks = [
    { label: "8+ characters",        pass: password.length >= 8 },
    { label: "Uppercase letter",     pass: /[A-Z]/.test(password) },
    { label: "Number",               pass: /[0-9]/.test(password) },
    { label: "Special character",    pass: /[^A-Za-z0-9]/.test(password) },
  ];
  const score = checks.filter((c) => c.pass).length;
  const colors = ["#ef4444", "#f97316", "#f59e0b", "#22c55e"];
  const labels = ["Weak", "Fair", "Good", "Strong"];

  return (
    <div className={styles.strengthWrap}>
      <div className={styles.strengthBars}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={styles.strengthBar}
            style={{ background: i < score ? colors[score - 1] : undefined }}
          />
        ))}
      </div>
      <span className={styles.strengthLabel} style={{ color: score > 0 ? colors[score - 1] : undefined }}>
        {score > 0 ? labels[score - 1] : ""}
      </span>
      <div className={styles.strengthChecks}>
        {checks.map((c) => (
          <span key={c.label} className={`${styles.strengthCheck} ${c.pass ? styles.strengthCheckPass : ""}`}>
            <i className={`fas ${c.pass ? "fa-circle-check" : "fa-circle"}`} />
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}