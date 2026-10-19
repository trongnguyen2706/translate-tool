export function normalizeLookupTerm(value) {
  const term = String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ").replace(/[’]/g, "'");
  const isAcronym = /^[A-Z]{2,4}$/.test(term);
  return isAcronym ? term : term.toLocaleLowerCase("vi");
}

export function normalizeMode(value) {
  return ["en-en", "en-vi", "vi-en"].includes(value) ? value : "en-vi";
}

export function lookupFromIndex(index, input) {
  const term = normalizeLookupTerm(input);
  const senses = index?.[term];
  if (!Array.isArray(senses) || !senses.length) return null;
  return { term, senses: senses.map((sense) => ({ ...sense })) };
}

export function getMissingFields(senses) {
  const first = senses?.[0];
  if (!first) return ["definition", "ipa", "examples", "synonyms"];
  const missing = [];
  if (!first.definitions?.length) missing.push("definition");
  if (!first.ipa) missing.push("ipa");
  if (!first.examples?.length) missing.push("examples");
  if (!first.synonyms?.length) missing.push("synonyms");
  return missing;
}
