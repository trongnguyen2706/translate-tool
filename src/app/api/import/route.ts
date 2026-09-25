import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireApiSession } from "@/lib/api";
import { meaningKey, normalizeText } from "@/lib/normalize";
import { dailyFiltersSchema, directionSchema, vocabularySchema } from "@/lib/validation";
import { parseCsv, vocabularyCsvColumns } from "@/lib/vocabulary-csv";

export const dynamic = "force-dynamic";

const schema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  vocabulary: z.array(vocabularySchema.extend({
    id: z.uuid().optional(),
    created_at: z.string().datetime({ offset: true }).optional(),
    updated_at: z.string().datetime({ offset: true }).optional()
  })).max(2000),
  translations: z.array(z.object({
    id: z.uuid().optional(),
    source_text: z.string().trim().min(1).max(12000),
    direction: directionSchema,
    translated_text: z.string().trim().min(1).max(30000),
    created_at: z.string().datetime({ offset: true }).optional()
  })).max(2000),
  daily_sets: z.array(z.object({
    study_date: z.iso.date(), filters: dailyFiltersSchema,
    requested_count: z.number().int().min(1).max(30),
    items: z.array(z.object({ vocabulary_item_id: z.uuid(), studied: z.boolean() })).max(30)
  })).max(2000).optional(),
  flashcards: z.array(z.object({ vocabulary_item_id: z.uuid(), status: z.enum(["not_yet", "roughly", "learned", "mastered"]).nullable(), source_daily_date: z.iso.date().nullable().optional() })).max(2000).optional()
});

const csvItemSchema = vocabularySchema.extend({
  created_at: z.string().datetime({ offset: true }).optional()
});

async function importCsv(request: NextRequest, session: NonNullable<Awaited<ReturnType<typeof requireApiSession>>>) {
  const csv = await request.text();
  if (new TextEncoder().encode(csv).length > 2_000_000) return apiError("Tệp nhập quá lớn.", 413);

  let rows: string[][];
  try { rows = parseCsv(csv); }
  catch (error) { return apiError(error instanceof Error ? error.message : "CSV không hợp lệ."); }
  if (rows.length < 2) return apiError("CSV cần có hàng tiêu đề và ít nhất một mục từ.");
  if (rows.length > 2001) return apiError("CSV chỉ được chứa tối đa 2.000 mục từ.");

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) return apiError("CSV có tên cột bị lặp.");
  const unknown = headers.find((header) => !vocabularyCsvColumns.includes(header as typeof vocabularyCsvColumns[number]));
  if (unknown !== undefined) return apiError(`CSV có cột không hỗ trợ: ${unknown || "(trống)"}. Hãy dùng CSV mẫu.`);
  const missing = ["term", "kind", "source_language"].filter((header) => !headers.includes(header));
  if (missing.length) return apiError(`CSV thiếu cột bắt buộc: ${missing.join(", ")}.`);

  const items = [];
  for (let index = 1; index < rows.length; index++) {
    const cells = rows[index];
    if (cells.length !== headers.length) return apiError(`Mục CSV số ${index}: số ô không khớp hàng tiêu đề.`);
    const values = Object.fromEntries(headers.map((header, column) => [header, cells[column].trim()]));
    const parsed = csvItemSchema.safeParse({
      term: values.term,
      kind: values.kind,
      source_language: values.source_language,
      meaning_vi: values.meaning_vi ?? "",
      meaning_en: values.meaning_en ?? "",
      example: values.example ?? "",
      collocations: (values.collocations ?? "").split(";").map((value) => value.trim()).filter(Boolean),
      source_text: values.source_text ?? "",
      note: values.note ?? "",
      cefr_level: values.cefr_level || null,
      ielts_relevance: values.ielts_relevance || null,
      ielts_skills: (values.ielts_skills ?? "").split(";").map((value) => value.trim()).filter(Boolean),
      topics: (values.topics ?? "").split(";").map((value) => value.trim()).filter(Boolean),
      tags: (values.tags ?? "").split(";").map((value) => value.trim()).filter(Boolean),
      learning_reason: values.learning_reason ?? "",
      ...(values.created_at ? { created_at: values.created_at } : {})
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return apiError(`Mục CSV số ${index}, cột ${issue.path.join(".") || "dữ liệu"}: ${issue.message}.`);
    }
    const item = parsed.data;
    items.push({
      ...item,
      tags: [...new Set([...item.tags, "Đã nhập"])],
      created_at: item.created_at ?? new Date().toISOString(),
      user_id: session.user.id,
      normalized_term: normalizeText(item.term),
      normalized_meaning: meaningKey(item.meaning_en, item.meaning_vi)
    });
  }

  const unique = new Map(items.map((item) => [
    `${item.normalized_term}\u0000${item.source_language}\u0000${item.normalized_meaning}`, item
  ]));
  let imported = 0;
  const vocabulary = [...unique.values()];
  for (let offset = 0; offset < vocabulary.length; offset += 100) {
    const { data, error } = await session.supabase.from("vocabulary_items")
      .upsert(vocabulary.slice(offset, offset + 100), {
        onConflict: "user_id,normalized_term,source_language,normalized_meaning",
        ignoreDuplicates: true
      }).select("id");
    if (error) return apiError("Không thể nhập CSV vào kho từ.", 500);
    imported += data?.length ?? 0;
  }
  return NextResponse.json({ vocabulary: imported, skipped: items.length - imported, translations: 0 });
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  if (Number(request.headers.get("content-length") ?? 0) > 2_000_000) return apiError("Tệp nhập quá lớn.", 413);
  if (request.nextUrl.searchParams.get("format") === "csv") return importCsv(request, session);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Tệp JSON không hợp lệ."); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiError("Tệp không đúng định dạng xuất của app.");

  const vocabulary = parsed.data.vocabulary.map((item) => ({
    ...vocabularySchema.parse(item),
    tags: [...new Set([...(item.tags ?? []), "Đã nhập"])],
    ...(item.created_at ? { created_at: item.created_at } : {}),
    ...(item.updated_at ? { updated_at: item.updated_at } : {}),
    user_id: session.user.id,
    normalized_term: normalizeText(item.term),
    normalized_meaning: meaningKey(item.meaning_en, item.meaning_vi)
  }));
  for (let offset = 0; offset < vocabulary.length; offset += 100) {
    const { error } = await session.supabase.from("vocabulary_items")
      .upsert(vocabulary.slice(offset, offset + 100), { onConflict: "user_id,normalized_term,source_language,normalized_meaning" });
    if (error) return apiError("Không thể nhập kho từ.", 500);
  }
  const translations = parsed.data.translations.map((item) => ({ ...item, user_id: session.user.id }));
  for (let offset = 0; offset < translations.length; offset += 100) {
    const { error } = await session.supabase.from("translations").upsert(translations.slice(offset, offset + 100));
    if (error) return apiError("Không thể nhập bản dịch.", 500);
  }
  let dailySetsImported = 0;
  if (parsed.data.daily_sets?.length || parsed.data.flashcards?.length) {
    const oldKeyById = new Map(parsed.data.vocabulary.filter((item) => item.id).map((item) => [item.id!,
      `${normalizeText(item.term)}\u0000${item.source_language}\u0000${meaningKey(item.meaning_en, item.meaning_vi)}`]));
    const currentIdByKey = new Map<string, string>();
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await session.supabase.from("vocabulary_items")
        .select("id,normalized_term,source_language,normalized_meaning")
        .eq("user_id", session.user.id).order("id").range(offset, offset + pageSize - 1);
      if (error) return apiError("Không thể khôi phục bộ học theo ngày.", 500);
      for (const item of data ?? []) currentIdByKey.set(`${item.normalized_term}\u0000${item.source_language}\u0000${item.normalized_meaning}`, item.id);
      if (!data || data.length < pageSize) break;
    }
    for (const set of parsed.data.daily_sets ?? []) {
      const ids = set.items.map((item) => currentIdByKey.get(oldKeyById.get(item.vocabulary_item_id) ?? ""));
      if (ids.some((id) => !id) || new Set(ids).size !== ids.length || ids.length > set.requested_count) {
        return apiError(`Bộ học ${set.study_date} tham chiếu mục từ không hợp lệ.`, 400);
      }
      const { error } = await session.supabase.rpc("replace_daily_word_set", {
        p_study_date: set.study_date, p_filters: set.filters,
        p_requested_count: set.requested_count, p_item_ids: ids as string[]
      });
      if (error) return apiError(`Không thể khôi phục bộ học ${set.study_date}. Hãy kiểm tra migration 002_learning.sql.`, 500);
      for (let index = 0; index < set.items.length; index++) {
        if (!set.items[index].studied) continue;
        const { error: progressError } = await session.supabase.rpc("set_daily_word_studied", {
          p_study_date: set.study_date, p_item_id: ids[index], p_studied: true
        });
        if (progressError) return apiError(`Không thể khôi phục tiến độ ${set.study_date}.`, 500);
      }
      dailySetsImported++;
    }
    if (parsed.data.flashcards?.length) {
      const cards = parsed.data.flashcards.map((card) => ({
        user_id: session.user.id,
        vocabulary_item_id: currentIdByKey.get(oldKeyById.get(card.vocabulary_item_id) ?? ""),
        status: card.status,
        source_daily_date: card.source_daily_date ?? null
      }));
      if (cards.some((card) => !card.vocabulary_item_id)) return apiError("Flashcard tham chiếu mục từ không hợp lệ.");
      for (let offset = 0; offset < cards.length; offset += 100) {
        const { error } = await session.supabase.from("flashcards")
          .upsert(cards.slice(offset, offset + 100), { onConflict: "user_id,vocabulary_item_id" });
        if (error) return apiError("Không thể khôi phục flashcard. Hãy kiểm tra migration 003_flashcards_tags.sql.", 500);
      }
    }
  }
  return NextResponse.json({ vocabulary: vocabulary.length, translations: translations.length, daily_sets: dailySetsImported, flashcards: parsed.data.flashcards?.length ?? 0 });
}
