import importlib.util
import json
import unittest
import uuid
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "build_dictionaries.py"
SPEC = importlib.util.spec_from_file_location("build_dictionaries", SCRIPT)
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class DictionaryBuildTests(unittest.TestCase):
    def test_preserves_irregular_base_links_and_bounded_grammar_tags(self):
        senses = builder.senses_for({"word": "went", "pos": "verb", "senses": [{
            "glosses": ["past tense of go"], "form_of": [{"word": "go"}, {"word": "go"}],
            "tags": ["form-of", "past"]
        }]}, "en")
        self.assertEqual(senses[0]["formOfTerms"], ["go"])
        self.assertEqual(senses[0]["formOf"], "go")
        self.assertEqual(senses[0]["formTags"], ["form-of", "past"])

    def test_builds_three_indexes_and_only_reverses_explicit_translations(self):
        fixtures = Path(__file__).parent / "fixtures"
        en_en = builder.build_en_en(fixtures / "dictionary-english.jsonl")
        en_vi, vi_en = builder.build_en_vi(fixtures / "dictionary-vietnamese.jsonl")
        self.assertEqual(en_en["bank"][0]["definitions"], ["financial institution"])
        self.assertEqual(en_en["bank"][0]["ipa"], "/bæŋk/")
        self.assertEqual(en_vi["bank"][0]["definitions"], ["ngân hàng", "bờ sông"])
        self.assertEqual(vi_en["ngân hàng"][0]["definitions"], ["bank"])
        self.assertNotIn("bờ sông", vi_en)
        self.assertEqual(vi_en["trở thành"][0]["sourceTerm"], "become")
        self.assertEqual(vi_en["trở thành"][0]["definitions"], ["become"])

    def test_gzip_pack_and_manifest_are_deterministic_and_checksummed(self):
        index = {"go": [{"id": "1", "definitions": ["đi"]}]}
        first = builder.pack_bytes(index)
        second = builder.pack_bytes(index)
        self.assertEqual(first, second)
        self.assertEqual(builder.hashlib.sha256(first).hexdigest(), builder.hashlib.sha256(second).hexdigest())
        lines = builder.gzip.decompress(first).decode("utf-8").splitlines()
        self.assertEqual(json.loads(lines[0]), {"term": "go", "senses": [{"id": "1", "definitions": ["đi"]}]})

    def test_normalization_preserves_vietnamese_and_acronyms(self):
        self.assertEqual(builder.key("  ĐI   HỌC "), "đi học")
        self.assertEqual(builder.key("US"), "US")
        self.assertNotEqual(builder.key("US"), builder.key("us"))

    def test_sqlite_staging_keeps_language_direction_and_translations_separate(self):
        fixtures = Path(__file__).parent / "fixtures"
        database = builder.build_staging_database(
            fixtures / "dictionary-english.jsonl", fixtures / "dictionary-vietnamese.jsonl", ":memory:"
        )
        try:
            self.assertEqual(database.execute("select count(*) from senses where direction='en-en'").fetchone()[0], 1)
            self.assertEqual(database.execute("select count(*) from senses where direction='en-vi'").fetchone()[0], 1)
            self.assertEqual(database.execute("select count(*) from senses where direction='vi-en'").fetchone()[0], 2)
            self.assertEqual(database.execute("select term from senses where direction='vi-en'").fetchone()[0], "ngân hàng")
        finally:
            database.close()

    def test_reads_official_compressed_jsonl_without_expanding_raw_dump(self):
        fixtures = Path(__file__).parent / "fixtures"
        scratch = Path(__file__).parents[1] / "artifacts"
        scratch.mkdir(exist_ok=True)
        compressed = scratch / f"dictionary-fixture-{uuid.uuid4()}.jsonl.gz"
        try:
            compressed.write_bytes(builder.gzip.compress((fixtures / "dictionary-english.jsonl").read_bytes()))
            self.assertEqual(builder.build_en_en(compressed)["bank"][0]["definitions"], ["financial institution"])
        finally:
            compressed.unlink(missing_ok=True)

    def test_full_sources_keep_translation_direction_and_resolve_explicit_inflections(self):
        fixtures = Path(__file__).parent / "fixtures"
        database = builder.build_staging_database(fixtures / "dictionary-english-full.jsonl", fixtures / "dictionary-vietnamese.jsonl", ":memory:", fixtures / "dictionary-vietnamese-english.jsonl")
        try:
            payload = database.execute("SELECT payload FROM senses WHERE direction='en-vi' AND term='restructured'").fetchone()[0]
            self.assertEqual(json.loads(payload)["definitions"], ["tái cơ cấu"])
            self.assertEqual(json.loads(payload)["glossLanguage"], "vi")
            self.assertEqual(json.loads(payload)["formOf"], "restructure")
            self.assertIsNone(database.execute("SELECT 1 FROM senses WHERE term='no-table-tags'").fetchone())
            bank = database.execute("SELECT payload FROM senses WHERE direction='vi-en' AND term='ngân hàng' AND sense_id LIKE 'enwiktionary-vi:%'").fetchone()[0]
            self.assertEqual(json.loads(bank)["sourceTerm"], "bank")
            concept = database.execute("SELECT payload FROM senses WHERE direction='vi-en' AND term='khái niệm'").fetchone()[0]
            self.assertNotIn("sourceTerm", json.loads(concept))
        finally:
            database.close()


if __name__ == "__main__":
    unittest.main()
