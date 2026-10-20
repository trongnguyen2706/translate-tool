import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { createBackupArchive, readBackupArchive } from "../src/lib/backup-archive.mjs";

test("large backups are bounded, self-contained, verified and resumable by stable part IDs", async () => {
  const vocabulary = Array.from({ length: 2401 }, (_, index) => ({ id: crypto.randomUUID(), term: `word ${index}`, meaning_en: "a definition", details: { ipa: "/wɜːd/" } }));
  const flashcards = vocabulary.map((word) => ({ vocabulary_item_id: word.id, status: "mastered" }));
  const archive = await createBackupArchive({ vocabulary, flashcards, occurrences: [{ vocabulary_item_id: vocabulary.at(-1).id, context_text: "saved context" }], daily_sets: [{ items: [{ vocabulary_item_id: vocabulary[0].id, studied: true }] }] });
  const parts = await readBackupArchive(archive);
  assert.ok(parts.length > 5);
  assert.deepEqual((await readBackupArchive(archive)).map((part) => part.id), parts.map((part) => part.id));
  const seen = new Set(); let cards = 0;
  for (const part of parts) {
    const data = JSON.parse(part.body), ids = new Set(data.vocabulary.map((word) => word.id));
    assert.ok(data.vocabulary.length <= 500);
    for (const word of data.vocabulary) seen.add(word.id);
    for (const row of [...data.flashcards, ...data.occurrences, ...data.identity_refs]) assert.ok(ids.has(row.vocabulary_item_id));
    for (const set of data.daily_sets) for (const item of set.items) assert.ok(ids.has(item.vocabulary_item_id));
    cards += data.flashcards.length;
  }
  assert.equal(seen.size, 2401); assert.equal(cards, 2401);
  const corrupt = unzipSync(archive);
  corrupt[parts[0].name] = strToU8("{}");
  await assert.rejects(readBackupArchive(zipSync(corrupt)), /checksum/);
});

test("ZIP parser rejects unexpected files, expansion bombs and invalid references", async () => {
  await assert.rejects(readBackupArchive(zipSync({ "../manifest.json": strToU8("{}") })), /Unexpected/);
  await assert.rejects(readBackupArchive(zipSync({ "manifest.json": new Uint8Array(1_600_000) })), /oversized/);
  await assert.rejects(createBackupArchive({ vocabulary: [], flashcards: [{ vocabulary_item_id: crypto.randomUUID() }] }), /missing vocabulary/);
});
