export function hasSupabaseConfig() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function hasOpenAIConfig() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function dailyLimit(kind: "translation" | "suggestion") {
  const value = Number(process.env[kind === "translation" ? "DAILY_TRANSLATION_LIMIT" : "DAILY_SUGGESTION_LIMIT"]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : kind === "translation" ? 60 : 30;
}
