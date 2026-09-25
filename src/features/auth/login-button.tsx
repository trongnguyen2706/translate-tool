"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { usePreferences } from "@/components/preferences-provider";

export function LoginButton() {
  const { t } = usePreferences();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function login() {
    setBusy(true);
    setError("");
    const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` }
    });
    if (error) { setError(t("Không thể mở đăng nhập Google.", "Could not open Google sign in.")); setBusy(false); }
  }
  return <><button className="google-button" onClick={login} disabled={busy}>
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.22c0-.72-.06-1.25-.2-1.8H12v3.4h5.37a4.6 4.6 0 0 1-2 3.02v2.5h3.22c1.88-1.73 2.76-4.28 2.76-7.12Z"/><path fill="#34A853" d="M12 21.5c2.7 0 4.96-.9 6.61-2.16l-3.22-2.5c-.9.6-2.04.95-3.39.95-2.6 0-4.81-1.76-5.6-4.13H3.08v2.58A10 10 0 0 0 12 21.5Z"/><path fill="#FBBC05" d="M6.4 13.66a6 6 0 0 1 0-3.32V7.76H3.08a10 10 0 0 0 0 8.48l3.32-2.58Z"/><path fill="#EA4335" d="M12 6.21c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.56 9.56 0 0 0 12 2.5a10 10 0 0 0-8.92 5.26l3.32 2.58C7.19 7.97 9.4 6.21 12 6.21Z"/></svg>
    {busy && <LoaderCircle size={17} className="spin" />}{busy ? t("Đang chuyển hướng…", "Redirecting…") : t("Tiếp tục với Google", "Continue with Google")}
  </button>{error && <div className="notice error">{error}</div>}</>;
}
