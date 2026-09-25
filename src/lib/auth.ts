import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getAllowedSession() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.email || !user.email_confirmed_at) return null;
  if (!user.app_metadata?.providers?.includes("google") && user.app_metadata?.provider !== "google") return null;
  const { data: allowed, error: accessError } = await supabase.rpc("is_allowed_google_user");
  if (accessError || !allowed) return null;
  return { supabase, user };
}
