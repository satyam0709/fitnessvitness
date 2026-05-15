import { getBackendApiUrl } from "@/lib/backendApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const FORWARDED_REQUEST_HEADERS = [
  "authorization",
  "cookie",
  "content-type",
  "accept",
  "x-tenant-subdomain",
  "x-tenant-slug",
  "x-subdomain",
  "x-integration-secret",
  "x-requested-with",
];

async function resolvePath(context) {
  const params = await context?.params;
  const parts = Array.isArray(params?.path) ? params.path : [];
  return parts.map((part) => encodeURIComponent(part)).join("/");
}

function buildBackendUrl(req, path, backendBase) {
  const sourceUrl = new URL(req.url);
  const target = new URL(`${backendBase}/api/${path}`);
  target.search = sourceUrl.search;
  return target;
}

function buildForwardHeaders(req) {
  const out = new Headers();

  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) out.set(name, value);
  }

  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const origin = req.headers.get("origin");

  if (origin) out.set("origin", origin);
  if (host) out.set("x-forwarded-host", host);
  if (proto) out.set("x-forwarded-proto", proto);

  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) out.set("x-forwarded-for", forwardedFor);

  return out;
}

function copyResponseHeaders(response) {
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "set-cookie" || HOP_BY_HOP_RESPONSE_HEADERS.has(lower)) return;
    headers.set(key, value);
  });

  let cookies = [];
  const getSetCookie = response.headers.getSetCookie;
  if (typeof getSetCookie === "function") {
    cookies = getSetCookie.call(response.headers) || [];
  } else if (typeof response.headers.raw === "function") {
    const raw = response.headers.raw();
    if (raw && Array.isArray(raw["set-cookie"])) {
      cookies = raw["set-cookie"];
    }
  } else {
    const cookieHeader = response.headers.get("set-cookie");
    if (cookieHeader) {
      cookies = [cookieHeader];
    }
  }

  for (const cookie of cookies) {
    if (cookie) headers.append("set-cookie", cookie);
  }

  return headers;
}

async function proxy(req, context) {
  const path = await resolvePath(context);
  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const backendBase = getBackendApiUrl().replace(/\/+$/, "");
  if (!backendBase) {
    return Response.json(
      {
        success: false,
        message: "Backend URL is not configured for the API proxy.",
        code: "MISSING_BACKEND_URL",
        hint: "Set BACKEND_API_URL, BACKEND_URL, or NEXT_PUBLIC_API_URL. On Vercel with routePrefix /_/backend, VERCEL_URL is used when those are unset.",
      },
      { status: 502 }
    );
  }

  try {
    const target = buildBackendUrl(req, path, backendBase);
    const response = await fetch(target, {
      method,
      headers: buildForwardHeaders(req),
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    });

    return new Response(await response.arrayBuffer(), {
      status: response.status,
      statusText: response.statusText,
      headers: copyResponseHeaders(response),
    });
  } catch (error) {
    const detail = error?.message || "proxy_error";
    console.error("[api-proxy] upstream fetch failed", {
      targetPath: path,
      backendBase,
      detail,
    });
    return Response.json(
      {
        success: false,
        message: `Unable to reach backend at ${backendBase}.`,
        code: "UPSTREAM_FETCH_FAILED",
        detail,
      },
      { status: 502 }
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
