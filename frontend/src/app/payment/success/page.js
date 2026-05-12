import SuccessContentClient from "./SuccessContentClient";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

async function fetchBackendPaymentStatus(reference, useOrderId) {
  if (!reference) return null;
  const query = useOrderId
    ? `order_id=${encodeURIComponent(reference)}`
    : `session_id=${encodeURIComponent(reference)}`;

  const requestHeaders = new Headers();
  const incoming = await headers();
  const cookieHeader = incoming.get("cookie");
  if (cookieHeader) {
    requestHeaders.set("cookie", cookieHeader);
  }

  const tenantSlug =
    incoming.get("x-tenant-slug") ||
    incoming.get("x-tenant-subdomain") ||
    incoming.get("x-subdomain");
  if (tenantSlug) {
    requestHeaders.set("x-tenant-slug", tenantSlug);
    requestHeaders.set("x-tenant-subdomain", tenantSlug);
    requestHeaders.set("x-subdomain", tenantSlug);
  }

  try {
    const res = await fetch(`/api/payment/status?${query}`, {
      method: "GET",
      headers: requestHeaders,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

export default async function PaymentSuccessPage({ searchParams }) {
  const params = await searchParams;
  const sessionId = params?.session_id ? String(params.session_id) : null;
  const orderId = params?.order_id ? String(params.order_id) : null;
  const billingHint = String(params?.billing || "").toLowerCase() || null;

  let initialData = null;
  let initialFetchError = false;
  if (sessionId) {
    initialData = await fetchBackendPaymentStatus(sessionId, false);
  } else if (orderId) {
    initialData = await fetchBackendPaymentStatus(orderId, true);
  }

  return (
    <SuccessContentClient
      initialData={initialData}
      initialFetchError={initialFetchError}
      initialSessionId={sessionId}
      initialOrderId={orderId}
      initialBillingHint={billingHint}
    />
  );
}
