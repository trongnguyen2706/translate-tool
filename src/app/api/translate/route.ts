import { NextRequest, NextResponse } from "next/server";
import { apiError, checkDailyLimit, recordUsage, requireApiSession } from "@/lib/api";
import { hasOpenAIConfig } from "@/lib/config";
import { openaiClient, openaiModel } from "@/lib/openai/client";
import { summarizeCost } from "@/lib/openai/pricing";
import { translateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const languageInstructions = {
  "en-vi": "Translate from English to natural Vietnamese. Keep meaning, tone, names and paragraph breaks. Return only the translation.",
  "vi-en": "Translate from Vietnamese to natural English. Keep meaning, tone, names and paragraph breaks. Return only the translation.",
  "en-en": "Rewrite the English in clear, natural English and explain difficult expressions briefly in English. Preserve the original meaning. Return only the rewritten text and concise explanation."
} as const;

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập bằng tài khoản được phép.", 401);
  if (!hasOpenAIConfig()) return apiError("OpenAI API chưa được cấu hình.", 503);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Dữ liệu không hợp lệ."); }
  const parsed = translateSchema.safeParse(body);
  if (!parsed.success) return apiError("Văn bản cần dịch dài tối đa 12.000 ký tự.");
  try {
    if (!await checkDailyLimit(session.supabase, session.user.id, "translation")) {
      return apiError("Bạn đã hết lượt dịch hôm nay.", 429);
    }
    const response = await openaiClient().responses.create({
      model: openaiModel(),
      instructions: languageInstructions[parsed.data.direction],
      input: parsed.data.text,
      max_output_tokens: 6000,
      store: false
    });
    const translation = response.output_text?.trim();
    if (!translation) return apiError("Chưa nhận được bản dịch. Hãy thử lại.", 502);
    await recordUsage(session.supabase, session.user.id, "translation", response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0);
    return NextResponse.json({ translation, usage: summarizeCost(response.model, response.usage) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("Không thể dịch lúc này. Hãy thử lại sau.", 502);
  }
}
