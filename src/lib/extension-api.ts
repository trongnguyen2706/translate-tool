import { NextResponse } from "next/server";

function allowedOrigin(origin: string) {
  const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  if (!match) return false;
  const configured = (process.env.CHROME_EXTENSION_IDS ?? process.env.CHROME_EXTENSION_ID ?? "")
    .split(",").map((id) => id.trim()).filter(Boolean);
  if (configured.length) return configured.includes(match[1]);
  return process.env.NODE_ENV !== "production";
}

export function extensionOptions(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  if (!allowedOrigin(origin)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export function extensionResponse(request: Request, body: unknown, status = 200) {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigin(origin)) return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...(origin ? corsHeaders(origin) : {}) }
  });
}

export function extensionCorsHeaders(origin: string) {
  return corsHeaders(origin);
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin"
  };
}
