import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

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

export async function getAllowedBearerSession(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  if (!match || match[1].length > 8192) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${match[1]}` } }
  });
  const { data: { user }, error } = await supabase.auth.getUser(match[1]);
  if (error || !user?.email || !user.email_confirmed_at) return null;
  if (!user.app_metadata?.providers?.includes("google") && user.app_metadata?.provider !== "google") return null;
  const { data: allowed, error: accessError } = await supabase.rpc("is_allowed_google_user");
  if (accessError || !allowed) return null;
  return { supabase, user };
}
