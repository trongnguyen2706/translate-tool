type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
} | null | undefined;

// USD per 1M standard text tokens: https://developers.openai.com/api/docs/pricing
// Update this map when OpenAI changes model pricing.
const rates: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-5-mini-2025-08-07": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 }
};

export function summarizeCost(model: string, usage: TokenUsage) {
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const cachedInputTokens = Math.min(inputTokens, usage?.input_tokens_details?.cached_tokens ?? 0);
  const rate = rates[model];
  const estimatedCostUsd = rate && usage
    ? ((inputTokens - cachedInputTokens) * rate.input + cachedInputTokens * rate.cachedInput + outputTokens * rate.output) / 1_000_000
    : null;
  return { inputTokens, outputTokens, estimatedCostUsd, model };
}
