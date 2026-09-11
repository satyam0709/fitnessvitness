import { NextResponse } from "next/server";
import { PROTECTED_PREFIXES } from "@/lib/constants";

const AUTH_PATH_PREFIXES = ["/login"];

function isProtectedPath(pathname) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isAuthPath(pathname) {
  return AUTH_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function hasAuthCookies(request) {
  const access = request.cookies.get("access_token")?.value;
  const refresh = request.cookies.get("refresh_token")?.value;
  const authHeader = request.headers.get("authorization");
  return Boolean(access || refresh || authHeader);
}

/**
 * Public origin of the current request.
 * Behind a reverse proxy (`next start` + Nginx) `request.url` is synthesized from the
 * server's own listen host/port (e.g. https://localhost:7301), so redirects built from it
 * send the browser to localhost. Prefer the proxy-supplied headers instead.
 */
function publicOrigin(request) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!host) return request.nextUrl.origin;
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
    request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host.split(",")[0].trim()}`;
}

export default function middleware(request) {
  const pathname = request.nextUrl.pathname;
  const cookiePresent = hasAuthCookies(request);

  if (!cookiePresent && (pathname === "/" || isProtectedPath(pathname))) {
    const loginUrl = new URL("/login", publicOrigin(request));
    if (pathname !== "/") {
      loginUrl.searchParams.set("returnTo", `${pathname}${request.nextUrl.search || ""}`);
    }
    return NextResponse.redirect(loginUrl);
  }

  if (cookiePresent && isAuthPath(pathname)) {
    // Allow auth pages to render; client-side role-aware routing handles final destination.
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
