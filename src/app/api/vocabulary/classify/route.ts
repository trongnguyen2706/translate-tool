import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, checkDailyLimit, recordUsage, requireApiSession } from "@/lib/api";
import { hasOpenAIConfig } from "@/lib/config";
import { openaiClient, openaiModel } from "@/lib/openai/client";
import { learningInstructions, learningMetadataProperties, learningMetadataRequired } from "@/lib/openai/learning-schema";
import { summarizeCost } from "@/lib/openai/pricing";
import { learningMetadataSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const requestSchema = z.object({ ids: z.array(z.uuid()).min(1).max(10) });
const classifiedSchema = learningMetadataSchema.extend({ id: z.uuid() });

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  if (!hasOpenAIConfig()) return apiError("OpenAI API chưa được cấu hình.", 503);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Dữ liệu không hợp lệ."); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return apiError("Chọn từ 1 đến 10 mục để phân loại.");
  const ids = [...new Set(parsed.data.ids)];
  const { data: sourceItems, error: lookupError } = await session.supabase.from("vocabulary_items")
    .select("id,term,kind,source_language,meaning_vi,meaning_en,example,source_text")
    .eq("user_id", session.user.id).in("id", ids);
  if (lookupError) return apiError("Không thể tải các mục từ.", 500);
  if (!sourceItems || sourceItems.length !== ids.length) return apiError("Có mục từ không tồn tại.", 404);

  try {
    if (!await checkDailyLimit(session.supabase, session.user.id, "suggestion")) {
      return apiError("Bạn đã hết lượt gợi ý hôm nay.", 429);
    }
    const response = await openaiClient().responses.create({
      model: openaiModel(),
      instructions: `${learningInstructions} Return one classification for each supplied id. For a Vietnamese term, use null for English CEFR and IELTS relevance unless its English meaning clearly identifies an English expression.`,
      input: JSON.stringify(sourceItems),
      max_output_tokens: 2600,
      store: false,
      text: { format: {
        type: "json_schema", name: "learning_classification", strict: true,
        schema: { type: "object", properties: { items: { type: "array", items: {
          type: "object", properties: { id: { type: "string" }, ...learningMetadataProperties },
          required: ["id", ...learningMetadataRequired], additionalProperties: false
        } } }, required: ["items"], additionalProperties: false }
      } }
    });
    const decoded = JSON.parse(response.output_text || "{}") as { items?: unknown[] };
    await recordUsage(session.supabase, session.user.id, "suggestion", response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0);
    const validIds = new Set(ids);
    const classified = (decoded.items ?? []).map((item) => classifiedSchema.safeParse(item))
      .filter((result) => result.success).map((result) => result.data)
      .filter((item) => validIds.has(item.id));
    let updated = 0;
    for (const item of classified) {
      const { error } = await session.supabase.from("vocabulary_items")
        .update({
          cefr_level: item.cefr_level, ielts_relevance: item.ielts_relevance,
          ielts_skills: item.ielts_skills, topics: item.topics,
          learning_reason: item.learning_reason, updated_at: new Date().toISOString()
        }).eq("id", item.id).eq("user_id", session.user.id);
      if (error) return apiError(`Đã phân loại ${updated}/${ids.length} mục. Hãy kiểm tra migration 002_learning.sql.`, 500);
      updated++;
    }
    return NextResponse.json({ updated, requested: ids.length, usage: summarizeCost(response.model, response.usage) });
  } catch {
    return apiError("Không thể phân loại từ lúc này.", 502);
  }
}
