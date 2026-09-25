import { redirect } from "next/navigation";
import { getAllowedSession } from "@/lib/auth";
import { hasSupabaseConfig } from "@/lib/config";
import { LoginContent } from "@/features/auth/login-content";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!hasSupabaseConfig()) redirect("/");
  const session = await getAllowedSession();
  if (session) redirect("/");
  const { error } = await searchParams;
  return <LoginContent error={error} />;
}
