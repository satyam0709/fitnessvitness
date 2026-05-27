import { redirect } from "next/navigation";

/** General / web settings removed — invoice settings is the single place for company + bank details. */
export default function WebSettingsRedirectPage() {
  redirect("/settings/invoice");
}
