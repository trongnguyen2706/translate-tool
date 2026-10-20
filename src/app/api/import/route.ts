import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireApiSession } from "@/lib/api";
import { meaningKey, normalizeText } from "@/lib/normalize";
import { dailyFiltersSchema, directionSchema, vocabularySchema } from "@/lib/validation";
import { parseCsv, vocabularyCsvColumns } from "@/lib/vocabulary-csv";

export const dynamic = "force-dynamic";
const maxJsonBytes = 20_000_000;

const schema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  vocabulary: z.array(vocabularySchema.extend({
    details: z.record(z.string(), z.unknown()).optional(),
    field_provenance: z.record(z.string(), z.unknown()).optional(),
    revision: z.number().int().positive().optional(),
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
  flashcards: z.array(z.object({ vocabulary_item_id: z.uuid(), status: z.enum(["not_yet", "roughly", "learned", "mastered"]).nullable(), source_daily_date: z.iso.date().nullable().optional() })).max(2000).optional(),
  identity_refs: z.array(z.object({
    id: z.uuid().optional(), vocabulary_item_id: z.uuid(), provider: z.string().min(1).max(80),
    source_reference: z.string().min(1).max(500), dataset_version: z.string().max(80).default(""),
    created_at: z.string().datetime({ offset: true }).optional()
  })).max(100000).optional(),
  occurrences: z.array(z.object({
    id: z.uuid().optional(), vocabulary_item_id: z.uuid(), operation_id: z.uuid(),
    selected_text: z.string().min(1).max(120), context_text: z.string().max(2000).default(""),
    source_url: z.string().url().max(2048), source_title: z.string().max(300).default(""),
    source_kind: z.enum(["youtube", "web"]), direction: directionSchema,
    video_time: z.number().finite().min(0).nullable(), created_at: z.string().datetime({ offset: true }).optional()
  })).max(100000).optional()
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

  let imported = 0;
  for (const item of items) {
    const { data, error } = await session.supabase.rpc("save_vocabulary_item", { p_item: item });
    if (error) return apiError("Không thể nhập CSV. Mục có nghĩa trùng mơ hồ cần được xử lý trong Kho từ.", error.code === "21000" ? 409 : 500);
    if (!data.already_existed) imported++;
  }
  return NextResponse.json({ vocabulary: imported, skipped: items.length - imported, translations: 0 });
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  if (request.nextUrl.searchParams.get("format") === "csv") return importCsv(request, session);
  let body: unknown;
  try {
    const json = await request.text();
    if (new TextEncoder().encode(json).length > maxJsonBytes) return apiError("Tệp JSON tối đa 20 MB.", 413);
    body = JSON.parse(json);
  } catch { return apiError("Tệp JSON không hợp lệ."); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiError("Tệp không đúng định dạng xuất của app.");

  const partId = request.nextUrl.searchParams.get("partId");
  if (partId && !z.uuid().safeParse(partId).success) return apiError("Backup part ID không hợp lệ.");
  const hash = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
  const deterministicId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const { data, error } = await session.supabase.rpc("restore_backup_part", {
    p_part_id: partId ?? deterministicId, p_hash: hash, p_data: parsed.data
  });
  if (error) return apiError(error.code === "21000" || error.code === "23505" ? "Backup có liên kết nghĩa mơ hồ hoặc part ID bị trùng với nội dung khác. Chưa nhập phần này." : "Không thể nhập phần backup. Kiểm tra migration 008; phần này chưa được ghi.", error.code === "21000" || error.code === "23505" ? 409 : 500);
  return NextResponse.json(data);
}
