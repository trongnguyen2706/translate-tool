import test from "node:test";
import assert from "node:assert/strict";
import { definitionInstructions, definitionLanguage, hasDefinitionLanguageMismatch } from "../src/lib/dictionary-language.mjs";

test("English-Vietnamese rejects the exact English paraphrase reported in the popup", () => {
  assert.equal(definitionLanguage("en-vi"), "vi");
  assert.equal(hasDefinitionLanguageMismatch(["organized or arranged again in a different way, often to improve it"], "en-vi"), true);
  assert.equal(hasDefinitionLanguageMismatch(["được tái cơ cấu; được tổ chức lại"], "en-vi"), false);
  assert.match(definitionInstructions("en-vi"), /MUST be written in Vietnamese/);
});

test("English definitions stay English for both English-English and Vietnamese-English", () => {
  for (const mode of ["en-en", "vi-en"]) {
    assert.equal(definitionLanguage(mode), "en");
    assert.equal(hasDefinitionLanguageMismatch(["organized or arranged again in a different way"], mode), false);
    assert.equal(hasDefinitionLanguageMismatch(["là một tổ chức của người lao động"], mode), true);
  }
});

test("short loanwords, names and empty unrequested fields are not rejected", () => {
  assert.equal(hasDefinitionLanguageMismatch(["marketing", "to chuc lai"], "en-vi"), false);
  assert.equal(hasDefinitionLanguageMismatch(["A Vietnamese term for ngân hàng, a bank."], "en-en"), false);
  assert.equal(hasDefinitionLanguageMismatch([], "en-vi"), false);
});
