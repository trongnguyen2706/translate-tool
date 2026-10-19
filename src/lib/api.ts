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
  kind: "translation" | "suggestion",
  requestId: string
) {
  const { data, error } = await supabase.rpc("reserve_usage_request", {
    p_request_id: requestId, p_kind: kind, p_limit: dailyLimit(kind)
  });
  if (error) throw error;
  return data === true;
}

export async function recordUsage(
  supabase: NonNullable<Awaited<ReturnType<typeof getAllowedSession>>>["supabase"],
  kind: "translation" | "suggestion",
  inputTokens: number,
  outputTokens: number,
  requestId: string
) {
  const { error } = await supabase.rpc("complete_usage_request", {
    p_request_id: requestId, p_input_tokens: inputTokens, p_output_tokens: outputTokens
  });
  if (error) throw error;
}
