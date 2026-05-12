import { NextResponse } from "next/server";
import { PROTECTED_PREFIXES } from "@/lib/constants";

const AUTH_PATH_PREFIXES = ["/login", "/signup", "/sign-in", "/register"];

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

export default function middleware(request) {
  const pathname = request.nextUrl.pathname;
  const cookiePresent = hasAuthCookies(request);

  if (!cookiePresent && isProtectedPath(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", `${pathname}${request.nextUrl.search || ""}`);
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
