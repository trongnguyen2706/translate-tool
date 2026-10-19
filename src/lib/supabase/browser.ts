"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabasePublicKey } from "@/lib/config";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabasePublicKey()!
  );
}
