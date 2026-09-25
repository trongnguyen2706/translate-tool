"use client";

import { ChangeEvent, ClipboardEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Check, CheckCheck, ChevronDown, ImagePlus, LoaderCircle, RotateCcw, Save, Sparkles, Trash2, X } from "lucide-react";
import type { Direction, Suggestion } from "@/lib/validation";
import type { StudyOptions } from "@/lib/validation";
import { cefrLevels, ieltsSkills, relevanceLabels, relevanceLabelsEn, skillLabels, topicKeys, topicLabels, topicLabelsEn } from "@/lib/learning";
import { usePreferences } from "@/components/preferences-provider";

type Translation = { id: string; source_text: string; translated_text: string; direction: Direction; created_at: string };
type Draft = Suggestion & { status: "pending" | "saved" | "dismissed"; id: string; savedRecordId?: string; alreadyExisted?: boolean };

const directions: { value: Direction; label: string }[] = [
  { value: "en-vi", label: "Anh → Việt" },
  { value: "vi-en", label: "Việt → Anh" },
  { value: "en-en", label: "Anh → Anh" }
];

async function readApi<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Có lỗi xảy ra.");
  return data as T;
}

export function ChatWorkspace({ historyId }: { historyId?: string }) {
  const { language, t } = usePreferences();
  const topics = language === "en" ? topicLabelsEn : topicLabels;
  const relevance = language === "en" ? relevanceLabelsEn : relevanceLabels;
  const [text, setText] = useState("");
  const [draftText, setDraftText] = useState("");
  const [direction, setDirection] = useState<Direction>("en-vi");
  const [resultDirection, setResultDirection] = useState<Direction>("en-vi");
  const [translation, setTranslation] = useState("");
  const [activePane, setActivePane] = useState<"translation" | "suggestions">("translation");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [savedTranslationId, setSavedTranslationId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [approveBeforeSave, setApproveBeforeSave] = useState(true);
  const [studyOptions, setStudyOptions] = useState<StudyOptions>({ mode: "general", currentLevel: "B1", skill: "all", topic: "all", count: 8 });
  const [suggestionSource, setSuggestionSource] = useState<"translation" | "study">("translation");
  const [focusTerm, setFocusTerm] = useState("");
  const [busy, setBusy] = useState<"ocr" | "translate" | "suggest" | "save" | null>(null);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [undoingDraftId, setUndoingDraftId] = useState<string | null>(null);
  const [deletingTranslation, setDeletingTranslation] = useState(false);
  const [ocrProgress, setOcrProgress] = useState("");
  const [imageName, setImageName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const translationScrollRef = useRef<HTMLDivElement>(null);
  const ocrRunningRef = useRef(false);

  const updateJumpButton = useCallback(() => {
    const pane = translationScrollRef.current;
    if (!pane) return;
    setShowJumpToLatest(pane.scrollHeight - pane.scrollTop - pane.clientHeight > 64);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(updateJumpButton);
    window.addEventListener("resize", updateJumpButton);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", updateJumpButton); };
  }, [text, translation, activePane, updateJumpButton]);

  const reset = useCallback(() => {
    setText(""); setDraftText(""); setTranslation(""); setDrafts([]); setFocusTerm("");
    setActivePane("translation"); setSuggestionSource("translation"); setShowJumpToLatest(false);
    setSavedTranslationId(null); setImageName(""); setError(""); setNotice("");
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = () => reset();
    window.addEventListener("new-chat", handler);
    return () => window.removeEventListener("new-chat", handler);
  }, [reset]);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" }).then((res) => readApi<{ settings: { default_direction: Direction; approve_before_save: boolean } }>(res))
      .then(({ settings }) => { setDirection(settings.default_direction); setApproveBeforeSave(settings.approve_before_save); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!historyId) return;
    fetch("/api/translations", { cache: "no-store" }).then((res) => readApi<{ items: Translation[] }>(res))
      .then(({ items }) => {
        const item = items.find((entry) => entry.id === historyId);
        if (!item) { setError(t("Không tìm thấy bản dịch đã lưu.", "Saved translation not found.")); return; }
        setText(item.source_text); setDraftText(""); setDirection(item.direction); setResultDirection(item.direction); setTranslation(item.translated_text); setActivePane("translation");
        setSavedTranslationId(item.id); setDrafts([]); setFocusTerm(""); setNotice(""); setError("");
      }).catch((err) => setError(err.message));
  }, [historyId, t]);

  async function processImage(file: File, label: string) {
    if (busy || ocrRunningRef.current) {
      setError(t("Đang xử lý. Vui lòng thử lại sau.", "Processing in progress. Please try again shortly."));
      return;
    }
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
      setError(t("Chọn ảnh PNG/JPG/WebP/BMP dưới 8 MB.", "Choose a PNG, JPG, WebP or BMP image under 8 MB.")); return;
    }
    ocrRunningRef.current = true;
    setBusy("ocr"); setError(""); setNotice(""); setOcrProgress(t("Đang chuẩn bị OCR…", "Preparing OCR…")); setImageName(label);
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(["eng", "vie"], 1, {
        logger: (message) => {
          if (typeof message.progress === "number") setOcrProgress(t(`Đang đọc chữ… ${Math.round(message.progress * 100)}%`, `Reading text… ${Math.round(message.progress * 100)}%`));
        }
      });
      try {
        const result = await worker.recognize(file);
        const extracted = result.data.text.trim();
        if (!extracted) throw new Error(t("OCR không nhận ra chữ. Thử cắt vùng ảnh rõ hơn hoặc nhập text thủ công.", "OCR could not read the text. Try a clearer crop or enter it manually."));
        setDraftText(extracted);
        setNotice(t("Đã đọc chữ từ ảnh. Bạn có thể sửa text trước khi dịch.", "Text extracted from the image. You can edit it before translating."));
      } finally { await worker.terminate(); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể đọc ảnh này.");
    } finally {
      ocrRunningRef.current = false;
      setBusy(null); setOcrProgress("");
    }
  }

  async function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await processImage(file, file.name); }
    finally { event.target.value = ""; }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.kind === "file" && item.type.startsWith("image/"));
    const image = imageItem?.getAsFile() ?? Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    void processImage(image, t("Ảnh đã dán", "Pasted image"));
  }

  async function translate(event?: FormEvent) {
    event?.preventDefault();
    if (!draftText.trim() || busy) return;
    const source = draftText.trim();
    const selectedDirection = direction;
    setText(source); setDraftText(""); setImageName(""); setResultDirection(selectedDirection); setActivePane("translation"); setSuggestionSource("translation");
    setBusy("translate"); setError(""); setNotice(""); setDrafts([]); setTranslation(""); setSavedTranslationId(null);
    try {
      const { translation: result } = await readApi<{ translation: string }>(await fetch("/api/translate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: source, direction: selectedDirection })
      }));
      setTranslation(result);
      if (!approveBeforeSave) await runSuggestions(source, result, selectedDirection, "translation");
    } catch (err) { setDraftText((current) => current || source); setError(err instanceof Error ? err.message : "Không thể dịch."); }
    finally { setBusy(null); }
  }

  async function saveTranslation() {
    if (!translation || savedTranslationId) return;
    setBusy("save"); setError("");
    try {
      const { item } = await readApi<{ item: Translation }>(await fetch("/api/translations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_text: text, direction: resultDirection, translated_text: translation })
      }));
      setSavedTranslationId(item.id); setNotice(t("Đã lưu bản dịch vào lịch sử.", "Translation saved to history."));
      window.dispatchEvent(new Event("translations-updated"));
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể lưu."); }
    finally { setBusy(null); }
  }

  async function saveDraft(item: Draft, source = text) {
    const { item: savedItem, already_existed } = await readApi<{ item: { id: string }; already_existed: boolean }>(await fetch("/api/vocabulary", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        term: item.term, kind: item.kind, meaning_vi: item.meaning_vi,
        meaning_en: item.meaning_en, example: item.example,
        collocations: item.collocations, source_text: source,
        source_language: "en", note: "", cefr_level: item.cefr_level,
        ielts_relevance: item.ielts_relevance, ielts_skills: item.ielts_skills,
        topics: item.topics, tags: item.tags, learning_reason: item.learning_reason
      })
    }));
    setDrafts((current) => current.map((draft) => draft.id === item.id ? { ...draft, status: "saved", savedRecordId: savedItem.id, alreadyExisted: already_existed } : draft));
  }

  async function saveDraftManually(item: Draft) {
    if (savingDraftId) return;
    setSavingDraftId(item.id);
    try { await saveDraft(item); }
    catch (err) { setError(err instanceof Error ? err.message : "Không thể lưu từ."); }
    finally { setSavingDraftId(null); }
  }

  async function undoSave(item: Draft) {
    if (!item.savedRecordId || item.alreadyExisted) return;
    setUndoingDraftId(item.id);
    try {
      await readApi(await fetch(`/api/vocabulary?id=${item.savedRecordId}`, { method: "DELETE" }));
      setDrafts((current) => current.map((draft) => draft.id === item.id ? { ...draft, status: "pending", savedRecordId: undefined } : draft));
      setNotice(t("Đã hoàn tác lưu từ.", "Word save undone."));
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể hoàn tác."); }
    finally { setUndoingDraftId(null); }
  }

  async function runSuggestions(source: string, translated: string, selectedDirection: Direction, sourceMode: "translation" | "study", selectedTerm = "", append = false) {
    setBusy("suggest"); setError(""); setNotice("");
    try {
      const { items } = await readApi<{ items: Suggestion[] }>(await fetch("/api/suggestions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceMode, text: source, ...(sourceMode === "translation" ? { translation: translated } : {}), direction: selectedDirection, options: studyOptions, ...(selectedTerm ? { focusTerm: selectedTerm } : {}) })
      }));
      const newDrafts: Draft[] = items.map((item, index) => ({ ...item, status: "pending", id: `${Date.now()}-${index}` }));
      setDrafts((current) => append ? [...current, ...newDrafts] : newDrafts);
      if (sourceMode === "translation" && !approveBeforeSave) {
        const results = await Promise.allSettled(newDrafts.map((item) => saveDraft(item, source)));
        const failures = results.filter((result) => result.status === "rejected").length;
        setNotice(failures ? t(`Đã lưu ${results.length - failures} mục; ${failures} mục chưa lưu được.`, `Saved ${results.length - failures} items; ${failures} could not be saved.`) : t(`Đã lưu ${results.length} mục vào kho từ.`, `Saved ${results.length} items to your vocabulary.`));
      }
      if (!items.length) setNotice(t("Chưa tìm thấy từ hoặc cụm phù hợp trong đoạn này.", "No suitable words or phrases found in this passage."));
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể gợi ý từ."); return false; }
    finally { setBusy(null); }
  }

  async function suggest(termOverride = "", append = false) {
    if (!translation || busy) return;
    setSuggestionSource("translation");
    setActivePane("suggestions");
    await runSuggestions(text, translation, resultDirection, "translation", termOverride || focusTerm, append);
  }

  async function study() {
    if (!draftText.trim() || busy) return;
    const source = draftText.trim();
    setText(source); setDraftText(""); setTranslation(""); setSavedTranslationId(null);
    setResultDirection(direction); setSuggestionSource("study"); setActivePane("suggestions");
    setDrafts([]); setFocusTerm(""); setImageName("");
    const succeeded = await runSuggestions(source, "", direction, "study");
    if (!succeeded) setDraftText((current) => current || source);
  }

  function updateDraft<K extends keyof Suggestion>(id: string, key: K, value: Suggestion[K]) {
    setDrafts((current) => current.map((item) => item.id === id ? {
      ...item, [key]: value
    } : item));
  }

  function captureSelection() {
    const selected = window.getSelection()?.toString().trim();
    if (selected && selected.length <= 120) setFocusTerm(selected);
  }

  async function deleteTranslation() {
    if (!savedTranslationId || deletingTranslation) return;
    setDeletingTranslation(true);
    try {
      await readApi(await fetch(`/api/translations?id=${savedTranslationId}`, { method: "DELETE" }));
      setSavedTranslationId(null); setNotice(t("Đã xóa bản dịch khỏi lịch sử.", "Translation removed from history."));
      window.dispatchEvent(new Event("translations-updated"));
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể xóa."); }
    finally { setDeletingTranslation(false); }
  }

  const hasContent = Boolean(text || translation);
  return <main className={`chat-page ${hasContent ? "chat-page-active" : ""}`}>
    <div className={`conversation ${hasContent ? "has-content" : ""}`}>
      {!hasContent && <div className="welcome">
        <div className="welcome-icon"><BookOpen size={24} /></div>
          <h1>{t("Bạn muốn dịch hay học từ đoạn này?", "Translate or study this passage?")}</h1>
        <p>{t("Nhập văn bản hoặc dán ảnh chụp màn hình. Chọn Dịch hoặc Học từ đoạn này.", "Enter text or paste a screenshot, then choose Translate or Study this passage.")}</p>
      </div>}
      {hasContent && <div className="message-stack">
        <div className="workspace-tabs" aria-label={t("Chọn nội dung xem", "Choose view")}>
          <button type="button" className={activePane === "translation" ? "active" : ""} aria-pressed={activePane === "translation"} onClick={() => setActivePane("translation")}>{t("Bản dịch", "Translation")}</button>
          <button type="button" className={activePane === "suggestions" ? "active" : ""} aria-pressed={activePane === "suggestions"} onClick={() => setActivePane("suggestions")}>{t("Gợi ý từ", "Word suggestions")} {drafts.filter((item) => item.status !== "dismissed").length > 0 ? `(${drafts.filter((item) => item.status !== "dismissed").length})` : ""}</button>
        </div>
        <div className={`translation-column ${activePane !== "translation" ? "is-mobile-hidden" : ""}`}>
        <div className="translation-pane" ref={translationScrollRef} onScroll={updateJumpButton}>
        <div className="source-block" onMouseUp={captureSelection}>
          <div className="block-label">{t("Văn bản gốc", "Original text")} <span>{t(directions.find((entry) => entry.value === resultDirection)?.label ?? "", {"en-vi":"English → Vietnamese","vi-en":"Vietnamese → English","en-en":"English → English"}[resultDirection])}</span></div>
          <p>{text}</p>
        </div>
        {(translation || busy === "translate") && <section className="translation-block" onMouseUp={captureSelection}>
          <div className="block-label">{t("Bản dịch", "Translation")}</div>
          {busy === "translate" ? <div className="translation-skeleton" role="status" aria-label={t("Đang dịch", "Translating")}>
            <div className="translation-skeleton-status"><LoaderCircle size={16} className="spin" /><span>{t("Đang dịch…", "Translating…")}</span></div>
            <span className="skeleton-line wide" /><span className="skeleton-line medium" /><span className="skeleton-line short" />
          </div> : <p className="result-reveal">{translation}</p>}
          {translation && <div className="result-actions">
            <button className="subtle-button" onClick={saveTranslation} disabled={!!savedTranslationId || !!busy}>{busy === "save" ? <LoaderCircle size={16} className="spin" /> : savedTranslationId ? <Check size={16} /> : <Save size={16} />}{busy === "save" ? t("Đang lưu…", "Saving…") : savedTranslationId ? t("Đã lưu", "Saved") : t("Lưu bản dịch", "Save translation")}</button>
            <button className="subtle-button" onClick={() => suggest()} disabled={!!busy}>{busy === "suggest" ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}{busy === "suggest" ? t("Đang gợi ý…", "Finding words…") : focusTerm ? t(`Gợi ý: ${focusTerm}`, `Suggest: ${focusTerm}`) : t("Gợi ý từ vựng", "Suggest vocabulary")}</button>
            {savedTranslationId && <button className="subtle-button danger" onClick={deleteTranslation} disabled={deletingTranslation}>{deletingTranslation ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}{deletingTranslation ? t("Đang xóa…", "Deleting…") : t("Xóa lịch sử", "Delete from history")}</button>}
          </div>}
        </section>}

        {focusTerm && <div className="focus-chip">{t("Đã chọn:", "Selected:")} <strong>{focusTerm}</strong><button onClick={() => suggestionSource === "study" ? runSuggestions(text, "", resultDirection, "study", focusTerm, true) : suggest(focusTerm, true)} disabled={!!busy}>{t("Gợi ý mục này", "Suggest this item")}</button><button onClick={() => setFocusTerm("")} aria-label={t("Bỏ chọn từ", "Clear selected word")}><X size={15} /></button></div>}
        </div>
        {showJumpToLatest && <button type="button" className="jump-to-latest" onClick={() => translationScrollRef.current?.scrollTo({ top: translationScrollRef.current.scrollHeight, behavior: "smooth" })} aria-label={t("Xuống cuối hội thoại", "Jump to latest")} title={t("Xuống cuối hội thoại", "Jump to latest")}><ArrowDown size={19} /></button>}
        </div>

        <section className={`suggestions-section ${activePane !== "suggestions" ? "is-mobile-hidden" : ""}`}>
          <div className="section-heading"><div><span className="eyebrow">{t("Kho từ cá nhân", "Personal vocabulary")}</span><h2>{t("Gợi ý để học", "Study suggestions")}</h2></div></div>
          {busy === "suggest" && <div className="suggestion-loading" role="status" aria-label={t("Đang tìm từ và cụm từ", "Finding words and phrases")}>
            <div className="translation-skeleton-status"><LoaderCircle size={16} className="spin" /><span>{t("Đang tìm từ và cụm từ…", "Finding words and phrases…")}</span></div>
            <div className="suggestion-skeleton-card"><span className="skeleton-line short" /><span className="skeleton-line wide" /><span className="skeleton-line medium" /></div>
            <div className="suggestion-skeleton-card"><span className="skeleton-line short" /><span className="skeleton-line medium" /></div>
          </div>}
          {busy !== "suggest" && drafts.length === 0 && <p className="suggestions-empty">{suggestionSource === "study" ? t("Chưa có từ phù hợp. Thử đổi bộ lọc hoặc nhập đoạn khác.", "No suitable words yet. Change the filters or try another passage.") : approveBeforeSave ? t("Dịch xong, nhấn Gợi ý từ vựng để xem từ và cụm từ ở đây.", "After translating, select Suggest vocabulary to see words and phrases here.") : t("Sau khi dịch, từ và cụm từ được gợi ý rồi lưu tự động ở đây.", "Suggested words and phrases will be saved here automatically after translation.")}</p>}
          <div className="suggestion-list">{drafts.filter((item) => item.status !== "dismissed").map((item) => <article className="suggestion-card" key={item.id}>
            <div className="suggestion-top"><span className="type-pill">{item.kind === "phrase" ? t("Cụm từ", "Phrase") : t("Từ", "Word")}</span><span className={`status ${item.status}`}>{item.status === "saved" ? t("Đã lưu", "Saved") : t("Chờ duyệt", "Pending review")}</span></div>
            <input className="term-input" aria-label={t("Từ hoặc cụm từ", "Word or phrase")} value={item.term} onChange={(event) => updateDraft(item.id, "term", event.target.value)} disabled={item.status === "saved"} />
            <div className="suggestion-fields"><label>{t("Nghĩa tiếng Việt", "Vietnamese meaning")}<input value={item.meaning_vi} onChange={(event) => updateDraft(item.id, "meaning_vi", event.target.value)} disabled={item.status === "saved"} /></label><label>English meaning<input value={item.meaning_en} onChange={(event) => updateDraft(item.id, "meaning_en", event.target.value)} disabled={item.status === "saved"} /></label></div>
            <label className="field-label">{t("Ví dụ", "Example")}<input value={item.example} onSelect={(event) => { const input = event.currentTarget; const selected = input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0).trim(); if (selected && selected.length <= 120) setFocusTerm(selected); }} onChange={(event) => updateDraft(item.id, "example", event.target.value)} disabled={item.status === "saved"} /></label>
            <label className="field-label">Collocations <small>{t("(cách nhau bằng dấu phẩy)", "(comma separated)")}</small><input value={item.collocations.join(", ")} onChange={(event) => updateDraft(item.id, "collocations", event.target.value.split(",").map((part) => part.trim()).filter(Boolean))} disabled={item.status === "saved"} /></label>
            <div className="learning-fields"><label>{t("Trình độ", "Level")}<select value={item.cefr_level ?? ""} onChange={(event) => updateDraft(item.id, "cefr_level", event.target.value ? event.target.value as Suggestion["cefr_level"] : null)} disabled={item.status === "saved"}><option value="">{t("Chưa rõ", "Unknown")}</option>{cefrLevels.map((level) => <option key={level}>{level}</option>)}</select></label><label>{t("Mức ưu tiên IELTS", "IELTS priority")}<select value={item.ielts_relevance ?? ""} onChange={(event) => updateDraft(item.id, "ielts_relevance", event.target.value ? event.target.value as Suggestion["ielts_relevance"] : null)} disabled={item.status === "saved"}><option value="">{t("Chưa rõ", "Unknown")}</option>{Object.entries(relevance).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
            <div className="learning-fields"><label>{t("Lĩnh vực", "Topic")}<select value="" onChange={(event) => { const topic = event.target.value as Suggestion["topics"][number]; updateDraft(item.id, "topics", item.topics.includes(topic) ? item.topics.filter((entry) => entry !== topic) : [...item.topics, topic].slice(0, 4)); }} disabled={item.status === "saved"}><option value="">{item.topics.length ? item.topics.map((topic) => topics[topic]).join(", ") : t("Chọn lĩnh vực", "Choose topic")}</option>{topicKeys.map((topic) => <option key={topic} value={topic}>{item.topics.includes(topic) ? "✓ " : ""}{topics[topic]}</option>)}</select></label><label>{t("Kỹ năng IELTS", "IELTS skill")}<select value="" onChange={(event) => { const skill = event.target.value as Suggestion["ielts_skills"][number]; updateDraft(item.id, "ielts_skills", item.ielts_skills.includes(skill) ? item.ielts_skills.filter((entry) => entry !== skill) : [...item.ielts_skills, skill]); }} disabled={item.status === "saved"}><option value="">{item.ielts_skills.length ? item.ielts_skills.map((skill) => skillLabels[skill]).join(", ") : t("Chọn kỹ năng", "Choose skill")}</option>{ieltsSkills.map((skill) => <option key={skill} value={skill}>{item.ielts_skills.includes(skill) ? "✓ " : ""}{skillLabels[skill]}</option>)}</select></label></div>
            <div className="suggestion-ai-tags"><span className="field-label">{t("Tag AI · lưu cùng từ", "AI tags · saved with word")}</span><div className="learning-tags">{(item.tags ?? []).map((tag) => <span key={tag}>#{tag}</span>)}</div></div>
            <label className="field-label">{t("Lý do gợi ý", "Reason for suggestion")}<input value={item.learning_reason} onChange={(event) => updateDraft(item.id, "learning_reason", event.target.value)} disabled={item.status === "saved"} /></label>
            {item.collocations.length > 0 && <div className="collocation-action-list">{item.collocations.map((collocation) => <button key={collocation} onClick={() => suggestionSource === "study" ? runSuggestions(text, "", resultDirection, "study", collocation, true) : suggest(collocation, true)} disabled={!!busy} title={t("Tạo gợi ý riêng cho cụm này", "Suggest this phrase separately")}>+ {collocation}</button>)}</div>}
            <div className="suggestion-actions">{item.status === "pending" ? <><button className="primary-small" onClick={() => saveDraftManually(item)} disabled={!!savingDraftId}>{savingDraftId === item.id ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{savingDraftId === item.id ? t("Đang lưu…", "Saving…") : t("Lưu từ", "Save word")}</button><button className="subtle-button" onClick={() => setDrafts((current) => current.map((draft) => draft.id === item.id ? { ...draft, status: "dismissed" } : draft))} disabled={savingDraftId === item.id}>{t("Bỏ qua", "Skip")}</button></> : <><span className="saved-note"><CheckCheck size={16} /> {item.alreadyExisted ? t("Đã có trong kho từ", "Already in vocabulary") : t("Đã lưu", "Saved")}</span>{!item.alreadyExisted && <button className="subtle-button" onClick={() => undoSave(item)} disabled={!!undoingDraftId}>{undoingDraftId === item.id ? <LoaderCircle size={15} className="spin" /> : <RotateCcw size={15} />}{undoingDraftId === item.id ? t("Đang hoàn tác…", "Undoing…") : t("Hoàn tác", "Undo")}</button>}</>}</div>
          </article>)}</div>
          {drafts.some((item) => item.status === "dismissed") && <button className="text-button" onClick={() => setDrafts((current) => current.map((item) => item.status === "dismissed" ? { ...item, status: "pending" } : item))}><RotateCcw size={15} /> {t("Hiện lại mục đã bỏ qua", "Show skipped items")}</button>}
        </section>
      </div>}
    </div>
    <div className="composer-wrap"><div className="composer-inner"><div className="composer-main">
      {error && <div className="notice error" role="alert">{language === "en" && /[À-ỹ]/u.test(error) ? "Could not complete the request. Please try again." : error}<button onClick={() => setError("")} aria-label={t("Đóng lỗi", "Dismiss error")}><X size={15} /></button></div>}
      {notice && <div className="notice success" role="status">{notice}<button onClick={() => setNotice("")} aria-label={t("Đóng thông báo", "Dismiss message")}><X size={15} /></button></div>}
      {imageName && <div className="attachment-chip"><ImagePlus size={15} />{imageName}<button onClick={() => setImageName("")} aria-label={t("Bỏ tên ảnh", "Remove image label")}><X size={14} /></button></div>}
      {busy === "ocr" && <div className="ocr-progress"><LoaderCircle size={15} className="spin" /> {ocrProgress}</div>}
      <form className="composer" onSubmit={translate}>
        <textarea ref={inputRef} value={draftText} onChange={(event) => { setDraftText(event.target.value); setImageName(""); }} onPaste={handlePaste} placeholder={t("Nhập, dán văn bản hoặc dán ảnh chụp màn hình…", "Type or paste text, or paste a screenshot…")} aria-label={t("Văn bản để dịch hoặc học", "Text to translate or study")} rows={Math.min(6, Math.max(2, Math.ceil(draftText.length / 90)))} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); translate(); } }} maxLength={12000} disabled={!!busy} />
        <div className="composer-toolbar">
          <div className="composer-tools"><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/bmp" hidden onChange={handleImage} /><button type="button" className="icon-button attachment-button" aria-label={t("Chọn ảnh", "Choose image")} title={t("Chọn ảnh", "Choose image")} onClick={() => fileRef.current?.click()} disabled={!!busy}><ImagePlus size={20} /></button><div className="select-wrap"><select aria-label={t("Chiều dịch", "Translation direction")} value={direction} onChange={(event) => setDirection(event.target.value as Direction)} disabled={!!busy}><option value="en-vi">{t("Anh → Việt", "English → Vietnamese")}</option><option value="vi-en">{t("Việt → Anh", "Vietnamese → English")}</option><option value="en-en">{t("Anh → Anh", "English → English")}</option></select><ChevronDown size={14} /></div></div>
          <div className="composer-submit"><button type="button" className="study-button" onClick={study} disabled={!draftText.trim() || !!busy}>{busy === "suggest" && suggestionSource === "study" ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}{busy === "suggest" && suggestionSource === "study" ? t("Đang tìm từ…", "Finding words…") : t("Học từ đoạn này", "Study this passage")}</button><button type="submit" className="send-button" aria-label={busy === "translate" ? t("Đang dịch", "Translating") : t("Dịch", "Translate")} title={t("Dịch", "Translate")} disabled={!draftText.trim() || !!busy}>{busy === "translate" ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={19} />}</button></div>
        </div>
      </form>
      <details className="study-settings"><summary>{t("Điều kiện gợi ý", "Suggestion filters")} · {studyOptions.currentLevel} · {studyOptions.mode === "general" ? t("Thông thường", "General") : "IELTS"}</summary><div className="study-settings-grid">
        <label>{t("Chế độ", "Mode")}<select value={studyOptions.mode} onChange={(event) => setStudyOptions({ ...studyOptions, mode: event.target.value as StudyOptions["mode"] })}><option value="general">{t("Thông thường", "General")}</option><option value="ielts-academic">IELTS Academic</option><option value="ielts-general">IELTS General</option></select></label>
        <label>{t("Trình độ hiện tại", "Current level")}<select value={studyOptions.currentLevel} onChange={(event) => setStudyOptions({ ...studyOptions, currentLevel: event.target.value as StudyOptions["currentLevel"] })}>{cefrLevels.map((level) => <option key={level}>{level}</option>)}</select></label>
        <label>{t("Kỹ năng", "Skill")}<select value={studyOptions.skill} onChange={(event) => setStudyOptions({ ...studyOptions, skill: event.target.value as StudyOptions["skill"] })}><option value="all">{t("Tất cả", "All")}</option>{ieltsSkills.map((skill) => <option key={skill} value={skill}>{skillLabels[skill]}</option>)}</select></label>
        <label>{t("Lĩnh vực", "Topic")}<select value={studyOptions.topic} onChange={(event) => setStudyOptions({ ...studyOptions, topic: event.target.value as StudyOptions["topic"] })}><option value="all">{t("Mọi lĩnh vực", "Any topic")}</option>{topicKeys.map((topic) => <option key={topic} value={topic}>{topics[topic]}</option>)}</select></label>
        <label>{t("Số gợi ý", "Number of suggestions")}<select value={studyOptions.count} onChange={(event) => setStudyOptions({ ...studyOptions, count: Number(event.target.value) as StudyOptions["count"] })}><option value={5}>5</option><option value={8}>8</option><option value={10}>10</option></select></label>
      </div></details>
    </div></div></div>
  </main>;
}
