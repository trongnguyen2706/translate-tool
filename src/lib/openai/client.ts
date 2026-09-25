import OpenAI from "openai";

export function openaiClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY chưa được cấu hình.");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export function openaiModel() {
  return process.env.OPENAI_MODEL || "gpt-5-mini";
}
