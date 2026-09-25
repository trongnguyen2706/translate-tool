import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireApiSession } from "@/lib/api";
import { directionSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const saveSchema = z.object({
  source_text: z.string().trim().min(1).max(12000),
  direction: directionSchema,
  translated_text: z.string().trim().min(1).max(30000)
});

export async function GET() {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  const { data, error } = await session.supabase.from("translations")
    .select("id,source_text,direction,translated_text,created_at")
    .eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(100);
  if (error) return apiError("Không thể tải lịch sử.", 500);
  return NextResponse.json({ items: data }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Dữ liệu không hợp lệ."); }
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) return apiError("Bản dịch không hợp lệ.");
  const { data, error } = await session.supabase.from("translations")
    .insert({ ...parsed.data, user_id: session.user.id })
    .select("id,source_text,direction,translated_text,created_at").single();
  if (error) return apiError("Không thể lưu bản dịch.", 500);
  return NextResponse.json({ item: data }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  const id = request.nextUrl.searchParams.get("id");
  if (!z.uuid().safeParse(id).success) return apiError("ID không hợp lệ.");
  const { error } = await session.supabase.from("translations")
    .delete().eq("id", id).eq("user_id", session.user.id);
  if (error) return apiError("Không thể xóa bản dịch.", 500);
  return NextResponse.json({ ok: true });
}
