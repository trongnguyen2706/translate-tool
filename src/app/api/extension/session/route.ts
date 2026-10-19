import { getAllowedBearerSession } from "@/lib/auth";
import { extensionOptions, extensionResponse } from "@/lib/extension-api";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) { return extensionOptions(request); }

export async function GET(request: Request) {
  const session = await getAllowedBearerSession(request);
  if (!session) return extensionResponse(request, { error: "Authentication required" }, 401);
  return extensionResponse(request, { userId: session.user.id, email: session.user.email });
}
