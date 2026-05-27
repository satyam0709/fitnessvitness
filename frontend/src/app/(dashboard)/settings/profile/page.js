import { redirect } from "next/navigation";

export default function SettingsProfileRedirectPage() {
  redirect("/settings/change-password");
}
