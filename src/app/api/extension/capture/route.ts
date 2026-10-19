import { createHash } from "node:crypto";
import { z } from "zod";
import { getAllowedBearerSession } from "@/lib/auth";
import { extensionOptions, extensionResponse } from "@/lib/extension-api";

export const dynamic = "force-dynamic";

const senseSchema = z.object({
  id: z.string().max(200).optional(),
  dataVersion: z.string().max(80).optional(),
  sourceTerm: z.string().trim().max(120).optional(),
  partOfSpeech: z.string().trim().max(40).optional(),
  ipa: z.string().trim().max(100).optional(),
  definitions: z.array(z.string().trim().max(500)).max(6).optional(),
  examples: z.array(z.string().trim().max(500)).max(3).optional(),
  collocations: z.array(z.string().trim().max(120)).max(6).optional(),
  synonyms: z.array(z.string().trim().max(120)).max(12).optional(),
  antonyms: z.array(z.string().trim().max(120)).max(12).optional(),
  aiFields: z.array(z.enum(["definitions", "ipa", "examples", "synonyms", "antonyms", "collocations"])).max(6).optional()
}).optional().nullable();

const schema = z.object({
  operationId: z.uuid(), term: z.string().trim().min(1).max(120), queryTerm: z.string().trim().min(1).max(120),
  phrase: z.boolean(), mode: z.enum(["en-en", "en-vi", "vi-en"]), selectedSense: senseSchema,
  context: z.string().max(2000).default(""), pageUrl: z.url().max(2048), pageTitle: z.string().max(300).default(""),
  videoTime: z.number().finite().min(0).nullable().default(null)
});

export function OPTIONS(request: Request) { return extensionOptions(request); }

export async function POST(request: Request) {
  const session = await getAllowedBearerSession(request);
  if (!session) return extensionResponse(request, { error: "Authentication required" }, 401);
  let raw: unknown;
  try { raw = await request.json(); } catch { return extensionResponse(request, { error: "Invalid JSON" }, 400); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return extensionResponse(request, { error: "Invalid capture payload" }, 400);
  const capture = parsed.data;
  const sense = capture.selectedSense;
  const definition = sense?.definitions?.[0] ?? "";
  const item = {
    term: capture.term,
    kind: capture.phrase ? "phrase" : "word",
    source_language: "en",
    meaning_en: capture.mode === "en-en" || capture.mode === "vi-en" ? definition : "",
    meaning_vi: capture.mode === "en-vi" ? definition : capture.mode === "vi-en" ? capture.queryTerm : "",
    example: capture.mode !== "vi-en" ? sense?.examples?.[0] ?? "" : "",
    collocations: capture.mode !== "vi-en" ? sense?.collocations ?? [] : [],
    details: sense ? {
      partOfSpeech: sense.partOfSpeech ?? null, ipa: sense.ipa ?? null,
      definitionLanguage: capture.mode === "en-vi" ? "vi" : "en",
      definitionsByLanguage: { [capture.mode === "en-vi" ? "vi" : "en"]: sense.definitions ?? [] },
      definitions: sense.definitions ?? [], examples: sense.examples ?? [],
      synonyms: sense.synonyms ?? [], antonyms: sense.antonyms ?? [], collocations: sense.collocations ?? []
    } : {},
    ai_fields: sense?.aiFields ?? [],
    identity_provider: sense?.id ? capture.mode === "en-en" ? "kaikki-en" : "kaikki-vi" : "",
    identity_reference: sense?.id ?? "",
    identity_version: sense?.dataVersion ?? ""
  };
  const url = new URL(capture.pageUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") return extensionResponse(request, { error: "Invalid source URL" }, 400);
  const occurrence = {
    selected_text: capture.queryTerm,
    context_text: capture.context,
    source_url: url.href,
    source_title: capture.pageTitle,
    source_kind: url.hostname === "www.youtube.com" ? "youtube" : "web",
    direction: capture.mode,
    video_time: capture.videoTime === null ? null : Math.round(capture.videoTime * 1000) / 1000
  };
  const payloadHash = createHash("sha256").update(JSON.stringify({ item, occurrence })).digest("hex");
  const { data, error } = await session.supabase.rpc("capture_extension_word", {
    p_operation_id: capture.operationId,
    p_payload_hash: payloadHash,
    p_item: item,
    p_occurrence: occurrence
  });
  if (error) {
    const status = error.code === "23505" ? 409 : error.code === "42501" ? 403 : 500;
    return extensionResponse(request, { error: status === 409 ? "Operation ID conflict" : status === 403 ? "Not allowed" : "Could not save capture" }, status);
  }
  return extensionResponse(request, data);
}
