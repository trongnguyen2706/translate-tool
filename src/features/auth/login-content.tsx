"use client";

import { LoginButton } from "@/features/auth/login-button";
import { usePreferences } from "@/components/preferences-provider";

export function LoginContent({ error }: { error?: string }) {
  const { t } = usePreferences();
  return <main className="login-screen"><section className="login-card">
    <div className="login-mark">P</div>
    <h1>{t("Đăng nhập vào Phrasebook", "Sign in to Phrasebook")}</h1>
    <p>{t("Dịch nhanh, chọn từ đáng học và giữ kho từ của riêng bạn.", "Translate quickly, pick useful words and build your own vocabulary.")}</p>
    {error === "not_allowed" && <div className="notice error">{t("Tài khoản Google này chưa được cho phép sử dụng.", "This Google account does not have access.")}</div>}
    {error === "oauth" && <div className="notice error">{t("Đăng nhập chưa hoàn tất. Vui lòng thử lại.", "Sign in was not completed. Please try again.")}</div>}
    <LoginButton />
    <span className="login-footnote">{t("Chỉ những tài khoản đã được chủ ứng dụng cho phép mới có thể vào.", "Only accounts approved by the app owner can sign in.")}</span>
  </section></main>;
}
