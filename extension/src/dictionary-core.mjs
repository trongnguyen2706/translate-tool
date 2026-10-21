export function normalizeLookupTerm(value) {
  const term = String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ").replace(/[’]/g, "'").replace(/[\u2010\u2011]/g, "-");
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
  const learnerCount = senses.filter((sense) => sense.learner && isEverydaySense(sense)).length;
  const everydayCount = senses.filter(isEverydaySense).length;
  return { term, senses: senses.map((sense) => ({ ...sense })), basicSenseCount: Math.min(3, learnerCount || everydayCount || senses.length) };
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

// Legacy packs contain these explicit dictionary notes but not form_of data.
// Extract only recognized grammar descriptions, never a guessed English stem.
const FORM_NOTE = /^((?:(?:plural|singular|past|present|future|simple|perfect|active|passive|tense|participle|gerund|infinitive|indicative|subjunctive|imperative|first-person|second-person|third-person|third|person|comparative|superlative|degree|form|inflection|and)\s+)+)of\s+([\p{L}\p{N}_][\p{L}\p{N}_'’ -]{0,119})\.?$/iu;
const VI_FORM_PATTERNS = [
  ["(?:dạng |hình thức )?số nhiều", "plural"],
  ["(?:động từ )?quá khứ và phân từ quá khứ", "simple past and past participle"],
  ["(?:dạng |động từ )?quá khứ", "past tense"],
  ["(?:dạng )?phân từ quá khứ", "past participle"],
  ["(?:dạng )?(?:phân từ hiện tại|hiện tại phân từ|danh động từ)", "present participle"],
  ["động từ (?:chia ở )?ngôi thứ ba số ít", "third-person present"]
].map(([pattern, grammar]) => [new RegExp(`^${pattern} của ([\\p{L}\\p{N}_][\\p{L}\\p{N}_'’ -]{0,119})\\.?$`, "iu"), grammar]);

function explicitFormNote(text) {
  const english = FORM_NOTE.exec(text.trim());
  if (english) return english;
  for (const [pattern, grammar] of VI_FORM_PATTERNS) {
    const match = pattern.exec(text.trim());
    if (match) return [match[0], grammar, match[1]];
  }
  return null;
}
const posKey = (value) => ({ adjective: "adj", adverb: "adv", pronoun: "pron", participle: "verb" }[value] ?? value ?? "");

function relationFor(sense) {
  const notes = (sense.definitions ?? []).map(explicitFormNote);
  const onlyNote = sense.formTags?.includes("form-of") || notes.length === 0 || notes.every(Boolean);
  const explicit = sense.formOfTerms?.length ? sense.formOfTerms : sense.formOf ? [sense.formOf] : [];
  const terms = [...new Set((explicit.length ? explicit : onlyNote ? notes.map((note) => note[2]) : [])
    .filter((term) => typeof term === "string" && term.trim().length <= 120).map(normalizeLookupTerm))].slice(0, 4);
  return { terms, onlyNote, grammar: notes.find(Boolean)?.[1]?.trim() ?? "", tags: sense.formTags ?? [] };
}

function formLabel(relation, base) {
  const grammar = [...relation.tags, relation.grammar].join(" ");
  if (/past and past participle/.test(relation.grammar)) return `Past tense / past participle of ${base}`;
  if (/plural/.test(grammar)) return `Plural of ${base}`;
  if (/past/.test(grammar) && /participle/.test(grammar)) return `Past participle of ${base}`;
  if (/past/.test(grammar)) return `Past tense of ${base}`;
  if (/present/.test(grammar) && /participle|gerund/.test(grammar)) return `-ing form of ${base}`;
  if (/third-person|third person/.test(grammar)) return `Present form of ${base} (he/she/it)`;
  if (/superlative/.test(grammar)) return `Superlative of ${base} (highest degree)`;
  if (/comparative/.test(grammar)) return `Comparative of ${base} (used to compare)`;
  return `Form of ${base}`;
}

export function describeWordForm(sense) {
  const relation = relationFor(sense);
  return relation.terms.length === 1 ? { baseForm: relation.terms[0], formNote: formLabel(relation, relation.terms[0]) } : null;
}

const SPECIAL_USAGE = /\b(?:archaic|obsolete|rare|dated|nonstandard|slang|informal|technical|chemistry|mathematics|logic|linguistics|phonetics|nuclear|finance|genetics|physics|computing)\b/i;
const TECHNICAL_PROSE = /\b(?:uncool|proposition|entails|anions|cations|inflection|lenis|fundamental forces|proto-indo-european)\b/i;
export function isEverydaySense(sense) {
  return sense.formStatus !== "unresolved" && !SPECIAL_USAGE.test((sense.usageLabels ?? []).join(" "))
    && !TECHNICAL_PROSE.test(sense.definitions?.[0] ?? "");
}

/** Prefer the learner edition and upstream order, never lexicographic sense IDs. */
export function rankDictionarySenses(senses) {
  const score = (sense) => (sense.formStatus === "unresolved" ? 1000 : 0)
    + (isEverydaySense(sense) ? 0 : 100) + (sense.learner ? -50 : 0)
    + (Number.isFinite(sense.senseRank) ? Math.min(sense.senseRank, 60) / 10
      : /\b(?:strength|strong|power|ability)\b/i.test(sense.definitions?.[0] ?? "") ? -2 : 1);
  const sorted = [...senses].sort((a, b) => score(a) - score(b));
  const seen = new Set();
  return sorted.filter((sense) => {
    const key = JSON.stringify([sense.partOfSpeech, sense.baseForm ?? "", (sense.definitions?.[0] ?? "").trim().toLowerCase().replace(/[.;]+$/, "")]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

async function formIdentity(term, sense, baseSense) {
  // Identity references are unique across the account, so an inflected form
  // must never reuse its base word's reference and silently merge their cards.
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([
    term, sense.id ?? sense.definitions, baseSense.id ?? baseSense.definitions, sense.partOfSpeech
  ])));
  return `form:${[...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Resolve explicit forms using only indexed reads from the active local pack. */
export async function resolveWordForms(term, senses, readSenses, mode, dataVersion) {
  const language = mode === "en-vi" ? "vi" : "en";
  const reads = new Map();
  let expansions = 0;
  const read = (base) => {
    if (!reads.has(base)) reads.set(base, reads.size < 32 ? Promise.resolve(readSenses(base)) : Promise.resolve([]));
    return reads.get(base);
  };
  async function resolve(word, sense, seen, depth) {
    if (sense.formStatus === "resolved") return [sense];
    const relation = relationFor(sense);
    if (!relation.terms.length) return [sense];
    // English translations in vi-en are headwords, not dictionary definitions
    // to replace with longer English text (which would change flashcard fronts).
    if (mode === "vi-en") return [sense];
    if (!relation.onlyNote) return [{ ...sense, baseForm: relation.terms[0], baseSenseId: sense.id, formNote: formLabel(relation, relation.terms[0]),
      formStatus: "resolved", dataVersion, id: await formIdentity(word, sense, sense) }];
    const resolved = [];
    if (depth < 3) for (const base of relation.terms) {
      if (seen.has(base)) continue;
      const candidates = (await read(base) ?? []).filter((candidate) =>
        posKey(candidate.partOfSpeech) === posKey(sense.partOfSpeech)
        && (!candidate.glossLanguage || candidate.glossLanguage === language)
        // Fixed expressions such as "excuse me" do not explain "she excuses".
        && !/^You say[, ]/i.test(candidate.definitions?.[0] ?? ""));
      for (const candidate of candidates.slice(0, 60)) {
        if (expansions++ >= 256) break;
        const leaves = await resolve(base, candidate, new Set([...seen, base]), depth + 1);
        for (const leaf of leaves) {
          if (leaf.formStatus === "unresolved" || !leaf.definitions?.length || leaf.formStatus !== "resolved" && relationFor(leaf).onlyNote && relationFor(leaf).terms.length) continue;
          resolved.push({ ...sense, definitions: leaf.definitions, examples: sense.examples?.length ? sense.examples : leaf.examples ?? [],
            learner: Boolean(leaf.learner), senseRank: leaf.senseRank,
            usageLabels: [...new Set([...(sense.usageLabels ?? []), ...(leaf.usageLabels ?? [])])],
            // Pronunciation belongs to the selected form, never to the base.
            synonyms: sense.synonyms?.length ? sense.synonyms : leaf.synonyms ?? [],
            antonyms: sense.antonyms?.length ? sense.antonyms : leaf.antonyms ?? [],
            collocations: sense.collocations?.length ? sense.collocations : leaf.collocations ?? [],
            id: await formIdentity(word, sense, leaf), baseForm: leaf.baseForm ?? base, baseSenseId: leaf.baseSenseId ?? leaf.id,
            formNote: formLabel(relation, base), formDefinitions: sense.definitions ?? [], formStatus: "resolved", dataVersion,
            examplesFromBase: !sense.examples?.length && Boolean(leaf.examples?.length) });
          if (resolved.length >= 60) break;
        }
        if (resolved.length >= 60) break;
      }
    }
    return resolved.length ? resolved : [{ ...sense, baseForm: relation.terms[0], formNote: formLabel(relation, relation.terms[0]),
      formDefinitions: sense.definitions ?? [], definitions: [], formStatus: "unresolved" }];
  }
  const output = [], identities = new Set();
  for (const sense of senses) {
    for (const value of await resolve(term, sense, new Set([normalizeLookupTerm(term)]), 0)) {
      const identity = JSON.stringify([value.id, value.definitions]);
      if (!identities.has(identity)) { output.push(value); identities.add(identity); }
    }
    if (output.length >= 200) break;
  }
  return rankDictionarySenses(output).slice(0, 200);
}
