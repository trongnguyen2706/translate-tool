import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireApiSession } from "@/lib/api";
import { meaningKey, normalizeText } from "@/lib/normalize";
import { vocabularySchema, vocabularyUpdateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const fields = "id,term,kind,source_language,meaning_vi,meaning_en,example,collocations,source_text,note,cefr_level,ielts_relevance,ielts_skills,topics,tags,learning_reason,created_at,updated_at";

export async function GET() {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
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
  if (values.term) payload.normalized_term = normalizeText(values.term);
  if (values.meaning_en !== undefined || values.meaning_vi !== undefined) {
    const { data: old } = await session.supabase.from("vocabulary_items")
      .select("meaning_en,meaning_vi").eq("id", id).eq("user_id", session.user.id).single();
    if (!old) return apiError("Không tìm thấy mục từ.", 404);
    payload.normalized_meaning = meaningKey(values.meaning_en ?? old.meaning_en, values.meaning_vi ?? old.meaning_vi);
  }
  const { data, error } = await session.supabase.from("vocabulary_items")
    .update(payload).eq("id", id).eq("user_id", session.user.id).select(fields).single();
  if (error) return apiError("Không thể sửa mục từ.", 500);
  return NextResponse.json({ item: data });
}

export async function DELETE(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  const id = request.nextUrl.searchParams.get("id");
  if (!z.uuid().safeParse(id).success) return apiError("ID không hợp lệ.");
  const { error } = await session.supabase.from("vocabulary_items")
    .delete().eq("id", id).eq("user_id", session.user.id);
  if (error) return apiError("Không thể xóa mục từ.", 500);
  return NextResponse.json({ ok: true });
}
