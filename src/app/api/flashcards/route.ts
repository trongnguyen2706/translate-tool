import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireApiSession } from "@/lib/api";
import { flashcardStatusSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const addSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("daily"), studyDate: z.iso.date() }),
  z.object({ source: z.literal("library"), itemId: z.uuid() })
]);
const updateSchema = z.object({ itemId: z.uuid(), status: flashcardStatusSchema.nullable() });

export async function GET() {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  const cards = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await session.supabase.from("flashcards")
      .select("vocabulary_item_id,status,source_daily_date,created_at")
      .eq("user_id", session.user.id).order("created_at", { ascending: false }).range(offset, offset + 499);
    if (error) return apiError("Không thể tải flashcard. Hãy kiểm tra migration 003_flashcards_tags.sql.", 500);
    cards.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  const itemPages = [];
  for (let offset = 0; offset < cards.length; offset += 100) {
    const ids = cards.slice(offset, offset + 100).map((card) => card.vocabulary_item_id);
    itemPages.push(session.supabase.from("vocabulary_items")
      .select("id,term,meaning_vi,meaning_en,example,collocations,kind,cefr_level,ielts_relevance,topics,tags")
      .eq("user_id", session.user.id).in("id", ids));
  }
  const results = await Promise.all(itemPages);
  if (results.some((result) => result.error)) return apiError("Không thể tải nội dung flashcard.", 500);
  const items = results.flatMap((result) => result.data ?? []);
  const byId = new Map(items.map((item) => [item.id, item]));
  return NextResponse.json({ cards: cards.flatMap((card) => {
    const item = byId.get(card.vocabulary_item_id);
    return item ? [{ ...card, ...item }] : [];
  }) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Dữ liệu không hợp lệ."); }
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) return apiError("Nguồn flashcard không hợp lệ.");

  let ids: string[];
  let sourceDate: string | null = null;
  if (parsed.data.source === "daily") {
    const { data: set, error } = await session.supabase.from("daily_word_sets")
      .select("id").eq("user_id", session.user.id).eq("study_date", parsed.data.studyDate).maybeSingle();
    if (error) return apiError("Không thể tìm bộ từ hôm nay.", 500);
    if (!set) return apiError("Chưa có bộ từ cho ngày đã chọn.", 404);
    const { data: positions, error: itemError } = await session.supabase.from("daily_word_set_items")
      .select("vocabulary_item_id").eq("user_id", session.user.id).eq("set_id", set.id);
    if (itemError) return apiError("Không thể đọc bộ từ.", 500);
    ids = (positions ?? []).map((item) => item.vocabulary_item_id);
    sourceDate = parsed.data.studyDate;
  } else {
    const { data: item, error } = await session.supabase.from("vocabulary_items")
      .select("id").eq("user_id", session.user.id).eq("id", parsed.data.itemId).maybeSingle();
    if (error) return apiError("Không thể tìm từ.", 500);
    if (!item) return apiError("Từ không có trong kho.", 404);
    ids = [item.id];
  }
  if (!ids.length) return NextResponse.json({ added: 0, total: 0 });
  const { data: existing, error: existingError } = await session.supabase.from("flashcards")
    .select("vocabulary_item_id").eq("user_id", session.user.id).in("vocabulary_item_id", ids);
  if (existingError) return apiError("Không thể kiểm tra flashcard đã có.", 500);
  const { data, error } = await session.supabase.from("flashcards")
    .upsert(ids.map((id) => ({ user_id: session.user.id, vocabulary_item_id: id,
      status: null, source_daily_date: sourceDate })),
      { onConflict: "user_id,vocabulary_item_id", ignoreDuplicates: true }).select("vocabulary_item_id");
  if (error) return apiError("Không thể tạo flashcard. Hãy kiểm tra migration 003_flashcards_tags.sql.", 500);
  if (sourceDate && existing?.length) {
    const { error: updateError } = await session.supabase.from("flashcards")
      .update({ source_daily_date: sourceDate, updated_at: new Date().toISOString() })
      .eq("user_id", session.user.id)
      .in("vocabulary_item_id", existing.map((item) => item.vocabulary_item_id));
    if (updateError) return apiError("Đã tạo thẻ mới nhưng không thể cập nhật ngày học cho thẻ cũ.", 500);
  }
  return NextResponse.json({ added: data?.length ?? 0, total: ids.length });
}

export async function PATCH(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Dữ liệu không hợp lệ."); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return apiError("Trạng thái flashcard không hợp lệ.");
  const { data, error } = await session.supabase.from("flashcards")
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq("user_id", session.user.id).eq("vocabulary_item_id", parsed.data.itemId)
    .select("vocabulary_item_id").maybeSingle();
  if (error) return apiError("Không thể lưu mức ghi nhớ.", 500);
  if (!data) return apiError("Không tìm thấy flashcard.", 404);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  const id = request.nextUrl.searchParams.get("itemId");
  if (!z.uuid().safeParse(id).success) return apiError("ID không hợp lệ.");
  const { error } = await session.supabase.from("flashcards")
    .delete().eq("user_id", session.user.id).eq("vocabulary_item_id", id);
  if (error) return apiError("Không thể xóa flashcard.", 500);
  return NextResponse.json({ ok: true });
}
