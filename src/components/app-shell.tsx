"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, BookOpenCheck, Languages, LoaderCircle, Menu, Plus, Settings, LogOut, X, Clock3, Layers3, Moon, Sun } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { PendingLinkIndicator } from "@/components/pending-link-indicator";
import { usePreferences } from "@/components/preferences-provider";

type Props = { children: React.ReactNode; email: string };

export function AppShell({ children, email }: Props) {
  const pathname = usePathname();
  const { t, theme, setTheme } = usePreferences();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [history, setHistory] = useState<{ id: string; source_text: string }[]>([]);

  useEffect(() => {
    async function loadHistory() {
      try {
        const response = await fetch("/api/translations", { cache: "no-store" });
        if (response.ok) setHistory((await response.json()).items ?? []);
      } catch { /* The main page still works when history cannot load. */ }
    }
    loadHistory();
    window.addEventListener("translations-updated", loadHistory);
    return () => window.removeEventListener("translations-updated", loadHistory);
  }, []);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await createSupabaseBrowserClient().auth.signOut();
      router.replace("/login");
      router.refresh();
    } catch { setSigningOut(false); }
  }

  const nav = [
    { href: "/", label: t("Dịch mới", "New translation"), icon: Plus },
    { href: "/daily-words", label: t("Từ vựng hôm nay", "Today's words"), icon: BookOpenCheck },
    { href: "/library", label: t("Kho từ", "Vocabulary"), icon: BookOpen },
    { href: "/flashcards", label: "Flashcard", icon: Layers3 },
    { href: "/settings", label: t("Cài đặt", "Settings"), icon: Settings }
  ];
  return <div className="app-layout">
    {open && <button className="sidebar-scrim" onClick={() => setOpen(false)} aria-label={t("Đóng menu", "Close menu")} />}
    <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
      <div className="brand-row">
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark"><Languages size={20} strokeWidth={2.1} /></span>
          <span>Phrasebook</span><PendingLinkIndicator />
        </Link>
        <button className="icon-button mobile-only" onClick={() => setOpen(false)} aria-label={t("Đóng menu", "Close menu")}><X size={20} /></button>
      </div>
      <div className="sidebar-section-title">{t("Không gian học", "Workspace")}</div>
      <nav className="side-nav" aria-label={t("Điều hướng chính", "Main navigation")}>
        {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} onClick={() => { setOpen(false); if (href === "/") window.dispatchEvent(new Event("new-chat")); }} className={`nav-link ${pathname === href ? "active" : ""}`}>
          <Icon size={18} strokeWidth={1.8} /><span>{label}</span><PendingLinkIndicator />
        </Link>)}
      </nav>
      <div className="history-nav">
        <div className="section-label"><Clock3 size={15} /> {t("Lịch sử đã lưu", "Saved history")}</div>
        {history.length ? history.slice(0, 30).map((item) => <Link key={item.id} href={`/?history=${item.id}`} className="history-link" onClick={() => setOpen(false)} title={item.source_text}><span>{item.source_text}</span><PendingLinkIndicator /></Link>) : <p className="history-empty">{t("Chưa có bản dịch đã lưu.", "No saved translations yet.")}</p>}
      </div>
      <div className="sidebar-bottom">
        <button className="nav-link theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? t("Chuyển sang giao diện sáng", "Switch to light appearance") : t("Chuyển sang giao diện tối", "Switch to dark appearance")}>
          {theme === "dark" ? <Sun size={18} strokeWidth={1.8} /> : <Moon size={18} strokeWidth={1.8} />}
          <span>{theme === "dark" ? t("Giao diện sáng", "Light appearance") : t("Giao diện tối", "Dark appearance")}</span>
        </button>
        <div className="account-line" title={email}><span className="avatar">{email.slice(0, 1).toUpperCase()}</span><span className="account-email">{email}</span></div>
        <button className="nav-link signout" onClick={signOut} disabled={signingOut}>{signingOut ? <LoaderCircle size={18} className="spin" /> : <LogOut size={18} strokeWidth={1.8} />}<span>{signingOut ? t("Đang đăng xuất…", "Signing out…") : t("Đăng xuất", "Sign out")}</span></button>
      </div>
    </aside>
    <div className="main-column">
      <button className="mobile-sidebar-trigger" onClick={() => setOpen(true)} aria-label={t("Mở menu", "Open menu")}><Menu size={20} /></button>
      {children}
    </div>
  </div>;
}
