export const vocabularyCsvColumns = [
  "term", "kind", "source_language", "meaning_vi", "meaning_en",
  "example", "collocations", "source_text", "note", "cefr_level",
  "ielts_relevance", "ielts_skills", "topics", "tags", "learning_reason", "created_at"
] as const;

export function csvEscape(value: unknown) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function parseCsv(input: string) {
  const source = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;

  function finishField() {
    row.push(field);
    field = "";
    afterQuote = false;
  }

  function finishRow() {
    finishField();
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    row = [];
  }

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        inQuotes = false;
        afterQuote = true;
      } else {
        field += char;
      }
      continue;
    }

    if (afterQuote && char !== "," && char !== "\r" && char !== "\n") {
      if (char === " " || char === "\t") continue;
      throw new Error(`CSV có ký tự không hợp lệ sau dấu ngoặc kép ở dòng ${rows.length + 1}.`);
    }
    if (char === '"') {
      if (field) throw new Error(`CSV có dấu ngoặc kép không hợp lệ ở dòng ${rows.length + 1}.`);
      inQuotes = true;
    } else if (char === ",") {
      finishField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      finishRow();
    } else {
      field += char;
    }
  }

  if (inQuotes) throw new Error("CSV có ô chưa đóng dấu ngoặc kép.");
  if (row.length > 0 || field !== "" || afterQuote) finishRow();
  return rows;
}
