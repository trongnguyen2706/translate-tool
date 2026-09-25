"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, BookOpen, Download, FileUp, Layers3, LoaderCircle, Plus, Search, Trash2, X } from "lucide-react";
import { usePreferences } from "@/components/preferences-provider";
import { cefrLevels, ieltsSkills, relevanceLabels, relevanceLabelsEn, skillLabels, topicKeys, topicLabels, topicLabelsEn } from "@/lib/learning";
import type { Suggestion } from "@/lib/validation";

type Item = {
  id: string; term: string; kind: "word" | "phrase"; source_language: "en" | "vi";
  meaning_vi: string; meaning_en: string; example: string; collocations: string[];
  source_text: string; note: string; created_at: string; updated_at: string;
  cefr_level: Suggestion["cefr_level"]; ielts_relevance: Suggestion["ielts_relevance"];
  ielts_skills: Suggestion["ielts_skills"]; topics: Suggestion["topics"]; tags: string[]; learning_reason: string;
};
type Draft = Omit<Item, "id" | "created_at" | "updated_at">;
type Period = "all" | "day" | "week" | "month" | "weekday";

const blankDraft: Draft = {
  term: "", kind: "word", source_language: "en", meaning_vi: "", meaning_en: "",
  example: "", collocations: [], source_text: "", note: "", cefr_level: null,
  ielts_relevance: null, ielts_skills: [], topics: [], tags: [], learning_reason: ""
};

function localDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function mondayKey(dateString: string) {
  const date = new Date(`${dateString}T12:00:00Z`);
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((weekday + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function weekdayKey(dateString: string) {
  return new Date(`${dateString}T12:00:00Z`).getUTCDay();
}

async function apiJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Có lỗi xảy ra.");
  return data as T;
}

export function LibraryView() {
  const { language, t } = usePreferences();
  const topics = language === "en" ? topicLabelsEn : topicLabels;
  const relevance = language === "en" ? relevanceLabelsEn : relevanceLabels;
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [anchor, setAnchor] = useState(() => localDate(new Date().toISOString()));
  const [weekday, setWeekday] = useState("1");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [levelFilter, setLevelFilter] = useState("all");
  const [ieltsFilter, setIeltsFilter] = useState("all");
  const [topicFilter, setTopicFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [classifying, setClassifying] = useState(false);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [tagInput, setTagInput] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const csvImportRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const { items: result } = await apiJson<{ items: Item[] }>(await fetch("/api/vocabulary", { cache: "no-store" }));
      setItems(result);
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể tải kho từ."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    fetch("/api/vocabulary", { cache: "no-store" })
      .then((response) => apiJson<{ items: Item[] }>(response))
      .then(({ items: result }) => setItems(result))
      .catch((err) => setError(err instanceof Error ? err.message : "Không thể tải kho từ."))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => items.filter((item) => {
    const q = query.trim().toLocaleLowerCase();
    if (q && ![item.term, item.meaning_vi, item.meaning_en, item.example, ...item.collocations].some((value) => value.toLocaleLowerCase().includes(q))) return false;
    const date = localDate(item.created_at);
    if (period === "day" && date !== anchor) return false;
    if (period === "week" && mondayKey(date) !== mondayKey(anchor)) return false;
    if (period === "month" && date.slice(0, 7) !== anchor.slice(0, 7)) return false;
    if (period === "weekday" && weekdayKey(date) !== Number(weekday)) return false;
    if (levelFilter !== "all" && (levelFilter === "unclassified" ? item.cefr_level !== null : item.cefr_level !== levelFilter)) return false;
    if (ieltsFilter !== "all" && (ieltsFilter === "unclassified" ? item.ielts_relevance !== null : item.ielts_relevance !== ieltsFilter)) return false;
    if (topicFilter !== "all" && !item.topics.includes(topicFilter as Suggestion["topics"][number])) return false;
    if (tagFilter !== "all" && !(item.tags ?? []).includes(tagFilter)) return false;
    return true;
  }).sort((a, b) => sort === "newest" ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at)), [items, query, period, anchor, weekday, sort, levelFilter, ieltsFilter, topicFilter, tagFilter]);

  const allTags = useMemo(() => [...new Set(items.flatMap((item) => item.tags ?? []))].sort((a, b) => a.localeCompare(b, "vi")), [items]);

  const groups = useMemo(() => {
    const result: { title: string; items: Item[] }[] = [];
    for (const item of visible) {
      const date = localDate(item.created_at);
      const key = period === "month" ? date.slice(0, 7) : period === "week" ? mondayKey(date) : period === "weekday" ? `Thứ ${weekdayKey(date) === 0 ? "Chủ nhật" : weekdayKey(date) + 1}` : date;
      let group = result.find((entry) => entry.title === key);
      if (!group) { group = { title: key, items: [] }; result.push(group); }
      group.items.push(item);
    }
    return result;
  }, [visible, period]);

  function startEdit(item?: Item) {
    setDraft(item ? {
      term: item.term, kind: item.kind, source_language: item.source_language,
      meaning_vi: item.meaning_vi, meaning_en: item.meaning_en, example: item.example,
      collocations: item.collocations, source_text: item.source_text, note: item.note,
      cefr_level: item.cefr_level, ielts_relevance: item.ielts_relevance,
      ielts_skills: item.ielts_skills, topics: item.topics, tags: item.tags ?? [], learning_reason: item.learning_reason
    } : { ...blankDraft });
    setTagInput((item?.tags ?? []).join("; "));
    setEditingId(item?.id ?? "new"); setError("");
  }

  async function save() {
    if (!draft.term.trim()) { setError(t("Nhập từ hoặc cụm từ trước khi lưu.", "Enter a word or phrase before saving.")); return; }
    const tags = [...new Set(tagInput.split(";").map((part) => part.trim()).filter(Boolean))];
    if (tags.length > 16 || tags.some((tag) => tag.length > 40)) { setError(t("Tối đa 16 tag, mỗi tag tối đa 40 ký tự.", "Use at most 16 tags, with up to 40 characters each.")); return; }
    setSaving(true); setError("");
    try {
      const isNew = editingId === "new";
      await apiJson(await fetch("/api/vocabulary", {
        method: isNew ? "POST" : "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isNew ? { ...draft, tags } : { id: editingId, values: { ...draft, tags } })
      }));
      setEditingId(null); setNotice(isNew ? t("Đã thêm mục từ.", "Word added.") : t("Đã cập nhật mục từ.", "Word updated.")); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể lưu."); }
    finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!window.confirm(t("Xóa mục từ này khỏi kho?", "Remove this item from your vocabulary?"))) return;
    setPendingAction(`delete:${id}`); setError("");
    try {
      await apiJson(await fetch(`/api/vocabulary?id=${id}`, { method: "DELETE" }));
      setItems((current) => current.filter((item) => item.id !== id));
      setNotice(t("Đã xóa mục từ.", "Word removed."));
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể xóa."); }
    finally { setPendingAction(null); }
  }

  async function classify(ids: string[]) {
    if (!ids.length || classifying) return;
    setClassifying(true); setError(""); setNotice("");
    try {
      const result = await apiJson<{ updated: number }>(await fetch("/api/vocabulary/classify", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids })
      }));
      setNotice(t(`Đã phân loại ${result.updated} mục từ. Tính 1 lượt gợi ý AI.`, `Classified ${result.updated} items. This used one AI suggestion request.`)); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể phân loại từ."); }
    finally { setClassifying(false); }
  }

  async function addFlashcard(id: string) {
    if (pendingAction) return;
    setPendingAction(`flashcard:${id}`);
    setError(""); setNotice("");
    try {
      const result = await apiJson<{ added: number }>(await fetch("/api/flashcards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "library", itemId: id })
      }));
      setNotice(result.added ? t("Đã tạo flashcard.", "Flashcard created.") : t("Từ này đã có flashcard.", "This word already has a flashcard."));
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể tạo flashcard."); }
    finally { setPendingAction(null); }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>, format: "json" | "csv") {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) { setError(t("Tệp nhập tối đa 2 MB.", "The import file must be 2 MB or smaller.")); event.target.value = ""; return; }
    setPendingAction(`import:${format}`);
    setError("");
    try {
      const body = await file.text();
      const result = await apiJson<{ vocabulary: number; translations: number; daily_sets?: number; flashcards?: number; skipped?: number }>(await fetch(format === "csv" ? "/api/import?format=csv" : "/api/import", {
        method: "POST", headers: { "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json" }, body
      }));
      setNotice(format === "csv"
        ? t(`Đã thêm ${result.vocabulary} mục từ từ CSV${result.skipped ? `, bỏ qua ${result.skipped} mục trùng` : ""}.`, `Imported ${result.vocabulary} words from CSV${result.skipped ? `; skipped ${result.skipped} duplicates` : ""}.`)
        : t(`Đã nhập ${result.vocabulary} mục từ, ${result.translations} bản dịch, ${result.daily_sets ?? 0} bộ học và ${result.flashcards ?? 0} flashcard.`, `Imported ${result.vocabulary} words, ${result.translations} translations, ${result.daily_sets ?? 0} daily sets and ${result.flashcards ?? 0} flashcards.`));
      await load();
      if (result.translations) window.dispatchEvent(new Event("translations-updated"));
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể nhập dữ liệu."); }
    finally { event.target.value = ""; setPendingAction(null); }
  }

  return <main className="library-page"><div className="page-container">
    <div className="page-heading"><div><span className="eyebrow">{t("Học theo ngữ cảnh", "Learn in context")}</span><h1>{t("Kho từ của bạn", "Your vocabulary")}</h1><p>{t(`${items.length} từ và cụm từ đã lưu`, `${items.length} saved words and phrases`)}</p></div><button className="primary-button" onClick={() => startEdit()}><Plus size={18} /> {t("Thêm từ", "Add word")}</button></div>

    <div className="library-toolbar">
      <label className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Tìm từ, nghĩa hoặc collocation", "Search words, meanings or collocations")} aria-label={t("Tìm trong kho từ", "Search vocabulary")} /></label>
      <div className="filter-row">
        <select aria-label={t("Lọc theo thời gian", "Filter by time")} value={period} onChange={(event) => setPeriod(event.target.value as Period)}><option value="all">{t("Mọi thời gian", "Any time")}</option><option value="day">{t("Theo ngày", "By date")}</option><option value="week">{t("Theo tuần", "By week")}</option><option value="month">{t("Theo tháng", "By month")}</option><option value="weekday">{t("Theo thứ", "By weekday")}</option></select>
        {(period === "day" || period === "week" || period === "month") && <input type="date" aria-label={t("Chọn ngày tham chiếu", "Choose reference date")} value={anchor} onChange={(event) => setAnchor(event.target.value)} />}
        {period === "weekday" && <select aria-label={t("Chọn thứ", "Choose weekday")} value={weekday} onChange={(event) => setWeekday(event.target.value)}>{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day, index) => <option key={day} value={(index + 1) % 7}>{t(index === 6 ? "Chủ nhật" : `Thứ ${index + 2}`, day)}</option>)}</select>}
        <select aria-label={t("Lọc trình độ", "Filter by level")} value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}><option value="all">{t("Mọi level", "Any level")}</option><option value="unclassified">{t("Chưa rõ level", "Unknown level")}</option>{cefrLevels.map((level) => <option key={level}>{level}</option>)}</select>
        <select aria-label={t("Lọc IELTS", "Filter by IELTS priority")} value={ieltsFilter} onChange={(event) => setIeltsFilter(event.target.value)}><option value="all">{t("Mọi mức IELTS", "Any IELTS priority")}</option><option value="unclassified">{t("Chưa rõ IELTS", "IELTS not classified")}</option>{Object.entries(relevance).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select aria-label={t("Lọc lĩnh vực", "Filter by topic")} value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}><option value="all">{t("Mọi lĩnh vực", "Any topic")}</option>{topicKeys.map((topic) => <option key={topic} value={topic}>{topics[topic]}</option>)}</select>
        <select aria-label={t("Lọc tag", "Filter by tag")} value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="all">{t("Mọi tag", "Any tag")}</option>{allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select>
        <button className="sort-button" onClick={() => setSort(sort === "newest" ? "oldest" : "newest")}><ArrowDownUp size={16} /> {sort === "newest" ? t("Mới nhất", "Newest") : t("Cũ nhất", "Oldest")}</button>
      </div>
      <button type="button" className="subtle-button" disabled={classifying || !items.some((item) => item.source_language === "en" && (!item.cefr_level || !item.ielts_relevance))} onClick={() => classify(items.filter((item) => item.source_language === "en" && (!item.cefr_level || !item.ielts_relevance)).slice(0, 10).map((item) => item.id))}>{classifying && <LoaderCircle size={16} className="spin" />}{classifying ? t("Đang phân loại…", "Classifying…") : t("Phân loại 10 từ chưa có nhãn · 1 lượt AI", "Classify 10 unlabeled words · 1 AI request")}</button>
    </div>

    {(error || notice) && <div className={`notice ${error ? "error" : "success"}`}>{error && language === "en" ? "Could not complete the request. Check your data and database migrations." : error || notice}<button onClick={() => { setError(""); setNotice(""); }} aria-label={t("Đóng thông báo", "Dismiss message")}><X size={16} /></button></div>}

    {loading ? <div className="empty-state" role="status"><LoaderCircle size={26} className="spin" /><h2>{t("Đang tải kho từ…", "Loading vocabulary…")}</h2></div> : visible.length === 0 ? <div className="empty-state"><BookOpen size={28} /><h2>{items.length ? t("Không có mục nào khớp bộ lọc", "No items match these filters") : t("Kho từ đang trống", "Your vocabulary is empty")}</h2><p>{items.length ? t("Thử đổi từ khóa hoặc khoảng thời gian.", "Try another search or time range.") : t("Dịch một đoạn văn rồi lưu từ được gợi ý, hoặc thêm từ thủ công.", "Translate a passage and save suggestions, or add a word manually.")}</p></div> : groups.map((group) => <section className="vocab-group" key={group.title}><h2>{group.title}<span>{group.items.length}</span></h2><div className="vocab-grid">{group.items.map((item) => <article className="vocab-card" key={item.id}>
      <div className="vocab-card-top"><span className="type-pill">{item.kind === "phrase" ? t("Cụm từ", "Phrase") : t("Từ", "Word")}</span><span className="card-date">{localDate(item.created_at)}</span></div>
      <h3>{item.term}</h3>
      {item.meaning_vi && <p className="meaning">{item.meaning_vi}</p>}
      {item.meaning_en && <p className="meaning-en">{item.meaning_en}</p>}
      {item.example && <p className="example">“{item.example}”</p>}
      <div className="learning-tags">{item.cefr_level && <span>{item.cefr_level}</span>}{item.ielts_relevance && <span>{relevance[item.ielts_relevance]}</span>}{item.ielts_skills.map((skill) => <span key={skill}>{skillLabels[skill]}</span>)}{item.topics.map((topic) => <span key={topic}>{topics[topic]}</span>)}{(item.tags ?? []).map((tag) => <span key={tag}>#{tag}</span>)}</div>
      {item.learning_reason && <p className="learning-reason">{item.learning_reason}</p>}
      {item.collocations.length > 0 && <div className="collocation-list">{item.collocations.map((collocation) => <span key={collocation}>{collocation}</span>)}</div>}
      {item.note && <p className="note-line">{item.note}</p>}
      {item.source_text && <details className="source-details"><summary>{t("Xem câu nguồn", "View source sentence")}</summary><p>{item.source_text}</p></details>}
      <div className="card-actions"><button onClick={() => startEdit(item)}>{t("Chỉnh sửa", "Edit")}</button><button onClick={() => addFlashcard(item.id)} disabled={!!pendingAction}>{pendingAction === `flashcard:${item.id}` ? <LoaderCircle size={14} className="spin" /> : <Layers3 size={14} />} Flashcard</button><button onClick={() => classify([item.id])} disabled={classifying || item.source_language !== "en"}>{classifying ? <LoaderCircle size={14} className="spin" /> : null} {t("Gợi ý nhãn AI", "Suggest AI labels")}</button><button onClick={() => remove(item.id)} className="danger" aria-label={t(`Xóa ${item.term}`, `Delete ${item.term}`)} disabled={!!pendingAction}>{pendingAction === `delete:${item.id}` ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}</button></div>
    </article>)}</div></section>)}

    <div className="data-actions"><span>{t("Dữ liệu của bạn", "Your data")}</span><div><a className="subtle-button" href="/api/export?format=json"><Download size={16} /> {t("Xuất JSON", "Export JSON")}</a><a className="subtle-button" href="/api/export?format=csv"><Download size={16} /> {t("Xuất CSV", "Export CSV")}</a><a className="subtle-button" href="/api/export?format=csv&sample=1"><Download size={16} /> {t("CSV mẫu", "Sample CSV")}</a><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => importFile(event, "json")} /><button className="subtle-button" onClick={() => importRef.current?.click()} disabled={pendingAction?.startsWith("import:")}>{pendingAction === "import:json" ? <LoaderCircle size={16} className="spin" /> : <FileUp size={16} />}{pendingAction === "import:json" ? t("Đang nhập…", "Importing…") : t("Nhập JSON", "Import JSON")}</button><input ref={csvImportRef} type="file" accept="text/csv,.csv" hidden onChange={(event) => importFile(event, "csv")} /><button className="subtle-button" onClick={() => csvImportRef.current?.click()} disabled={pendingAction?.startsWith("import:")}>{pendingAction === "import:csv" ? <LoaderCircle size={16} className="spin" /> : <FileUp size={16} />}{pendingAction === "import:csv" ? t("Đang nhập…", "Importing…") : t("Nhập CSV", "Import CSV")}</button></div></div>
    <p className="import-hint">{t("CSV chỉ nhập kho từ. Tải CSV mẫu để xem tên cột; nhiều collocation, kỹ năng, lĩnh vực và tag trong một ô cách nhau bằng dấu chấm phẩy (;). Từ nhập được gắn tag “Đã nhập”. Tệp tối đa 2 MB.", "CSV imports vocabulary only. Download the sample for column names; separate multiple values with semicolons (;). Imported words receive the Imported tag. Maximum file size: 2 MB.")}</p>
  </div>

  {editingId && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingId(null); }}><div className="edit-modal" role="dialog" aria-modal="true" aria-label={editingId === "new" ? t("Thêm từ", "Add word") : t("Chỉnh sửa từ", "Edit word")}>
    <div className="modal-heading"><h2>{editingId === "new" ? t("Thêm từ", "Add word") : t("Chỉnh sửa từ", "Edit word")}</h2><button className="icon-button" onClick={() => setEditingId(null)} aria-label={t("Đóng", "Close")}><X size={20} /></button></div>
    <div className="modal-fields"><label>{t("Từ hoặc cụm từ", "Word or phrase")}<input autoFocus value={draft.term} onChange={(event) => setDraft({ ...draft, term: event.target.value })} /></label><div className="two-cols"><label>{t("Loại", "Type")}<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as Draft["kind"] })}><option value="word">{t("Từ", "Word")}</option><option value="phrase">{t("Cụm từ", "Phrase")}</option></select></label><label>{t("Ngôn ngữ nguồn", "Source language")}<select value={draft.source_language} onChange={(event) => setDraft({ ...draft, source_language: event.target.value as Draft["source_language"] })}><option value="en">{t("Tiếng Anh", "English")}</option><option value="vi">{t("Tiếng Việt", "Vietnamese")}</option></select></label></div><label>{t("Nghĩa tiếng Việt", "Vietnamese meaning")}<input value={draft.meaning_vi} onChange={(event) => setDraft({ ...draft, meaning_vi: event.target.value })} /></label><label>English meaning<input value={draft.meaning_en} onChange={(event) => setDraft({ ...draft, meaning_en: event.target.value })} /></label><label>{t("Ví dụ", "Example")}<textarea value={draft.example} onChange={(event) => setDraft({ ...draft, example: event.target.value })} rows={2} /></label><label>{t("Collocations, cách nhau bằng dấu phẩy", "Collocations, comma separated")}<input value={draft.collocations.join(", ")} onChange={(event) => setDraft({ ...draft, collocations: event.target.value.split(",").map((part) => part.trim()).filter(Boolean) })} /></label><div className="two-cols"><label>{t("Trình độ", "Level")}<select value={draft.cefr_level ?? ""} onChange={(event) => setDraft({ ...draft, cefr_level: event.target.value ? event.target.value as Draft["cefr_level"] : null })}><option value="">{t("Chưa rõ", "Unknown")}</option>{cefrLevels.map((level) => <option key={level}>{level}</option>)}</select></label><label>IELTS<select value={draft.ielts_relevance ?? ""} onChange={(event) => setDraft({ ...draft, ielts_relevance: event.target.value ? event.target.value as Draft["ielts_relevance"] : null })}><option value="">{t("Chưa rõ", "Unknown")}</option>{Object.entries(relevance).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><label>{t("Lĩnh vực", "Topic")}<select value="" onChange={(event) => { const topic = event.target.value as Draft["topics"][number]; setDraft({ ...draft, topics: draft.topics.includes(topic) ? draft.topics.filter((entry) => entry !== topic) : [...draft.topics, topic].slice(0, 4) }); }}><option value="">{draft.topics.length ? draft.topics.map((topic) => topics[topic]).join(", ") : t("Chọn lĩnh vực", "Choose topic")}</option>{topicKeys.map((topic) => <option key={topic} value={topic}>{draft.topics.includes(topic) ? "✓ " : ""}{topics[topic]}</option>)}</select></label><label>{t("Kỹ năng IELTS", "IELTS skill")}<select value="" onChange={(event) => { const skill = event.target.value as Draft["ielts_skills"][number]; setDraft({ ...draft, ielts_skills: draft.ielts_skills.includes(skill) ? draft.ielts_skills.filter((entry) => entry !== skill) : [...draft.ielts_skills, skill] }); }}><option value="">{draft.ielts_skills.length ? draft.ielts_skills.map((skill) => skillLabels[skill]).join(", ") : t("Chọn kỹ năng", "Choose skill")}</option>{ieltsSkills.map((skill) => <option key={skill} value={skill}>{draft.ielts_skills.includes(skill) ? "✓ " : ""}{skillLabels[skill]}</option>)}</select></label><label>{t("Tag riêng, cách nhau bằng dấu chấm phẩy", "Custom tags, separated by semicolons")}<input value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder={t("Ví dụ: IELTS; cần ôn", "Example: IELTS; review")} /></label><label>{t("Lý do gợi ý", "Reason for suggestion")}<input value={draft.learning_reason} onChange={(event) => setDraft({ ...draft, learning_reason: event.target.value })} /></label><label>{t("Câu nguồn", "Source sentence")}<textarea value={draft.source_text} onChange={(event) => setDraft({ ...draft, source_text: event.target.value })} rows={2} /></label><label>{t("Ghi chú", "Notes")}<textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} rows={2} /></label></div>
    {error && <div className="notice error">{language === "en" ? "Could not save this word." : error}</div>}
    <div className="modal-actions"><button className="subtle-button" onClick={() => setEditingId(null)} disabled={saving}>{t("Hủy", "Cancel")}</button><button className="primary-button" onClick={save} disabled={saving}>{saving && <LoaderCircle size={16} className="spin" />}{saving ? t("Đang lưu…", "Saving…") : t("Lưu mục từ", "Save word")}</button></div>
  </div></div>}
  </main>;
}
