import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SetupScreen } from "@/components/setup-screen";
import { getAllowedSession } from "@/lib/auth";
import { hasSupabaseConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!hasSupabaseConfig()) return <SetupScreen />;
  const session = await getAllowedSession();
  if (!session) redirect("/login");
  return <AppShell email={session.user.email!}>{children}</AppShell>;
}
