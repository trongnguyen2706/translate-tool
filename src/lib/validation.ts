import { z } from "zod";
import { cefrLevels, ieltsSkills, topicKeys } from "@/lib/learning";

export const directionSchema = z.enum(["en-vi", "vi-en", "en-en"]);
export type Direction = z.infer<typeof directionSchema>;

export const translateSchema = z.object({
  text: z.string().trim().min(1).max(12000),
  direction: directionSchema
});

export const cefrSchema = z.enum(cefrLevels);
export const ieltsSkillSchema = z.enum(ieltsSkills);
export const topicSchema = z.enum(topicKeys);
export const learningMetadataSchema = z.object({
  cefr_level: cefrSchema.nullable(),
  ielts_relevance: z.enum(["high", "medium", "low"]).nullable(),
  ielts_skills: z.array(ieltsSkillSchema).max(4),
  topics: z.array(topicSchema).max(4),
  learning_reason: z.string().trim().max(300)
});

const vocabularyCoreSchema = z.object({
  term: z.string().trim().min(1).max(120),
  kind: z.enum(["word", "phrase"]),
  meaning_vi: z.string().trim().max(500),
  meaning_en: z.string().trim().max(500),
  example: z.string().trim().max(800),
  collocations: z.array(z.string().trim().max(120)).max(6)
});
export const suggestionSchema = vocabularyCoreSchema.extend(learningMetadataSchema.shape);
export type Suggestion = z.infer<typeof suggestionSchema>;

export const studyOptionsSchema = z.object({
  mode: z.enum(["general", "ielts-academic", "ielts-general"]).default("general"),
  currentLevel: cefrSchema.default("B1"),
  skill: z.union([ieltsSkillSchema, z.literal("all")]).default("all"),
  topic: z.union([topicSchema, z.literal("all")]).default("all"),
  count: z.union([z.literal(5), z.literal(8), z.literal(10)]).default(8)
});
export type StudyOptions = z.infer<typeof studyOptionsSchema>;

export const suggestionsRequestSchema = z.discriminatedUnion("source", [
  translateSchema.extend({
    source: z.literal("translation"),
    translation: z.string().trim().max(12000),
    focusTerm: z.string().trim().max(120).optional(),
    options: studyOptionsSchema.optional()
  }),
  translateSchema.extend({
    source: z.literal("study"),
    options: studyOptionsSchema,
    focusTerm: z.string().trim().max(120).optional()
  })
]);

export const vocabularySchema = vocabularyCoreSchema.extend({
  source_text: z.string().trim().max(12000).default(""),
  source_language: z.enum(["en", "vi"]),
  note: z.string().trim().max(1000).default(""),
  cefr_level: cefrSchema.nullable().default(null),
  ielts_relevance: z.enum(["high", "medium", "low"]).nullable().default(null),
  ielts_skills: z.array(ieltsSkillSchema).max(4).default([]),
  topics: z.array(topicSchema).max(4).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(16).default([]),
  learning_reason: z.string().trim().max(300).default("")
});

export const flashcardStatusSchema = z.enum(["not_yet", "roughly", "learned", "mastered"]);
export type FlashcardStatus = z.infer<typeof flashcardStatusSchema>;

export const vocabularyUpdateSchema = vocabularySchema.partial();

export const dailyFiltersSchema = z.object({
  createdMode: z.enum(["all", "date", "weekday"]).default("all"),
  createdDate: z.iso.date().optional(),
  createdWeekday: z.number().int().min(0).max(6).optional(),
  levelMode: z.enum(["all", "range", "unclassified"]).default("all"),
  levelMin: cefrSchema.optional(),
  levelMax: cefrSchema.optional(),
  ieltsMode: z.enum(["all", "high", "high-medium", "low", "unclassified"]).default("all"),
  skill: z.union([ieltsSkillSchema, z.literal("all")]).default("all"),
  topic: z.union([topicSchema, z.literal("all")]).default("all"),
  tag: z.string().trim().max(40).default(""),
  kind: z.enum(["all", "word", "phrase"]).default("all")
});
export type DailyFilters = z.infer<typeof dailyFiltersSchema>;
