"use client";

import { useEffect, useState } from "react";
import { Check, CircleHelp, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { usePreferences, type AppLanguage, type AppTheme } from "@/components/preferences-provider";
import type { Direction } from "@/lib/validation";

type Settings = { default_direction: Direction; approve_before_save: boolean };

export function SettingsView({ email }: { email: string }) {
  const { language, setLanguage, theme, setTheme, t } = usePreferences();
  const [settings, setSettings] = useState<Settings>({ default_direction: "en-vi", approve_before_save: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" }).then((response) => response.json())
      .then((data) => { if (data.settings) setSettings(data.settings); else setError(data.error || "Không thể tải cài đặt."); })
      .catch(() => setError("Không thể tải cài đặt."))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không thể lưu cài đặt.");
      setSettings(data.settings); setMessage(t("Đã lưu cài đặt.", "Settings saved."));
    } catch (err) { setError(language === "en" ? "Could not save settings." : err instanceof Error ? err.message : "Không thể lưu cài đặt."); }
    finally { setSaving(false); }
  }

  return <main className="settings-page"><div className="page-container narrow">
    <div className="page-heading"><div><span className="eyebrow">{t("Cá nhân hóa", "Preferences")}</span><h1>{t("Cài đặt", "Settings")}</h1><p>{t("Điều chỉnh cách dịch và lưu từ của bạn.", "Choose how Phrasebook looks and works for you.")}</p></div></div>
    {(message || error) && <div className={`notice ${error ? "error" : "success"}`}>{error ? language === "en" ? "Could not load or save settings. Please try again." : error : message}<button onClick={() => { setMessage(""); setError(""); }} aria-label={t("Đóng thông báo", "Dismiss message")}><X size={15} /></button></div>}
    <section className="settings-card"><div className="setting-header"><h2>{t("Giao diện", "Appearance")}</h2><p>{t("Lựa chọn này được lưu trên trình duyệt của bạn.", "These choices are saved in this browser.")}</p></div>
      <div className="settings-preference-grid"><label className="setting-control">{t("Chế độ hiển thị", "Theme")}<select value={theme} onChange={(event) => setTheme(event.target.value as AppTheme)}><option value="light">{t("Sáng", "Light")}</option><option value="dark">{t("Tối", "Dark")}</option></select></label>
      <label className="setting-control">{t("Ngôn ngữ", "Language")}<select value={language} onChange={(event) => setLanguage(event.target.value as AppLanguage)}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label></div>
    </section>
    <section className="settings-card"><div className="setting-header"><h2>{t("Dịch thuật", "Translation")}</h2><p>{t("Chiều dịch mặc định khi mở một lượt dịch mới.", "Default direction for a new translation.")}</p></div><label className="setting-control">{t("Chiều dịch", "Direction")}<select value={settings.default_direction} onChange={(event) => setSettings({ ...settings, default_direction: event.target.value as Direction })} disabled={loading}><option value="en-vi">{t("Anh → Việt", "English → Vietnamese")}</option><option value="vi-en">{t("Việt → Anh", "Vietnamese → English")}</option><option value="en-en">{t("Anh → Anh", "English → English")}</option></select></label></section>
    <section className="settings-card"><div className="setting-header"><h2>{t("Gợi ý và lưu từ vựng", "Vocabulary suggestions and saving")}</h2><p>{t("Chọn cách xử lý từ, cụm từ và collocation sau khi dịch.", "Choose how suggested words and phrases are saved after translation.")}</p></div><label className="toggle-row"><div><strong>{t("Duyệt trước khi lưu", "Review before saving")}</strong><span>{settings.approve_before_save ? t("Sau khi dịch, nhấn Gợi ý từ vựng để xem và chỉnh từng mục trước khi lưu.", "After translating, review and edit each suggestion before saving it.") : t("Sau mỗi lần dịch, AI tự gợi ý rồi lưu các mục vào kho từ, không cần duyệt.", "After translating, AI automatically suggests and saves vocabulary.")}</span></div><input type="checkbox" checked={settings.approve_before_save} onChange={(event) => setSettings({ ...settings, approve_before_save: event.target.checked })} disabled={loading} /></label></section>
    <section className="settings-card"><div className="setting-header"><h2>{t("Quyền riêng tư", "Privacy")}</h2></div><div className="info-row"><ShieldCheck size={19} /><p>{t("Ảnh được đọc chữ trên thiết bị và không được tải lên server. OpenAI chỉ nhận text bạn gửi để dịch hoặc phân tích.", "Images are read on your device and are not uploaded. OpenAI receives only the text you submit for translation or analysis.")}</p></div><div className="info-row"><CircleHelp size={19} /><p>{t("Bản dịch chỉ xuất hiện trong lịch sử sau khi bạn chọn lưu. Dữ liệu của hai tài khoản được tách riêng.", "Translations appear in history only after you save them. Each account has separate data.")}</p></div></section>
    <section className="settings-card"><div className="setting-header"><h2>{t("Tài khoản", "Account")}</h2><p>{t("Đăng nhập bằng Google", "Signed in with Google")}</p></div><div className="account-value">{email}</div></section>
    <button className="primary-button settings-save" onClick={save} disabled={saving || loading}>{saving ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{saving ? t("Đang lưu…", "Saving…") : t("Lưu cài đặt", "Save settings")}</button>
  </div></main>;
}
