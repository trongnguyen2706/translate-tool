"""Extract English vocabulary entries from the user-provided IELTS Vocabulary PDF.

Usage: python scripts/extract_ielts_vocabulary.py SOURCE.pdf OUTPUT.json
The output follows Phrasebook's JSON import format. It is intended for a
private import, and the source PDF is never copied into the repository.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

from pypdf import PdfReader


SECTIONS = [
    ("ENVIRONMENT", 4, "environment"),
    ("ENERGY", 12, "environment"),
    ("EDUCATION", 19, "education"),
    ("WORK", 27, "work"),
    ("HEALTH", 34, "health"),
    ("CRIME", 42, "society"),
    ("TECHNOLOGY", 50, "technology"),
    ("GOVERNMENT SPENDING", 57, "society"),
    ("TRANSPORTATION", 65, "travel"),
    ("CITY LIFE", 72, "society"),
    ("FAMILY & CHILDREN", 79, "daily-life"),
    ("LANGUAGES", 86, "culture"),
    ("ANIMALS", 94, "science"),
    ("MEDIA AND ADVERTISING", 101, "culture"),
    ("FOOD AND DIET", 108, "health"),
]

MAIN = re.compile(r"^(\d{1,2})\.\s+(.+)$")
VIETNAMESE = re.compile(r"[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]", re.I)
POS_SUFFIX = re.compile(r"\s+\((?:n|v|adj|adv|phr|phrase)\)\s*$", re.I)
REJECTED: list[tuple[int, str]] = []
UNPAIRED: list[tuple[int, str]] = []


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\uf0b7", " ")).strip(" \t:;–-")


def is_english_term(value: str) -> bool:
    value = clean(value)
    if not value or len(value) > 120 or VIETNAMESE.search(value):
        return False
    if not re.search(r"[A-Za-z]", value):
        return False
    if value.lower().startswith(("bài ", "từ vựng", "ielts vocabulary")):
        return False
    return True


def split_entry(text: str) -> tuple[str, str] | None:
    if ":" not in text:
        return None
    term, meaning = text.split(":", 1)
    term = POS_SUFFIX.sub("", clean(term))
    meaning = clean(meaning)
    if not is_english_term(term) or not meaning or len(meaning) > 500:
        return None
    return term, meaning


def entry(term: str, meaning: str, section: str, topic: str, page: int, kind: str) -> dict:
    return {
        "term": term,
        "kind": "phrase" if len(term.split()) > 1 else "word",
        "source_language": "en",
        "meaning_vi": meaning,
        "meaning_en": "",
        "example": "",
        "collocations": [],
        "source_text": "",
        "note": f"IELTS Vocabulary - IELTS Nguyễn Huyền; {section}; trang {page}; {kind}.",
        "cefr_level": None,
        "ielts_relevance": "medium",
        "ielts_skills": [],
        "topics": [topic],
        "tags": ["IELTS Vocabulary"],
        "learning_reason": "Có trong tài liệu học IELTS; chưa xác minh tần suất xuất hiện trong đề thi.",
    }


def segment_entries(segment: list[tuple[int, str]], section: str, topic: str) -> list[dict]:
    if not segment:
        return []
    page = segment[0][0]
    first = MAIN.match(segment[0][1])
    if not first:
        return []
    output = []
    head = first.group(2)
    head_index = 1
    while ":" not in head and head_index < min(4, len(segment)):
        head += " " + segment[head_index][1]
        head_index += 1
    parsed = split_entry(head)
    if parsed:
        term, meaning = parsed
        while head_index < len(segment):
            continuation = segment[head_index][1]
            if continuation == "Từ vựng học thêm" or not VIETNAMESE.search(continuation):
                break
            if len(meaning) + len(continuation) + 1 > 500:
                break
            meaning += " " + continuation
            head_index += 1
        parsed = (term, meaning)
    if parsed:
        output.append(entry(*parsed, section, topic, page, "mục chính"))

    supplemental = False
    pending: tuple[int, str] | None = None
    for line_page, line in segment[head_index:]:
        if line == "Từ vựng học thêm":
            supplemental = True
            continue
        if not supplemental:
            continue
        candidate = split_entry(line)
        if candidate:
            if pending:
                old = split_entry(pending[1])
                if old:
                    output.append(entry(*old, section, topic, pending[0], "học thêm"))
            pending = (line_page, line)
        elif ":" in line:
            REJECTED.append((line_page, line))
        elif is_english_term(line):
            UNPAIRED.append((line_page, line))
        elif pending and VIETNAMESE.search(line) and not re.match(r"^\d+\.", line):
            # Wrapped Vietnamese explanation from the previous item.
            pending = (pending[0], pending[1] + " " + line)
    if pending:
        old = split_entry(pending[1])
        if old:
            output.append(entry(*old, section, topic, pending[0], "học thêm"))
    return output


def read_section(reader: PdfReader, name: str, first_page: int, last_page: int, topic: str) -> list[dict]:
    lines: list[tuple[int, str]] = []
    for page_num in range(first_page, last_page + 1):
        page_text = reader.pages[page_num - 1].extract_text() or ""
        if "BÀI TẬP" in page_text:
            page_text = page_text.split("BÀI TẬP", 1)[0]
            stop = True
        else:
            stop = False
        for raw in page_text.splitlines():
            line = clean(raw)
            if not line or line == name or line == str(page_num):
                continue
            lines.append((page_num, line))
        if stop:
            break

    segments: list[list[tuple[int, str]]] = []
    for line in lines:
        if MAIN.match(line[1]):
            segments.append([line])
        elif segments:
            segments[-1].append(line)
    return [item for segment in segments for item in segment_entries(segment, name, topic)]


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract_ielts_vocabulary.py SOURCE.pdf OUTPUT.json")
    source, destination = map(Path, sys.argv[1:])
    reader = PdfReader(str(source))
    items: list[dict] = []
    for index, (name, start, topic) in enumerate(SECTIONS):
        end = SECTIONS[index + 1][1] - 1 if index + 1 < len(SECTIONS) else len(reader.pages)
        section_items = read_section(reader, name, start, end, topic)
        main_count = sum("mục chính" in item["note"] for item in section_items)
        print(f"{name}: {len(section_items)} ({main_count} chính, {len(section_items) - main_count} học thêm)")
        items.extend(section_items)

    unique: dict[tuple[str, str], dict] = {}
    for item in items:
        key = (clean(item["term"]).casefold(), clean(item["meaning_vi"]).casefold()[:180])
        if key not in unique:
            unique[key] = item
        else:
            previous = unique[key]
            previous["topics"] = list(dict.fromkeys([*previous["topics"], *item["topics"]]))[:4]
    vocabulary = list(unique.values())
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({"version": 3, "vocabulary": vocabulary, "translations": [], "daily_sets": [], "flashcards": []}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Total: {len(items)} candidates, {len(vocabulary)} unique, {destination.stat().st_size} bytes")
    print("Kinds:", dict(Counter(item["kind"] for item in vocabulary)))
    print("Rejected colon lines:", len(REJECTED))
    for warning in REJECTED[:30]:
        print("  ", warning)
    print("Unpaired English lines:", len(UNPAIRED))
    for warning in UNPAIRED[:30]:
        print("  ", warning)


if __name__ == "__main__":
    main()
