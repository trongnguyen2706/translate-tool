/** @typedef {"en-en" | "en-vi" | "vi-en"} DictionaryMode */

/** @param {DictionaryMode} mode */
export function definitionLanguage(mode) {
  return mode === "en-vi" ? "vi" : "en";
}

/** @param {DictionaryMode} mode */
export function definitionInstructions(mode) {
  const language = definitionLanguage(mode);
  return language === "vi"
    ? 'Every non-empty definitions item MUST be written in Vietnamese (tiếng Việt), with Vietnamese spelling and accents. Translate or explain the English term in Vietnamese. NEVER return an English paraphrase as a definition. Example: for "restructured", write "được tái cơ cấu; được tổ chức lại", NOT "organized or arranged again in a different way". Set definitionLanguage to "vi". Examples, synonyms, antonyms and collocations remain English; IPA is phonetic notation.'
    : 'Every non-empty definitions item MUST be written in English. Explain the meaning in English, not Vietnamese. Set definitionLanguage to "en". Examples, synonyms, antonyms and collocations are English; IPA is phonetic notation.';
}

// Reject obvious wrong-language prose; short loanwords and names are left alone.
/** @param {string[]} definitions @param {DictionaryMode} mode */
export function hasDefinitionLanguageMismatch(definitions, mode) {
  const englishMarkers = new Set(["a", "an", "the", "is", "are", "was", "were", "or", "and", "of", "to", "in", "with", "that", "which", "something", "someone", "again"]);
  const vietnameseMarkers = new Set(["là", "được", "của", "một", "những", "các", "trong", "với", "hoặc", "người", "việc", "sự"]);
  return definitions.some((definition) => {
    const text = definition.toLocaleLowerCase("vi").normalize("NFC");
    const words = text.match(/[\p{L}]+/gu) ?? [];
    const accented = /[ăâđêôơưàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ]/u.test(text) || /[\u0300-\u036f]/u.test(text.normalize("NFD"));
    if (definitionLanguage(mode) === "vi") {
      return !accented && words.length >= 3 && new Set(words.filter((word) => englishMarkers.has(word))).size >= 2;
    }
    const vietnameseCount = words.filter((word) => vietnameseMarkers.has(word)).length;
    const englishCount = words.filter((word) => englishMarkers.has(word)).length;
    return accented && vietnameseCount >= 2 && vietnameseCount > englishCount;
  });
}
