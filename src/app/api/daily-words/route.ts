import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireApiSession } from "@/lib/api";
import { cefrLevels, vietnamDate, vietnamWeekday } from "@/lib/learning";
import { dailyFiltersSchema, type DailyFilters } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Session = NonNullable<Awaited<ReturnType<typeof requireApiSession>>>;
const dateSchema = z.iso.date();
const createSchema = z.object({
  studyDate: dateSchema,
  count: z.number().int().min(1).max(30),
  filters: dailyFiltersSchema
});
const studiedSchema = z.object({
  studyDate: dateSchema,
  itemId: z.uuid(),
  studied: z.boolean()
});

function validFilters(filters: DailyFilters) {
  if (filters.createdMode === "date" && !filters.createdDate) return false;
  if (filters.createdMode === "weekday" && filters.createdWeekday === undefined) return false;
  if (filters.levelMode === "range") {
    if (!filters.levelMin || !filters.levelMax) return false;
    if (cefrLevels.indexOf(filters.levelMin) > cefrLevels.indexOf(filters.levelMax)) return false;
  }
  return true;
}

function matches(item: {
  created_at: string; source_language: string; kind: string; cefr_level: string | null;
  ielts_relevance: string | null; ielts_skills: string[]; topics: string[]; tags: string[];
}, filters: DailyFilters) {
  if (item.source_language !== "en") return false;
  const createdAt = new Date(item.created_at);
  if (filters.createdMode === "date" && vietnamDate(createdAt) !== filters.createdDate) return false;
  if (filters.createdMode === "weekday" && vietnamWeekday(createdAt) !== filters.createdWeekday) return false;
  if (filters.kind !== "all" && item.kind !== filters.kind) return false;
  if (filters.levelMode === "unclassified" && item.cefr_level !== null) return false;
  if (filters.levelMode === "range") {
    const level = cefrLevels.indexOf(item.cefr_level as typeof cefrLevels[number]);
    if (level < cefrLevels.indexOf(filters.levelMin!) || level > cefrLevels.indexOf(filters.levelMax!)) return false;
  }
  if (filters.ieltsMode === "unclassified" && item.ielts_relevance !== null) return false;
  if (filters.ieltsMode === "high" && item.ielts_relevance !== "high") return false;
  if (filters.ieltsMode === "high-medium" && !["high", "medium"].includes(item.ielts_relevance ?? "")) return false;
  if (filters.ieltsMode === "low" && item.ielts_relevance !== "low") return false;
  if (filters.skill !== "all" && !item.ielts_skills.includes(filters.skill)) return false;
  if (filters.topic !== "all" && !item.topics.includes(filters.topic)) return false;
  if (filters.tag && !item.tags.some((tag) => tag.toLocaleLowerCase() === filters.tag.toLocaleLowerCase())) return false;
  return true;
}

async function readSet(session: Session, studyDate: string) {
  const { data: studySet, error: setError } = await session.supabase.from("daily_word_sets")
    .select("id,study_date,filters,requested_count,created_at,updated_at")
    .eq("user_id", session.user.id).eq("study_date", studyDate).maybeSingle();
  if (setError) throw setError;
  if (!studySet) return { set: null, items: [] };
  const { data: positions, error: itemError } = await session.supabase.from("daily_word_set_items")
    .select("vocabulary_item_id,position,studied_at").eq("user_id", session.user.id)
    .eq("set_id", studySet.id).order("position");
  if (itemError) throw itemError;
  const ids = (positions ?? []).map((item) => item.vocabulary_item_id);
  if (!ids.length) return { set: studySet, items: [] };
  const { data: vocabulary, error: vocabularyError } = await session.supabase.from("vocabulary_items")
    .select("id,term,kind,meaning_vi,meaning_en,example,collocations,cefr_level,ielts_relevance,ielts_skills,topics,tags,learning_reason")
    .eq("user_id", session.user.id).in("id", ids);
  if (vocabularyError) throw vocabularyError;
  const byId = new Map((vocabulary ?? []).map((item) => [item.id, item]));
  return { set: studySet, items: (positions ?? []).flatMap((position) => {
    const item = byId.get(position.vocabulary_item_id);
    return item ? [{ ...item, studied_at: position.studied_at }] : [];
  }) };
}

export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  const studyDate = request.nextUrl.searchParams.get("date") ?? vietnamDate();
  if (!dateSchema.safeParse(studyDate).success) return apiError("Ngày học không hợp lệ.");
  try { return NextResponse.json(await readSet(session, studyDate), { headers: { "Cache-Control": "no-store" } }); }
  catch { return apiError("Không thể tải bộ từ. Hãy kiểm tra migration 002_learning.sql.", 500); }
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Dữ liệu không hợp lệ."); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success || !validFilters(parsed.data.filters)) return apiError("Bộ lọc từ vựng không hợp lệ.");
  const { studyDate, count, filters } = parsed.data;
  try {
    const candidates = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await session.supabase.from("vocabulary_items")
        .select("id,created_at,source_language,kind,cefr_level,ielts_relevance,ielts_skills,topics,tags")
        .eq("user_id", session.user.id).order("id").range(offset, offset + pageSize - 1);
      if (error) throw error;
      candidates.push(...(data ?? []).filter((item) => matches(item, filters)));
      if (!data || data.length < pageSize) break;
    }
    for (let index = candidates.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [candidates[index], candidates[other]] = [candidates[other], candidates[index]];
    }
    const selected = candidates.slice(0, count).map((item) => item.id);
    const { error } = await session.supabase.rpc("replace_daily_word_set", {
      p_study_date: studyDate, p_filters: filters, p_requested_count: count, p_item_ids: selected
    });
    if (error) throw error;
    return NextResponse.json({ ...(await readSet(session, studyDate)), available: candidates.length }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("Không thể tạo bộ từ. Hãy kiểm tra migration 002_learning.sql.", 500);
  }
}

export async function PATCH(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Dữ liệu không hợp lệ."); }
  const parsed = studiedSchema.safeParse(body);
  if (!parsed.success) return apiError("Mục từ không hợp lệ.");
  try {
    const { data, error } = await session.supabase.rpc("set_daily_word_studied", {
      p_study_date: parsed.data.studyDate, p_item_id: parsed.data.itemId, p_studied: parsed.data.studied
    });
    if (error) throw error;
    if (!data) return apiError("Không tìm thấy mục từ trong bộ học.", 404);
    return NextResponse.json({ ok: true });
  } catch { return apiError("Không thể cập nhật tiến độ học.", 500); }
}
