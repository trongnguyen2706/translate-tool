import { zipSync, Unzip, UnzipInflate, strToU8, strFromU8 } from "fflate";

const MAX_PART = 1_500_000, MAX_TOTAL = 200_000_000, MAX_FILES = 2000;
const keys = ["vocabulary", "translations", "flashcards", "daily_sets", "identity_refs", "occurrences"];
const blank = () => Object.fromEntries([["version", 4], ...keys.map((key) => [key, []])]);
const sha = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

// Every part contains its vocabulary dependencies, making its restore transaction independent.
export function splitBackup(data) {
  const words = new Map(data.vocabulary.map((word) => [word.id, word]));
  const parts = [];
  for (const key of keys) {
    let part = blank();
    for (const row of data[key] ?? []) {
      const copy = structuredClone(part);
      copy[key].push(row);
      const ids = key === "vocabulary" ? [] : key === "daily_sets" ? row.items.map((item) => item.vocabulary_item_id) : row.vocabulary_item_id ? [row.vocabulary_item_id] : [];
      for (const id of ids) {
        if (!words.has(id)) throw new Error("Backup contains a missing vocabulary reference");
        if (!copy.vocabulary.some((word) => word.id === id)) copy.vocabulary.push(words.get(id));
      }
      if (strToU8(JSON.stringify(copy)).length > MAX_PART || copy[key].length > 500 || copy.vocabulary.length > 500) {
        if (!keys.some((name) => part[name].length)) throw new Error("One backup record is too large");
        parts.push(part); part = blank(); part[key].push(row);
        for (const id of ids) if (!part.vocabulary.some((word) => word.id === id)) part.vocabulary.push(words.get(id));
        if (strToU8(JSON.stringify(part)).length > MAX_PART) throw new Error("One backup record is too large");
      } else part = copy;
    }
    if (keys.some((name) => part[name].length)) parts.push(part);
  }
  if (!parts.length) parts.push(blank());
  if (parts.length > MAX_FILES) throw new Error("Backup exceeds the supported part count");
  return parts;
}

export async function createBackupArchive(data) {
  const files = {}, parts = []; let total = 0;
  for (const [index, part] of splitBackup(data).entries()) {
    const name = `part-${String(index + 1).padStart(4, "0")}.json`, bytes = strToU8(JSON.stringify(part));
    total += bytes.length;
    if (total > MAX_TOTAL) throw new Error("Backup exceeds 200 MB of uncompressed data");
    files[name] = bytes;
    parts.push({ name, id: crypto.randomUUID(), bytes: bytes.length, sha256: await sha(bytes) });
  }
  files["manifest.json"] = strToU8(JSON.stringify({ format: "phrasebook-backup", version: 1, exportedAt: new Date().toISOString(), parts }));
  const archive = zipSync(files, { level: 6 });
  if (archive.length > 100_000_000) throw new Error("Compressed backup exceeds the 100 MB import limit");
  return archive;
}

export async function readBackupArchive(bytes) {
  if (bytes.length > 100_000_000) throw new Error("ZIP imports are limited to 100 MB");
  const files = new Map(); let total = 0, count = 0;
  const unzip = new Unzip((file) => {
    if (++count > MAX_FILES + 1 || !/^(manifest\.json|part-\d{4}\.json)$/.test(file.name) || files.has(file.name)) throw new Error("Unexpected or duplicate ZIP entry");
    if (file.originalSize > MAX_PART || (file.compression !== 0 && file.compression !== 8)) throw new Error("Unsupported or oversized ZIP entry");
    const chunks = []; let size = 0;
    files.set(file.name, null);
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      size += chunk.length; total += chunk.length;
      if (size > MAX_PART || total > MAX_TOTAL) { file.terminate(); throw new Error("ZIP exceeds decompression limits"); }
      chunks.push(chunk);
      if (final) {
        const result = new Uint8Array(size); let offset = 0;
        for (const item of chunks) { result.set(item, offset); offset += item.length; }
        files.set(file.name, result);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 4096) unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
  if (!files.get("manifest.json")) throw new Error("Backup manifest missing");
  const manifest = JSON.parse(strFromU8(files.get("manifest.json")));
  if (manifest.format !== "phrasebook-backup" || manifest.version !== 1 || !Array.isArray(manifest.parts) || !manifest.parts.length || manifest.parts.length > MAX_FILES || files.size !== manifest.parts.length + 1) throw new Error("Invalid backup manifest");
  const seen = new Set(), ids = new Set(), parts = [];
  for (const part of manifest.parts) {
    const data = files.get(part.name);
    if (!/^part-\d{4}\.json$/.test(part.name) || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(part.id) || seen.has(part.name) || ids.has(part.id) || !data || data.length !== part.bytes || await sha(data) !== part.sha256) throw new Error("Backup checksum or part ID mismatch");
    seen.add(part.name); ids.add(part.id);
    const body = strFromU8(data), parsed = JSON.parse(body);
    if (parsed.version !== 4 || !Array.isArray(parsed.vocabulary) || parsed.vocabulary.length > 2000) throw new Error("Invalid backup part");
    parts.push({ id: part.id, name: part.name, body });
  }
  return parts;
}
