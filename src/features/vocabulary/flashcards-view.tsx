"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Lightbulb, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { usePreferences } from "@/components/preferences-provider";
import { flashcardStatusLabels, flashcardStatusLabelsEn, relevanceLabels, relevanceLabelsEn, topicLabels, topicLabelsEn } from "@/lib/learning";
import type { FlashcardStatus } from "@/lib/validation";

type Card = {
  id: string; term: string; meaning_vi: string; meaning_en: string; example: string;
  kind: "word" | "phrase"; cefr_level: string | null;
  ielts_relevance: "high" | "medium" | "low" | null;
  topics: string[]; tags: string[]; collocations: string[]; status: FlashcardStatus | null;
  source_daily_date: string | null; created_at: string;
};
const statuses: FlashcardStatus[] = ["not_yet", "roughly", "learned", "mastered"];
type CardLanguageMode = "en-en" | "en-vi" | "vi-en";

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Có lỗi xảy ra.");
  return data as T;
}

export function FlashcardsView() {
  const { language, t } = usePreferences();
  const statusLabels = language === "en" ? flashcardStatusLabelsEn : flashcardStatusLabels;
  const relevance = language === "en" ? relevanceLabelsEn : relevanceLabels;
  const topics = language === "en" ? topicLabelsEn : topicLabels;
  const [cards, setCards] = useState<Card[]>([]);
  const [filter, setFilter] = useState<FlashcardStatus | "all" | "unrated" | "daily">("all");
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [languageMode, setLanguageMode] = useState<CardLanguageMode>("en-vi");
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [sentence, setSentence] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<FlashcardStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/flashcards", { cache: "no-store" }).then((response) => readJson<{ cards: Card[] }>(response))
      .then((data) => setCards(data.cards))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Không thể tải flashcard."))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => cards.filter((card) => filter === "all" ||
    (filter === "unrated" && !card.status) || (filter === "daily" && !!card.source_daily_date) || card.status === filter), [cards, filter]);
  const card = visible[Math.min(index, Math.max(visible.length - 1, 0))];

  function resetPractice() { setPracticeOpen(false); setShowHints(false); setSentence(""); }
  function chooseFilter(value: typeof filter) { setFilter(value); setIndex(0); setFlipped(false); resetPractice(); }
  function move(delta: number) { setIndex((current) => Math.max(0, Math.min(visible.length - 1, current + delta))); setFlipped(false); resetPractice(); }

  const frontText = card ? languageMode === "vi-en" ? card.meaning_vi || card.meaning_en || card.term : card.term : "";
  const backText = card ? languageMode === "en-en" ? card.meaning_en || card.meaning_vi || t("Chưa có nghĩa", "No meaning yet") : languageMode === "vi-en" ? card.term : card.meaning_vi || card.meaning_en || t("Chưa có nghĩa", "No meaning yet") : "";
  const frontLabel = languageMode === "vi-en" ? t("NGHĨA TIẾNG VIỆT", "VIETNAMESE MEANING") : t("TỪ TIẾNG ANH", "ENGLISH WORD");
  const backLabel = languageMode === "en-en" ? t("ĐỊNH NGHĨA TIẾNG ANH", "ENGLISH DEFINITION") : languageMode === "vi-en" ? t("TỪ TIẾNG ANH", "ENGLISH WORD") : t("NGHĨA TIẾNG VIỆT", "VIETNAMESE MEANING");

  async function setStatus(status: FlashcardStatus) {
    if (!card || busy) return;
    setBusy(true); setPendingStatus(status); setError("");
    try {
      await readJson(await fetch("/api/flashcards", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: card.id, status }) }));
      setCards((current) => current.map((entry) => entry.id === card.id ? { ...entry, status } : entry));
      if (filter === "all" || filter === "daily") move(1);
      else { setIndex((current) => filter === status ? current : Math.max(0, Math.min(current, visible.length - 2))); setFlipped(false); resetPractice(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể lưu mức ghi nhớ."); }
    finally { setBusy(false); setPendingStatus(null); }
  }

  async function remove() {
    if (!card || busy || !window.confirm(t(`Xóa flashcard “${card.term}”? Từ vẫn ở Kho từ.`, `Remove the flashcard for “${card.term}”? The word will remain in your vocabulary.`))) return;
    setBusy(true); setError("");
    try {
      await readJson(await fetch(`/api/flashcards?itemId=${card.id}`, { method: "DELETE" }));
      setCards((current) => current.filter((entry) => entry.id !== card.id));
      setIndex((current) => Math.max(0, Math.min(current, visible.length - 2))); setFlipped(false); resetPractice();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể xóa flashcard."); }
    finally { setBusy(false); }
  }

  const counts = Object.fromEntries(statuses.map((status) => [status, cards.filter((entry) => entry.status === status).length]));
  return <main className="library-page"><div className="page-container flashcard-page">
    <div className="page-heading"><div><span className="eyebrow">{t("Ôn tập từ vựng", "Vocabulary review")}</span><h1>Flashcard</h1><p>{t(`${cards.length} thẻ · Lật thẻ rồi chọn mức bạn nhớ từ`, `${cards.length} cards · Flip each card, then choose how well you remember it`)}</p></div></div>
    <div className="flashcard-filters" role="group" aria-label={t("Lọc flashcard", "Filter flashcards")}>
      <button className={filter === "all" ? "active" : ""} onClick={() => chooseFilter("all")}>{t("Tất cả", "All")} · {cards.length}</button>
      <button className={filter === "unrated" ? "active" : ""} onClick={() => chooseFilter("unrated")}>{t("Chưa đánh giá", "Not rated")} · {cards.filter((entry) => !entry.status).length}</button>
      {statuses.map((status) => <button key={status} className={filter === status ? "active" : ""} onClick={() => chooseFilter(status)}>{statusLabels[status]} · {counts[status]}</button>)}
      <button className={filter === "daily" ? "active" : ""} onClick={() => chooseFilter("daily")}>{t("Từ bộ hằng ngày", "From daily sets")} · {cards.filter((entry) => entry.source_daily_date).length}</button>
    </div>
    {error && <p className="daily-feedback error" role="alert">{language === "en" ? "Could not load or update flashcards. Check whether migration 003 has been applied." : error}</p>}
    {loading ? <div className="empty-state" role="status"><LoaderCircle size={26} className="spin" /><h2>{t("Đang tải flashcard…", "Loading flashcards…")}</h2></div> : !card ? <div className="empty-state"><BookOpen size={30} /><h2>{cards.length ? t("Không có thẻ ở mức này", "No cards at this level") : t("Chưa có flashcard", "No flashcards yet")}</h2><p>{t("Tạo thẻ từ tab “Từ vựng hôm nay” hoặc từ từng mục trong Kho từ.", "Create cards from Today's words or individual items in your vocabulary.")}</p></div> : <>
      <label className="flashcard-mode">{t("Ngôn ngữ hai mặt thẻ", "Card language order")}<select value={languageMode} onChange={(event) => { setLanguageMode(event.target.value as CardLanguageMode); setFlipped(false); }}><option value="en-en">Anh → Anh · English → English</option><option value="en-vi">Anh → Việt · English → Vietnamese</option><option value="vi-en">Việt → Anh · Vietnamese → English</option></select></label>
      <div className="flashcard-counter">{t("Thẻ", "Card")} {Math.min(index + 1, visible.length)} / {visible.length}{card.source_daily_date ? t(` · Bộ ngày ${card.source_daily_date}`, ` · Set from ${card.source_daily_date}`) : ""}</div>
      <button type="button" className={`flashcard-surface ${flipped ? "flipped" : ""}`} onClick={() => setFlipped(!flipped)} aria-label={flipped ? t("Lật về mặt từ", "Flip to word") : t("Lật xem nghĩa", "Flip to meaning")}>
        <span className="flashcard-hint">{flipped ? backLabel : frontLabel}</span>
        <strong>{flipped ? backText : frontText}</strong>
        {flipped && languageMode === "en-en" && card.example && <em>{card.example}</em>}
        <small><RotateCcw size={15} /> {t("Chạm để lật", "Tap to flip")}</small>
      </button>
      <section className="flashcard-practice">
        <div className="flashcard-practice-heading"><div><strong>{t("Luyện đặt câu", "Sentence practice")}</strong><p>{t(`Viết một câu tiếng Anh có “${card.term}”.`, `Write an English sentence using “${card.term}”.`)}</p></div><button className="subtle-button" type="button" onClick={() => { setPracticeOpen(!practiceOpen); setShowHints(false); }}>{practiceOpen ? t("Thu gọn", "Close") : t("Bắt đầu", "Practice")}</button></div>
        {practiceOpen && <><textarea aria-label={t("Câu của bạn", "Your sentence")} value={sentence} onChange={(event) => setSentence(event.target.value)} rows={3} placeholder={t(`Thử đặt câu với “${card.term}”…`, `Try a sentence with “${card.term}”…`)} />
          <button className="flashcard-hint-toggle" type="button" onClick={() => setShowHints(!showHints)}><Lightbulb size={16} />{showHints ? t("Ẩn gợi ý", "Hide hints") : t("Cho tôi gợi ý", "Show me a hint")}</button>
          {showHints && <div className="flashcard-hints"><p><strong>{t("Nghĩa", "Meaning")}:</strong> {card.meaning_vi || card.meaning_en || t("Chưa có nghĩa", "No meaning yet")}</p>{card.collocations.length > 0 && <p><strong>{t("Cụm từ có thể dùng", "Useful collocations")}:</strong> {card.collocations.join(" · ")}</p>}{card.example && <p><strong>{t("Câu tham khảo", "Example")}:</strong> {card.example}</p>}</div>}
        </>}
      </section>
      <div className="learning-tags flashcard-tags">{card.cefr_level && <span>{card.cefr_level}</span>}{card.ielts_relevance && <span>{relevance[card.ielts_relevance]}</span>}{card.topics.map((topic) => <span key={topic}>{topics[topic as keyof typeof topics] ?? topic}</span>)}{card.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
      <div className="flashcard-rating" aria-label={t("Chọn mức ghi nhớ", "Choose recall level")}>{statuses.map((status) => <button key={status} className={card.status === status ? "selected" : ""} disabled={busy} onClick={() => setStatus(status)}>{pendingStatus === status && <LoaderCircle size={15} className="spin" />}{statusLabels[status]}</button>)}</div>
      <div className="flashcard-navigation"><button className="subtle-button" onClick={() => move(-1)} disabled={busy || index === 0}><ArrowLeft size={16} /> {t("Trước", "Previous")}</button><button className="subtle-button" onClick={remove} disabled={busy}>{busy && !pendingStatus ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}{busy && !pendingStatus ? t("Đang bỏ thẻ…", "Removing…") : t("Bỏ thẻ", "Remove card")}</button><button className="subtle-button" onClick={() => move(1)} disabled={busy || index >= visible.length - 1}>{t("Tiếp", "Next")} <ArrowRight size={16} /></button></div>
    </>}
  </div></main>;
}
