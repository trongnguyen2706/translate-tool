import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireApiSession } from "@/lib/api";
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
  const { data, error } = await session.supabase.rpc("save_vocabulary_item", { p_item: parsed.data });
  if (error) return apiError(error.code === "21000" ? "Có nhiều mục cùng nghĩa. Chọn và sửa mục trong kho trước khi lưu." : "Không thể lưu từ. Kiểm tra migration 007.", error.code === "21000" ? 409 : 500);
  return NextResponse.json(data);
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
  const { data, error } = await session.supabase.rpc("save_vocabulary_item", {
    p_item: payload, p_target_id: id, p_overwrite: true, p_expected_revision: old.revision
  });
  if (error) return apiError("Mục từ vừa được cập nhật hoặc không thể lưu. Tải lại rồi thử lại.", error.code === "40001" ? 409 : 500);
  return NextResponse.json({ item: data.item });
}

export async function DELETE(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  const id = request.nextUrl.searchParams.get("id");
  const undoRevision = request.nextUrl.searchParams.get("undoRevision");
  if (undoRevision !== null) {
    const revision = Number(undoRevision);
    if (!z.uuid().safeParse(id).success || !Number.isInteger(revision) || revision < 1) return apiError("Thao tác hoàn tác không hợp lệ.");
    const { data, error } = await session.supabase.rpc("undo_vocabulary_save", { p_id: id, p_revision: revision });
    if (error) return apiError("Không thể hoàn tác.", 500);
    if (!data) return apiError("Từ đã được sửa, thêm ngữ cảnh hoặc đưa vào học. Hãy quản lý mục này trong Kho từ.", 409);
    return NextResponse.json({ ok: true, deletedIds: [id] });
  }
  let body: unknown;
  if (id !== null) body = { ids: [id] };
  else {
    try { body = await request.json(); } catch { return apiError("Dữ liệu không hợp lệ."); }
  }
  const parsed = z.object({ ids: z.array(z.uuid()).min(1).max(100) }).safeParse(body);
  if (!parsed.success) return apiError("Chọn từ 1 đến 100 ID hợp lệ mỗi lần xóa.");
  const { data, error } = await session.supabase.rpc("delete_vocabulary_items", { p_ids: [...new Set(parsed.data.ids)] });
  if (error) return apiError("Không thể xóa mục từ.", 500);
  return NextResponse.json({ ok: true, deletedIds: data ?? [] });
}
