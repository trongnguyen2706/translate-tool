import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const supabase = await createSupabaseServerClient();
  if (!code || !supabase) return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  const { data: { user } } = await supabase.auth.getUser();
  const { data: allowed } = await supabase.rpc("is_allowed_google_user");
  if (!user?.email || !user.email_confirmed_at || !allowed) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=not_allowed", request.url));
  }
  return NextResponse.redirect(new URL("/", request.url));
}
