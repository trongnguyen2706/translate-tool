"use client";
import { useState } from "react";
import { usePreferences } from "@/components/preferences-provider";
type Entry = { id: string; term: string; mode: string; state: string; requested_fields: string[]; updated_at: string };
export function EnrichmentHistory() {
  const { t } = usePreferences();
  const [items, setItems] = useState<Entry[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setError("");
    try { const response = await fetch("/api/vocabulary/enrich", { cache: "no-store" }), result = await response.json(); if (!response.ok) throw new Error(result.error); setItems(result.items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load requests"); }
    finally { setBusy(false); }
  }
  async function reset(entry: Entry) {
    if (!confirm(t("Kết quả lần gọi trước chưa rõ. Cho phép thử lại có thể tốn thêm một lượt AI. Tiếp tục?", "The previous outcome is unknown. Allowing another attempt may use another AI request. Continue?"))) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/vocabulary/enrich", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: entry.id, allowAnotherAttempt: true }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not reset request"); }
    finally { setBusy(false); }
  }
  return <details className="source-details"><summary>{t("Lịch sử yêu cầu AI", "AI request history")}</summary><button className="subtle-button" disabled={busy} onClick={() => void load()}>{t("Tải / làm mới 50 yêu cầu gần nhất", "Load / refresh 50 recent requests")}</button>{error && <p role="alert">{error}</p>}{items?.length === 0 && <p>{t("Chưa có yêu cầu.", "No requests yet.")}</p>}{items?.map((entry) => <div className="occurrence-entry" key={entry.id}><strong>{entry.term}</strong> · {entry.mode} · {entry.state}<p>{entry.requested_fields.join(", ")} · {new Date(entry.updated_at).toLocaleString()}</p>{(entry.state === "uncertain" || entry.state === "reserved") && <button className="subtle-button" disabled={busy} onClick={() => void reset(entry)}>{t("Cho phép thử lại sau 2 phút", "Allow another attempt after 2 minutes")}</button>}</div>)}</details>;
}
