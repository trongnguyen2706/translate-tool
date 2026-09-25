import { NextResponse } from "next/server";
import { getAllowedSession } from "@/lib/auth";
import { dailyLimit } from "@/lib/config";

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireApiSession() {
  return getAllowedSession();
}

export function vietnamDayStart() {
  const vietnamDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  return new Date(`${vietnamDate}T00:00:00+07:00`);
}

export async function checkDailyLimit(
  supabase: NonNullable<Awaited<ReturnType<typeof getAllowedSession>>>["supabase"],
  userId: string,
  kind: "translation" | "suggestion"
) {
  const { count, error } = await supabase.from("usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("kind", kind).gte("created_at", vietnamDayStart().toISOString());
  if (error) throw error;
  return (count ?? 0) < dailyLimit(kind);
}

export async function recordUsage(
  supabase: NonNullable<Awaited<ReturnType<typeof getAllowedSession>>>["supabase"],
  userId: string,
  kind: "translation" | "suggestion",
  inputTokens: number,
  outputTokens: number
) {
  const { error } = await supabase.from("usage_events").insert({
    user_id: userId, kind, input_tokens: inputTokens, output_tokens: outputTokens
  });
  if (error) throw error;
}
