import test from "node:test";
import assert from "node:assert/strict";
import { getMissingFields, lookupFromIndex, normalizeLookupTerm, normalizeMode } from "../extension/src/dictionary-core.mjs";

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

test("missing detail fields are reported without making an AI request", () => {
  assert.deepEqual(getMissingFields([{ definitions: ["a way to move"], ipa: "/gəʊ/" }]), ["examples", "synonyms"]);
  assert.deepEqual(getMissingFields([]), ["definition", "ipa", "examples", "synonyms"]);
});
