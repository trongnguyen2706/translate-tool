"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type AppLanguage = "vi" | "en";
export type AppTheme = "light" | "dark";

type Preferences = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  t: (vietnamese: string, english: string) => string;
};

const Context = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>("vi");
  const [theme, setTheme] = useState<AppTheme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        setLanguage(localStorage.getItem("phrasebook-language") === "en" ? "en" : "vi");
        setTheme(localStorage.getItem("phrasebook-theme") === "dark" ? "dark" : "light");
      } catch { /* Private browsing can block storage. */ }
      setReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language;
    document.title = language === "en" ? "Phrasebook — Translate and study vocabulary" : "Phrasebook — Dịch và học từ";
    try {
      localStorage.setItem("phrasebook-theme", theme);
      localStorage.setItem("phrasebook-language", language);
    } catch { /* The current tab still keeps the selected preference. */ }
  }, [language, theme, ready]);

  const value = useMemo<Preferences>(() => ({
    language, setLanguage, theme, setTheme,
    t: (vietnamese, english) => language === "en" ? english : vietnamese
  }), [language, theme]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePreferences() {
  const value = useContext(Context);
  if (!value) throw new Error("PreferencesProvider is missing.");
  return value;
}
