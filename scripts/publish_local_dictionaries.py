"""Verify built dictionary chunks and publish an immutable local data version."""
import argparse
import copy
import gzip
import hashlib
import json
import re
import shutil
from pathlib import Path


def publish(source: Path, public: Path):
    source = source.resolve()
    public = public.resolve()
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["dataVersion"]
    if not re.fullmatch(r"[A-Za-z0-9._-]+", version) or version in (".", ".."):
        raise ValueError("Invalid dictionary version")
    destination = public / version
    destination.mkdir(parents=True, exist_ok=True)
    published = copy.deepcopy(manifest)
    for pack in published["packages"]:
        count = 0
        max_senses = 0
        language = "vi" if pack["direction"] == "en-vi" else "en"
        for chunk in pack["chunks"]:
            chunk_path = (source / chunk["url"]).resolve()
            if not chunk_path.is_relative_to(source):
                raise ValueError("Chunk path escapes the source directory")
            raw = chunk_path.read_bytes()
            if len(raw) != chunk["compressedBytes"] or hashlib.sha256(raw).hexdigest() != chunk["checksumSha256"]:
                raise ValueError(f"Invalid compressed chunk: {chunk_path.name}")
            with gzip.open(chunk_path, "rb") as data:
                plain = data.read(2 * 1024 * 1024 + 1)
            if len(plain) != chunk["uncompressedBytes"] or len(plain) > 2 * 1024 * 1024:
                raise ValueError("Invalid uncompressed chunk size")
            lines = plain.splitlines()
            if len(lines) != chunk["entryCount"] or len(lines) > 5000:
                raise ValueError("Invalid chunk entry count")
            for line in lines:
                entry = json.loads(line)
                if len(entry["term"]) > 120 or len(entry["senses"]) > 1000 or len(line.decode("utf-8")) > 1_000_000:
                    raise ValueError("Entry exceeds extension installer bounds")
                if any(sense.get("glossLanguage") != language for sense in entry["senses"]):
                    raise ValueError("Dictionary definition language mismatch")
                max_senses = max(max_senses, len(entry["senses"]))
            target = destination / chunk_path.name
            if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() != chunk["checksumSha256"]:
                raise ValueError("Published data version is immutable; choose a new version")
            shutil.copyfile(chunk_path, target)
            chunk["url"] = f"{version}/{target.name}"
            count += len(lines)
        if count != pack["entryCount"]:
            raise ValueError("Package entry count mismatch")
        print(f"Verified {pack['direction']}: {count} keys; {pack['compressedBytes']} bytes compressed; max {max_senses} senses", flush=True)
    attribution = "\n".join([
        "Dictionary data derived from Wiktionary contributors via Kaikki.org / Wiktextract.",
        "Sources: https://kaikki.org/dictionary/English/ ; https://kaikki.org/dictionary/Vietnamese/ ; https://kaikki.org/dictionary/rawdata.html",
        "Source editions: English Wiktionary and Vietnamese Wiktionary.",
        "License: CC BY-SA 4.0 / GFDL, as recorded in each package manifest.",
        "https://creativecommons.org/licenses/by-sa/4.0/ ; https://www.gnu.org/licenses/fdl-1.3.html",
        "Changes: selected language pairs; normalized terms; compacted definitions and relations; added explicit form aliases; split and compressed chunks.",
    ]) + "\n"
    (destination / "ATTRIBUTION.txt").write_text(attribution, encoding="utf-8")
    published["attributionUrl"] = f"{version}/ATTRIBUTION.txt"
    pending = public / ".manifest-pending.json"
    pending.write_text(json.dumps(published, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    pending.replace(public / "manifest.json")
    print(f"Published {version}; local manifest: http://localhost:3000/dictionaries/manifest.json", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--public", type=Path, default=Path("public/dictionaries"))
    args = parser.parse_args()
    publish(args.source, args.public)
