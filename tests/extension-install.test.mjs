import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { getPackage } from "../extension/src/storage.mjs";

let receive;
const local = {};
globalThis.chrome = {
  runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(listener) { receive = listener; } } },
  alarms: { onAlarm: { addListener() {} } },
  storage: { local: { async set(values) { Object.assign(local, values); } } }
};
await import("../extension/src/background.mjs");

function send(type, values) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Worker did not respond")), 5000);
    receive({ protocol: 1, type, ...values }, {}, (result) => { clearTimeout(timer); resolve(result); });
  });
}

function repository(version, entries, mode = "en-vi") {
  const files = new Map();
  const chunks = entries.map((rows, index) => {
    const plain = Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    const bytes = gzipSync(plain);
    const url = `${version}-${index}.json.gz`;
    files.set(`/${url}`, bytes);
    return { url, entryCount: rows.length, compressedBytes: bytes.length, uncompressedBytes: plain.length, checksumSha256: createHash("sha256").update(bytes).digest("hex") };
  });
  return { files, pack: { packageId: `phrasebook-${mode}`, direction: mode, dataVersion: version, contentType: "application/x-ndjson+gzip", chunks, entryCount: entries.flat().length, compressedBytes: chunks.reduce((sum, chunk) => sum + chunk.compressedBytes, 0) } };
}
const row = (term, definition, language = "vi") => ({ term, senses: [{ id: term, definitions: [definition], glossLanguage: language }] });

test("dictionary installs activate atomically, preserve the old version on failure, and resume verified chunks", async (t) => {
  let current = repository("test-v1", [[row("bank", "ngân hàng")]]);
  let failPath = "";
  const requests = new Map();
  t.mock.method(globalThis, "fetch", async (input) => {
    const path = new URL(input).pathname;
    if (path === "/manifest.json") return Response.json({ schemaVersion: 1, packages: [current.pack] });
    requests.set(path, (requests.get(path) ?? 0) + 1);
    if (path === failPath) return new Response("unavailable", { status: 503 });
    return new Response(current.files.get(path), { status: current.files.has(path) ? 200 : 404 });
  });
  const install = () => send("install-dictionary", { manifestUrl: "https://dictionary.test/manifest.json", mode: "en-vi" });
  const lookup = () => send("lookup", { term: "bank", mode: "en-vi" });

  assert.equal((await install()).ok, true);
  assert.equal((await lookup()).data.result.senses[0].definitions[0], "ngân hàng");

  const next = repository("test-v2", [[row("bank", "ngân hàng thương mại")], [row("hello", "xin chào")]]);
  current = next;
  failPath = "/test-v2-1.json.gz";
  assert.equal((await install()).ok, false);
  assert.equal((await getPackage("phrasebook-en-vi@test-v2")).completedChunks, 1);
  assert.equal((await lookup()).data.result.senses[0].definitions[0], "ngân hàng");

  current = repository("test-v2", [[row("bank", "nội dung đã đổi")], [row("hello", "xin chào")]]);
  assert.match((await install()).error, /chưa tăng phiên bản/);
  current = next;
  failPath = "";
  assert.equal((await install()).ok, true);
  assert.equal(requests.get("/test-v2-0.json.gz"), 1);
  assert.equal((await lookup()).data.result.senses[0].definitions[0], "ngân hàng thương mại");
  assert.equal((await getPackage("phrasebook-en-vi@test-v1")).active, false);
  assert.equal((await getPackage("phrasebook-en-vi@test-v2")).active, true);
  assert.equal(local.dictionaryProgress.state, "ready");

  current = repository("test-wrong-language", [[row("bank", "a financial institution", "en")]]);
  assert.equal((await install()).ok, false);
  assert.equal((await lookup()).data.result.senses[0].definitions[0], "ngân hàng thương mại");
});
