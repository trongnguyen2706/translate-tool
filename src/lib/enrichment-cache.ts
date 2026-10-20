import { createHash } from "node:crypto";
import type { requireApiSession } from "@/lib/api";

type Session = NonNullable<Awaited<ReturnType<typeof requireApiSession>>>;
export class EnrichmentError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
export async function cachedEnrichment<T>(session: Session, input: { mode: string; fields: readonly string[]; [key: string]: unknown }, generate: (id: string, started: () => void) => Promise<T>) {
  const key = createHash("sha256").update(JSON.stringify({ version: 1, ...input, fields: [...input.fields].sort() })).digest("hex");
  const { data, error } = await session.supabase.rpc("claim_enrichment", { p_key: key, p_mode: input.mode, p_fields: input.fields, p_term: input.term ?? "" });
  if (error) throw new EnrichmentError("Could not open AI request. Apply migration 006_enrichment_cache.sql.", 503);
  if (!data.claimed) {
    if (data.state === "complete") return { ...data.result as T, cacheHit: true };
    throw new EnrichmentError(data.state === "uncertain"
      ? "This AI request has an unknown outcome. Open AI request history in Downloads and sync or your library to allow another attempt."
      : "This AI request is still running. Wait and click again to retrieve its result.", 409);
  }
  let sent = false;
  try {
    const result = await generate(data.id, () => { sent = true; });
    const saved = await session.supabase.rpc("finish_enrichment", { p_id: data.id, p_state: "complete", p_result: result });
    if (saved.error || saved.data !== true) throw new EnrichmentError("AI finished, but its result could not be recorded. Do not immediately send the request again.", 503);
    return { ...result, cacheHit: false };
  } catch (error) {
    await session.supabase.rpc("finish_enrichment", { p_id: data.id, p_state: sent ? "uncertain" : "failed", p_result: null });
    throw error;
  }
}
