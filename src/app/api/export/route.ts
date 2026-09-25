import { NextRequest, NextResponse } from "next/server";
import { apiError, requireApiSession } from "@/lib/api";
import { csvEscape, vocabularyCsvColumns } from "@/lib/vocabulary-csv";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return apiError("Bạn cần đăng nhập.", 401);
  if (request.nextUrl.searchParams.get("format") === "csv" && request.nextUrl.searchParams.get("sample") === "1") {
    const sample = [
      vocabularyCsvColumns.join(","),
      ["climate change", "phrase", "en", "biến đổi khí hậu", "long-term changes in climate", "Climate change affects agriculture.", "address climate change; climate change impacts", "", "", "B2", "high", "writing; reading", "environment; society", "IELTS; môi trường", "Hữu ích khi thảo luận tác động môi trường.", ""].map(csvEscape).join(","),
      ["significant", "word", "en", "đáng kể", "important or large enough to matter", "The change had a significant effect.", "significant effect; significant increase", "", "", "B1", "high", "writing; speaking", "work; education", "học thuật", "Dùng được trong nhiều chủ đề.", ""].map(csvEscape).join(",")
    ].join("\r\n");
    return new NextResponse("\uFEFF" + sample, { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=phrasebook-sample.csv",
      "Cache-Control": "no-store"
    } });
  }
  const vocabulary = [];
  const translations = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await session.supabase.from("vocabulary_items")
      .select("id,term,kind,source_language,meaning_vi,meaning_en,example,collocations,source_text,note,cefr_level,ielts_relevance,ielts_skills,topics,tags,learning_reason,created_at,updated_at")
      .eq("user_id", session.user.id).order("created_at", { ascending: false })
      .order("id", { ascending: false }).range(offset, offset + pageSize - 1);
    if (error) return apiError("Không thể xuất dữ liệu.", 500);
    vocabulary.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  if (request.nextUrl.searchParams.get("format") !== "csv") {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await session.supabase.from("translations")
        .select("id,source_text,direction,translated_text,created_at")
        .eq("user_id", session.user.id).order("created_at", { ascending: false })
        .order("id", { ascending: false }).range(offset, offset + pageSize - 1);
      if (error) return apiError("Không thể xuất dữ liệu.", 500);
      translations.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }
  }

  const dailySets: { study_date: string; filters: unknown; requested_count: number; items: { vocabulary_item_id: string; studied: boolean }[] }[] = [];
  if (request.nextUrl.searchParams.get("format") !== "csv") {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await session.supabase.from("daily_word_sets")
        .select("id,study_date,filters,requested_count").eq("user_id", session.user.id)
        .order("study_date", { ascending: false }).range(offset, offset + pageSize - 1);
      if (error) return apiError("Không thể xuất bộ từ theo ngày. Hãy kiểm tra migration 002_learning.sql.", 500);
      for (const set of data ?? []) {
        const { data: positions, error: positionError } = await session.supabase.from("daily_word_set_items")
          .select("vocabulary_item_id,studied_at").eq("user_id", session.user.id).eq("set_id", set.id).order("position");
        if (positionError) return apiError("Không thể xuất tiến độ học.", 500);
        dailySets.push({ study_date: set.study_date, filters: set.filters, requested_count: set.requested_count,
          items: (positions ?? []).map((item) => ({ vocabulary_item_id: item.vocabulary_item_id, studied: !!item.studied_at })) });
      }
      if (!data || data.length < pageSize) break;
    }
  }

  const filename = `phrasebook-${new Date().toISOString().slice(0, 10)}`;
  if (request.nextUrl.searchParams.get("format") === "csv") {
    const csv = [vocabularyCsvColumns.join(","), ...vocabulary.map((row) => vocabularyCsvColumns.map((key) => csvEscape(row[key])).join(","))].join("\r\n");
    return new NextResponse("\uFEFF" + csv, { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
      "Cache-Control": "no-store"
    } });
  }

  const flashcards = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await session.supabase.from("flashcards")
      .select("vocabulary_item_id,status,source_daily_date")
      .eq("user_id", session.user.id).order("created_at", { ascending: false }).range(offset, offset + pageSize - 1);
    if (error) return apiError("Không thể xuất flashcard. Hãy kiểm tra migration 003_flashcards_tags.sql.", 500);
    flashcards.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return new NextResponse(JSON.stringify({ version: 3, exported_at: new Date().toISOString(), vocabulary, translations, daily_sets: dailySets, flashcards }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.json"`,
      "Cache-Control": "no-store"
    }
  });
}
