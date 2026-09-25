"use client";

import { useEffect, useState } from "react";
import { BookOpenCheck, Check, ChevronDown, Layers3, LoaderCircle, RefreshCw } from "lucide-react";
import { usePreferences } from "@/components/preferences-provider";
import { cefrLevels, ieltsSkills, relevanceLabels, relevanceLabelsEn, skillLabels, topicKeys, topicLabels, topicLabelsEn, vietnamDate } from "@/lib/learning";
import type { DailyFilters } from "@/lib/validation";

type DailyItem = {
  id: string; term: string; kind: "word" | "phrase"; meaning_vi: string; meaning_en: string;
  example: string; collocations: string[]; cefr_level: string | null;
  ielts_relevance: "high" | "medium" | "low" | null;
  topics: string[]; tags: string[]; learning_reason: string; studied_at: string | null;
};
type DailySet = { id: string; study_date: string; filters: DailyFilters; requested_count: number };
type DailyResponse = { set: DailySet | null; items: DailyItem[]; available?: number };

const initialFilters: DailyFilters = {
  createdMode: "all", levelMode: "all", ieltsMode: "all",
  skill: "all", topic: "all", tag: "", kind: "all"
};

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Không thể tải bộ từ.");
  return data as T;
}

export function DailyWords() {
  const { language, t } = usePreferences();
  const topics = language === "en" ? topicLabelsEn : topicLabels;
  const relevance = language === "en" ? relevanceLabelsEn : relevanceLabels;
  const [studyDate, setStudyDate] = useState(() => vietnamDate());
  const [filters, setFilters] = useState<DailyFilters>(initialFilters);
  const [count, setCount] = useState(10);
  const [dailySet, setDailySet] = useState<DailySet | null>(null);
  const [items, setItems] = useState<DailyItem[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"set" | "flashcards" | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/daily-words?date=${studyDate}`, { cache: "no-store" })
      .then((response) => readJson<DailyResponse>(response))
      .then((data) => {
        if (cancelled) return;
        setDailySet(data.set); setItems(data.items); setError(""); setMessage("");
        setFilters(data.set ? { ...initialFilters, ...data.set.filters } : initialFilters);
        setCount(data.set?.requested_count ?? 10);
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Không thể tải bộ từ."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [studyDate]);

  async function createSet() {
    if (busy) return;
    setBusy("set"); setError(""); setMessage("");
    try {
      const result = await readJson<DailyResponse>(await fetch("/api/daily-words", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studyDate, count, filters })
      }));
      setDailySet(result.set); setItems(result.items);
      setMessage(result.items.length < count
        ? t(`Tìm thấy ${result.items.length}/${count} từ khớp bộ lọc. Bạn có thể nới điều kiện và tạo lại.`, `Found ${result.items.length}/${count} matching words. Broaden the filters and try again.`)
        : t(`Đã tạo bộ ${result.items.length} từ cho ngày ${studyDate}.`, `Created a set of ${result.items.length} words for ${studyDate}.`));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tạo bộ từ."); }
    finally { setBusy(null); }
  }

  async function toggleStudied(item: DailyItem) {
    if (busyItemId) return;
    setBusyItemId(item.id);
    setError("");
    try {
      await readJson(await fetch("/api/daily-words", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studyDate, itemId: item.id, studied: !item.studied_at })
      }));
      setItems((current) => current.map((entry) => entry.id === item.id
        ? { ...entry, studied_at: item.studied_at ? null : new Date().toISOString() } : entry));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể cập nhật tiến độ."); }
    finally { setBusyItemId(null); }
  }

  async function createFlashcards() {
    if (!items.length) return;
    if (busy) return;
    setBusy("flashcards"); setError(""); setMessage("");
    try {
      const result = await readJson<{ added: number; total: number }>(await fetch("/api/flashcards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "daily", studyDate })
      }));
      setMessage(t(`Đã thêm ${result.added} flashcard mới từ bộ ${studyDate}. ${result.total - result.added} thẻ đã có sẵn.`, `Added ${result.added} flashcards from ${studyDate}. ${result.total - result.added} were already in your deck.`));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tạo flashcard."); }
    finally { setBusy(null); }
  }

  const studied = items.filter((item) => item.studied_at).length;
  return <section className="daily-words" aria-label={t("Từ vựng hôm nay", "Today's words")}>
    <div className="daily-header">
      <div className="daily-title">{loading ? <LoaderCircle size={19} className="spin" /> : <BookOpenCheck size={19} />}<div><strong>{t("Từ vựng hôm nay", "Today's words")}</strong><span>{loading ? t("Đang tải…", "Loading…") : error ? t("Không thể tải bộ học · mở để xem lỗi", "Could not load set · open for details") : dailySet ? t(`${studied}/${items.length} đã học · còn ${items.length}/${dailySet.requested_count} từ · ${studyDate}`, `${studied}/${items.length} studied · ${items.length}/${dailySet.requested_count} words · ${studyDate}`) : t("Chọn từ trong Kho từ để học", "Choose saved words to study")}</span></div></div>
      <div className="daily-header-actions"><input type="date" aria-label={t("Ngày học", "Study date")} value={studyDate} disabled={!!busy} onChange={(event) => { setLoading(true); setDailySet(null); setItems([]); setStudyDate(event.target.value); }} /><button type="button" className="subtle-button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? t("Thu gọn", "Collapse") : t("Mở bộ học", "Open study set")}<ChevronDown size={15} className={expanded ? "rotate" : ""} /></button></div>
    </div>
    {expanded && <div className="daily-body">
      <div className="daily-filters">
        <label>{t("Số từ", "Word count")}<select value={count} onChange={(event) => setCount(Number(event.target.value))}><option value={5}>5</option><option value={10}>10</option><option value={20}>20</option><option value={30}>30</option></select></label>
        <label>{t("Ngày đã nhập", "Date added")}<select value={filters.createdMode} onChange={(event) => setFilters({ ...filters, createdMode: event.target.value as DailyFilters["createdMode"], createdDate: filters.createdDate ?? vietnamDate(), createdWeekday: filters.createdWeekday ?? 1 })}><option value="all">{t("Mọi ngày", "Any day")}</option><option value="date">{t("Ngày cụ thể", "Specific date")}</option><option value="weekday">{t("Thứ trong tuần", "Day of week")}</option></select></label>
        {filters.createdMode === "date" && <label>{t("Chọn ngày", "Choose date")}<input type="date" value={filters.createdDate ?? vietnamDate()} onChange={(event) => setFilters({ ...filters, createdDate: event.target.value })} /></label>}
        {filters.createdMode === "weekday" && <label>{t("Chọn thứ", "Choose weekday")}<select value={filters.createdWeekday ?? 1} onChange={(event) => setFilters({ ...filters, createdWeekday: Number(event.target.value) })}>{[1,2,3,4,5,6,0].map((day) => <option key={day} value={day}>{day === 0 ? t("Chủ nhật", "Sunday") : t(`Thứ ${day + 1}`, new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, day))))}</option>)}</select></label>}
        <label>{t("Trình độ", "Level")}<select value={filters.levelMode} onChange={(event) => setFilters({ ...filters, levelMode: event.target.value as DailyFilters["levelMode"], levelMin: filters.levelMin ?? "A1", levelMax: filters.levelMax ?? "C2" })}><option value="all">{t("Mọi trình độ", "Any level")}</option><option value="range">{t("Chọn khoảng", "Select range")}</option><option value="unclassified">{t("Chưa phân loại", "Unclassified")}</option></select></label>
        {filters.levelMode === "range" && <><label>{t("Từ level", "From level")}<select value={filters.levelMin ?? "A1"} onChange={(event) => setFilters({ ...filters, levelMin: event.target.value as DailyFilters["levelMin"] })}>{cefrLevels.map((level) => <option key={level}>{level}</option>)}</select></label><label>{t("Đến level", "To level")}<select value={filters.levelMax ?? "C2"} onChange={(event) => setFilters({ ...filters, levelMax: event.target.value as DailyFilters["levelMax"] })}>{cefrLevels.map((level) => <option key={level}>{level}</option>)}</select></label></>}
        <label>IELTS<select value={filters.ieltsMode} onChange={(event) => setFilters({ ...filters, ieltsMode: event.target.value as DailyFilters["ieltsMode"] })}><option value="all">{t("Mọi mức", "Any priority")}</option><option value="high">{t("Ưu tiên IELTS", "IELTS priority")}</option><option value="high-medium">{t("Có ích trở lên", "Useful or higher")}</option><option value="low">{t("Ít ưu tiên", "Lower priority")}</option><option value="unclassified">{t("Chưa phân loại", "Unclassified")}</option></select></label>
        <label>{t("Kỹ năng", "Skill")}<select value={filters.skill} onChange={(event) => setFilters({ ...filters, skill: event.target.value as DailyFilters["skill"] })}><option value="all">{t("Tất cả", "All")}</option>{ieltsSkills.map((skill) => <option key={skill} value={skill}>{skillLabels[skill]}</option>)}</select></label>
        <label>{t("Lĩnh vực", "Topic")}<select value={filters.topic} onChange={(event) => setFilters({ ...filters, topic: event.target.value as DailyFilters["topic"] })}><option value="all">{t("Mọi lĩnh vực", "Any topic")}</option>{topicKeys.map((topic) => <option key={topic} value={topic}>{topics[topic]}</option>)}</select></label>
        <label>Tag<input value={filters.tag} onChange={(event) => setFilters({ ...filters, tag: event.target.value })} placeholder={t("Ví dụ: IELTS Vocabulary", "Example: IELTS Vocabulary")} /></label>
        <label>{t("Loại", "Type")}<select value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value as DailyFilters["kind"] })}><option value="all">{t("Từ và cụm từ", "Words and phrases")}</option><option value="word">{t("Từ", "Word")}</option><option value="phrase">{t("Cụm từ", "Phrase")}</option></select></label>
      </div>
      <div className="daily-action-row"><button type="button" className="primary-button" onClick={createSet} disabled={!!busy || loading}>{busy === "set" ? <LoaderCircle size={16} className="spin" /> : dailySet ? <RefreshCw size={16} /> : <BookOpenCheck size={16} />}{busy === "set" ? t("Đang tạo bộ…", "Creating set…") : dailySet ? t("Tạo lại bộ", "Regenerate set") : t("Tạo bộ học", "Create study set")}</button>{dailySet && items.length > 0 && <button type="button" className="subtle-button" onClick={createFlashcards} disabled={!!busy}>{busy === "flashcards" ? <LoaderCircle size={16} className="spin" /> : <Layers3 size={16} />}{busy === "flashcards" ? t("Đang tạo thẻ…", "Creating cards…") : t("Tạo flashcard từ bộ này", "Create flashcards from this set")}</button>}<span>{t("Chỉ lấy từ tiếng Anh đã lưu; không dùng lượt AI.", "Uses saved English words; no AI request is used.")}</span></div>
      {error && <p className="daily-feedback error" role="alert">{language === "en" ? "Could not complete the request. Check whether migrations 002 and 003 have been applied." : error}</p>}
      {message && <p className="daily-feedback" role="status">{message}</p>}
      {dailySet && <div className="daily-items">{items.length ? items.map((item) => <article className={`daily-item ${item.studied_at ? "studied" : ""}`} key={item.id}>
        <div><strong>{item.term}</strong><span>{item.cefr_level ?? t("Chưa rõ level", "Level unknown")}{item.ielts_relevance ? ` · ${relevance[item.ielts_relevance]}` : ""}{item.topics.length ? ` · ${item.topics.map((topic) => topics[topic as keyof typeof topics] ?? topic).join(", ")}` : ""}{item.tags?.length ? ` · ${item.tags.map((tag) => `#${tag}`).join(" ")}` : ""}</span><p>{item.meaning_vi || item.meaning_en}</p>{item.example && <small>{item.example}</small>}</div>
        <button type="button" onClick={() => toggleStudied(item)} disabled={!!busyItemId || loading} aria-label={`${item.studied_at ? t("Bỏ đánh dấu", "Unmark") : t("Đánh dấu đã học", "Mark studied")} ${item.term}`}>{busyItemId === item.id ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{busyItemId === item.id ? t("Đang lưu…", "Saving…") : item.studied_at ? t("Đã học", "Studied") : t("Đã nhớ", "Remembered")}</button>
      </article>) : <p className="suggestions-empty">{t("Bộ này chưa có từ khớp bộ lọc. Hãy đổi điều kiện rồi tạo lại.", "No words match these filters. Change the filters and regenerate the set.")}</p>}</div>}
    </div>}
  </section>;
}

export function DailyWordsPageView() {
  const { t } = usePreferences();
  return <main className="library-page"><div className="page-container daily-page">
    <div className="page-heading"><div><span className="eyebrow">{t("Học mỗi ngày", "Daily practice")}</span><h1>{t("Từ vựng hôm nay", "Today's words")}</h1><p>{t("Chọn ngày và điều kiện để tạo bộ từ từ Kho từ của bạn.", "Choose a date and filters to build a study set from your vocabulary.")}</p></div></div>
    <DailyWords />
  </div></main>;
}
