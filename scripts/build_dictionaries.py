#!/usr/bin/env python3
"""Build small, versioned Phrasebook packs from Kaikki JSONL extracts.

The upstream dumps are supplied by the operator and never checked into Git.
Definitions retain their language direction. Vietnamese -> English uses
explicit translation pairs and optional Vietnamese entries with English glosses;
English flashcard headwords are attached only when verified in the English index.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import sqlite3
import sys
import itertools
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = 1
DATA_VERSION = "2026.10.21.1-forms"
MAX_TERM_LENGTH = 100
MAX_DEFINITION_LENGTH = 500
WORD_RE = re.compile(r"^[\w][\w'’ -]*$", re.UNICODE)


def clean(value: str) -> str:
    return " ".join(value.replace("\u00a0", " ").split()).strip()


def key(value: str) -> str:
    normalized = clean(value).replace("’", "'")
    # Keep intentional acronyms (US) separate from ordinary lowercase words
    # (us), while allowing normal sentence/title casing to resolve together.
    is_short_acronym = normalized.isupper() and len(normalized) in range(2, 5) and " " not in normalized
    return normalized if is_short_acronym else normalized.casefold()


def candidate_term(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = clean(value)
    if not value or len(value) > MAX_TERM_LENGTH or not WORD_RE.fullmatch(value):
        return None
    if not any(char.isalpha() for char in value):
        return None
    return value


def read_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{path}:{line_number}: invalid JSON: {error.msg}") from error
            if isinstance(item, dict):
                yield item


def senses_for(entry: dict[str, Any], gloss_language: str) -> list[dict[str, Any]]:
    output = []
    for index, sense in enumerate(entry.get("senses", [])):
        if not isinstance(sense, dict):
            continue
        glosses = [clean(text) for text in sense.get("glosses", []) if isinstance(text, str)]
        glosses = [text for text in glosses if text and len(text) <= MAX_DEFINITION_LENGTH]
        if not glosses:
            continue
        examples = []
        for example in sense.get("examples", [])[:3]:
            if isinstance(example, dict):
                text = clean(example.get("text", ""))
                if text and len(text) <= 500:
                    examples.append(text)
        output.append({
            "id": str(sense.get("id") or f"{entry.get('word','')}:{entry.get('pos','')}:{index}"),
            "partOfSpeech": clean(entry.get("pos", "")) or None,
            "definitions": glosses[:6],
            "examples": examples,
            "glossLanguage": gloss_language,
        })
        # Keep the upstream relationship; runtime lookup follows it in the same
        # language pack instead of guessing a stem by removing word endings.
        bases = list(dict.fromkeys(
            base for reference in sense.get("form_of", [])
            if isinstance(reference, dict) and (base := candidate_term(reference.get("word")))
        ))[:4]
        if bases:
            output[-1]["formOfTerms"] = bases
            output[-1]["formOf"] = bases[0]
            output[-1]["formTags"] = [tag for tag in sense.get("tags", [])
                                      if isinstance(tag, str) and len(tag) <= 40][:20]
        for field in ("synonyms", "antonyms", "collocations"):
            related = []
            for item in [*sense.get(field, []), *entry.get(field, [])]:
                word = item.get("word") if isinstance(item, dict) else item
                if isinstance(word, str) and 0 < len(clean(word)) <= 120 and clean(word) not in related:
                    related.append(clean(word))
            if related:
                output[-1][field] = related[:6 if field == "collocations" else 12]
    return output


def ipa_for(entry: dict[str, Any]) -> str | None:
    for sound in entry.get("sounds", []):
        if isinstance(sound, dict) and isinstance(sound.get("ipa"), str):
            ipa = clean(sound["ipa"])
            if ipa:
                return ipa[:100]
    return None


def add_entry(index: dict[str, list[dict[str, Any]]], term: str, sense: dict[str, Any], ipa: str | None = None) -> None:
    term_key = key(term)
    existing = index.setdefault(term_key, [])
    if not any(item["id"] == sense["id"] and item["definitions"] == sense["definitions"] for item in existing):
        if ipa and not any(item.get("ipa") for item in existing):
            sense["ipa"] = ipa
        existing.append(sense)


def build_en_en(path: Path) -> dict[str, list[dict[str, Any]]]:
    index: dict[str, list[dict[str, Any]]] = {}
    for entry in read_jsonl(path):
        if entry.get("lang_code") != "en":
            continue
        term = candidate_term(entry.get("word"))
        if not term:
            continue
        for sense in senses_for(entry, "en"):
            add_entry(index, term, sense, ipa_for(entry))
    return index


def explicit_translation_pairs(entry: dict[str, Any]) -> Iterable[tuple[str, str]]:
    term = candidate_term(entry.get("word"))
    language = entry.get("lang_code")
    if not term or language not in ("en", "vi"):
        return
    for translation in entry.get("translations", []):
        if not isinstance(translation, dict):
            continue
        target_language = translation.get("lang_code", translation.get("code"))
        translated = candidate_term(translation.get("word"))
        if not translated:
            continue
        if language == "en" and target_language == "vi":
            yield translated, term
        elif language == "vi" and target_language == "en":
            yield term, translated


def reverse_sense(entry: dict[str, Any], vi_term: str, en_term: str) -> dict[str, Any]:
    return {
        "id": f"{key(en_term)}:translation:{key(vi_term)}",
        "partOfSpeech": clean(entry.get("pos", "")) or None,
        "definitions": [en_term], "examples": [], "glossLanguage": "en", "sourceTerm": en_term,
    }


def build_en_vi(path: Path) -> tuple[dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]]]:
    forward: dict[str, list[dict[str, Any]]] = {}
    reverse: dict[str, list[dict[str, Any]]] = {}
    for entry in read_jsonl(path):
        term = candidate_term(entry.get("word"))
        if not term:
            continue
        if entry.get("lang_code") == "en":
            for sense in senses_for(entry, "vi"):
                add_entry(forward, term, sense, ipa_for(entry))
        # Only use explicit Wiktionary translation pairs. Do not infer a reverse
        # entry by turning an arbitrary Vietnamese definition into an English term.
        for vi_term, en_term in explicit_translation_pairs(entry):
            add_entry(reverse, vi_term, reverse_sense(entry, vi_term, en_term))
    return forward, reverse


def pack_bytes(index: dict[str, list[dict[str, Any]]]) -> bytes:
    payload = b"".join(
        json.dumps({"term": term, "senses": senses}, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
        for term, senses in sorted(index.items())
    )
    import io

    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", mtime=0, compresslevel=9) as zipped:
        zipped.write(payload)
    return buffer.getvalue()


def write_pack(path: Path, package_id: str, direction: str, index: dict[str, list[dict[str, Any]]], sources: list[str]) -> dict[str, Any]:
    packed = pack_bytes(index)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(packed)
    return {
        "packageId": package_id,
        "direction": direction,
        "schemaVersion": SCHEMA_VERSION,
        "dataVersion": DATA_VERSION,
        "url": path.name,
        "contentType": "application/x-ndjson+gzip",
        "compressedBytes": len(packed),
        "entryCount": len(index),
        "checksumSha256": hashlib.sha256(packed).hexdigest(),
        "sources": sources,
        "license": "CC BY-SA 4.0 / GFDL; retain upstream attribution and comply with share-alike terms.",
    }


def insert_staging_sense(database: sqlite3.Connection, direction: str, term: str, sense: dict[str, Any]) -> None:
    payload = json.dumps(sense, ensure_ascii=False, separators=(",", ":"))
    database.execute("INSERT OR IGNORE INTO senses(direction, term, sense_id, payload) VALUES(?,?,?,?)",
                     (direction, key(term), sense["id"], payload))


def build_staging_database(english_path: Path, vietnamese_path: Path, database_path: Path, vietnamese_english_path: Path | None = None, progress: bool = False) -> sqlite3.Connection:
    database = sqlite3.connect(database_path)
    # This disposable database is rebuilt from source after interruption.
    database.execute("PRAGMA journal_mode = OFF")
    database.execute("PRAGMA synchronous = OFF")
    database.execute("PRAGMA cache_size = -131072")
    database.execute("CREATE TABLE senses (direction TEXT NOT NULL, term TEXT NOT NULL, sense_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(direction, term, sense_id, payload)) WITHOUT ROWID")
    database.execute("CREATE INDEX senses_direction_term_idx ON senses(direction, term)")
    database.execute("CREATE TABLE form_aliases (alias TEXT NOT NULL, base TEXT NOT NULL, PRIMARY KEY(alias, base)) WITHOUT ROWID")

    for entry in read_jsonl(vietnamese_path):
        term = candidate_term(entry.get("word"))
        if not term:
            continue
        if entry.get("lang_code") == "en":
            for sense in senses_for(entry, "vi"):
                ipa = ipa_for(entry)
                if ipa:
                    sense["ipa"] = ipa
                insert_staging_sense(database, "en-vi", term, sense)
        for vi_term, en_term in explicit_translation_pairs(entry):
            insert_staging_sense(database, "vi-en", vi_term, reverse_sense(entry, vi_term, en_term))
    database.commit()
    native_vi_keys = {row[0] for row in database.execute("SELECT DISTINCT term FROM senses WHERE direction='en-vi'")}
    translated_vi_keys = set(native_vi_keys)
    if progress:
        print(f"English-Vietnamese source: {len(native_vi_keys)} headwords", flush=True)

    for number, entry in enumerate(read_jsonl(english_path), 1):
        if progress and number % 50000 == 0:
            print(f"English source: {number} records processed", flush=True)
        if number % 10000 == 0:
            database.commit()
        if entry.get("lang_code") != "en":
            continue
        term = candidate_term(entry.get("word"))
        if not term:
            continue
        for sense in senses_for(entry, "en"):
            ipa = ipa_for(entry)
            if ipa:
                sense["ipa"] = ipa
            insert_staging_sense(database, "en-en", term, sense)
        for vi_term, en_term in explicit_translation_pairs(entry):
            insert_staging_sense(database, "vi-en", vi_term, reverse_sense(entry, vi_term, en_term))
            if key(en_term) not in native_vi_keys:
                translated = reverse_sense(entry, vi_term, en_term)
                translated.update(id=f"en-translation:{translated['id']}", definitions=[vi_term], glossLanguage="vi")
                translated.pop("sourceTerm", None)
                insert_staging_sense(database, "en-vi", en_term, translated)
                translated_vi_keys.add(key(en_term))
        for form in entry.get("forms", []):
            if isinstance(form, dict) and "table-tags" in form.get("tags", []):
                continue
            alias = candidate_term(form.get("form")) if isinstance(form, dict) else None
            if alias and key(term) in translated_vi_keys and key(alias) != key(term):
                database.execute("INSERT OR IGNORE INTO form_aliases VALUES (?,?)", (key(alias), key(term)))
        for sense in entry.get("senses", []):
            for reference in sense.get("form_of", []):
                base = candidate_term(reference.get("word")) if isinstance(reference, dict) else None
                if base and key(base) in translated_vi_keys and key(base) != key(term):
                    database.execute("INSERT OR IGNORE INTO form_aliases VALUES (?,?)", (key(term), key(base)))
    database.commit()
    return finish_staging_database(database, vietnamese_english_path, progress)


def finish_staging_database(database: sqlite3.Connection, vietnamese_english_path: Path | None = None, progress: bool = False) -> sqlite3.Connection:
    database.execute("CREATE INDEX IF NOT EXISTS form_aliases_base_idx ON form_aliases(base)")
    if progress:
        print("Joining English-Vietnamese form aliases", flush=True)
    database.execute("""CREATE TEMP TABLE alias_senses AS
        SELECT f.alias, f.base, s.sense_id, s.payload FROM form_aliases f
        JOIN senses s ON s.direction='en-vi' AND s.term=f.base
        WHERE NOT EXISTS (SELECT 1 FROM senses e WHERE e.direction='en-vi' AND e.term=f.alias)""")
    database.execute("""INSERT OR IGNORE INTO senses(direction,term,sense_id,payload)
        SELECT 'en-vi', alias, sense_id, json_set(payload, '$.formOf', base) FROM alias_senses""")
    database.execute("DROP TABLE alias_senses")
    database.commit()
    if progress:
        print("English source and inflected English-Vietnamese forms complete", flush=True)

    if vietnamese_english_path:
        for entry in read_jsonl(vietnamese_english_path):
            if entry.get("lang_code") != "vi":
                continue
            term = candidate_term(entry.get("word"))
            if not term:
                continue
            for sense in senses_for(entry, "en"):
                english_headword = candidate_term(sense["definitions"][0])
                if english_headword and database.execute("SELECT 1 FROM senses WHERE direction='en-en' AND term=? LIMIT 1", (key(english_headword),)).fetchone():
                    sense["sourceTerm"] = english_headword
                sense["id"] = f"enwiktionary-vi:{sense['id']}"
                insert_staging_sense(database, "vi-en", term, sense)
        database.commit()
    database.commit()
    return database


def write_chunked_packages(database: sqlite3.Connection, out_dir: Path, chunk_size: int = 5000, data_version: str = DATA_VERSION, progress: bool = False) -> list[dict[str, Any]]:
    packages = []
    source_names = {
        "en-en": ["Kaikki English Wiktionary"],
        "en-vi": ["Kaikki Vietnamese Wiktionary"],
        "vi-en": ["Kaikki Vietnamese Wiktionary; explicit translation pairs"],
    }
    for direction in ("en-en", "en-vi", "vi-en"):
        cursor = database.execute("SELECT term, payload FROM senses WHERE direction = ? ORDER BY term, sense_id, payload", (direction,))
        groups = ((term, [item[1] for item in group]) for term, group in itertools.groupby(cursor, key=lambda row: row[0]))
        chunks = []
        chunk_number = 0
        buffer: dict[str, list[dict[str, Any]]] = {}
        buffer_bytes = 0
        for term, senses in groups:
            parsed_senses = [json.loads(payload) for payload in senses]
            parsed_senses.sort(key=lambda sense: sense.get("partOfSpeech") == "name")
            entry_bytes = len(json.dumps({"term": term, "senses": parsed_senses}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) + 1
            if buffer and (len(buffer) >= chunk_size or buffer_bytes + entry_bytes > 2 * 1024 * 1024):
                chunks.append(write_stream_chunk(out_dir, direction, chunk_number, buffer))
                chunk_number += 1
                if progress and chunk_number % 50 == 0:
                    print(f"Packing {direction}: {sum(chunk['entryCount'] for chunk in chunks)} keys", flush=True)
                buffer = {}
                buffer_bytes = 0
            if entry_bytes > 2 * 1024 * 1024:
                raise ValueError(f"Dictionary entry is too large to distribute safely: {term}")
            buffer[term] = parsed_senses
            buffer_bytes += entry_bytes
        if buffer:
            chunks.append(write_stream_chunk(out_dir, direction, chunk_number, buffer))
        packages.append({
            "packageId": f"phrasebook-{direction}", "direction": direction,
            "schemaVersion": SCHEMA_VERSION, "dataVersion": data_version,
            "contentType": "application/x-ndjson+gzip", "entryCount": sum(chunk["entryCount"] for chunk in chunks),
            "compressedBytes": sum(chunk["compressedBytes"] for chunk in chunks),
            "chunks": chunks, "sources": source_names[direction],
            "license": "CC BY-SA 4.0 / GFDL; retain upstream attribution and comply with share-alike terms.",
        })
        if progress:
            print(f"Packed {direction}: {packages[-1]['entryCount']} keys", flush=True)
    return packages


def write_stream_chunk(out_dir: Path, direction: str, number: int, index: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    filename = f"{direction}-{number + 1:04d}.json.gz"
    path = out_dir / filename
    uncompressed_bytes = 0
    with path.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, compresslevel=9) as zipped:
            for term, senses in sorted(index.items()):
                row = json.dumps({"term": term, "senses": senses}, ensure_ascii=False, separators=(",", ":"))
                data = row.encode("utf-8") + b"\n"
                zipped.write(data)
                uncompressed_bytes += len(data)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return {"url": filename, "entryCount": len(index), "compressedBytes": path.stat().st_size,
            "uncompressedBytes": uncompressed_bytes, "checksumSha256": digest}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--english", type=Path, required=True, help="Kaikki English Wiktionary JSONL")
    parser.add_argument("--vietnamese", type=Path, required=True, help="Kaikki Vietnamese Wiktionary JSONL")
    parser.add_argument("--out", type=Path, default=Path("artifacts/dictionaries"))
    parser.add_argument("--english-source", default="Kaikki English Wiktionary", help="Attribution name for the English input edition")
    parser.add_argument("--vietnamese-english", type=Path, help="Vietnamese entries with English glosses from English Wiktionary")
    parser.add_argument("--data-version", default=DATA_VERSION)
    parser.add_argument("--progress", action="store_true")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    database_path = args.out / ".dictionary-build.sqlite"
    try:
        for staging_file in (database_path, Path(str(database_path) + "-wal"), Path(str(database_path) + "-shm")):
            staging_file.unlink(missing_ok=True)
        database = build_staging_database(args.english, args.vietnamese, database_path, args.vietnamese_english, args.progress)
        packs = write_chunked_packages(database, args.out, data_version=args.data_version, progress=args.progress)
        packs[0]["sources"] = [args.english_source]
        if args.vietnamese_english:
            packs[2]["sources"].append("Kaikki English Wiktionary; Vietnamese entries with English definitions")
        database.close()
        database_path.unlink(missing_ok=True)
        Path(str(database_path) + "-wal").unlink(missing_ok=True)
        Path(str(database_path) + "-shm").unlink(missing_ok=True)
    except (OSError, ValueError, sqlite3.Error) as error:
        print(error, file=sys.stderr)
        if database_path.exists(): database_path.unlink(missing_ok=True)
        return 1
    manifest = {"schemaVersion": SCHEMA_VERSION, "dataVersion": args.data_version, "packages": packs}
    manifest_path = args.out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(packs)} packs to {args.out}; manifest: {manifest_path}")
    for pack in packs:
        print(f"{pack['direction']}: {pack['entryCount']} keys, {pack['compressedBytes']} compressed bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
