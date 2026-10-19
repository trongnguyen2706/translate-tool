import { z } from "zod";
import { getAllowedBearerSession } from "@/lib/auth";
import { extensionOptions, extensionResponse } from "@/lib/extension-api";
import { normalizeText } from "@/lib/normalize";

export const dynamic = "force-dynamic";
const schema = z.object({ term: z.string().trim().min(1).max(120), mode: z.enum(["en-en", "en-vi", "vi-en"]) });

export function OPTIONS(request: Request) { return extensionOptions(request); }

export async function POST(request: Request) {
  const session = await getAllowedBearerSession(request);
  if (!session) return extensionResponse(request, { error: "Authentication required" }, 401);
  let raw: unknown;
  try { raw = await request.json(); } catch { return extensionResponse(request, { error: "Invalid JSON" }, 400); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return extensionResponse(request, { error: "Invalid lookup status request" }, 400);
  const normalizedTerm = normalizeText(parsed.data.term);
  const { data: items, error } = await session.supabase.from("vocabulary_items")
    .select("id,term,meaning_en,meaning_vi,normalized_meaning,created_at")
    .eq("user_id", session.user.id).eq("source_language", "en")
    .eq("normalized_term", normalizedTerm).order("created_at", { ascending: true }).limit(30);
  if (error) return extensionResponse(request, { error: "Could not read saved words" }, 500);
  if (!items?.length) return extensionResponse(request, { state: "not_saved", items: [] });
  const ids = items.map((item) => item.id);
  const [{ data: cards, error: cardError }, { data: refs, error: refError }] = await Promise.all([
    session.supabase.from("flashcards").select("vocabulary_item_id,status").eq("user_id", session.user.id).in("vocabulary_item_id", ids),
    session.supabase.from("vocabulary_identity_refs").select("vocabulary_item_id,provider,source_reference,dataset_version").eq("user_id", session.user.id).in("vocabulary_item_id", ids)
  ]);
  if (cardError) return extensionResponse(request, { error: "Could not read flashcards" }, 500);
  if (refError) return extensionResponse(request, { error: "Could not read saved dictionary references" }, 500);
  const statusById = new Map((cards ?? []).map((card) => [card.vocabulary_item_id, card.status]));
  const refsById = new Map<string, typeof refs>();
  for (const ref of refs ?? []) refsById.set(ref.vocabulary_item_id, [...(refsById.get(ref.vocabulary_item_id) ?? []), ref]);
  return extensionResponse(request, { state: "saved", items: items.map((item) => ({
    ...item, flashcard_status: statusById.get(item.id) ?? null, identity_refs: refsById.get(item.id) ?? []
  })) });
}
