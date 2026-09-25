"use client";

import { usePreferences } from "@/components/preferences-provider";

export function SetupScreen() {
  const { t } = usePreferences();
  return <main className="setup-screen"><div className="setup-card">
    <span className="eyebrow">Phrasebook</span>
    <h1>{t("Ứng dụng đã sẵn sàng để cấu hình.", "Phrasebook is ready to configure.")}</h1>
    <p>{t("Tạo project Supabase, thêm biến môi trường theo", "Create a Supabase project, add environment variables from")} <code>.env.example</code>, {t("rồi chạy lại ứng dụng. Hướng dẫn nằm trong README.md.", "then restart the app. See README.md for instructions.")}</p>
  </div></main>;
}
