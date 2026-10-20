import { getAllowedBearerSession } from "@/lib/auth";
import { extensionOptions, extensionResponse } from "@/lib/extension-api";
import { enrichmentHistory, resetEnrichment } from "@/lib/enrichment-history";
export function OPTIONS(request: Request) { return extensionOptions(request); }
export async function GET(request: Request) {
  const session = await getAllowedBearerSession(request);
  if (!session) return extensionResponse(request, { error: "Authentication required" }, 401);
  const result = await enrichmentHistory(session);
  return extensionResponse(request, result, "error" in result ? 500 : 200);
}
export async function POST(request: Request) {
  const session = await getAllowedBearerSession(request);
  if (!session) return extensionResponse(request, { error: "Authentication required" }, 401);
  let body; try { body = await request.json(); } catch { return extensionResponse(request, { error: "Invalid JSON" }, 400); }
  const result = await resetEnrichment(session, body);
  return extensionResponse(request, result, "error" in result ? 409 : 200);
}
