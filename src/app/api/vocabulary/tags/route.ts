import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, checkDailyLimit, recordUsage, requireApiSession } from "@/lib/api";
import { hasOpenAIConfig } from "@/lib/config";
import { openaiClient, openaiModel } from "@/lib/openai/client";
import { aiTagInstructions, aiTagsProperty } from "@/lib/openai/learning-schema";
import { aiTagsSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const requestSchema = z.object({ ids: z.array(z.uuid()).min(1).max(10) });
const resultSchema = z.object({ items: z.array(z.object({ id: z.uuid(), tags: aiTagsSchema })).min(1).max(10) });

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  if (!hasOpenAIConfig()) return apiError("OpenAI API chưa được cấu hình.", 503);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Dữ liệu không hợp lệ."); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return apiError("Chọn từ 1 đến 10 mục từ mỗi lô gắn tag.");

  try {
    const ids = [...new Set(parsed.data.ids)];
    const { data, error } = await session.supabase.from("vocabulary_items")
      .select("id,term,kind,source_language,meaning_vi,meaning_en,example,source_text,tags,updated_at")
      .eq("user_id", session.user.id).in("id", ids);
    if (error) return apiError("Không thể tải từ cần gắn tag.", 500);
    if (!data || data.length !== ids.length) return apiError("Một số từ không còn trong kho. Hãy tải lại trước khi tiếp tục.", 404);
    const untagged = data.filter((item) => item.tags.length === 0);
    if (!untagged.length) return NextResponse.json({ items: [], skipped: ids.length });
    if (!await checkDailyLimit(session.supabase, session.user.id, "suggestion")) {
      return apiError("Đã hết lượt AI hôm nay. Tag đã lưu vẫn được giữ; bạn có thể tiếp tục vào ngày mai.", 429);
    }

    const response = await openaiClient().responses.create({
      model: openaiModel(),
      instructions: `You are an English-Vietnamese vocabulary tutor. ${aiTagInstructions} Return exactly one result for each supplied ID, keeping IDs unchanged.`,
      input: JSON.stringify(untagged.map((item) => ({
        id: item.id, term: item.term, kind: item.kind, source_language: item.source_language,
        meaning_vi: item.meaning_vi, meaning_en: item.meaning_en, example: item.example,
        source_text: item.source_text.slice(0, 2000)
      }))),
      max_output_tokens: 1800,
      store: false,
      text: { format: {
        type: "json_schema", name: "vocabulary_tags", strict: true,
        schema: {
          type: "object", additionalProperties: false, required: ["items"],
          properties: { items: { type: "array", items: {
            type: "object", additionalProperties: false, required: ["id", "tags"],
            properties: { id: { type: "string" }, tags: aiTagsProperty }
          } } }
        }
      } }
    });
    await recordUsage(session.supabase, session.user.id, "suggestion", response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0);
    const result = resultSchema.safeParse(JSON.parse(response.output_text || "{}"));
    if (!result.success) return apiError("AI chưa trả đủ tag hợp lệ. Hãy thử lại lô này.", 502);
    const originals = new Map(untagged.map((item) => [item.id, item]));
    const resultIds = new Set(result.data.items.map((item) => item.id));
    if (resultIds.size !== untagged.length || result.data.items.length !== untagged.length || [...resultIds].some((id) => !originals.has(id))) {
      return apiError("AI trả danh sách từ chưa đầy đủ. Hãy thử lại lô này.", 502);
    }

    const updated: { id: string; tags: string[]; updated_at: string }[] = [];
    for (const item of result.data.items) {
      // Compare the original version so AI never overwrites tags or context edited during generation.
      const { data: saved, error: saveError } = await session.supabase.from("vocabulary_items")
        .update({ tags: item.tags, updated_at: new Date().toISOString() })
        .eq("id", item.id).eq("user_id", session.user.id).eq("tags", "{}")
        .eq("updated_at", originals.get(item.id)!.updated_at)
        .select("id,tags,updated_at").maybeSingle();
      if (saveError) return NextResponse.json({ items: updated, error: "Không thể lưu hết lô tag. Những tag đã lưu được giữ lại; hãy thử lại các từ còn thiếu." }, { status: 500 });
      if (saved) updated.push(saved);
    }
    return NextResponse.json({ items: updated, skipped: ids.length - updated.length });
  } catch {
    return apiError("Không thể gắn tag lúc này. Những lô đã hoàn thành được giữ lại; hãy thử tiếp các từ chưa có tag.", 502);
  }
}
