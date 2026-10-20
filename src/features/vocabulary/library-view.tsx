"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, BookOpen, Download, ExternalLink, FileUp, Layers3, LoaderCircle, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { usePreferences } from "@/components/preferences-provider";
import { cefrLevels, ieltsSkills, relevanceLabels, relevanceLabelsEn, skillLabels, topicKeys, topicLabels, topicLabelsEn } from "@/lib/learning";
import type { Suggestion } from "@/lib/validation";
import { lookupExtensionDictionary, type DictionarySense } from "@/lib/extension-dictionary";
import { readBackupArchive } from "@/lib/backup-archive.mjs";
import { EnrichmentHistory } from "./enrichment-history";

type Item = {
  id: string; term: string; kind: "word" | "phrase"; source_language: "en" | "vi";
  meaning_vi: string; meaning_en: string; example: string; collocations: string[];
  source_text: string; note: string; created_at: string; updated_at: string;
  cefr_level: Suggestion["cefr_level"]; ielts_relevance: Suggestion["ielts_relevance"];
  ielts_skills: Suggestion["ielts_skills"]; topics: Suggestion["topics"]; tags: string[]; learning_reason: string;
  details: Record<string, unknown>; field_provenance: Record<string, unknown>; revision: number;
};
type Draft = Omit<Item, "id" | "created_at" | "updated_at" | "details" | "field_provenance" | "revision">;
type Period = "all" | "day" | "week" | "month" | "weekday";

const blankDraft: Draft = {
  term: "", kind: "word", source_language: "en", meaning_vi: "", meaning_en: "",
  example: "", collocations: [], source_text: "", note: "", cefr_level: null,
  ielts_relevance: null, ielts_skills: [], topics: [], tags: [], learning_reason: ""
};

type EnrichField = "definitions" | "ipa" | "examples" | "synonyms" | "antonyms" | "collocations";

function hasList(value: unknown) { return Array.isArray(value) && value.some((part) => typeof part === "string" && part.trim()); }
function detailsSource(item: Item, field: string) {
  const source = (item.field_provenance?.[field] as { source?: string } | undefined)?.source;
  return source === "ai" ? "AI" : source === "dictionary" ? "Từ điển" : "";
}
function missingFields(item: Item, mode: "en-en" | "en-vi" | "vi-en"): EnrichField[] {
  const details = item.details ?? {};
  const missing: EnrichField[] = [];
  const expectedLanguage = mode === "en-vi" ? "vi" : "en";
  const definitionsByLanguage = details.definitionsByLanguage as Record<string, unknown> | undefined;
  const hasDefinitionForMode = hasList(definitionsByLanguage?.[expectedLanguage])
    || (details.definitionLanguage === expectedLanguage && hasList(details.definitions));
  if (!(mode === "en-vi" ? item.meaning_vi : item.meaning_en) && !hasDefinitionForMode) missing.push("definitions");
  if (!(typeof details.ipa === "string" && details.ipa.trim())) missing.push("ipa");
  if (!item.example && !hasList(details.examples)) missing.push("examples");
  if (!hasList(details.synonyms)) missing.push("synonyms");
  if (!hasList(details.antonyms)) missing.push("antonyms");
  if (!item.collocations.length && !hasList(details.collocations)) missing.push("collocations");
  return missing;
}

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

type Occurrence = {
  id: string; selected_text: string; context_text: string; source_url: string;
  source_title: string; source_kind: "youtube" | "web"; direction: "en-en" | "en-vi" | "vi-en";
  video_time: number | null; created_at: string;
};

function occurrenceLink(occurrence: Occurrence) {
  try {
    const url = new URL(occurrence.source_url);
    if (occurrence.source_kind === "youtube" && occurrence.video_time !== null) {
      url.searchParams.set("t", `${Math.floor(occurrence.video_time)}s`);
    }
    return url.toString();
  } catch { return occurrence.source_url; }
}

function formatVideoTime(seconds: number) {
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function OccurrencesPanel({ itemId }: { itemId: string }) {
  const { language, t } = usePreferences();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<Occurrence[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError("");
    try {
      const result = await apiJson<{ occurrences: Occurrence[]; has_more: boolean }>(
        await fetch(`/api/vocabulary?occurrences=${encodeURIComponent(itemId)}&offset=${offset}`, { cache: "no-store" })
      );
      setRows((current) => offset === 0 ? result.occurrences : [...current, ...result.occurrences]);
      setHasMore(result.has_more);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Không thể tải ngữ cảnh.", "Could not load saved contexts."));
    } finally { setLoading(false); }
  }, [itemId, t]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) void load(0);
  }

  return <div className="occurrences-panel">
    <button type="button" className="source-context-toggle" aria-expanded={open} onClick={toggleOpen}>
      {open ? t("Ẩn ngữ cảnh", "Hide saved contexts") : t("Ngữ cảnh đã lưu", "Saved contexts")}
    </button>
    {open && <div className="occurrence-list">
      {loading && <p role="status">{t("Đang tải…", "Loading…")}</p>}
      {error && <p className="occurrence-error">{error}</p>}
      {!loading && !error && rows.length === 0 && <p>{t("Chưa có ngữ cảnh nào được lưu.", "No saved contexts yet.")}</p>}
      {rows.map((row) => <article className="occurrence-entry" key={row.id}>
        <p className="occurrence-context">{row.context_text || row.selected_text}</p>
        <div className="occurrence-meta">
          <span>{row.source_title || (row.source_kind === "youtube" ? "YouTube" : t("Trang web", "Website"))}</span>
          <time dateTime={row.created_at}>{new Intl.DateTimeFormat(language === "en" ? "en" : "vi-VN", { dateStyle: "medium" }).format(new Date(row.created_at))}</time>
        </div>
        <a href={occurrenceLink(row)} target="_blank" rel="noreferrer">
          <ExternalLink size={14} /> {row.source_kind === "youtube" && row.video_time !== null
            ? t(`Mở video tại ${formatVideoTime(row.video_time)}`, `Open video at ${formatVideoTime(row.video_time)}`)
            : t("Mở nguồn", "Open source")}
        </a>
      </article>)}
      {hasMore && <button type="button" className="subtle-button occurrence-more" disabled={loading} onClick={() => void load(rows.length)}>{loading ? t("Đang tải…", "Loading…") : t("Tải thêm", "Load more")}</button>}
    </div>}
  </div>;
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [tagging, setTagging] = useState(false);
  const [tagProgress, setTagProgress] = useState({ processed: 0, total: 0, updated: 0 });
  const [stoppingTags, setStoppingTags] = useState(false);
  const stopTagsRef = useRef(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichMode, setEnrichMode] = useState<"en-en" | "en-vi" | "vi-en">("en-vi");
  const [enrichSource, setEnrichSource] = useState<"ai" | "dictionary">("dictionary");
  const [enrichFields, setEnrichFields] = useState<EnrichField[]>(["definitions", "ipa", "examples", "synonyms", "antonyms", "collocations"]);
  const [missingFilter, setMissingFilter] = useState("all");
  const [dictionaryChoice, setDictionaryChoice] = useState<{ term: string; senses: DictionarySense[]; choose: (sense: DictionarySense | null) => void } | null>(null);
  const choiceRef = useRef<((sense: DictionarySense | null) => void) | null>(null);
  const [enrichProgress, setEnrichProgress] = useState({ processed: 0, total: 0, updated: 0 });
  const [stoppingEnrich, setStoppingEnrich] = useState(false);
  const stopEnrichRef = useRef(false);
  const importRef = useRef<HTMLInputElement>(null);
  const csvImportRef = useRef<HTMLInputElement>(null);
  const zipImportRef = useRef<HTMLInputElement>(null);
  const stopImportRef = useRef(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const actionsBusy = tagging || classifying || enriching || !!pendingAction;

  async function load() {
    try {
      const { items: result } = await apiJson<{ items: Item[] }>(await fetch("/api/vocabulary", { cache: "no-store" }));
      setItems(result);
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể tải kho từ."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    stopTagsRef.current = false;
    stopEnrichRef.current = false;
    fetch("/api/vocabulary", { cache: "no-store" })
      .then((response) => apiJson<{ items: Item[] }>(response))
      .then(({ items: result }) => setItems(result))
      .catch((err) => setError(err instanceof Error ? err.message : "Không thể tải kho từ."))
      .finally(() => setLoading(false));
    return () => { stopTagsRef.current = true; stopEnrichRef.current = true; stopImportRef.current = true; choiceRef.current?.(null); };
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== "visible" || actionsBusy || editingId) return;
      void fetch("/api/vocabulary", { cache: "no-store" }).then((response) => apiJson<{ items: Item[] }>(response))
        .then((result) => { if (active) setItems(result.items); }).catch(() => {});
    };
    const receive = (event: MessageEvent) => {
      if (event.source === window && event.origin === location.origin && event.data?.channel === "phrasebook-dictionary-v1" && event.data.type === "synced") refresh();
    };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh); window.addEventListener("message", receive);
    return () => { active = false; window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("message", receive); };
  }, [actionsBusy, editingId]);

  const visible = useMemo(() => items.filter((item) => {
    if (missingFilter !== "all" && !(missingFilter === "any" ? missingFields(item, enrichMode).length : missingFields(item, enrichMode).includes(missingFilter as EnrichField))) return false;
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
    if (tagFilter === "__untagged__" ? (item.tags ?? []).length > 0 : tagFilter !== "all" && !(item.tags ?? []).includes(tagFilter)) return false;
    return true;
  }).sort((a, b) => sort === "newest" ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at)), [items, query, period, anchor, weekday, sort, levelFilter, ieltsFilter, topicFilter, tagFilter, missingFilter, enrichMode]);

  const allTags = useMemo(() => [...new Set(items.flatMap((item) => item.tags ?? []))].sort((a, b) => a.localeCompare(b, "vi")), [items]);
  const untaggedCount = items.filter((item) => !(item.tags ?? []).length).length;
  const selectedVisible = visible.filter((item) => selectedIds.has(item.id));

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function tagAllUntagged() {
    if (actionsBusy) return;
    const ids = items.filter((item) => !(item.tags ?? []).length).map((item) => item.id);
    if (!ids.length) return;
    stopTagsRef.current = false;
    setTagging(true); setStoppingTags(false); setError(""); setNotice("");
    setTagProgress({ processed: 0, total: ids.length, updated: 0 });
    let updated = 0;
    try {
      for (let offset = 0; offset < ids.length && !stopTagsRef.current; offset += 10) {
        const batch = ids.slice(offset, offset + 10);
        const response = await fetch("/api/vocabulary/tags", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: batch })
        });
        const result = await response.json() as { items?: Pick<Item, "id" | "tags" | "updated_at">[]; error?: string };
        const saved = new Map((result.items ?? []).map((item) => [item.id, item]));
        updated += saved.size;
        setItems((current) => current.map((item) => saved.has(item.id) ? { ...item, ...saved.get(item.id)! } : item));
        setTagProgress({ processed: Math.min(offset + batch.length, ids.length), total: ids.length, updated });
        if (!response.ok) throw new Error(result.error || t("Không thể gắn tag.", "Could not add tags."));
      }
      setNotice(stopTagsRef.current
        ? t(`Đã dừng. Đã lưu tag cho ${updated} từ; bấm gắn tag để tiếp tục các từ còn thiếu.`, `Stopped. Saved tags for ${updated} words; run again to continue with untagged words.`)
        : t(`Đã gắn tag cho ${updated} từ. Từ đã được sửa hoặc gắn tag trong lúc chạy sẽ được bỏ qua.`, `Added tags to ${updated} words. Words edited or tagged during the run were skipped.`));
    } catch (err) {
      setError(t(`Đã lưu tag cho ${updated} từ. `, `Saved tags for ${updated} words. `) + (err instanceof Error ? err.message : t("Không thể tiếp tục.", "Could not continue.")));
    } finally { setTagging(false); setStoppingTags(false); await load(); }
  }

  async function enrichMissing(targetIds?: string[]) {
    if (actionsBusy) return;
    const candidates = targetIds
      ? items.filter((item) => targetIds.includes(item.id))
      : selectedVisible.length
      ? selectedVisible.filter((item) => item.source_language === "en")
      : visible.filter((item) => item.source_language === "en");
    const ids = candidates.filter((item) => missingFields(item, enrichMode).some((field) => enrichFields.includes(field))).slice(0, 100).map((item) => item.id);
    if (!ids.length) return;
    stopEnrichRef.current = false;
    setEnriching(true); setStoppingEnrich(false); setError(""); setNotice("");
    setEnrichProgress({ processed: 0, total: ids.length, updated: 0 });
    let updated = 0;
    try {
      for (let index = 0; index < ids.length && !stopEnrichRef.current; index++) {
        const item = items.find((entry) => entry.id === ids[index]);
        if (!item) continue;
        let dictionary;
        if (enrichSource === "dictionary") {
          const pack = await lookupExtensionDictionary(item.term, enrichMode === "vi-en" ? "en-en" : enrichMode);
          let sense: DictionarySense | null = pack.senses[0] ?? null;
          if (pack.senses.length > 1) sense = await new Promise<DictionarySense | null>((resolve) => {
            const choose = (value: DictionarySense | null) => { choiceRef.current = null; setDictionaryChoice(null); resolve(value); };
            choiceRef.current = choose;
            setDictionaryChoice({ term: item.term, senses: pack.senses, choose });
          });
          if (stopEnrichRef.current) break;
          if (!sense) { setEnrichProgress({ processed: index + 1, total: ids.length, updated }); continue; }
          dictionary = { id: sense.id, dataVersion: pack.dataVersion, definitions: (sense.definitions ?? []).slice(0, 6).map((text) => text.slice(0, 500)), ipa: sense.ipa ?? "",
            examples: (sense.examples ?? []).slice(0, 3), synonyms: (sense.synonyms ?? []).slice(0, 12), antonyms: (sense.antonyms ?? []).slice(0, 12), collocations: (sense.collocations ?? []).slice(0, 6) };
        }
        const response = await fetch("/api/vocabulary/enrich", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, mode: enrichMode, source: enrichSource, dictionary, fields: missingFields(item, enrichMode).filter((field) => enrichFields.includes(field)) })
        });
        const result = await response.json() as { item?: Partial<Item> & { id: string }; error?: string; state?: string };
        if (!response.ok) throw new Error(result.error || t("Không thể bổ sung mục từ.", "Could not enrich this word."));
        if (result.item) {
          updated++;
          setItems((current) => current.map((entry) => entry.id === result.item!.id ? { ...entry, ...result.item } : entry));
        }
        setEnrichProgress({ processed: index + 1, total: ids.length, updated });
      }
      setNotice(stopEnrichRef.current
        ? t(`Đã dừng sau ${updated} mục đã cập nhật.`, `Stopped after updating ${updated} words.`)
        : t(`Đã xử lý ${ids.length} mục; bổ sung ${updated}.`, `Processed ${ids.length} words; enriched ${updated}.`));
    } catch (err) {
      setError(t(`Đã cập nhật ${updated} mục. `, `Updated ${updated} words. `) + (err instanceof Error ? err.message : t("Không thể tiếp tục.", "Could not continue.")));
    } finally { setEnriching(false); setStoppingEnrich(false); await load(); }
  }

  async function removeSelected() {
    if (actionsBusy || !selectedVisible.length) return;
    const ids = selectedVisible.map((item) => item.id);
    if (!window.confirm(t(
      `Xóa ${ids.length} từ đã chọn đang hiển thị? Flashcard và mục trong bộ học ngày liên quan cũng sẽ bị xóa. Không thể hoàn tác.`,
      `Delete ${ids.length} selected visible words? Linked flashcards and daily study entries will also be deleted. This cannot be undone.`
    ))) return;
    setPendingAction("bulk-delete"); setError(""); setNotice("");
    let deleted = 0;
    try {
      for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100);
        const result = await apiJson<{ deletedIds: string[] }>(await fetch("/api/vocabulary", {
          method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: batch })
        }));
        deleted += result.deletedIds.length;
        const removed = new Set(result.deletedIds);
        setItems((current) => current.filter((item) => !removed.has(item.id)));
        setSelectedIds((current) => new Set([...current].filter((id) => !removed.has(id))));
        setNotice(t(`Đã xóa ${deleted}/${ids.length} từ.`, `Deleted ${deleted}/${ids.length} words.`));
      }
    } catch (err) {
      setError(t(`Đã xóa ${deleted} từ. `, `Deleted ${deleted} words. `) + (err instanceof Error ? err.message : t("Không thể xóa các từ còn lại.", "Could not delete the remaining words.")));
    } finally { setPendingAction(null); await load(); }
  }

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
    if (actionsBusy) return;
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
    if (!ids.length || actionsBusy) return;
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
    if (actionsBusy) return;
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

  async function importFile(event: ChangeEvent<HTMLInputElement>, format: "json" | "csv" | "zip") {
    if (actionsBusy) return;
    const file = event.target.files?.[0];
    if (!file) return;
    const maxBytes = format === "zip" ? 100_000_000 : format === "json" ? 20_000_000 : 2_000_000;
    if (file.size > maxBytes) { setError(format === "json" ? t("Tệp JSON tối đa 20 MB.", "JSON imports are limited to 20 MB.") : t("Tệp CSV tối đa 2 MB.", "CSV imports are limited to 2 MB.")); event.target.value = ""; return; }
    setPendingAction(`import:${format}`);
    setError("");
    try {
      if (format === "zip") {
        stopImportRef.current = false;
        const parts = await readBackupArchive(new Uint8Array(await file.arrayBuffer()));
        setImportProgress({ done: 0, total: parts.length });
        let done = 0;
        for (const part of parts) {
          if (stopImportRef.current) break;
          await apiJson(await fetch(`/api/import?partId=${encodeURIComponent(part.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: part.body }));
          done++; setImportProgress({ done, total: parts.length });
        }
        setNotice(t(`Đã nhập ${done}/${parts.length} phần. Chọn lại cùng ZIP để tiếp tục; phần hoàn tất không nhập lại. Tiến độ học đã có được giữ nguyên.`, `Imported ${done}/${parts.length} parts. Select the same ZIP to resume; completed parts are reused. Existing study progress is preserved.`));
        await load(); window.dispatchEvent(new Event("translations-updated")); return;
      }
      const body = await file.text();
      const result = await apiJson<{ vocabulary: number; translations: number; daily_sets?: number; flashcards?: number; identity_refs?: number; occurrences?: number; skipped?: number }>(await fetch(format === "csv" ? "/api/import?format=csv" : "/api/import", {
        method: "POST", headers: { "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json" }, body
      }));
      setNotice(format === "csv"
        ? t(`Đã thêm ${result.vocabulary} mục từ từ CSV${result.skipped ? `, bỏ qua ${result.skipped} mục trùng` : ""}.`, `Imported ${result.vocabulary} words from CSV${result.skipped ? `; skipped ${result.skipped} duplicates` : ""}.`)
        : t(`Đã nhập ${result.vocabulary} mục từ, ${result.translations} bản dịch, ${result.daily_sets ?? 0} bộ học, ${result.flashcards ?? 0} flashcard và ${result.occurrences ?? 0} ngữ cảnh.`, `Imported ${result.vocabulary} words, ${result.translations} translations, ${result.daily_sets ?? 0} daily sets, ${result.flashcards ?? 0} flashcards and ${result.occurrences ?? 0} saved contexts.`));
      await load();
      if (result.translations) window.dispatchEvent(new Event("translations-updated"));
    } catch (err) { setError((err instanceof Error ? err.message : "Không thể nhập dữ liệu.") + (format === "zip" ? t(" Chọn lại cùng ZIP để tiếp tục từ phần đã hoàn tất.", " Select the same ZIP to resume completed parts.") : "")); }
    finally { event.target.value = ""; setPendingAction(null); setImportProgress(null); }
  }

  return <main className="library-page"><div className="page-container">
    {importProgress && <div className="tagging-progress" role="status"><span>{t("Nhập backup", "Import backup")}: {importProgress.done}/{importProgress.total}</span><progress value={importProgress.done} max={importProgress.total} /><button onClick={() => { stopImportRef.current = true; }}>{t("Dừng sau phần này", "Stop after this part")}</button></div>}
    <EnrichmentHistory />
    <div className="page-heading"><div><span className="eyebrow">{t("Học theo ngữ cảnh", "Learn in context")}</span><h1>{t("Kho từ của bạn", "Your vocabulary")}</h1><p>{t(`${items.length} từ và cụm từ đã lưu`, `${items.length} saved words and phrases`)}</p></div><button className="primary-button" disabled={actionsBusy} onClick={() => startEdit()}><Plus size={18} /> {t("Thêm từ", "Add word")}</button></div>

    <div className="library-toolbar">
      <label className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Tìm từ, nghĩa hoặc collocation", "Search words, meanings or collocations")} aria-label={t("Tìm trong kho từ", "Search vocabulary")} /></label>
      <div className="filter-row">
        <select aria-label={t("Lọc theo thời gian", "Filter by time")} value={period} onChange={(event) => setPeriod(event.target.value as Period)}><option value="all">{t("Mọi thời gian", "Any time")}</option><option value="day">{t("Theo ngày", "By date")}</option><option value="week">{t("Theo tuần", "By week")}</option><option value="month">{t("Theo tháng", "By month")}</option><option value="weekday">{t("Theo thứ", "By weekday")}</option></select>
        {(period === "day" || period === "week" || period === "month") && <input type="date" aria-label={t("Chọn ngày tham chiếu", "Choose reference date")} value={anchor} onChange={(event) => setAnchor(event.target.value)} />}
        {period === "weekday" && <select aria-label={t("Chọn thứ", "Choose weekday")} value={weekday} onChange={(event) => setWeekday(event.target.value)}>{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day, index) => <option key={day} value={(index + 1) % 7}>{t(index === 6 ? "Chủ nhật" : `Thứ ${index + 2}`, day)}</option>)}</select>}
        <select aria-label={t("Lọc trình độ", "Filter by level")} value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}><option value="all">{t("Mọi level", "Any level")}</option><option value="unclassified">{t("Chưa rõ level", "Unknown level")}</option>{cefrLevels.map((level) => <option key={level}>{level}</option>)}</select>
        <select aria-label={t("Lọc IELTS", "Filter by IELTS priority")} value={ieltsFilter} onChange={(event) => setIeltsFilter(event.target.value)}><option value="all">{t("Mọi mức IELTS", "Any IELTS priority")}</option><option value="unclassified">{t("Chưa rõ IELTS", "IELTS not classified")}</option>{Object.entries(relevance).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select aria-label={t("Lọc lĩnh vực", "Filter by topic")} value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}><option value="all">{t("Mọi lĩnh vực", "Any topic")}</option>{topicKeys.map((topic) => <option key={topic} value={topic}>{topics[topic]}</option>)}</select>
        <select aria-label={t("Lọc tag", "Filter by tag")} value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="all">{t("Mọi tag", "Any tag")}</option><option value="__untagged__">{t("Chưa có tag", "Without tags")}</option>{allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select>
        <select aria-label={t("Lọc nội dung thiếu", "Filter missing fields")} value={missingFilter} onChange={(event) => setMissingFilter(event.target.value)}><option value="all">{t("Mọi nội dung", "All content")}</option><option value="any">{t("Có ô trống", "Any missing field")}</option>{(["definitions", "ipa", "examples", "synonyms", "antonyms", "collocations"] as EnrichField[]).map((field) => <option key={field} value={field}>{t("Thiếu", "Missing")} {field}</option>)}</select>
        <button className="sort-button" onClick={() => setSort(sort === "newest" ? "oldest" : "newest")}><ArrowDownUp size={16} /> {sort === "newest" ? t("Mới nhất", "Newest") : t("Cũ nhất", "Oldest")}</button>
      </div>
      <div className="library-ai-actions">
        <button type="button" className="subtle-button" disabled={actionsBusy || !items.some((item) => item.source_language === "en" && (!item.cefr_level || !item.ielts_relevance))} onClick={() => classify(items.filter((item) => item.source_language === "en" && (!item.cefr_level || !item.ielts_relevance)).slice(0, 10).map((item) => item.id))}>{classifying && <LoaderCircle size={16} className="spin" />}{classifying ? t("Đang phân loại…", "Classifying…") : t("Phân loại 10 từ chưa có nhãn · 1 lượt AI", "Classify 10 unlabeled words · 1 AI request")}</button>
        <button type="button" className="subtle-button" disabled={loading || actionsBusy || !untaggedCount} onClick={tagAllUntagged}><Sparkles size={16} />{t(`Tự gắn tag AI · ${untaggedCount} từ chưa có tag`, `Auto-tag with AI · ${untaggedCount} untagged words`)}</button>
        <label>{t("Nghĩa bổ sung", "Definition mode")} <select value={enrichMode} onChange={(event) => setEnrichMode(event.target.value as typeof enrichMode)} disabled={actionsBusy}><option value="en-en">{t("Anh–Anh", "English → English")}</option><option value="en-vi">{t("Anh–Việt", "English → Vietnamese")}</option><option value="vi-en">{t("Việt–Anh", "Vietnamese → English")}</option></select></label>
        <label>{t("Nguồn", "Source")} <select value={enrichSource} disabled={actionsBusy} onChange={(event) => setEnrichSource(event.target.value as typeof enrichSource)}><option value="dictionary">{t("Từ điển trong extension", "Extension dictionary")}</option><option value="ai">AI</option></select></label>
        <button type="button" className="subtle-button" disabled={loading || actionsBusy || !enrichFields.length || !visible.some((item) => item.source_language === "en" && missingFields(item, enrichMode).some((field) => enrichFields.includes(field)))} onClick={() => { void enrichMissing(); }}><Sparkles size={16} />{enriching ? t("Đang bổ sung…", "Enriching…") : t(`Bổ sung ô trống${selectedVisible.length ? ` (${selectedVisible.length} đã chọn)` : ""}`, `Fill missing fields${selectedVisible.length ? ` (${selectedVisible.length} selected)` : ""}`)}</button>
        <small>{t("Áp dụng toàn kho · tối đa 10 từ/lượt AI · tự lưu tag.", "Entire library · up to 10 words per AI request · tags saved automatically.")}</small>
      </div>
      {tagging && <div className="tagging-progress">
        <div role="status" aria-live="polite"><LoaderCircle size={16} className="spin" /><span>{t(`Đã xử lý ${tagProgress.processed}/${tagProgress.total} từ · đã lưu tag cho ${tagProgress.updated} từ`, `Processed ${tagProgress.processed}/${tagProgress.total} words · tagged ${tagProgress.updated}`)}</span></div>
        <progress value={tagProgress.processed} max={tagProgress.total || 1} aria-label={t("Tiến độ gắn tag", "Tagging progress")} />
        <button type="button" className="subtle-button" disabled={stoppingTags} onClick={() => { stopTagsRef.current = true; setStoppingTags(true); }}>{stoppingTags ? t("Đang hoàn thành lô hiện tại…", "Finishing current batch…") : t("Dừng sau lô này", "Stop after this batch")}</button>
      </div>}
      {enriching && <div className="tagging-progress">
        <div role="status" aria-live="polite"><LoaderCircle size={16} className="spin" /><span>{t(`Đã xử lý ${enrichProgress.processed}/${enrichProgress.total} mục · cập nhật ${enrichProgress.updated}`, `Processed ${enrichProgress.processed}/${enrichProgress.total} words · updated ${enrichProgress.updated}`)}</span></div>
        <progress value={enrichProgress.processed} max={enrichProgress.total || 1} aria-label={t("Tiến độ bổ sung", "Enrichment progress")} />
        <button type="button" className="subtle-button" disabled={stoppingEnrich} onClick={() => { stopEnrichRef.current = true; setStoppingEnrich(true); }}>{stoppingEnrich ? t("Đang dừng sau mục hiện tại…", "Stopping after current word…") : t("Dừng", "Stop")}</button>
      </div>}
      <fieldset disabled={actionsBusy} className="enrichment-fields"><legend>{t("Chỉ bổ sung các ô trống đã chọn", "Fill selected missing fields only")}</legend>{(["definitions", "ipa", "examples", "synonyms", "antonyms", "collocations"] as EnrichField[]).map((field) => <label key={field}><input type="checkbox" checked={enrichFields.includes(field)} onChange={(event) => setEnrichFields((current) => event.target.checked ? [...current, field] : current.filter((value) => value !== field))} /> {field}</label>)}</fieldset>
      <small>{enrichSource === "dictionary" ? t("Dùng bộ đã tải trong extension. Chọn nghĩa khi có nhiều kết quả; không tự gọi AI nếu thiếu.", "Uses downloaded extension dictionaries. Choose a sense for ambiguous words; missing data never triggers AI.") : t("Chỉ gọi AI khi bấm; kết quả đã có được dùng lại. Tối đa 100 mục mỗi lượt chạy.", "AI runs only after you click; completed results are reused. Up to 100 words per run.")}</small>
    </div>

    {(error || notice) && <div role={error ? "alert" : "status"} className={`notice ${error ? "error" : "success"}`}>{error || notice}<button onClick={() => { setError(""); setNotice(""); }} aria-label={t("Đóng thông báo", "Dismiss message")}><X size={16} /></button></div>}

    {!loading && visible.length > 0 && <div className="library-bulk-actions" aria-label={t("Thao tác hàng loạt", "Bulk actions")}>
      <label className="vocab-select"><input type="checkbox" checked={selectedVisible.length === visible.length} ref={(node) => { if (node) node.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visible.length; }} disabled={actionsBusy} onChange={(event) => setSelectedIds(event.target.checked ? new Set(visible.map((item) => item.id)) : new Set())} />{t(`Chọn tất cả ${visible.length} từ đang hiển thị`, `Select all ${visible.length} visible words`)}</label>
      <span>{t(`Đã chọn ${selectedVisible.length} từ đang hiển thị`, `${selectedVisible.length} visible words selected`)}</span>
      {selectedIds.size > 0 && <button type="button" className="subtle-button" disabled={actionsBusy} onClick={() => setSelectedIds(new Set())}>{t("Bỏ chọn", "Clear selection")}</button>}
      <button type="button" className="subtle-button danger" disabled={actionsBusy || !selectedVisible.length} onClick={removeSelected}>{pendingAction === "bulk-delete" ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}{pendingAction === "bulk-delete" ? t("Đang xóa…", "Deleting…") : t(`Xóa đã chọn (${selectedVisible.length})`, `Delete selected (${selectedVisible.length})`)}</button>
    </div>}

    {loading ? <div className="empty-state" role="status"><LoaderCircle size={26} className="spin" /><h2>{t("Đang tải kho từ…", "Loading vocabulary…")}</h2></div> : visible.length === 0 ? <div className="empty-state"><BookOpen size={28} /><h2>{items.length ? t("Không có mục nào khớp bộ lọc", "No items match these filters") : t("Kho từ đang trống", "Your vocabulary is empty")}</h2><p>{items.length ? t("Thử đổi từ khóa hoặc khoảng thời gian.", "Try another search or time range.") : t("Dịch một đoạn văn rồi lưu từ được gợi ý, hoặc thêm từ thủ công.", "Translate a passage and save suggestions, or add a word manually.")}</p></div> : groups.map((group) => <section className="vocab-group" key={group.title}><h2>{group.title}<span>{group.items.length}</span></h2><div className="vocab-grid">{group.items.map((item) => <article className="vocab-card" data-selected={selectedIds.has(item.id)} key={item.id}>
      <div className="vocab-card-top"><label className="vocab-select"><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelection(item.id)} disabled={actionsBusy} aria-label={t(`Chọn ${item.term}`, `Select ${item.term}`)} /><span className="type-pill">{item.kind === "phrase" ? t("Cụm từ", "Phrase") : t("Từ", "Word")}</span></label><span className="card-date">{localDate(item.created_at)}</span></div>
      <h3>{item.term}</h3>
      {item.meaning_vi && <p className="meaning">{item.meaning_vi}</p>}
      {item.meaning_en && <p className="meaning-en">{item.meaning_en}</p>}
      {item.example && <p className="example">“{item.example}”</p>}
      <div className="learning-tags">{item.cefr_level && <span>{item.cefr_level}</span>}{item.ielts_relevance && <span>{relevance[item.ielts_relevance]}</span>}{item.ielts_skills.map((skill) => <span key={skill}>{skillLabels[skill]}</span>)}{item.topics.map((topic) => <span key={topic}>{topics[topic]}</span>)}{(item.tags ?? []).map((tag) => <span key={`tag:${tag}`}>#{tag}</span>)}</div>
      {item.learning_reason && <p className="learning-reason">{item.learning_reason}</p>}
      {item.collocations.length > 0 && <div className="collocation-list">{item.collocations.map((collocation) => <span key={collocation}>{collocation}</span>)}</div>}
      <OccurrencesPanel itemId={item.id} />
      {Object.keys(item.field_provenance ?? {}).length > 0 && <details className="source-details"><summary>{t("Nguồn dữ liệu từng trường", "Field sources")}</summary>{Object.entries(item.field_provenance).map(([field, value]) => { const provenance = value as { source?: string; updated_at?: string }; return <p key={field}>{field}: {provenance.source === "ai" ? "AI" : provenance.source === "dictionary" ? t("Từ điển", "Dictionary") : t("Nhập / chỉnh sửa", "Imported / edited")} {provenance.updated_at && <small>· {new Date(provenance.updated_at).toLocaleString()}</small>}</p>; })}</details>}
      {(item.details?.ipa || hasList(item.details?.synonyms) || hasList(item.details?.antonyms)) && <details className="source-details"><summary>{t("Thông tin từ", "Dictionary details")}</summary>
        {typeof item.details.ipa === "string" && item.details.ipa && <p>IPA: {item.details.ipa} {detailsSource(item, "ipa") && <small>· {detailsSource(item, "ipa")}</small>}</p>}
        {hasList(item.details.synonyms) && <p>{t("Đồng nghĩa", "Synonyms")}: {(item.details.synonyms as string[]).join(", ")} {detailsSource(item, "synonyms") && <small>· {detailsSource(item, "synonyms")}</small>}</p>}
        {hasList(item.details.antonyms) && <p>{t("Trái nghĩa", "Antonyms")}: {(item.details.antonyms as string[]).join(", ")} {detailsSource(item, "antonyms") && <small>· {detailsSource(item, "antonyms")}</small>}</p>}
      </details>}
      {item.note && <p className="note-line">{item.note}</p>}
      {item.source_text && <details className="source-details"><summary>{t("Xem câu nguồn", "View source sentence")}</summary><p>{item.source_text}</p></details>}
      <div className="card-actions"><button disabled={actionsBusy} onClick={() => startEdit(item)}>{t("Chỉnh sửa", "Edit")}</button><button onClick={() => addFlashcard(item.id)} disabled={actionsBusy}>{pendingAction === `flashcard:${item.id}` ? <LoaderCircle size={14} className="spin" /> : <Layers3 size={14} />} Flashcard</button><button onClick={() => classify([item.id])} disabled={actionsBusy || item.source_language !== "en"}>{classifying ? <LoaderCircle size={14} className="spin" /> : null} {t("Gợi ý nhãn AI", "Suggest AI labels")}</button><button onClick={() => enrichMissing([item.id])} disabled={actionsBusy || item.source_language !== "en" || !missingFields(item, enrichMode).length}>{t("Bổ sung ô trống", "Fill missing fields")}</button><button onClick={() => remove(item.id)} className="danger" aria-label={t(`Xóa ${item.term}`, `Delete ${item.term}`)} disabled={actionsBusy}>{pendingAction === `delete:${item.id}` ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}</button></div>
    </article>)}</div></section>)}

    <div className="data-actions"><div><a className="subtle-button" href="/api/export?format=zip"><Download size={16} /> {t("Xuất ZIP đầy đủ", "Export full ZIP")}</a><input ref={zipImportRef} type="file" accept="application/zip,.zip" hidden onChange={(event) => importFile(event, "zip")} /><button className="subtle-button" disabled={actionsBusy} onClick={() => zipImportRef.current?.click()}><FileUp size={16} />{t("Nhập / tiếp tục ZIP", "Import / resume ZIP")}</button></div><span>{t("Dữ liệu của bạn", "Your data")}</span><div><a className="subtle-button" href="/api/export?format=json"><Download size={16} /> {t("Xuất JSON", "Export JSON")}</a><a className="subtle-button" href="/api/export?format=csv"><Download size={16} /> {t("Xuất CSV", "Export CSV")}</a><a className="subtle-button" href="/api/export?format=csv&sample=1"><Download size={16} /> {t("CSV mẫu", "Sample CSV")}</a><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => importFile(event, "json")} /><button className="subtle-button" onClick={() => importRef.current?.click()} disabled={actionsBusy}>{pendingAction === "import:json" ? <LoaderCircle size={16} className="spin" /> : <FileUp size={16} />}{pendingAction === "import:json" ? t("Đang nhập…", "Importing…") : t("Nhập JSON", "Import JSON")}</button><input ref={csvImportRef} type="file" accept="text/csv,.csv" hidden onChange={(event) => importFile(event, "csv")} /><button className="subtle-button" onClick={() => csvImportRef.current?.click()} disabled={actionsBusy}>{pendingAction === "import:csv" ? <LoaderCircle size={16} className="spin" /> : <FileUp size={16} />}{pendingAction === "import:csv" ? t("Đang nhập…", "Importing…") : t("Nhập CSV", "Import CSV")}</button></div></div>
    <p className="import-hint">{t("CSV chỉ nhập kho từ. Tải CSV mẫu để xem tên cột; nhiều collocation, kỹ năng, lĩnh vực và tag trong một ô cách nhau bằng dấu chấm phẩy (;). Từ nhập được gắn tag “Đã nhập”. Tệp tối đa 2 MB.", "CSV imports vocabulary only. Download the sample for column names; separate multiple values with semicolons (;). Imported words receive the Imported tag. Maximum file size: 2 MB.")}</p>
  </div>

  {editingId && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingId(null); }}><div className="edit-modal" role="dialog" aria-modal="true" aria-label={editingId === "new" ? t("Thêm từ", "Add word") : t("Chỉnh sửa từ", "Edit word")}>
    <div className="modal-heading"><h2>{editingId === "new" ? t("Thêm từ", "Add word") : t("Chỉnh sửa từ", "Edit word")}</h2><button className="icon-button" onClick={() => setEditingId(null)} aria-label={t("Đóng", "Close")}><X size={20} /></button></div>
    <div className="modal-fields"><label>{t("Từ hoặc cụm từ", "Word or phrase")}<input autoFocus value={draft.term} onChange={(event) => setDraft({ ...draft, term: event.target.value })} /></label><div className="two-cols"><label>{t("Loại", "Type")}<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as Draft["kind"] })}><option value="word">{t("Từ", "Word")}</option><option value="phrase">{t("Cụm từ", "Phrase")}</option></select></label><label>{t("Ngôn ngữ nguồn", "Source language")}<select value={draft.source_language} onChange={(event) => setDraft({ ...draft, source_language: event.target.value as Draft["source_language"] })}><option value="en">{t("Tiếng Anh", "English")}</option><option value="vi">{t("Tiếng Việt", "Vietnamese")}</option></select></label></div><label>{t("Nghĩa tiếng Việt", "Vietnamese meaning")}<input value={draft.meaning_vi} onChange={(event) => setDraft({ ...draft, meaning_vi: event.target.value })} /></label><label>English meaning<input value={draft.meaning_en} onChange={(event) => setDraft({ ...draft, meaning_en: event.target.value })} /></label><label>{t("Ví dụ", "Example")}<textarea value={draft.example} onChange={(event) => setDraft({ ...draft, example: event.target.value })} rows={2} /></label><label>{t("Collocations, cách nhau bằng dấu phẩy", "Collocations, comma separated")}<input value={draft.collocations.join(", ")} onChange={(event) => setDraft({ ...draft, collocations: event.target.value.split(",").map((part) => part.trim()).filter(Boolean) })} /></label><div className="two-cols"><label>{t("Trình độ", "Level")}<select value={draft.cefr_level ?? ""} onChange={(event) => setDraft({ ...draft, cefr_level: event.target.value ? event.target.value as Draft["cefr_level"] : null })}><option value="">{t("Chưa rõ", "Unknown")}</option>{cefrLevels.map((level) => <option key={level}>{level}</option>)}</select></label><label>IELTS<select value={draft.ielts_relevance ?? ""} onChange={(event) => setDraft({ ...draft, ielts_relevance: event.target.value ? event.target.value as Draft["ielts_relevance"] : null })}><option value="">{t("Chưa rõ", "Unknown")}</option>{Object.entries(relevance).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><label>{t("Lĩnh vực", "Topic")}<select value="" onChange={(event) => { const topic = event.target.value as Draft["topics"][number]; setDraft({ ...draft, topics: draft.topics.includes(topic) ? draft.topics.filter((entry) => entry !== topic) : [...draft.topics, topic].slice(0, 4) }); }}><option value="">{draft.topics.length ? draft.topics.map((topic) => topics[topic]).join(", ") : t("Chọn lĩnh vực", "Choose topic")}</option>{topicKeys.map((topic) => <option key={topic} value={topic}>{draft.topics.includes(topic) ? "✓ " : ""}{topics[topic]}</option>)}</select></label><label>{t("Kỹ năng IELTS", "IELTS skill")}<select value="" onChange={(event) => { const skill = event.target.value as Draft["ielts_skills"][number]; setDraft({ ...draft, ielts_skills: draft.ielts_skills.includes(skill) ? draft.ielts_skills.filter((entry) => entry !== skill) : [...draft.ielts_skills, skill] }); }}><option value="">{draft.ielts_skills.length ? draft.ielts_skills.map((skill) => skillLabels[skill]).join(", ") : t("Chọn kỹ năng", "Choose skill")}</option>{ieltsSkills.map((skill) => <option key={skill} value={skill}>{draft.ielts_skills.includes(skill) ? "✓ " : ""}{skillLabels[skill]}</option>)}</select></label><label>{t("Tag riêng, cách nhau bằng dấu chấm phẩy", "Custom tags, separated by semicolons")}<input value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder={t("Ví dụ: IELTS; cần ôn", "Example: IELTS; review")} /></label><label>{t("Lý do gợi ý", "Reason for suggestion")}<input value={draft.learning_reason} onChange={(event) => setDraft({ ...draft, learning_reason: event.target.value })} /></label><label>{t("Câu nguồn", "Source sentence")}<textarea value={draft.source_text} onChange={(event) => setDraft({ ...draft, source_text: event.target.value })} rows={2} /></label><label>{t("Ghi chú", "Notes")}<textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} rows={2} /></label></div>
    {error && <div className="notice error">{language === "en" ? "Could not save this word." : error}</div>}
    <div className="modal-actions"><button className="subtle-button" onClick={() => setEditingId(null)} disabled={saving}>{t("Hủy", "Cancel")}</button><button className="primary-button" onClick={save} disabled={saving}>{saving && <LoaderCircle size={16} className="spin" />}{saving ? t("Đang lưu…", "Saving…") : t("Lưu mục từ", "Save word")}</button></div>
  </div></div>}
  {dictionaryChoice && <div className="modal-backdrop"><div className="word-modal" role="dialog" aria-modal="true" aria-labelledby="dictionary-choice-title"><h2 id="dictionary-choice-title">{t("Chọn nghĩa cho", "Choose a sense for")} {dictionaryChoice.term}</h2><p>{t("Chỉ dùng nghĩa bạn chọn để điền ô trống. Nội dung đã có được giữ nguyên.", "Only the selected sense fills missing fields. Existing content is preserved.")}</p><div className="dictionary-choices">{dictionaryChoice.senses.map((sense, index) => <button autoFocus={index === 0} key={`${sense.id}-${index}`} className="subtle-button" onClick={() => dictionaryChoice.choose(sense)}>{sense.partOfSpeech && <strong>{sense.partOfSpeech} · </strong>}{sense.definitions?.join("; ") || sense.sourceTerm || t("Chưa có nghĩa", "No definition")}</button>)}</div><div className="modal-actions"><button className="subtle-button" onClick={() => dictionaryChoice.choose(null)}>{t("Bỏ qua từ này", "Skip word")}</button><button className="subtle-button" onClick={() => { stopEnrichRef.current = true; dictionaryChoice.choose(null); }}>{t("Dừng", "Stop")}</button></div></div></div>}
  </main>;
}
