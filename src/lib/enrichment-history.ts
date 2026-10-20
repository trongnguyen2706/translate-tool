import { z } from "zod";
import type { requireApiSession } from "@/lib/api";
type Session = NonNullable<Awaited<ReturnType<typeof requireApiSession>>>;
export async function enrichmentHistory(session: Session) {
  const { data, error } = await session.supabase.from("enrichment_requests")
    .select("id,term,mode,requested_fields,state,created_at,updated_at").eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(50);
  return error ? { error: "Could not load AI requests. Check migration 006." } : { items: data };
}
export async function resetEnrichment(session: Session, body: unknown) {
  const parsed = z.object({ id: z.uuid(), allowAnotherAttempt: z.literal(true) }).safeParse(body);
  if (!parsed.success) return { error: "Confirm another AI attempt first." };
  const { data, error } = await session.supabase.rpc("reset_uncertain_enrichment", { p_id: parsed.data.id });
  return error || !data ? { error: "This request is not eligible for another attempt yet." } : { reset: true };
}
