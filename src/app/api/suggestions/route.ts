import { NextRequest, NextResponse } from "next/server";
import { apiError, checkDailyLimit, recordUsage, requireApiSession } from "@/lib/api";
import { hasOpenAIConfig } from "@/lib/config";
import { openaiClient, openaiModel } from "@/lib/openai/client";
import { summarizeCost } from "@/lib/openai/pricing";
import { aiTagInstructions, aiTagsProperty, learningInstructions, learningMetadataProperties, learningMetadataRequired } from "@/lib/openai/learning-schema";
import { suggestionsRequestSchema, suggestionSchema } from "@/lib/validation";
import { cefrLevels } from "@/lib/learning";
import { normalizeText } from "@/lib/normalize";

export const dynamic = "force-dynamic";

const itemSchema = {
  type: "object",
  properties: {
    term: { type: "string" },
    kind: { type: "string", enum: ["word", "phrase"] },
    meaning_vi: { type: "string" },
    meaning_en: { type: "string" },
    example: { type: "string" },
    collocations: { type: "array", items: { type: "string" } },
    tags: aiTagsProperty,
    ...learningMetadataProperties
  },
  required: ["term", "kind", "meaning_vi", "meaning_en", "example", "collocations", "tags", ...learningMetadataRequired],
  additionalProperties: false
} as const;

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập bằng tài khoản được phép.", 401);
  if (!hasOpenAIConfig()) return apiError("OpenAI API chưa được cấu hình.", 503);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Dữ liệu không hợp lệ."); }
  const parsed = suggestionsRequestSchema.safeParse(body);
  if (!parsed.success) return apiError("Nội dung gợi ý không hợp lệ.");
  try {
    if (!await checkDailyLimit(session.supabase, session.user.id, "suggestion")) {
      return apiError("Bạn đã hết lượt gợi ý hôm nay.", 429);
    }
    const { text, focusTerm } = parsed.data;
    const options = parsed.data.options ?? {
      mode: "general" as const, currentLevel: "B1" as const,
      skill: "all" as const, topic: "all" as const, count: 8 as const
    };
    const translation = parsed.data.source === "translation" ? parsed.data.translation : "";
    const response = await openaiClient().responses.create({
      model: openaiModel(),
      instructions: `${learningInstructions} ${aiTagInstructions} Suggest useful English words, expressions, and collocations related to the supplied text. For English source text, extract expressions actually present in it. For Vietnamese source text, propose natural English equivalents and say they are proposed expressions in the learning reason. Meanings must fit context. Examples must be short and natural. Return no more than the requested count. Respect the learner's CEFR level as a minimum: suggest items at that level or higher. Also respect IELTS mode, skill, and topic. If no relevant item exists, return an empty array. Focus terms may have directly related collocations, but do not recursively expand examples.`,
      input: JSON.stringify({ source: parsed.data.source, text, translation, direction: parsed.data.direction, focusTerm, options }),
      max_output_tokens: 4800,
      store: false,
      text: { format: {
        type: "json_schema",
        name: "vocabulary_suggestions",
        strict: true,
        schema: {
          type: "object",
          properties: { items: { type: "array", items: itemSchema } },
          required: ["items"],
          additionalProperties: false
        }
      } }
    });
    const decoded = JSON.parse(response.output_text || "{}") as { items?: unknown[] };
    const minLevel = cefrLevels.indexOf(options.currentLevel);
    const seen = new Set<string>();
    const candidates = (decoded.items ?? []).map((item) => suggestionSchema.safeParse(item))
      .filter((result) => result.success).map((result) => result.data);
    const candidateTerms = [...new Set(candidates.map((item) => normalizeText(item.term)))];
    const { data: existing, error: existingError } = candidateTerms.length
      ? await session.supabase.from("vocabulary_items").select("normalized_term")
        .eq("user_id", session.user.id).eq("source_language", "en").in("normalized_term", candidateTerms)
      : { data: [], error: null };
    if (existingError) throw existingError;
    const savedTerms = new Set((existing ?? []).map((item) => item.normalized_term));
    const items = candidates.filter((item) => {
      const key = normalizeText(item.term);
      if (seen.has(key)) return false;
      seen.add(key);
      if (savedTerms.has(key)) return false;
      if (item.cefr_level && cefrLevels.indexOf(item.cefr_level) < minLevel) return false;
      if (!focusTerm && options.topic !== "all" && !item.topics.includes(options.topic)) return false;
      if (!focusTerm && options.mode !== "general" && item.ielts_relevance === "low") return false;
      if (!focusTerm && options.skill !== "all" && !item.ielts_skills.includes(options.skill)) return false;
      return true;
    }).slice(0, options.count);
    await recordUsage(session.supabase, session.user.id, "suggestion", response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0);
    return NextResponse.json({ items, usage: summarizeCost(response.model, response.usage) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("Không thể tạo gợi ý lúc này. Hãy thử lại sau.", 502);
  }
}
