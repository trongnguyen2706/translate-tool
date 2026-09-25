import { SettingsView } from "@/features/settings/settings-view";
import { getAllowedSession } from "@/lib/auth";

export default async function SettingsPage() {
  const session = await getAllowedSession();
  return <SettingsView email={session?.user.email ?? ""} />;
}
