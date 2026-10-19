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


if __name__ == "__main__":
    unittest.main()
