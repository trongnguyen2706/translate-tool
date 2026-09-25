import { NextResponse } from "next/server";
import { apiError, requireApiSession, vietnamDayStart } from "@/lib/api";
import { dailyLimit } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);

  const dayStart = vietnamDayStart().toISOString();
  const kinds = ["translation", "suggestion"] as const;
  try {
    const counts = await Promise.all(kinds.map(async (kind) => {
      const { count, error } = await session.supabase.from("usage_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", session.user.id).eq("kind", kind).gte("created_at", dayStart);
      if (error) throw error;
      const used = count ?? 0;
      const limit = dailyLimit(kind);
      return [kind, { used, limit, remaining: Math.max(0, limit - used) }] as const;
    }));
    return NextResponse.json({ usage: Object.fromEntries(counts) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("Không thể tải hạn mức hôm nay.", 500);
  }
}
