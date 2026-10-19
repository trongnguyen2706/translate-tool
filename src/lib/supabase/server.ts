import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { hasSupabaseConfig, supabasePublicKey } from "@/lib/config";

export async function createSupabaseServerClient() {
  if (!hasSupabaseConfig()) return null;
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabasePublicKey()!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(items) {
          try {
            items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot set cookies; the callback and route handlers can.
          }
        }
      }
    }
  );
}
