import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireApiSession } from "@/lib/api";
import { meaningKey, normalizeText } from "@/lib/normalize";
import { vocabularySchema, vocabularyUpdateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const fields = "id,term,kind,source_language,meaning_vi,meaning_en,example,collocations,source_text,note,cefr_level,ielts_relevance,ielts_skills,topics,tags,learning_reason,details,field_provenance,revision,created_at,updated_at";

export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  const occurrenceItemId = request.nextUrl.searchParams.get("occurrences");
  if (occurrenceItemId !== null) {
    if (!z.uuid().safeParse(occurrenceItemId).success) return apiError("Mục từ không hợp lệ.", 400);
    const offset = Math.max(0, Number.parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);
    const { data, error } = await session.supabase.from("vocabulary_occurrences")
      .select("id,selected_text,context_text,source_url,source_title,source_kind,direction,video_time,created_at")
      .eq("user_id", session.user.id).eq("vocabulary_item_id", occurrenceItemId)
      .order("created_at", { ascending: false }).range(offset, offset + 9);
    if (error) return apiError("Không thể tải ngữ cảnh. Hãy kiểm tra migration 004_extension_capture.sql.", 500);
    return NextResponse.json({ occurrences: data ?? [], has_more: (data?.length ?? 0) === 10 }, { headers: { "Cache-Control": "no-store" } });
  }
  const items = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await session.supabase.from("vocabulary_items")
      .select(fields).eq("user_id", session.user.id)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) return apiError("Không thể tải kho từ.", 500);
    items.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Dữ liệu không hợp lệ."); }
  const parsed = vocabularySchema.safeParse(body);
  if (!parsed.success) return apiError("Mục từ không hợp lệ.");
  const item = parsed.data;
  const payload = {
    ...item,
    user_id: session.user.id,
    normalized_term: normalizeText(item.term),
    normalized_meaning: meaningKey(item.meaning_en, item.meaning_vi)
  };
  const { data: existing, error: lookupError } = await session.supabase.from("vocabulary_items")
    .select(fields).eq("user_id", session.user.id)
    .eq("normalized_term", payload.normalized_term)
    .eq("source_language", payload.source_language)
    .eq("normalized_meaning", payload.normalized_meaning).maybeSingle();
  if (lookupError) return apiError("Không thể kiểm tra từ đã lưu.", 500);
  if (existing) return NextResponse.json({ item: existing, already_existed: true });
  const { data, error } = await session.supabase.from("vocabulary_items")
    .insert(payload)
    .select(fields).single();
  if (error) return apiError("Không thể lưu từ. Hãy kiểm tra dữ liệu rồi thử lại.", 500);
  return NextResponse.json({ item: data, already_existed: false });
}

export async function PATCH(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Dữ liệu không hợp lệ."); }
  const parsed = z.object({ id: z.uuid(), values: vocabularyUpdateSchema }).safeParse(body);
  if (!parsed.success) return apiError("Mục từ không hợp lệ.");
  const { id, values } = parsed.data;
  const payload: Record<string, unknown> = { ...values, updated_at: new Date().toISOString() };
  const { data: old, error: oldError } = await session.supabase.from("vocabulary_items")
    .select("meaning_en,meaning_vi,revision,field_provenance").eq("id", id).eq("user_id", session.user.id).maybeSingle();
  if (oldError) return apiError("Không thể tải mục từ cần sửa.", 500);
  if (!old) return apiError("Không tìm thấy mục từ.", 404);
  payload.revision = old.revision + 1;
  const provenance = { ...((old.field_provenance ?? {}) as Record<string, unknown>) };
  for (const field of Object.keys(values)) provenance[field] = { source: "manual", updated_at: payload.updated_at };
  payload.field_provenance = provenance;
  if (values.term) payload.normalized_term = normalizeText(values.term);
  if (values.meaning_en !== undefined || values.meaning_vi !== undefined) {
    payload.normalized_meaning = meaningKey(values.meaning_en ?? old.meaning_en, values.meaning_vi ?? old.meaning_vi);
  }
  const { data, error } = await session.supabase.from("vocabulary_items")
    .update(payload).eq("id", id).eq("user_id", session.user.id).eq("revision", old.revision).select(fields).maybeSingle();
  if (error) return apiError("Không thể sửa mục từ.", 500);
  if (!data) return apiError("Mục từ vừa được cập nhật ở nơi khác. Tải lại trang rồi thử lại.", 409);
  return NextResponse.json({ item: data });
}

export async function DELETE(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  const id = request.nextUrl.searchParams.get("id");
  let body: unknown;
  if (id !== null) body = { ids: [id] };
  else {
    try { body = await request.json(); } catch { return apiError("Dữ liệu không hợp lệ."); }
  }
  const parsed = z.object({ ids: z.array(z.uuid()).min(1).max(100) }).safeParse(body);
  if (!parsed.success) return apiError("Chọn từ 1 đến 100 ID hợp lệ mỗi lần xóa.");
  const { data, error } = await session.supabase.from("vocabulary_items")
    .delete().in("id", [...new Set(parsed.data.ids)]).eq("user_id", session.user.id).select("id");
  if (error) return apiError("Không thể xóa mục từ.", 500);
  return NextResponse.json({ ok: true, deletedIds: (data ?? []).map((item) => item.id) });
}
