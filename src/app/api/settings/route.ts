import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireApiSession } from "@/lib/api";
import { directionSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const schema = z.object({
  default_direction: directionSchema,
  approve_before_save: z.boolean()
});

export async function GET() {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  const { data, error } = await session.supabase.from("user_settings")
    .select("default_direction,approve_before_save").eq("user_id", session.user.id).maybeSingle();
  if (error) return apiError("Không thể tải cài đặt.", 500);
  return NextResponse.json({ settings: data ?? { default_direction: "en-vi", approve_before_save: true } });
}

export async function PUT(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Dữ liệu không hợp lệ."); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiError("Cài đặt không hợp lệ.");
  const { data, error } = await session.supabase.from("user_settings")
    .upsert({ ...parsed.data, user_id: session.user.id, updated_at: new Date().toISOString() })
    .select("default_direction,approve_before_save").single();
  if (error) return apiError("Không thể lưu cài đặt.", 500);
  return NextResponse.json({ settings: data });
}
