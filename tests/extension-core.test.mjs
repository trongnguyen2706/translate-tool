import test from "node:test";
import assert from "node:assert/strict";
import { getMissingFields, lookupFromIndex, normalizeLookupTerm, normalizeMode, resolveWordForms } from "../extension/src/dictionary-core.mjs";

test("lookup keeps acronyms separate from lowercase words", () => {
  assert.equal(normalizeLookupTerm("US"), "US");
  assert.equal(normalizeLookupTerm("us"), "us");
  const result = lookupFromIndex({ US: [{ definitions: ["United States"] }], us: [{ definitions: ["pronoun"] }] }, "US");
  assert.equal(result.senses[0].definitions[0], "United States");
});

test("lookup normalizes Vietnamese accents and whitespace", () => {
  assert.equal(normalizeLookupTerm("  ĐI   HỌC "), "đi học");
  assert.equal(lookupFromIndex({ "đi học": [{ definitions: ["attend school"] }] }, "Đi học")?.senses[0].definitions[0], "attend school");
});

test("only known lookup modes are accepted", () => {
  assert.equal(normalizeMode("vi-en"), "vi-en");
  assert.equal(normalizeMode("other"), "en-vi");
});

test("hyphenated words share dictionary keys across typographic hyphens", () => {
  const index = { "eco-friendly": [{ definitions: ["environmentally friendly"] }] };
  for (const term of ["eco-friendly", "Eco‐friendly", "eco‑friendly"]) {
    assert.equal(normalizeLookupTerm(term), "eco-friendly");
    assert.equal(lookupFromIndex(index, term)?.term, "eco-friendly");
  }
  assert.equal(normalizeLookupTerm("mother-in-law"), "mother-in-law");
  assert.equal(normalizeLookupTerm("don’t"), "don't");
  assert.equal(normalizeLookupTerm("eco—friendly"), "eco—friendly");
  assert.equal(normalizeLookupTerm("eco–friendly"), "eco–friendly");
});

test("missing detail fields are reported without making an AI request", () => {
  assert.deepEqual(getMissingFields([{ definitions: ["a way to move"], ipa: "/gəʊ/" }]), ["examples", "synonyms"]);
  assert.deepEqual(getMissingFields([]), ["definition", "ipa", "examples", "synonyms"]);
});

test("inflected forms expose real meanings for the same part of speech, without borrowing pronunciation", async () => {
  const index = { excuse: [
    { id: "noun-one", partOfSpeech: "noun", definitions: ["a reason given to explain a mistake"], examples: ["That is a poor excuse."], ipa: "/base/", glossLanguage: "en" },
    { id: "verb-one", partOfSpeech: "verb", definitions: ["to forgive someone"], glossLanguage: "en" }
  ] };
  const forms = [
    { id: "plural", partOfSpeech: "noun", definitions: ["plural of excuse"], ipa: "/form/" },
    { id: "present", partOfSpeech: "verb", definitions: ["third-person singular simple present indicative of excuse"] }
  ];
  const result = await resolveWordForms("excuses", forms, (word) => index[word], "en-en", "v2");
  assert.equal(result.length, 2);
  assert.equal(result[0].definitions[0], index.excuse[0].definitions[0]);
  assert.equal(result[1].definitions[0], "to forgive someone");
  assert.equal(result[0].ipa, "/form/");
  assert.equal(result[1].ipa, undefined);
  assert.equal(result[0].formNote, "Plural of excuse");
  assert.equal(result[1].formNote, "Present form of excuse (he/she/it)");
  assert.equal(result[0].examplesFromBase, true);
  assert.notEqual(result[0].id, "noun-one");
  assert.notEqual(result[0].id, result[1].id);
  assert.equal(result[0].id, (await resolveWordForms("excuses", forms, (word) => index[word], "en-en", "v2"))[0].id);
});

test("explicit irregular forms resolve in the selected language and keep meaningful translations", async () => {
  const sense = { id: "went", partOfSpeech: "verb", definitions: ["past tense of go"], formOfTerms: ["go"], formTags: ["past", "form-of"] };
  const result = await resolveWordForms("went", [sense], () => [
    { id: "go-vi", partOfSpeech: "verb", definitions: ["đi; di chuyển"], glossLanguage: "vi" },
    { id: "go-en", partOfSpeech: "verb", definitions: ["to move"], glossLanguage: "en" }
  ], "en-vi", "v2");
  assert.equal(result[0].definitions[0], "đi; di chuyển");
  assert.equal(result[0].formNote, "Past tense of go");
  for (const note of ["động từ quá khứ của go.", "Quá khứ và phân từ quá khứ của go", "Động từ chia ở ngôi thứ ba số ít của go"]) {
    const vietnamese = await resolveWordForms("went",[{partOfSpeech:"verb",definitions:[note]}],() => [{partOfSpeech:"verb",definitions:["đi"],glossLanguage:"vi"}],"en-vi","v2");
    assert.equal(vietnamese[0].definitions[0],"đi");
    assert.equal(vietnamese[0].baseForm,"go");
  }
  const translated = { id: "go-vi", definitions: ["đã đi"], formOf: "go", partOfSpeech: "verb" };
  const native = await resolveWordForms("went", [translated], () => { throw new Error("No additional read needed"); }, "en-vi", "v2");
  assert.equal(native[0].definitions[0], "đã đi");
  assert.deepEqual(await resolveWordForms("went", native, () => [], "en-vi", "v3"), native, "a saved resolved sense retains its identity and original version");
  const reverse = { sourceTerm: "children", definitions: ["children"], formOf: "child" };
  assert.deepEqual(await resolveWordForms("trẻ em", [reverse], () => [], "vi-en", "v2"), [reverse]);
});

test("missing bases, cycles, chains and ambiguous bases are bounded and never guessed", async () => {
  const index = {
    children: [{ id: "children", partOfSpeech: "noun", definitions: ["plural of child"] }],
    child: [{ id: "child-1", partOfSpeech: "noun", definitions: ["a young person"] }, { id: "child-2", partOfSpeech: "noun", definitions: ["someone's son or daughter"] }],
    a: [{ partOfSpeech: "verb", definitions: ["past tense of b"] }],
    b: [{ partOfSpeech: "verb", definitions: ["past tense of a"] }]
  };
  const lookup = (word) => index[word];
  assert.equal((await resolveWordForms("children", index.children, lookup, "en-en", "v2")).length, 2);
  const loop = await resolveWordForms("a", index.a, lookup, "en-en", "v2");
  assert.equal(loop[0].formStatus, "unresolved");
  assert.deepEqual(loop[0].definitions, []);
  const chain = await resolveWordForms("childrens", [{ id: "chain", partOfSpeech: "noun", definitions: ["plural of children"] }], lookup, "en-en", "v2");
  assert.equal(chain[0].baseForm, "child");
  assert.equal(chain[0].definitions[0], "a young person");
  const ordinary = { definitions: ["a cup of tea"] };
  assert.deepEqual(await resolveWordForms("cup", [ordinary], () => { throw new Error("Must not guess"); }, "en-en", "v2"), [ordinary]);
  const wrongPos = await resolveWordForms("went", [{ partOfSpeech: "verb", definitions: ["past tense of go"] }], () => [{ partOfSpeech: "noun", definitions: ["a turn in a game"] }], "en-en", "v2");
  assert.equal(wrongPos[0].formStatus, "unresolved");
});
