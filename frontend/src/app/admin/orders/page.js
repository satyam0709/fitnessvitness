import { redirect } from "next/navigation";

/** Canonical orders URL is `/admin/order` (legacy). */
export default function AdminOrdersAliasPage() {
  redirect("/admin/order");
}
