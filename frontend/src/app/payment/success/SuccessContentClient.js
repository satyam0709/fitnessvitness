"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";

// How long to keep polling before giving up (90 seconds)
// Stripe webhooks usually fire within 5-10 seconds
const POLL_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 3_000;

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available — silently ignore
    }
  }

  return (
    <button onClick={handleCopy} className="copy-btn" type="button" aria-label="Copy workspace URL">
      {copied ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
          <polyline points="13 3 6 11 3 8" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
          <rect x="5" y="2" width="9" height="9" rx="1.5" />
          <path d="M11 2V1a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1" />
        </svg>
      )}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function SuccessContent({ initialData, initialFetchError, initialSessionId, initialOrderId, initialBillingHint }) {
  const params = useSearchParams();
  const router = useRouter();
  const sessionId = params.get("session_id") || initialSessionId;
  const orderId = params.get("order_id") || initialOrderId;
  const billingHint = String(params.get("billing") || initialBillingHint || "").toLowerCase();

  const initialStatus = (() => {
    if (initialFetchError) return "error";
    if (!initialData) return "loading";
    const payStatus = String(initialData.payment_status || "").toLowerCase();
    const subStatus = String(initialData.status || "").toLowerCase();
    if (payStatus === "completed" || (!sessionId && initialData.success && ["active", "trial"].includes(subStatus))) {
      return "success";
    }
    return "loading";
  })();

  const [status, setStatus] = useState(initialStatus);
  const [data, setData] = useState(initialData);

  const pollTimerRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  const cancelledRef = useRef(false);
  const cleanupDoneRef = useRef(false);

  // Hard back-button trap: push the current URL onto history stack so
  // pressing back just reloads this same page instead of going to payment/cart
  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const handlePop = () => {
      window.history.pushState(null, "", window.location.href);
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  const poll = useCallback(async () => {
    if (cancelledRef.current) return;

    // Give up if we have been polling too long
    if (Date.now() - startTimeRef.current > POLL_TIMEOUT_MS) {
      setStatus("timeout");
      return;
    }

    try {
      const qs = sessionId
        ? `session_id=${encodeURIComponent(sessionId)}`
        : `order_id=${encodeURIComponent(orderId)}`;

      const res = await fetch(`/api/payment/status?${qs}`, { credentials: "include" });
      const json = await res.json();

      if (cancelledRef.current) return;

      const payStatus = String(json.payment_status || "").toLowerCase();
      const subStatus = String(json.status || "").toLowerCase();

      // Payment confirmed
      if (res.ok && json.success && payStatus === "completed") {
        setData(json);
        setStatus("success");
        return;
      }

      // Order-based flow (trial / direct order) — no Stripe session
      if (!sessionId && res.ok && json.success && ["active", "trial"].includes(subStatus)) {
        setData(json);
        setStatus("success");
        return;
      }

      // Still processing — keep polling
      if (["pending", "processing"].includes(payStatus) || (res.ok && !json.success)) {
        pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      setStatus("error");
    } catch {
      if (!cancelledRef.current) {
        pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }
  }, [sessionId, orderId]);

  useEffect(() => {
    const ref = sessionId || orderId;
    if (!ref) {
      // Nothing to confirm — send to login
      router.replace("/login");
      return;
    }

    cancelledRef.current = false;
    poll();

    return () => {
      cancelledRef.current = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [sessionId, orderId, router, poll]);

  useEffect(() => {
    if (status !== "success" || cleanupDoneRef.current) return;
    cleanupDoneRef.current = true;
    try {
      window.localStorage.removeItem("rnd_cart");
      window.localStorage.removeItem("rnd_onboarding");
      document.cookie = "onboarding_lock=; Path=/; Max-Age=0; SameSite=Lax";
      window.dispatchEvent(new CustomEvent("crm-orders-changed"));
    } catch {
      /* ignore storage/cookie cleanup errors */
    }
  }, [status]);

  const baseDomain = process.env.NEXT_PUBLIC_APP_BASE_DOMAIN || "365rndcrm.vercel.app";
  const subdomain = data?.subdomain;
  const isTrial =
    (data && String(data.billing_mode || "").toLowerCase() === "trial") ||
    (!data && billingHint === "trial");
  const apiWorkspaceUrl = typeof data?.workspace_url === "string" ? data.workspace_url.trim() : "";
  const tenantUrl =
    apiWorkspaceUrl ||
    (subdomain && typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
      ? `http://${subdomain}.localhost:${window.location.port || "3000"}`
      : subdomain
        ? `https://${subdomain}.${baseDomain}`
        : null);
  const planName = data?.package_name || "your plan";
  const companyName = data?.company_name || "your workspace";
  const userEmail = data?.user_email || data?.order?.user_email || data?.order?.email || "Check your inbox";
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@365rnd.com";
  const workspaceAccessReady = data?.workspace_access_ready !== false;

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }

        body { margin: 0; background: #f4f6f8; }

        .page {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 16px;
          background: #f4f6f8;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .card {
          width: 100%;
          max-width: 640px;
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.08);
          overflow: hidden;
        }

        .card-header {
          background: #1d4ed8;
          padding: 24px 32px;
          text-align: center;
        }

        .logo-text {
          margin: 0;
          font-size: 20px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.3px;
        }

        .logo-sub {
          margin: 4px 0 0;
          font-size: 11px;
          color: rgba(255,255,255,0.65);
          letter-spacing: 0.8px;
          text-transform: uppercase;
        }

        .card-body {
          padding: 40px 32px 32px;
        }

        /* Loading state */
        .loading-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          padding: 20px 0;
        }

        .spinner {
          width: 44px;
          height: 44px;
          border: 3px solid #e5e7eb;
          border-top-color: #1d4ed8;
          border-radius: 50%;
          animation: spin 0.75s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        .loading-label {
          font-size: 15px;
          color: #6b7280;
          margin: 0;
        }

        .loading-sub {
          font-size: 13px;
          color: #9ca3af;
          margin: 0;
        }

        /* Success state */
        .check-wrap {
          display: flex;
          justify-content: center;
          margin-bottom: 24px;
        }

        .check-circle {
          width: 72px;
          height: 72px;
          background: #dcfce7;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: popIn 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }

        @keyframes popIn {
          from { transform: scale(0); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }

        .success-title {
          font-size: 24px;
          font-weight: 700;
          color: #111827;
          margin: 0 0 8px;
          text-align: center;
        }

        .success-sub {
          font-size: 15px;
          color: #6b7280;
          margin: 0 0 28px;
          text-align: center;
          line-height: 1.55;
        }

        .success-sub strong { color: #374151; }

        /* Workspace URL card */
        .url-card {
          background: #eff6ff;
          border: 1.5px solid #bfdbfe;
          border-radius: 10px;
          padding: 20px 20px 16px;
          margin-bottom: 20px;
        }

        .url-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: #6b7280;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .url-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }

        .url-text {
          flex: 1;
          font-size: 15px;
          font-weight: 700;
          color: #1d4ed8;
          font-family: 'Courier New', monospace;
          word-break: break-all;
          background: #fff;
          border: 1px solid #bfdbfe;
          border-radius: 6px;
          padding: 8px 12px;
          margin: 0;
        }

        .copy-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: #fff;
          border: 1px solid #bfdbfe;
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 600;
          color: #1d4ed8;
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
          transition: background 0.15s;
        }

        .copy-btn:hover { background: #dbeafe; }

        .url-note {
          font-size: 12px;
          color: #6b7280;
          margin: 0;
          line-height: 1.55;
        }

        /* Email notice */
        .email-notice {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 8px;
          padding: 14px 16px;
          display: flex;
          gap: 10px;
          align-items: flex-start;
          margin-bottom: 20px;
        }

        .email-icon {
          font-size: 18px;
          line-height: 1;
          flex-shrink: 0;
          margin-top: 1px;
        }

        .email-notice p {
          margin: 0;
          font-size: 13px;
          color: #15803d;
          line-height: 1.55;
        }

        /* Steps */
        .steps {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 8px;
        }

        .step {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
        }

        .step-dot {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 600;
        }

        .step-done .step-dot { background: #dcfce7; color: #16a34a; }
        .step-done { color: #374151; font-weight: 500; }
        .step-pending .step-dot { background: #f3f4f6; color: #9ca3af; border: 1px solid #e5e7eb; }
        .step-pending { color: #9ca3af; }

        /* Error state */
        .error-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          text-align: center;
          padding: 16px 0;
        }

        .error-circle {
          width: 64px;
          height: 64px;
          background: #fee2e2;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          font-weight: 700;
          color: #dc2626;
        }

        .error-title {
          font-size: 20px;
          font-weight: 700;
          color: #111827;
          margin: 0;
        }

        .error-msg {
          font-size: 14px;
          color: #6b7280;
          margin: 0;
          line-height: 1.6;
        }

        .support-link {
          display: inline-block;
          margin-top: 4px;
          font-size: 13px;
          color: #1d4ed8;
          text-decoration: none;
          border: 1px solid #bfdbfe;
          padding: 8px 18px;
          border-radius: 7px;
          font-weight: 600;
        }

        .support-link:hover { background: #eff6ff; }

        /* Footer */
        .card-footer {
          background: #f9fafb;
          border-top: 1px solid #e5e7eb;
          padding: 16px 32px;
          text-align: center;
        }

        .cta-row {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 8px;
        }

        .btn-primary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          padding: 14px 20px;
          border-radius: 10px;
          border: none;
          background: #1d4ed8;
          color: #fff;
          font-size: 15px;
          font-weight: 700;
          text-decoration: none;
          cursor: pointer;
          transition: background 0.15s;
        }

        .btn-primary:hover { background: #1e40af; }

        .btn-secondary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          padding: 12px 20px;
          border-radius: 10px;
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #374151;
          font-size: 14px;
          font-weight: 600;
          text-decoration: none;
          cursor: pointer;
        }

        .btn-secondary:hover { background: #f9fafb; }

        .footer-ref {
          font-size: 11px;
          color: #9ca3af;
          margin: 0;
        }

        .footer-ref code {
          background: #f3f4f6;
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 10px;
        }

        .footer-ref a { color: #9ca3af; }

        /* Timeout state re-uses loading styles */
        .timeout-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          text-align: center;
          padding: 16px 0;
        }
      `}</style>

      <div className="page">
        <div className="card">

          {/* Branding header — always visible */}
          <div className="card-header">
            <p className="logo-text">365 RND CRM</p>
            <p className="logo-sub">{isTrial ? "Trial started" : "Registration complete"}</p>
          </div>

          <div className="card-body">

            {/* ── Loading ── */}
            {status === "loading" && (
              <div className="loading-wrap">
                <div className="spinner" />
                <p className="loading-label">Confirming your payment...</p>
                <p className="loading-sub">This usually takes a few seconds</p>
              </div>
            )}

            {/* ── Timeout (still polling, no result after 90s) ── */}
            {status === "timeout" && (
              <div className="timeout-wrap">
                <div className="spinner" style={{ borderTopColor: "#f59e0b" }} />
                <p className="loading-label" style={{ color: "#92400e" }}>
                  Still confirming...
                </p>
                <p className="loading-sub">
                  Your payment may be processing. Check your email in a few minutes or contact{" "}
                  <a href={`mailto:${supportEmail}`} style={{ color: "#1d4ed8" }}>
                    {supportEmail}
                  </a>
                  .
                </p>
              </div>
            )}

            {/* ── Error ── */}
            {status === "error" && (
              <div className="error-wrap">
                <div className="error-circle">!</div>
                <p className="error-title">Could not confirm payment</p>
                <p className="error-msg">
                  If money was deducted, do not pay again. We will verify and activate your
                  workspace within 24 hours.
                </p>
                <a href={`mailto:${supportEmail}`} className="support-link">
                  Contact support
                </a>
              </div>
            )}

            {/* ── Success ── */}
            {status === "success" && (
              <>
                <div className="check-wrap">
                  <div className="check-circle">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"
                      strokeLinecap="round" strokeLinejoin="round" width="34" height="34">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                </div>

                <p className="success-title">
                  {workspaceAccessReady
                    ? isTrial
                      ? "Your 7-day trial is on!"
                      : "You're all set!"
                    : isTrial
                      ? "Trial active, verification pending"
                      : "Payment complete, verification pending"}
                </p>
                <p className="success-sub">
                  {!workspaceAccessReady ? (
                    <>
                      {isTrial ? "Trial is active" : "Payment is confirmed"} for <strong>{companyName}</strong>.
                      Your workspace URL is reserved, but access remains locked until super-admin database
                      verification is completed.
                    </>
                  ) : isTrial ? (
                    <>
                      <strong>Registration is complete</strong> for <strong>{companyName}</strong>. Your{" "}
                      <strong>{planName}</strong> trial gives full workspace access for 7 days — no payment
                      required for this period.
                    </>
                  ) : (
                    <>
                      Payment received and <strong>registration is complete</strong> for{" "}
                      <strong>{companyName}</strong>. Your <strong>{planName}</strong> workspace is active.
                    </>
                  )}
                </p>

                {/* Workspace URL */}
                {tenantUrl ? (
                  <div className="url-card">
                    <p className="url-label">Your workspace URL</p>
                    <div className="url-row">
                      <p className="url-text">{tenantUrl}</p>
                      <CopyButton text={tenantUrl} />
                    </div>
                    <p className="url-note">
                      {workspaceAccessReady
                        ? "This is your permanent login URL. Save it and share it with your team."
                        : "URL reserved. It becomes accessible only after super-admin verification email."}
                    </p>
                  </div>
                ) : null}

                {/* Order Summary */}
                <div style={{
                  background: '#ffffff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  padding: '24px',
                  marginBottom: '24px',
                  textAlign: 'left',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                }}>
                  <p style={{ margin: '0 0 20px', fontSize: '14px', fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                      <rect x="1" y="4" width="14" height="10" rx="2" ry="2"></rect>
                      <path d="M1 10h14"></path>
                      <path d="M5 1v3"></path>
                      <path d="M11 1v3"></path>
                    </svg>
                    {isTrial ? "Trial Registration Summary" : "Payment & Order Summary"}
                  </p>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', fontSize: '14px' }}>
                    <div style={{ borderBottom: '1px solid #f3f4f6', paddingBottom: '12px' }}>
                      <span style={{ color: '#6b7280', fontSize: '12px', display: 'block', marginBottom: '4px' }}>Status</span>
                      <strong style={{ color: '#10b981', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                          <path d="M12 5l-7 7-4-4"></path>
                        </svg>
                        {isTrial ? "Trial Started" : "Paid Successfully"}
                      </strong>
                    </div>
                    <div style={{ borderBottom: '1px solid #f3f4f6', paddingBottom: '12px' }}>
                      <span style={{ color: '#6b7280', fontSize: '12px', display: 'block', marginBottom: '4px' }}>Plan</span>
                      <strong style={{ color: '#111827', fontSize: '15px' }}>{planName}</strong>
                    </div>
                    <div style={{ borderBottom: '1px solid #f3f4f6', paddingBottom: '12px' }}>
                      <span style={{ color: '#6b7280', fontSize: '12px', display: 'block', marginBottom: '4px' }}>Workspace</span>
                      <strong style={{ color: '#111827', fontSize: '15px' }}>{companyName}</strong>
                    </div>
                    <div style={{ borderBottom: '1px solid #f3f4f6', paddingBottom: '12px' }}>
                      <span style={{ color: '#6b7280', fontSize: '12px', display: 'block', marginBottom: '4px' }}>Order Date</span>
                      <strong style={{ color: '#111827', fontSize: '15px' }}>
                        {data?.order?.created_at ? new Date(data.order.created_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        }) : new Date().toLocaleDateString()}
                      </strong>
                    </div>
                  </div>

                  {/* Payment Amount Details - Only show for paid orders */}
                  {!isTrial && data?.order && (
                    <div style={{
                      marginTop: '20px',
                      padding: '16px',
                      background: '#f9fafb',
                      borderRadius: '8px',
                      border: '1px solid #e5e7eb'
                    }}>
                      <p style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: '600', color: '#374151' }}>
                        Payment Amount Details
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px' }}>
                        <div>
                          <span style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>Package Price</span>
                          <strong style={{ color: '#111827' }}>
                            {data.order.currency === 'USD' ? '$' : '₹'}{parseFloat(data.order.package_price || 0).toFixed(2)}
                          </strong>
                        </div>
                        <div>
                          <span style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>Subtotal</span>
                          <strong style={{ color: '#111827' }}>
                            {data.order.currency === 'USD' ? '$' : '₹'}{parseFloat(data.order.subtotal || 0).toFixed(2)}
                          </strong>
                        </div>
                        <div>
                          <span style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>GST/Tax</span>
                          <strong style={{ color: '#ef4444' }}>
                            {data.order.currency === 'USD' ? '$' : '₹'}{parseFloat(data.order.gst || 0).toFixed(2)}
                          </strong>
                        </div>
                        <div>
                          <span style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>Total Paid</span>
                          <strong style={{ color: '#10b981', fontSize: '16px' }}>
                            {data.order.currency === 'USD' ? '$' : '₹'}{parseFloat(data.order.total || 0).toFixed(2)}
                          </strong>
                        </div>
                      </div>
                      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e5e7eb' }}>
                        <span style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>Currency</span>
                        <strong style={{ color: '#111827' }}>{data.order.currency || 'INR'}</strong>
                      </div>
                    </div>
                  )}

                  {/* User Contact Information */}
                  <div style={{
                    marginTop: '20px',
                    padding: '16px',
                    background: '#eff6ff',
                    borderRadius: '8px',
                    border: '1px solid #bfdbfe'
                  }}>
                    <p style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: '600', color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                      </svg>
                      Contact Information
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px' }}>
                      <div>
                        <span style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>Email Used</span>
                        <strong style={{ color: '#111827', wordBreak: 'break-all' }}>{userEmail}</strong>
                      </div>
                      <div>
                        <span style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>Order Reference</span>
                        <strong style={{ color: '#111827', fontFamily: 'monospace' }}>
                          {data?.order?.id ? `ORD-${data.order.id.toString().padStart(6, '0')}` : (sessionId || orderId || 'N/A')}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Next Steps & Important Information */}
                <div style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '12px',
                  padding: '20px',
                  marginBottom: '24px',
                  textAlign: 'left'
                }}>
                  <p style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: '700', color: '#15803d', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    Next Steps & Important Information
                  </p>
                  <div style={{ fontSize: '13px', color: '#15803d', lineHeight: '1.6' }}>
                    <ul style={{ margin: '0', paddingLeft: '20px' }}>
                      <li style={{ marginBottom: '8px' }}>
                        <strong>Workspace Access:</strong> {workspaceAccessReady
                          ? `Your workspace is ready at ${tenantUrl || 'the URL above'}.`
                          : 'Your workspace will be accessible after super-admin verification (usually within 24 hours).'}
                      </li>
                      <li style={{ marginBottom: '8px' }}>
                        <strong>Email Confirmation:</strong> A detailed confirmation email has been sent to {userEmail}. Check your inbox and spam folder.
                      </li>
                      <li style={{ marginBottom: '8px' }}>
                        <strong>Support:</strong> For any questions, contact <a href={`mailto:${supportEmail}`} style={{ color: '#1d4ed8', fontWeight: '600' }}>{supportEmail}</a>.
                      </li>
                      {!isTrial && (
                        <li style={{ marginBottom: '8px' }}>
                          <strong>Invoice/Receipt:</strong> A formal invoice will be emailed to you within 24 hours. Keep it for your records.
                        </li>
                      )}
                      <li>
                        <strong>Security:</strong> Your payment was processed securely via Stripe. No card details are stored on our servers.
                      </li>
                    </ul>
                  </div>
                </div>

                {/* Email notice */}
                <div className="email-notice">
                  <span className="email-icon">✉️</span>
                  <p>
                    {workspaceAccessReady
                      ? "You'll get an email shortly with your workspace link, sign-in reminders, and any follow-up steps. Please check your inbox and spam folder."
                      : "Super admin will verify your database and email you once your workspace is approved for login."}
                  </p>
                </div>

                {tenantUrl && workspaceAccessReady ? (
                  <div className="cta-row">
                    <a className="btn-primary" href={tenantUrl}>
                      Open your workspace
                    </a>
                    <a className="btn-secondary" href="/login">
                      Sign in from this browser
                    </a>
                  </div>
                ) : (
                  <div className="cta-row">
                    <a className="btn-primary" href="/workspace-pending">
                      View verification status
                    </a>
                  </div>
                )}

                {/* Steps */}
                <div className="steps" style={{ marginTop: "24px" }}>
                  <div className="step step-done">
                    <div className="step-dot">
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" width="10" height="10">
                        <polyline points="10 3 5 9 2 6" />
                      </svg>
                    </div>
                    <span>{isTrial ? "Trial activated" : "Payment received"}</span>
                  </div>
                  <div className="step step-done">
                    <div className="step-dot">
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" width="10" height="10">
                        <polyline points="10 3 5 9 2 6" />
                      </svg>
                    </div>
                    <span>Workspace registered</span>
                  </div>
                  <div className="step step-done">
                    <div className="step-dot">
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" width="10" height="10">
                        <polyline points="10 3 5 9 2 6" />
                      </svg>
                    </div>
                    <span>{workspaceAccessReady ? "Confirmation email queued" : "Verification email pending"}</span>
                  </div>
                  <div className={`step ${workspaceAccessReady ? "step-done" : "step-pending"}`}>
                    <div className="step-dot">
                      {workspaceAccessReady ? (
                        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
                          strokeLinecap="round" strokeLinejoin="round" width="10" height="10">
                          <polyline points="10 3 5 9 2 6" />
                        </svg>
                      ) : (
                        <span>4</span>
                      )}
                    </div>
                    <span>Super-admin DB verification</span>
                  </div>
                </div>
              </>
            )}

          </div>

          {/* Footer with ref code — always visible */}
          <div className="card-footer">
            <p className="footer-ref">
              {(sessionId || orderId) && (
                <>Ref: <code>{sessionId || orderId}</code> &nbsp;·&nbsp; </>
              )}
              <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
            </p>
          </div>

        </div>
      </div>
    </>
  );
}

export default function SuccessContentClient(props) {
  return <SuccessContent {...props} />;
}
