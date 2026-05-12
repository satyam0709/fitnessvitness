import { NextResponse } from "next/server";
import { PROTECTED_PREFIXES } from "@/lib/constants";

const DEFAULT_BASE = "365rndcrm.vercel.app";

const AUTH_PATH_PREFIXES = ["/login", "/signup", "/sign-in", "/register"];
/** Platform `/admin` must stay reachable even with `onboarding_lock` (cookie-only gate). */
const ONBOARDING_ALLOWED_PREFIXES = ["/add-package", "/cart", "/payment/success", "/admin"];

function normalizeBase() {
  const raw = String(process.env.NEXT_PUBLIC_APP_BASE_DOMAIN || DEFAULT_BASE)
    .trim()
    .replace(/^https?:\/\//, "");
  return raw.split("/")[0].toLowerCase();
}

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

function hasOnboardingLock(request) {
  return request.cookies.get("onboarding_lock")?.value === "1";
}

function isOnboardingAllowedPath(pathname) {
  return ONBOARDING_ALLOWED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default function middleware(request) {
  const base = normalizeBase();
  const hostOnly = String(request.headers.get("host") || "")
    .split(":")[0]
    .toLowerCase();

  let res = NextResponse.next();

  if (hostOnly && hostOnly !== "localhost" && hostOnly !== "127.0.0.1" && hostOnly !== base) {
    if (hostOnly.endsWith(`.${base}`)) {
      const sub = hostOnly.slice(0, -base.length - 1);
      if (sub && !sub.includes(".") && sub !== "www") {
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set("x-tenant-slug", sub);
        res = NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        });
      }
    }
  }

  const pathname = request.nextUrl.pathname;
  const cookiePresent = hasAuthCookies(request);
  const onboardingLocked = hasOnboardingLock(request);

  if (!cookiePresent && isProtectedPath(pathname)) {
    if (pathname === "/login" || pathname.startsWith("/login/")) {
      return res;
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", `${pathname}${request.nextUrl.search || ""}`);
    return NextResponse.redirect(loginUrl);
  }

  if (cookiePresent && isAuthPath(pathname)) {
    if (pathname === "/signup" || pathname.startsWith("/signup/")) {
      return res;
    }
    // Allow auth pages to render; client-side role-aware routing handles final destination.
    return res;
  }

  if (cookiePresent && onboardingLocked && isProtectedPath(pathname) && !isOnboardingAllowedPath(pathname)) {
    return NextResponse.redirect(new URL("/add-package?onboarding=1", request.url));
  }

  return res;
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
