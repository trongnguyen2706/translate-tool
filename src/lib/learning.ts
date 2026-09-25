export const cefrLevels = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export const ieltsSkills = ["speaking", "writing", "reading", "listening"] as const;
export const topicKeys = [
  "health", "work", "education", "environment", "technology", "society",
  "travel", "business", "science", "culture", "daily-life", "other"
] as const;

export type CefrLevel = typeof cefrLevels[number];
export type IeltsSkill = typeof ieltsSkills[number];
export type TopicKey = typeof topicKeys[number];

export const topicLabels: Record<TopicKey, string> = {
  health: "Sức khỏe", work: "Công việc", education: "Giáo dục",
  environment: "Môi trường", technology: "Công nghệ", society: "Xã hội",
  travel: "Du lịch", business: "Kinh doanh", science: "Khoa học",
  culture: "Văn hóa", "daily-life": "Đời sống", other: "Khác"
};

export const topicLabelsEn: Record<TopicKey, string> = {
  health: "Health", work: "Work", education: "Education",
  environment: "Environment", technology: "Technology", society: "Society",
  travel: "Travel", business: "Business", science: "Science",
  culture: "Culture", "daily-life": "Daily life", other: "Other"
};

export const skillLabels: Record<IeltsSkill, string> = {
  speaking: "Speaking", writing: "Writing", reading: "Reading", listening: "Listening"
};

export const relevanceLabels = {
  high: "Ưu tiên IELTS", medium: "Có ích cho IELTS", low: "Ít ưu tiên IELTS"
} as const;

export const relevanceLabelsEn: Record<keyof typeof relevanceLabels, string> = {
  high: "IELTS priority", medium: "Useful for IELTS", low: "Lower IELTS priority"
};

export const flashcardStatusLabels = {
  not_yet: "Chưa thuộc", roughly: "Sơ sơ", learned: "Thuộc rồi", mastered: "Nằm lòng"
} as const;

export const flashcardStatusLabelsEn: Record<keyof typeof flashcardStatusLabels, string> = {
  not_yet: "Not yet", roughly: "Roughly", learned: "Learned", mastered: "Mastered"
};

export function vietnamDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(value);
}

export function vietnamWeekday(value: Date) {
  const date = vietnamDate(value);
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
