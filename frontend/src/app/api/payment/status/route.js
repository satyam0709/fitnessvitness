import { NextResponse } from "next/server";
import { getBackendApiUrl } from "@/lib/backendApi";

export async function GET(req) {
  const authorization = req.headers.get("authorization") || "";
  const cookie = req.headers.get("cookie") || "";
  const tenantSubdomain = req.headers.get("x-tenant-subdomain") || "";
  const tenantSlug = req.headers.get("x-tenant-slug") || "";
  const host = req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const origin = req.headers.get("origin") || "";
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id") || "";
  const orderId = url.searchParams.get("order_id") || "";
  const query = sessionId
    ? `session_id=${encodeURIComponent(sessionId)}`
    : `order_id=${encodeURIComponent(orderId)}`;
  const backendApiUrl = getBackendApiUrl();

  try {
    const response = await fetch(
      `${backendApiUrl}/api/payment/status?${query}`,
      {
        method: "GET",
        headers: {
          Authorization: authorization,
          Cookie: cookie,
          ...(tenantSubdomain ? { "X-Tenant-Subdomain": tenantSubdomain } : {}),
          ...(tenantSlug ? { "X-Tenant-Slug": tenantSlug } : {}),
          ...(origin ? { Origin: origin } : {}),
          ...(host ? { "X-Forwarded-Host": host } : {}),
          "X-Forwarded-Proto": proto,
        },
      }
    );

    const data = await response.json().catch(() => ({
      success: false,
      message: "Invalid response from payment backend.",
    }));

    const nextResponse = NextResponse.json(data, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });

    const getSetCookie = response.headers.getSetCookie;
    const cookies =
      typeof getSetCookie === "function"
        ? getSetCookie.call(response.headers)
        : response.headers.get("set-cookie")
          ? [response.headers.get("set-cookie")]
          : [];
    for (const c of cookies) nextResponse.headers.append("set-cookie", c);
    return nextResponse;
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: `Unable to reach payment backend at ${backendApiUrl}.`,
        detail: error.message,
      },
      { status: 502 }
    );
  }
}
