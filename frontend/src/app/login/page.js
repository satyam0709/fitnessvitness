import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";

async function resolveSearchParams(searchParams) {
  if (!searchParams) return {};
  if (typeof searchParams.then === "function") {
    return await searchParams;
  }
  return searchParams;
}

export default async function LoginPage({ searchParams }) {
  const sp = await resolveSearchParams(searchParams);
  const initialReturnTo = typeof sp?.returnTo === "string" ? sp.returnTo : "";
  const initialEmail = typeof sp?.email === "string" ? sp.email : "";
  return <LoginClient initialReturnTo={initialReturnTo} initialEmail={initialEmail} />;
}
